import { GoogleGenAI } from "@google/genai";
import {
  extractedLabelSchema,
} from "@/lib/schemas/extracted-label.schema";
import type { ExtractedLabel } from "@/types/extracted-label";
import type {
  LabelExtractionInput,
  LabelExtractionService,
} from "./label-extraction.service";
import { buildOcrPrompt } from "./ocr-prompt-builder";
import {
  computeExtractionScores,
  hashPrompt,
  summarizeRawText,
  tracedExtract,
} from "@/lib/observability/braintrust";

// Retry policy adopted from
// https://github.com/fsyeddev/ttb-label/blob/main/lib/gemini.ts with attribution.
// Delays in milliseconds: first retry after 5s, second after 10s.
export const GEMINI_503_RETRY_DELAYS_MS = [5000, 10000] as const;

export function is503Error(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; message?: unknown };
  if (e.status === 503) return true;
  if (typeof e.message === "string" && /\b503\b/.test(e.message)) return true;
  return false;
}

export async function callWithRetryOn503<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[] = GEMINI_503_RETRY_DELAYS_MS,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!is503Error(err) || attempt >= delaysMs.length) throw err;
      const delayMs = delaysMs[attempt];
      console.warn(
        `[gemini] 503 — retrying in ${delayMs}ms (attempt ${attempt + 1}/${delaysMs.length})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}

// Even with responseMimeType: "application/json", Gemini occasionally wraps
// output in ```json ... ``` fences — more likely when the prompt itself
// contains a JSON example. Strip them defensively before JSON.parse.
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export class GeminiExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GeminiExtractionError";
  }
}

export interface GeminiLabelExtractionConfig {
  apiKey: string;
  model: string;
}

export class GeminiLabelExtractionService implements LabelExtractionService {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(config: GeminiLabelExtractionConfig) {
    if (!config.apiKey) {
      throw new GeminiExtractionError(
        "Gemini API key is required to construct the Gemini extraction service.",
      );
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model;
  }

  async extract(input: LabelExtractionInput): Promise<ExtractedLabel> {
    const { application, images } = input;
    const prompt = buildOcrPrompt(application);
    const productType = application.applicationTypeStep.productType;
    const promptHash = hashPrompt(prompt.userInstruction);

    return tracedExtract(async (span) => {
      span.log({
        input: {
          productType,
          imageCount: images.length,
          promptHash,
        },
        metadata: {
          model: this.model,
          mockExtraction: false,
          promptHash,
        },
      });

      const imageParts = images
        .filter((img) => img.base64 && img.mimeType)
        .map((img) => ({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64 as string,
          },
        }));

      if (imageParts.length === 0) {
        throw new GeminiExtractionError(
          "No image payloads with base64 data were provided to the Gemini extractor.",
        );
      }

      const userParts = [
        ...imageParts,
        { text: prompt.userInstruction },
      ];

      let response;
      const tCall = Date.now();
      try {
        response = await callWithRetryOn503(() =>
          this.client.models.generateContent({
            model: this.model,
            contents: [
              {
                role: "user",
                parts: userParts,
              },
            ],
            config: {
              systemInstruction: prompt.systemInstruction,
              responseMimeType: "application/json",
              temperature: 0.1,
            },
          }),
        );
      } catch (err) {
        throw new GeminiExtractionError(
          "Gemini call failed while extracting the label.",
          err,
        );
      }
      const geminiCallMs = Date.now() - tCall;

      const text = response.text ?? "";
      if (!text.trim()) {
        throw new GeminiExtractionError(
          "Gemini returned an empty response body.",
        );
      }

      const cleaned = stripJsonFences(text);

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(cleaned);
      } catch (err) {
        const finishReason =
          (response as { candidates?: Array<{ finishReason?: string }> })
            .candidates?.[0]?.finishReason ?? "unknown";
        throw new GeminiExtractionError(
          `Gemini response was not valid JSON (finishReason=${finishReason}, len=${text.length}). First 500 chars: ${cleaned.slice(0, 500)}`,
          err,
        );
      }

      if (process.env.EXTRACTION_DEBUG_LOG === "true") {
        console.info(
          "[gemini] raw response (truncated 2KB)",
          text.slice(0, 2000),
        );
      }

      const result = extractedLabelSchema.safeParse(parsedJson);
      if (!result.success) {
        throw new GeminiExtractionError(
          `Gemini response did not match ExtractedLabel schema: ${result.error.message}`,
          result.error,
        );
      }

      const extractedLabel: ExtractedLabel = {
        ...result.data,
        imagesAnalyzed:
          result.data.imagesAnalyzed?.length > 0
            ? result.data.imagesAnalyzed
            : images.map((i) => i.id),
      };

      span.log({
        output: {
          rawTextTruncated: summarizeRawText(extractedLabel.rawText),
          inferredProductType: extractedLabel.inferredProductType,
          inferredProductTypeConfidence:
            extractedLabel.inferredProductTypeConfidence,
          normalizedFieldKeys: Object.keys(extractedLabel.normalizedFields),
        },
        metrics: { geminiCallMs },
        scores: computeExtractionScores(extractedLabel, productType),
      });

      return extractedLabel;
    });
  }
}

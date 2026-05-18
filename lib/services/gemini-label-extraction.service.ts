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
  computeGeminiCostUsd,
  computeLatencyScore,
  hashPrompt,
  summarizeRawText,
  tracedExtract,
} from "@/lib/observability/braintrust";

// Retry policy. Phase 6 reworked from a fixed 5s/10s schedule to exponential
// backoff with jitter, and widened the trigger to also match 429 / quota
// exhaustion responses (`RESOURCE_EXHAUSTED`). Schedule: 1s, 2s, 4s, 8s ⇒
// ~15s worst-case before giving up. Jitter ±20% spreads concurrent retries
// across workers so a single burst of 429s doesn't lock-step into another
// burst on the way back up. See docs/specs/phase-6-batch-ui-first-row-fast-path.md.
export const GEMINI_RETRY_BASE_DELAYS_MS = [1000, 2000, 4000, 8000] as const;

/** @deprecated kept for backward-compat imports; tests should consume
 *  GEMINI_RETRY_BASE_DELAYS_MS directly. Removed in a future cleanup. */
export const GEMINI_503_RETRY_DELAYS_MS = GEMINI_RETRY_BASE_DELAYS_MS;

export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; message?: unknown };
  if (e.status === 503 || e.status === 429) return true;
  if (typeof e.message === "string") {
    if (/\b503\b/.test(e.message)) return true;
    if (/\b429\b/.test(e.message)) return true;
    if (/RESOURCE_EXHAUSTED/.test(e.message)) return true;
    if (/rate.?limit/i.test(e.message)) return true;
  }
  return false;
}

/** @deprecated rename to `isRetryableError`. Re-exported for backward compat. */
export const is503Error = isRetryableError;

function jitter(baseMs: number): number {
  // ±20% jitter, deterministic floor so a 1000ms base never becomes 0.
  const spread = baseMs * 0.2;
  const offset = (Math.random() * 2 - 1) * spread;
  return Math.max(100, Math.floor(baseMs + offset));
}

export async function callWithRetryOn503<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[] = GEMINI_RETRY_BASE_DELAYS_MS,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt >= delaysMs.length) throw err;
      const delayMs = jitter(delaysMs[attempt]);
      console.warn(
        `[gemini] retryable error — retrying in ${delayMs}ms (attempt ${attempt + 1}/${delaysMs.length})`,
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
              // Disable Gemini 2.5 thinking for this structured OCR task.
              // Thinking adds latency without measurable accuracy gain on a
              // schema-constrained extraction (observed: thoughtsTokens up
              // to 62k pushing geminiCallMs to 237s on a 2-image call).
              // Requires @google/genai >= 1.x — the 0.7 SDK silently stripped
              // every field except includeThoughts from thinkingConfig.
              thinkingConfig: { thinkingBudget: 0 },
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

      const usage = (response as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
          thoughtsTokenCount?: number;
        };
      }).usageMetadata;
      const finishReason =
        (response as { candidates?: Array<{ finishReason?: string }> })
          .candidates?.[0]?.finishReason ?? "unknown";

      span.log({
        output: {
          rawTextTruncated: summarizeRawText(extractedLabel.rawText),
          inferredProductType: extractedLabel.inferredProductType,
          inferredProductTypeConfidence:
            extractedLabel.inferredProductTypeConfidence,
          normalizedFieldKeys: Object.keys(extractedLabel.normalizedFields),
          finishReason,
        },
        metrics: {
          geminiCallMs,
          promptTokens: usage?.promptTokenCount,
          completionTokens: usage?.candidatesTokenCount,
          totalTokens: usage?.totalTokenCount,
          thoughtsTokens: usage?.thoughtsTokenCount,
          estimated_cost_usd: computeGeminiCostUsd(usage),
        },
        scores: {
          ...computeExtractionScores(extractedLabel, productType),
          "extraction.latencyUnder5s": computeLatencyScore(geminiCallMs),
        },
      });

      return extractedLabel;
    });
  }
}

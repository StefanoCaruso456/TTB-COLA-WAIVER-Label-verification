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
    try {
      response = await this.client.models.generateContent({
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
      });
    } catch (err) {
      throw new GeminiExtractionError(
        "Gemini call failed while extracting the label.",
        err,
      );
    }

    const text = response.text ?? "";
    if (!text.trim()) {
      throw new GeminiExtractionError(
        "Gemini returned an empty response body.",
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch (err) {
      throw new GeminiExtractionError(
        "Gemini response was not valid JSON.",
        err,
      );
    }

    const result = extractedLabelSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new GeminiExtractionError(
        `Gemini response did not match ExtractedLabel schema: ${result.error.message}`,
        result.error,
      );
    }

    // Ensure imagesAnalyzed reflects the IDs we sent, regardless of what the
    // model returns, so the rest of the pipeline can correlate by ID.
    return {
      ...result.data,
      imagesAnalyzed:
        result.data.imagesAnalyzed?.length > 0
          ? result.data.imagesAnalyzed
          : images.map((i) => i.id),
    };
  }
}

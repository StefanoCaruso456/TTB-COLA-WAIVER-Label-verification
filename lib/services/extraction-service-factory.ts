import type { LabelExtractionService } from "./label-extraction.service";
import { resolveExtractionMode } from "./label-extraction.service";
import { MockLabelExtractionService } from "./mock-label-extraction.service";
import { GeminiLabelExtractionService } from "./gemini-label-extraction.service";

export function getExtractionService(
  env: NodeJS.ProcessEnv = process.env,
): LabelExtractionService {
  const mode = resolveExtractionMode(env);
  if (mode === "mock") {
    return new MockLabelExtractionService();
  }
  return new GeminiLabelExtractionService({
    apiKey: env.GEMINI_API_KEY as string,
    // Default reverted to gemini-2.5-flash after gemini-2.5-flash-lite
    // returned "model not found" on the deployed Google AI API endpoint
    // (the lite variant may need a dated id like
    // gemini-2.5-flash-lite-preview-06-17 depending on tier). Operators
    // who want lite can opt in explicitly via GEMINI_MODEL once they
    // confirm the right id for their account.
    model: env.GEMINI_MODEL ?? "gemini-2.5-flash",
  });
}

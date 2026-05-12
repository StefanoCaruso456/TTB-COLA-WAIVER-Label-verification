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
    model: env.GEMINI_MODEL ?? "gemini-2.5-flash",
  });
}

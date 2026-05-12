import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";

export interface LabelExtractionInput {
  application: ColaApplication;
  images: LabelImagePayload[];
  /**
   * Mock-only hook: the orchestrator passes a scenario name through to the
   * mock extraction service so canned sample data can produce intentional
   * discrepancies. The Gemini service ignores this field.
   */
  mockScenario?: string;
}

export interface LabelExtractionService {
  extract(input: LabelExtractionInput): Promise<ExtractedLabel>;
}

export type ExtractionMode = "mock" | "gemini";

export function resolveExtractionMode(env: NodeJS.ProcessEnv = process.env): ExtractionMode {
  const useMock = (env.USE_MOCK_EXTRACTION ?? "false").toLowerCase();
  if (useMock === "true" || useMock === "1" || useMock === "yes") {
    return "mock";
  }
  if (!env.GEMINI_API_KEY) {
    // Safety fallback: without a key, we cannot call Gemini. Force mock.
    return "mock";
  }
  return "gemini";
}

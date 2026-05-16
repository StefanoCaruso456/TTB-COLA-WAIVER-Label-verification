export type {
  VerificationStatus,
  VerificationSeverity,
  VerificationSource,
  AutomationLevel,
  VerificationCheck,
  OverallStatus,
  CommodityIntent,
  AuditSummary,
  VerificationReport,
} from "@/lib/schemas/verification-result.schema";

/**
 * Per-phase wall-clock timings for one `/api/verify` call.
 * Populated server-side; surfaced in the response so the client can
 * `console.table` them for free observability.
 *
 * All values in milliseconds unless suffixed.
 */
export interface AnalysisTimings {
  formParseMs: number;
  imageDecodeMs: number;
  imagePreprocessMs: number;
  geminiExtractionMs: number;
  validationMs: number;
  totalServerMs: number;
  /** First image only. */
  imageSizeKB: number;
  /** First image only, after preprocessing. Zero if preprocessing was skipped. */
  resizedSizeKB: number;
}

// Stable error-code taxonomy used by batch processing to record why a
// submission failed. Phase 2 owns the taxonomy; Phase 3+ writes the codes to
// BatchSubmission.errorCode.
//
// See docs/specs/phase-2-data-model-and-storage.md.

import {
  GeminiExtractionError,
  is503Error,
} from "./gemini-label-extraction.service";
import {
  FileNotFoundError,
  FileStorageWriteError,
} from "./file-storage";
import { VerificationInputError } from "./verification-orchestrator";

export const BATCH_ERROR_CODES = {
  INVALID_IMAGE: "INVALID_IMAGE",
  TIMEOUT: "TIMEOUT",
  GEMINI_503: "GEMINI_503",
  GEMINI_OTHER: "GEMINI_OTHER",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  STORAGE_WRITE: "STORAGE_WRITE",
  STORAGE_READ: "STORAGE_READ",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
  UNKNOWN: "UNKNOWN",
} as const;

export type BatchErrorCode =
  (typeof BATCH_ERROR_CODES)[keyof typeof BATCH_ERROR_CODES];

/**
 * Inspects an unknown thrown value and returns the best-fit BatchErrorCode.
 * Order matters: 503 detection happens before the generic Gemini bucket so a
 * 503 wrapped in a GeminiExtractionError is still classified as GEMINI_503.
 */
export function classifyError(err: unknown): BatchErrorCode {
  if (is503Error(err)) return BATCH_ERROR_CODES.GEMINI_503;

  if (err instanceof GeminiExtractionError) {
    // Sometimes the 503 is on err.cause rather than err itself.
    if (is503Error(err.cause)) return BATCH_ERROR_CODES.GEMINI_503;
    return BATCH_ERROR_CODES.GEMINI_OTHER;
  }

  if (err instanceof FileNotFoundError) return BATCH_ERROR_CODES.STORAGE_READ;
  if (err instanceof FileStorageWriteError) return BATCH_ERROR_CODES.STORAGE_WRITE;
  if (err instanceof VerificationInputError) return BATCH_ERROR_CODES.VALIDATION_ERROR;

  if (err instanceof Error && /timeout|timed out|etimedout/i.test(err.message)) {
    return BATCH_ERROR_CODES.TIMEOUT;
  }

  return BATCH_ERROR_CODES.UNKNOWN;
}

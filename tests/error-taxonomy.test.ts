import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  BATCH_ERROR_CODES,
  classifyError,
} from "@/lib/services/error-taxonomy";
import { GeminiExtractionError } from "@/lib/services/gemini-label-extraction.service";
import {
  FileNotFoundError,
  FileStorageWriteError,
} from "@/lib/services/file-storage";
import { VerificationInputError } from "@/lib/services/verification-orchestrator";

describe("classifyError", () => {
  it("classifies_GeminiExtractionError_as_GEMINI_OTHER", () => {
    const err = new GeminiExtractionError("bad json");
    expect(classifyError(err)).toBe(BATCH_ERROR_CODES.GEMINI_OTHER);
  });

  it("classifies_503_status_as_GEMINI_503", () => {
    expect(classifyError({ status: 503 })).toBe(BATCH_ERROR_CODES.GEMINI_503);
  });

  it("classifies_503_in_message_as_GEMINI_503", () => {
    expect(classifyError(new Error("Got 503 from upstream"))).toBe(
      BATCH_ERROR_CODES.GEMINI_503,
    );
  });

  it("classifies_503_wrapped_in_GeminiExtractionError_as_GEMINI_503", () => {
    const inner = { status: 503 };
    const err = new GeminiExtractionError("wrapped 503", inner);
    expect(classifyError(err)).toBe(BATCH_ERROR_CODES.GEMINI_503);
  });

  it("classifies_FileNotFoundError_as_STORAGE_READ", () => {
    expect(classifyError(new FileNotFoundError("abc"))).toBe(
      BATCH_ERROR_CODES.STORAGE_READ,
    );
  });

  it("classifies_FileStorageWriteError_as_STORAGE_WRITE", () => {
    expect(classifyError(new FileStorageWriteError("disk full"))).toBe(
      BATCH_ERROR_CODES.STORAGE_WRITE,
    );
  });

  it("classifies_VerificationInputError_as_VALIDATION_ERROR", () => {
    const issues = z.string().safeParse(123);
    if (issues.success) throw new Error("should not parse");
    const err = new VerificationInputError("bad input", issues.error.issues);
    expect(classifyError(err)).toBe(BATCH_ERROR_CODES.VALIDATION_ERROR);
  });

  it("classifies_timeout_message_as_TIMEOUT", () => {
    expect(classifyError(new Error("operation timed out after 30s"))).toBe(
      BATCH_ERROR_CODES.TIMEOUT,
    );
  });

  it("classifies_unknown_throwable_as_UNKNOWN", () => {
    expect(classifyError("plain string")).toBe(BATCH_ERROR_CODES.UNKNOWN);
    expect(classifyError(null)).toBe(BATCH_ERROR_CODES.UNKNOWN);
    expect(classifyError(42)).toBe(BATCH_ERROR_CODES.UNKNOWN);
    expect(classifyError(new Error("random unrelated"))).toBe(
      BATCH_ERROR_CODES.UNKNOWN,
    );
  });
});

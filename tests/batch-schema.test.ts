import { describe, expect, it } from "vitest";

import {
  batchStatusSchema,
  batchSubmissionStatusSchema,
  batchSummarySchema,
  batchSubmissionSummarySchema,
  isValidBatchSubmissionTransition,
} from "@/lib/schemas/batch.schema";

describe("batchStatusSchema", () => {
  it("accepts all 5 documented statuses", () => {
    for (const s of ["queued", "processing", "completed", "partially_failed", "canceled"]) {
      expect(batchStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects unknown statuses (case / typo)", () => {
    expect(batchStatusSchema.safeParse("QUEUED").success).toBe(false);
    expect(batchStatusSchema.safeParse("in_progress").success).toBe(false);
    expect(batchStatusSchema.safeParse("done").success).toBe(false);
  });
});

describe("batchSubmissionStatusSchema", () => {
  it("accepts all 6 documented statuses", () => {
    for (const s of ["queued", "processing", "extracted", "verified", "failed", "canceled"]) {
      expect(batchSubmissionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects unknown statuses", () => {
    expect(batchSubmissionStatusSchema.safeParse("complete").success).toBe(false);
  });
});

describe("isValidBatchSubmissionTransition", () => {
  it("allows queued → processing", () => {
    expect(isValidBatchSubmissionTransition("queued", "processing")).toBe(true);
  });

  it("allows queued → canceled", () => {
    expect(isValidBatchSubmissionTransition("queued", "canceled")).toBe(true);
  });

  it("allows processing → extracted", () => {
    expect(isValidBatchSubmissionTransition("processing", "extracted")).toBe(true);
  });

  it("allows processing → failed", () => {
    expect(isValidBatchSubmissionTransition("processing", "failed")).toBe(true);
  });

  it("allows processing → queued (retry)", () => {
    expect(isValidBatchSubmissionTransition("processing", "queued")).toBe(true);
  });

  it("allows extracted → verified", () => {
    expect(isValidBatchSubmissionTransition("extracted", "verified")).toBe(true);
  });

  it("allows failed → queued (operator retry)", () => {
    expect(isValidBatchSubmissionTransition("failed", "queued")).toBe(true);
  });

  it("rejects queued → verified (must pass through processing/extracted)", () => {
    expect(isValidBatchSubmissionTransition("queued", "verified")).toBe(false);
  });

  it("rejects verified → anything (terminal)", () => {
    expect(isValidBatchSubmissionTransition("verified", "queued")).toBe(false);
    expect(isValidBatchSubmissionTransition("verified", "failed")).toBe(false);
  });

  it("rejects canceled → anything (terminal)", () => {
    expect(isValidBatchSubmissionTransition("canceled", "queued")).toBe(false);
    expect(isValidBatchSubmissionTransition("canceled", "processing")).toBe(false);
  });
});

describe("batchSummarySchema", () => {
  const valid = {
    id: "cmp123",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "queued" as const,
    totalCount: 5,
    completedCount: 0,
    failedCount: 0,
    canceledCount: 0,
  };

  it("accepts a valid summary", () => {
    expect(batchSummarySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts ISO string timestamps too", () => {
    const withStrings = {
      ...valid,
      createdAt: "2026-05-16T10:00:00Z",
      updatedAt: "2026-05-16T10:00:00Z",
    };
    expect(batchSummarySchema.safeParse(withStrings).success).toBe(true);
  });

  it("rejects negative counts", () => {
    expect(batchSummarySchema.safeParse({ ...valid, failedCount: -1 }).success).toBe(false);
  });

  it("rejects unknown status", () => {
    expect(batchSummarySchema.safeParse({ ...valid, status: "weird" }).success).toBe(false);
  });
});

describe("batchSubmissionSummarySchema", () => {
  const sha = "a".repeat(64);
  const valid = {
    id: "cms123",
    batchId: "cmb123",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "queued" as const,
    attemptCount: 0,
    fileHash: sha,
    fileName: "label.jpg",
    fileSize: 12345,
    fileMimeType: "image/jpeg",
    fileStorageKey: sha,
  };

  it("accepts a valid submission summary", () => {
    expect(batchSubmissionSummarySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-sha256 fileHash", () => {
    expect(
      batchSubmissionSummarySchema.safeParse({ ...valid, fileHash: "short" }).success,
    ).toBe(false);
  });

  it("rejects empty fileName", () => {
    expect(
      batchSubmissionSummarySchema.safeParse({ ...valid, fileName: "" }).success,
    ).toBe(false);
  });

  it("rejects negative fileSize", () => {
    expect(
      batchSubmissionSummarySchema.safeParse({ ...valid, fileSize: -1 }).success,
    ).toBe(false);
  });
});

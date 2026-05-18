import { describe, it, expect, vi, beforeEach } from "vitest";

import { runFirstSubmissionInline } from "@/lib/services/run-first-submission-inline";

// Mock the dependencies the helper composes. We're asserting the helper's
// own contract (response shape, side-effect order, failure isolation), not
// the underlying services — those have their own tests.

const mockGetBuffer = vi.fn();
const mockRunVerification = vi.fn();
const mockTransitionSubmissionStatus = vi.fn();
const mockRecordSubmissionVerification = vi.fn();
const mockRecordSubmissionFailure = vi.fn();
const mockBatchUpdate = vi.fn();
const mockClassifyError = vi.fn();

vi.mock("@/lib/services/file-storage-factory", () => ({
  getFileStorage: () => ({ getBuffer: mockGetBuffer }),
}));

vi.mock("@/lib/services/verification-orchestrator", () => ({
  runVerification: (...args: unknown[]) => mockRunVerification(...args),
}));

vi.mock("@/lib/services/batch-service", () => ({
  transitionSubmissionStatus: (...args: unknown[]) =>
    mockTransitionSubmissionStatus(...args),
  recordSubmissionVerification: (...args: unknown[]) =>
    mockRecordSubmissionVerification(...args),
  recordSubmissionFailure: (...args: unknown[]) =>
    mockRecordSubmissionFailure(...args),
}));

vi.mock("@/lib/services/error-taxonomy", () => ({
  classifyError: (...args: unknown[]) => mockClassifyError(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    batch: { update: (...args: unknown[]) => mockBatchUpdate(...args) },
  },
}));

const baseSubmission = {
  id: "sub-1",
  fileName: "wine-01.jpg",
  fileMimeType: "image/jpeg",
  fileSize: 12345,
  fileStorageKey: "deadbeef",
  applicationJson: {
    applicationTypeStep: { productType: "wine" },
  },
};

describe("runFirstSubmissionInline — success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBuffer.mockResolvedValue(Buffer.from("fake-bytes"));
    mockTransitionSubmissionStatus.mockResolvedValue(undefined);
    mockRecordSubmissionVerification.mockResolvedValue(undefined);
    mockBatchUpdate.mockResolvedValue(undefined);
    mockRunVerification.mockResolvedValue({
      record: { id: "rec-1" },
      report: { overallStatus: "pass", auditSummary: {} },
      extractedLabel: { normalizedFields: {} },
    });
  });

  it("returns ok:true with the report + record id from the orchestrator", async () => {
    const result = await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submissionId).toBe("sub-1");
      expect(result.verificationRecordId).toBe("rec-1");
      expect(result.report).toEqual({
        overallStatus: "pass",
        auditSummary: {},
      });
    }
  });

  it("transitions submission queued → processing → extracted → verified in order", async () => {
    await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    const calls = mockTransitionSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(calls).toEqual(["processing", "extracted", "verified"]);
  });

  it("links VerificationRecord and stamps Batch.firstSubmissionId after success", async () => {
    await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(mockRecordSubmissionVerification).toHaveBeenCalledWith({
      submissionId: "sub-1",
      batchId: "batch-1",
      verificationRecordId: "rec-1",
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { firstSubmissionId: "sub-1" },
    });
  });

  it("invokes runVerification with batchSubmissionId set for downstream linkage", async () => {
    await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(mockRunVerification).toHaveBeenCalledTimes(1);
    const arg = mockRunVerification.mock.calls[0][0] as {
      batchSubmissionId?: string;
      images: Array<{ base64: string; mimeType: string }>;
    };
    expect(arg.batchSubmissionId).toBe("sub-1");
    expect(arg.images[0].mimeType).toBe("image/jpeg");
    expect(arg.images[0].base64).toBe(
      Buffer.from("fake-bytes").toString("base64"),
    );
  });
});

describe("runFirstSubmissionInline — failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBuffer.mockResolvedValue(Buffer.from("fake-bytes"));
    mockTransitionSubmissionStatus.mockResolvedValue(undefined);
    mockRecordSubmissionFailure.mockResolvedValue(undefined);
    mockBatchUpdate.mockResolvedValue(undefined);
    mockClassifyError.mockReturnValue("GEMINI_503");
  });

  it("returns ok:false with the classified error code when runVerification throws", async () => {
    mockRunVerification.mockRejectedValue(
      Object.assign(new Error("upstream 503"), { status: 503 }),
    );

    const result = await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.submissionId).toBe("sub-1");
      expect(result.errorCode).toBe("GEMINI_503");
      expect(result.errorMessage).toContain("upstream 503");
    }
  });

  it("marks submission failed and records the failure on the batch", async () => {
    mockRunVerification.mockRejectedValue(new Error("kaboom"));

    await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(
      mockTransitionSubmissionStatus.mock.calls.some(
        (c) => c[1] === "failed",
      ),
    ).toBe(true);
    expect(mockRecordSubmissionFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "sub-1",
        batchId: "batch-1",
        errorCode: "GEMINI_503",
      }),
    );
  });

  it("still stamps Batch.firstSubmissionId on failure so the UI can show row 1's failure inline", async () => {
    mockRunVerification.mockRejectedValue(new Error("kaboom"));

    await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(mockBatchUpdate).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { firstSubmissionId: "sub-1" },
    });
  });

  it("does NOT call recordSubmissionVerification when runVerification fails", async () => {
    mockRunVerification.mockRejectedValue(new Error("kaboom"));

    await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(mockRecordSubmissionVerification).not.toHaveBeenCalled();
  });
});

describe("runFirstSubmissionInline — defensive paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBuffer.mockResolvedValue(Buffer.from("fake-bytes"));
    mockTransitionSubmissionStatus.mockResolvedValue(undefined);
    mockRecordSubmissionVerification.mockResolvedValue(undefined);
    mockRecordSubmissionFailure.mockResolvedValue(undefined);
    mockBatchUpdate.mockResolvedValue(undefined);
    mockClassifyError.mockReturnValue("UNKNOWN");
  });

  it("falls back to the failure path if runVerification returns no record id", async () => {
    // Contract: persist:false isn't passed, so runVerification must produce
    // a record. If it doesn't, we'd silently drop the FK — surface it loud.
    mockRunVerification.mockResolvedValue({
      record: null,
      report: { overallStatus: "pass" },
      extractedLabel: {},
    });

    const result = await runFirstSubmissionInline({
      batchId: "batch-1",
      submission: baseSubmission,
    });

    expect(result.ok).toBe(false);
    expect(mockRecordSubmissionFailure).toHaveBeenCalled();
  });
});

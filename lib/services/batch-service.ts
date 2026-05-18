// Pure data-access + state-transition helpers for batches.
// No HTTP concerns, no orchestration of runVerification — the route handler
// composes those.
//
// See docs/specs/phase-3-synchronous-batch.md.

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Batch, BatchSubmission } from "@prisma/client";
import {
  isValidBatchSubmissionTransition,
  type BatchSubmissionStatus,
} from "@/lib/schemas/batch.schema";
import type { BatchErrorCode } from "./error-taxonomy";

export class InvalidBatchTransitionError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly from: string,
    public readonly to: BatchSubmissionStatus,
  ) {
    super(
      `Invalid BatchSubmission transition: ${from} → ${to} (submission ${submissionId})`,
    );
    this.name = "InvalidBatchTransitionError";
  }
}

export class BatchSubmissionNotFoundError extends Error {
  constructor(public readonly submissionId: string) {
    super(`BatchSubmission not found: ${submissionId}`);
    this.name = "BatchSubmissionNotFoundError";
  }
}

export interface CreateBatchInput {
  clientName?: string;
  applicantName?: string;
  totalCount: number;
}

export async function createBatch(input: CreateBatchInput): Promise<Batch> {
  return prisma.batch.create({
    data: {
      status: "processing",
      clientName: input.clientName,
      applicantName: input.applicantName,
      totalCount: input.totalCount,
    },
  });
}

export interface NewBatchSubmissionInput {
  fileHash: string;
  fileName: string;
  fileSize: number;
  fileMimeType: string;
  fileStorageKey: string;
  applicationJson: unknown;
}

export async function createBatchSubmissions(input: {
  batchId: string;
  submissions: NewBatchSubmissionInput[];
}): Promise<BatchSubmission[]> {
  // Prisma's createMany doesn't return the rows; do a tx of creates so we
  // preserve order and get back the IDs in the same order as input.
  return prisma.$transaction(
    input.submissions.map((s) =>
      prisma.batchSubmission.create({
        data: {
          batchId: input.batchId,
          status: "queued",
          fileHash: s.fileHash,
          fileName: s.fileName,
          fileSize: s.fileSize,
          fileMimeType: s.fileMimeType,
          fileStorageKey: s.fileStorageKey,
          applicationJson: s.applicationJson as Prisma.InputJsonValue,
        },
      }),
    ),
  );
}

export interface BatchSubmissionWithRecord extends BatchSubmission {
  verificationRecordId: string | null;
  /** Phase 6: lightweight verdict surface for inline rendering in the
   *  batch detail table. Null when no record exists yet (queued /
   *  processing rows). Kept as a narrow projection rather than the full
   *  reportJson to keep response payloads small at 200-row scale. */
  reportSummary: {
    overallStatus: string;
    overallConfidence: number | null;
    mismatchCount: number;
  } | null;
}

export async function getBatchById(id: string): Promise<{
  batch: Batch;
  submissions: BatchSubmissionWithRecord[];
} | null> {
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) return null;
  const rows = await prisma.batchSubmission.findMany({
    where: { batchId: id },
    orderBy: { createdAt: "asc" },
    include: {
      verificationRecord: { select: { id: true, reportJson: true } },
    },
  });
  const submissions: BatchSubmissionWithRecord[] = rows.map((r) => {
    const { verificationRecord, ...rest } = r;
    const reportSummary = verificationRecord?.reportJson
      ? summarizeReport(verificationRecord.reportJson)
      : null;
    return {
      ...rest,
      verificationRecordId: verificationRecord?.id ?? null,
      reportSummary,
    };
  });
  return { batch, submissions };
}

function summarizeReport(reportJson: unknown): {
  overallStatus: string;
  overallConfidence: number | null;
  mismatchCount: number;
} | null {
  if (!reportJson || typeof reportJson !== "object") return null;
  const r = reportJson as {
    overallStatus?: unknown;
    overallConfidence?: unknown;
    auditSummary?: { errors?: unknown; warnings?: unknown };
  };
  const overallStatus =
    typeof r.overallStatus === "string" ? r.overallStatus : "unknown";
  const overallConfidence =
    typeof r.overallConfidence === "number" ? r.overallConfidence : null;
  const errors =
    typeof r.auditSummary?.errors === "number" ? r.auditSummary.errors : 0;
  const warnings =
    typeof r.auditSummary?.warnings === "number" ? r.auditSummary.warnings : 0;
  return { overallStatus, overallConfidence, mismatchCount: errors + warnings };
}

export async function transitionSubmissionStatus(
  id: string,
  to: BatchSubmissionStatus,
): Promise<BatchSubmission> {
  const existing = await prisma.batchSubmission.findUnique({ where: { id } });
  if (!existing) throw new BatchSubmissionNotFoundError(id);
  const from = existing.status as BatchSubmissionStatus;
  if (!isValidBatchSubmissionTransition(from, to)) {
    throw new InvalidBatchTransitionError(id, from, to);
  }
  const data: Prisma.BatchSubmissionUpdateInput = { status: to };
  if (to === "processing" && !existing.startedAt) {
    data.startedAt = new Date();
    data.attemptCount = { increment: 1 };
  }
  if (to === "verified" || to === "failed" || to === "canceled") {
    data.completedAt = new Date();
  }
  return prisma.batchSubmission.update({ where: { id }, data });
}

/**
 * Atomically: (a) update the VerificationRecord with the batchSubmissionId FK,
 * (b) increment Batch.completedCount.
 *
 * Note: the BatchSubmission's status transition to `verified` is the caller's
 * responsibility (via `transitionSubmissionStatus`) — kept separate so the
 * caller can decide ordering (e.g., transition first, then link, so a partial
 * crash leaves the row in `extracted` rather than `verified` without a link).
 */
export async function recordSubmissionVerification(input: {
  submissionId: string;
  batchId: string;
  verificationRecordId: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.verificationRecord.update({
      where: { id: input.verificationRecordId },
      data: { batchSubmissionId: input.submissionId },
    }),
    prisma.batch.update({
      where: { id: input.batchId },
      data: { completedCount: { increment: 1 } },
    }),
  ]);
}

export async function recordSubmissionFailure(input: {
  submissionId: string;
  batchId: string;
  errorCode: BatchErrorCode;
  errorMessage: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.batchSubmission.update({
      where: { id: input.submissionId },
      data: {
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 2000),
      },
    }),
    prisma.batch.update({
      where: { id: input.batchId },
      data: { failedCount: { increment: 1 } },
    }),
  ]);
}

export async function finalizeBatch(batchId: string): Promise<Batch> {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`Batch not found: ${batchId}`);
  const status =
    batch.failedCount === 0 ? "completed" : "partially_failed";
  return prisma.batch.update({
    where: { id: batchId },
    data: {
      status,
      completedAt: new Date(),
    },
  });
}

// Zod schemas for Batch and BatchSubmission rows + status literal unions.
//
// Status enums are defined here (single source of truth) and re-exported by
// types/batch.ts. Plain TypeScript literal unions in types/batch.ts would not
// validate at runtime — the DB column is TEXT, so a buggy caller could write
// any string. These Zod enums catch that at the boundary.
//
// See docs/specs/phase-2-data-model-and-storage.md.

import { z } from "zod";

export const batchStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "partially_failed",
  "canceled",
]);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const batchSubmissionStatusSchema = z.enum([
  "queued",
  "processing",
  "extracted",
  "verified",
  "failed",
  "canceled",
]);
export type BatchSubmissionStatus = z.infer<typeof batchSubmissionStatusSchema>;

/**
 * Valid status transitions for a BatchSubmission. The worker (Phase 5) must
 * only transition through these edges — direct jumps from queued → verified
 * skipping processing/extracted indicate a bug.
 */
export const BATCH_SUBMISSION_TRANSITIONS: Readonly<
  Record<BatchSubmissionStatus, ReadonlyArray<BatchSubmissionStatus>>
> = {
  queued: ["processing", "canceled"],
  processing: ["extracted", "failed", "queued"], // queued = retry
  extracted: ["verified", "failed"],
  verified: [],
  failed: ["queued"], // operator-driven retry
  canceled: [],
};

export function isValidBatchSubmissionTransition(
  from: BatchSubmissionStatus,
  to: BatchSubmissionStatus,
): boolean {
  return BATCH_SUBMISSION_TRANSITIONS[from].includes(to);
}

const datetimeSchema = z.union([z.date(), z.string().datetime()]);

export const batchSummarySchema = z.object({
  id: z.string(),
  createdAt: datetimeSchema,
  updatedAt: datetimeSchema,
  completedAt: datetimeSchema.nullable().optional(),
  status: batchStatusSchema,
  clientName: z.string().nullable().optional(),
  applicantName: z.string().nullable().optional(),
  totalCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  canceledCount: z.number().int().nonnegative(),
});

export const batchDetailSchema = batchSummarySchema.extend({
  manifestJson: z.unknown().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export type BatchSummary = z.infer<typeof batchSummarySchema>;
export type BatchDetail = z.infer<typeof batchDetailSchema>;

export const batchSubmissionSummarySchema = z.object({
  id: z.string(),
  batchId: z.string(),
  createdAt: datetimeSchema,
  updatedAt: datetimeSchema,
  startedAt: datetimeSchema.nullable().optional(),
  completedAt: datetimeSchema.nullable().optional(),
  status: batchSubmissionStatusSchema,
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  attemptCount: z.number().int().nonnegative(),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i, "fileHash must be 64-char sha256 hex"),
  fileName: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  fileMimeType: z.string().min(1),
  fileStorageKey: z.string().min(1),
});

export const batchSubmissionDetailSchema = batchSubmissionSummarySchema.extend({
  applicationJson: z.unknown(),
  verificationRecordId: z.string().nullable().optional(),
});

export type BatchSubmissionSummary = z.infer<typeof batchSubmissionSummarySchema>;
export type BatchSubmissionDetail = z.infer<typeof batchSubmissionDetailSchema>;

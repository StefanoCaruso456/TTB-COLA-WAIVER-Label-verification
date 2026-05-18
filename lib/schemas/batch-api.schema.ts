// Request + response schemas for the batch API.
// See docs/specs/phase-3-synchronous-batch.md.

import { z } from "zod";

import { colaApplicationSchema } from "./cola-application.schema";
import {
  batchStatusSchema,
  batchSubmissionStatusSchema,
} from "./batch.schema";

// Phase 5: default raised from 5 (sync cap) to 200 (async worker cap).
// Override via env MAX_BATCH_FILES_OVERRIDE (1..500). The hard ceiling
// guards against a runaway value blowing past the request body limit.
const DEFAULT_MAX_BATCH_FILES = 200;
const HARD_MAX_BATCH_FILES = 500;

function resolveMaxBatchFiles(): number {
  const raw = process.env.MAX_BATCH_FILES_OVERRIDE;
  if (!raw) return DEFAULT_MAX_BATCH_FILES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_BATCH_FILES;
  return Math.min(Math.floor(n), HARD_MAX_BATCH_FILES);
}

export const MAX_BATCH_FILES = resolveMaxBatchFiles();

/**
 * Phase 6 first-row fast-path payload. Embedded in the POST response so the
 * UI can render row 1's verification report inline (mirrors what
 * /api/verify returns) while rows 2…N continue in the background worker.
 *
 * `report` and `extractedLabel` are intentionally typed as `unknown` here —
 * the route hands them through verbatim from runVerification; the consuming
 * component re-parses against the single-label result schema, so adding
 * shape constraints in two places would just create drift.
 */
export const firstSubmissionSuccessSchema = z.object({
  ok: z.literal(true),
  submissionId: z.string(),
  fileName: z.string(),
  verificationRecordId: z.string(),
  report: z.unknown(),
  extractedLabel: z.unknown(),
});
export const firstSubmissionFailureSchema = z.object({
  ok: z.literal(false),
  submissionId: z.string(),
  fileName: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
});
export const firstSubmissionResultSchema = z.discriminatedUnion("ok", [
  firstSubmissionSuccessSchema,
  firstSubmissionFailureSchema,
]);
export type FirstSubmissionResultPayload = z.infer<
  typeof firstSubmissionResultSchema
>;

/** Response shape for POST /api/batches. */
export const createBatchAcceptedResponseSchema = z.object({
  batchId: z.string(),
  status: batchStatusSchema,
  totalCount: z.number().int().nonnegative(),
  /**
   * Phase 6: present when the route ran the first submission inline.
   * Absent on empty batches or if the inline run was skipped for a reason
   * the route documents (none currently — kept optional for forward
   * compatibility with cancel-before-start or admin-replay flows).
   */
  firstSubmission: firstSubmissionResultSchema.optional(),
});
export type CreateBatchAcceptedResponse = z.infer<
  typeof createBatchAcceptedResponseSchema
>;

/**
 * The `applications` form field is a JSON-encoded string containing an array
 * of ColaApplication objects, one per uploaded file in the same order.
 */
export const createBatchApplicationsSchema = z
  .array(colaApplicationSchema)
  .min(1, "At least one application is required.")
  .max(MAX_BATCH_FILES, `Up to ${MAX_BATCH_FILES} applications are supported.`);

export const createBatchMetadataSchema = z
  .object({
    clientName: z.string().trim().min(1).optional(),
    applicantName: z.string().trim().min(1).optional(),
  })
  .strict();

export type CreateBatchApplications = z.infer<typeof createBatchApplicationsSchema>;
export type CreateBatchMetadata = z.infer<typeof createBatchMetadataSchema>;

const submissionResponseSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  status: batchSubmissionStatusSchema,
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  verificationRecordId: z.string().nullable().optional(),
  createdAt: z.string(),
  completedAt: z.string().nullable().optional(),
});

export const createBatchResponseSchema = z.object({
  batchId: z.string(),
  status: batchStatusSchema,
  totalCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  submissions: z.array(submissionResponseSchema),
});

export const getBatchResponseSchema = z.object({
  batch: z.object({
    id: z.string(),
    status: batchStatusSchema,
    createdAt: z.string(),
    completedAt: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    applicantName: z.string().nullable().optional(),
    totalCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    canceledCount: z.number().int().nonnegative(),
    // Phase 6 derived progress fields. processingCount excludes terminal
    // states; percentComplete counts both completed and failed as "done"
    // (matches what a reviewer expects from a progress bar that includes
    // partial-failure batches).
    processingCount: z.number().int().nonnegative(),
    percentComplete: z.number().int().min(0).max(100),
    firstSubmissionId: z.string().nullable().optional(),
  }),
  submissions: z.array(submissionResponseSchema),
});

export type CreateBatchResponse = z.infer<typeof createBatchResponseSchema>;
export type GetBatchResponse = z.infer<typeof getBatchResponseSchema>;
export type SubmissionResponse = z.infer<typeof submissionResponseSchema>;

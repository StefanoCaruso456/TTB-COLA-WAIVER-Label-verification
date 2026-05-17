// Request + response schemas for the batch API.
// See docs/specs/phase-3-synchronous-batch.md.

import { z } from "zod";

import { colaApplicationSchema } from "./cola-application.schema";
import {
  batchStatusSchema,
  batchSubmissionStatusSchema,
} from "./batch.schema";

export const MAX_BATCH_FILES = 5;

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
  }),
  submissions: z.array(submissionResponseSchema),
});

export type CreateBatchResponse = z.infer<typeof createBatchResponseSchema>;
export type GetBatchResponse = z.infer<typeof getBatchResponseSchema>;
export type SubmissionResponse = z.infer<typeof submissionResponseSchema>;

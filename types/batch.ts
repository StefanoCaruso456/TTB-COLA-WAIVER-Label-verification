export type { Batch, BatchSubmission } from "@prisma/client";
export type {
  FileStorage,
  PutFileInput,
  StoredFileMetadata,
} from "@/lib/services/file-storage";
export type { BatchErrorCode } from "@/lib/services/error-taxonomy";

// Status enums and validity transitions are defined in the schema layer so a
// single Zod source-of-truth backs both API boundaries and TypeScript types.
export {
  batchStatusSchema,
  batchSubmissionStatusSchema,
  BATCH_SUBMISSION_TRANSITIONS,
  isValidBatchSubmissionTransition,
} from "@/lib/schemas/batch.schema";
export type {
  BatchStatus,
  BatchSubmissionStatus,
  BatchSummary,
  BatchDetail,
  BatchSubmissionSummary,
  BatchSubmissionDetail,
} from "@/lib/schemas/batch.schema";

// Convenience arrays for UI dropdowns; derived from the Zod enum so any new
// status added to the schema automatically flows here.
import {
  batchStatusSchema,
  batchSubmissionStatusSchema,
} from "@/lib/schemas/batch.schema";
export const BATCH_STATUSES = batchStatusSchema.options;
export const BATCH_SUBMISSION_STATUSES = batchSubmissionStatusSchema.options;

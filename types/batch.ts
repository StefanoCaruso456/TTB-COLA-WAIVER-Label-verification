export type { Batch, BatchSubmission } from "@prisma/client";
export type {
  FileStorage,
  PutFileInput,
  StoredFileMetadata,
} from "@/lib/services/file-storage";
export type { BatchErrorCode } from "@/lib/services/error-taxonomy";

export const BATCH_STATUSES = [
  "queued",
  "processing",
  "completed",
  "partially_failed",
  "canceled",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_SUBMISSION_STATUSES = [
  "queued",
  "processing",
  "extracted",
  "verified",
  "failed",
  "canceled",
] as const;
export type BatchSubmissionStatus = (typeof BATCH_SUBMISSION_STATUSES)[number];

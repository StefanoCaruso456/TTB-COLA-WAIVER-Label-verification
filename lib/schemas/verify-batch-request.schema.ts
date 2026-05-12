import { z } from "zod";

import { labelImagePayloadSchema } from "./cola-application.schema";

export const BATCH_MAX_ITEMS = 50;
export const BATCH_DEFAULT_CONCURRENCY = 4;
export const BATCH_MAX_CONCURRENCY = 8;

export const verifyBatchItemSchema = z.object({
  itemKey: z.string().trim().min(1).optional(),
  clientName: z.string().trim().optional(),
  applicantName: z.string().trim().optional(),
  productName: z.string().trim().optional(),
  application: z.unknown(),
  images: z.array(labelImagePayloadSchema).min(1).max(10),
  mockScenario: z.string().optional(),
});

export const verifyBatchRequestSchema = z.object({
  items: z.array(verifyBatchItemSchema).min(1).max(BATCH_MAX_ITEMS),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(BATCH_MAX_CONCURRENCY)
    .optional(),
});

export type VerifyBatchItem = z.infer<typeof verifyBatchItemSchema>;
export type VerifyBatchRequest = z.infer<typeof verifyBatchRequestSchema>;

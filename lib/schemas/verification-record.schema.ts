import { z } from "zod";
import {
  productTypeSchema,
  sourceOfProductSchema,
} from "./cola-application.schema";
import { overallStatusSchema } from "./verification-result.schema";

export const verificationRecordSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  clientName: z.string().nullable().optional(),
  applicantName: z.string().nullable().optional(),
  productName: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  productType: productTypeSchema,
  sourceOfProduct: sourceOfProductSchema,
  status: overallStatusSchema,
});

export const verificationRecordDetailSchema =
  verificationRecordSummarySchema.extend({
    applicationJson: z.unknown(),
    extractedJson: z.unknown(),
    reportJson: z.unknown(),
    imageJson: z.unknown().optional(),
    reviewerNotes: z.string().nullable().optional(),
  });

export type VerificationRecordSummary = z.infer<
  typeof verificationRecordSummarySchema
>;

export type VerificationRecordDetail = z.infer<
  typeof verificationRecordDetailSchema
>;

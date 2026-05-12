import { z } from "zod";
import {
  productTypeSchema,
  sourceOfProductSchema,
} from "./cola-application.schema";

export const verificationStatusSchema = z.enum([
  "match",
  "likely_match",
  "mismatch",
  "missing",
  "not_applicable",
  "needs_review",
]);

export const verificationSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
]);

export const verificationSourceSchema = z.enum([
  "application_field_match",
  "mandatory_label_presence",
  "product_specific_rule",
  "image_quality",
  "commodity_consistency",
  "human_review",
]);

export const automationLevelSchema = z.enum([
  "automated",
  "partially_automated",
  "human_review_required",
]);

export const verificationCheckSchema = z.object({
  id: z.string(),
  fieldKey: z.string(),
  label: z.string(),
  expectedValue: z.string().nullable().optional(),
  extractedValue: z.string().nullable().optional(),
  status: verificationStatusSchema,
  severity: verificationSeveritySchema,
  confidence: z.number().min(0).max(1).optional(),
  source: verificationSourceSchema,
  automationLevel: automationLevelSchema,
  reason: z.string().optional(),
  evidenceText: z.string().optional(),
  recommendation: z.string().optional(),
});

export const overallStatusSchema = z.enum([
  "pass",
  "needs_review",
  "fail",
]);

export const commodityIntentSchema = z.object({
  selectedProductType: productTypeSchema,
  inferredProductType: productTypeSchema.optional(),
  inferredConfidence: z.number().min(0).max(1).optional(),
  routingDecision: productTypeSchema,
  conflictDetected: z.boolean(),
  reason: z.string(),
});

export const auditSummarySchema = z.object({
  totalChecks: z.number().int().nonnegative(),
  passing: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
});

export const verificationReportSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  applicationId: z.string().optional(),
  productType: productTypeSchema,
  sourceOfProduct: sourceOfProductSchema,
  overallStatus: overallStatusSchema,
  overallConfidence: z.number().min(0).max(1).optional(),
  checks: z.array(verificationCheckSchema),
  commodityIntent: commodityIntentSchema,
  auditSummary: auditSummarySchema,
});

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type VerificationSeverity = z.infer<typeof verificationSeveritySchema>;
export type VerificationSource = z.infer<typeof verificationSourceSchema>;
export type AutomationLevel = z.infer<typeof automationLevelSchema>;
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type OverallStatus = z.infer<typeof overallStatusSchema>;
export type CommodityIntent = z.infer<typeof commodityIntentSchema>;
export type AuditSummary = z.infer<typeof auditSummarySchema>;
export type VerificationReport = z.infer<typeof verificationReportSchema>;

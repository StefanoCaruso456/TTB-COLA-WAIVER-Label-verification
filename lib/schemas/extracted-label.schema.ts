import { z } from "zod";
import {
  labelImageTypeSchema,
  productTypeSchema,
} from "./cola-application.schema";

export const bboxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .partial();

export const extractedFieldSchema = z.object({
  value: z.string().nullable().optional(),
  normalizedValue: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceText: z.string().optional(),
  imageId: z.string().optional(),
  labelImageType: labelImageTypeSchema.optional(),
  bbox: bboxSchema.optional(),
});

export const extractedFieldListSchema = z.object({
  values: z.array(extractedFieldSchema).default([]),
});

export const imageQualityRiskLevelSchema = z.enum(["low", "medium", "high"]);
export const overallReadabilitySchema = z.enum(["good", "fair", "poor"]);

export const imageQualitySchema = z.object({
  blurRisk: imageQualityRiskLevelSchema.optional(),
  glareRisk: imageQualityRiskLevelSchema.optional(),
  lowLightRisk: imageQualityRiskLevelSchema.optional(),
  orientationRisk: imageQualityRiskLevelSchema.optional(),
  overallReadability: overallReadabilitySchema.optional(),
  notes: z.string().optional(),
});

// Phase 6 / requirement #15 Tier 1+2: typography metadata for the
// Government Warning. Backward-compatible — every field is optional, the
// parent object is optional. Legacy ExtractedLabel JSON validates unchanged.
//
// `prefixIsBold` answers Jenny's "must be in bold" check from her interview
// (27 CFR 16.21). `warningBbox` + `brandReferenceBbox` enable the relative
// sizing heuristic — warning text should not be conspicuously smaller than
// other prominent label text. Absolute mm-compliance per 27 CFR 16.22 is
// deliberately not addressed here; see
// docs/research/2026-05-18-gov-warning-typography-enforcement.md (§5, Tier 3)
// for the calibration-gap explanation.
export const governmentWarningTypographySchema = z.object({
  prefixIsBold: z.boolean().optional(),
  prefixIsAllCaps: z.boolean().optional(),
  prefixBbox: bboxSchema.optional(),
  warningBbox: bboxSchema.optional(),
  brandReferenceBbox: bboxSchema.optional(),
  notes: z.string().optional(),
});

export const extractedLabelFieldsSchema = z.object({
  brandName: extractedFieldSchema.optional(),
  dbaTradeName: extractedFieldSchema.optional(),
  fancifulName: extractedFieldSchema.optional(),
  classOrTypeDesignation: extractedFieldSchema.optional(),
  netContents: extractedFieldListSchema.optional(),
  alcoholContent: extractedFieldSchema.optional(),
  proof: extractedFieldSchema.optional(),
  nameAndAddress: extractedFieldSchema.optional(),
  countryOfOrigin: extractedFieldSchema.optional(),
  governmentWarning: extractedFieldSchema.optional(),
  governmentWarningTypography: governmentWarningTypographySchema.optional(),
  foreignLanguageText: extractedFieldSchema.optional(),
  specialWordingOrDesigns: extractedFieldSchema.optional(),

  vintageYear: extractedFieldSchema.optional(),
  grapeVarietals: extractedFieldListSchema.optional(),
  appellation: extractedFieldSchema.optional(),
  sulfiteDeclaration: extractedFieldSchema.optional(),

  ageStatement: extractedFieldSchema.optional(),
  stateOfDistillation: extractedFieldSchema.optional(),
  neutralSpiritsStatement: extractedFieldSchema.optional(),
  coloringOrWoodTreatmentStatement: extractedFieldSchema.optional(),

  fdCYellow5Disclosure: extractedFieldSchema.optional(),
  aspartameDisclosure: extractedFieldSchema.optional(),
  cochinealOrCarmineDisclosure: extractedFieldSchema.optional(),
});

export const extractedLabelSchema = z.object({
  rawText: z.string().optional(),
  inferredProductType: productTypeSchema.optional(),
  inferredProductTypeConfidence: z.number().min(0).max(1).optional(),
  imagesAnalyzed: z.array(z.string()).default([]),
  normalizedFields: extractedLabelFieldsSchema.default({}),
  imageQuality: imageQualitySchema.default({}),
  modelNotes: z.string().optional(),
});

export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type ExtractedFieldList = z.infer<typeof extractedFieldListSchema>;
export type ImageQuality = z.infer<typeof imageQualitySchema>;
export type GovernmentWarningTypography = z.infer<
  typeof governmentWarningTypographySchema
>;
export type ExtractedLabelFields = z.infer<typeof extractedLabelFieldsSchema>;
export type ExtractedLabel = z.infer<typeof extractedLabelSchema>;

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
export type ExtractedLabelFields = z.infer<typeof extractedLabelFieldsSchema>;
export type ExtractedLabel = z.infer<typeof extractedLabelSchema>;

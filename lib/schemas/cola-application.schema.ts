import { z } from "zod";

export const productTypeSchema = z.enum([
  "wine",
  "domestic_sake",
  "distilled_spirits",
  "malt_beverage",
]);

export const sourceOfProductSchema = z.enum(["domestic", "imported"]);

export const colaApplicationTypeSchema = z.enum([
  "certificate_of_label_approval",
  "certificate_of_exemption",
]);

export const labelImageTypeSchema = z.enum([
  "brand",
  "back",
  "neck",
  "side",
  "strip",
  "other",
  "unknown",
]);

export const applicationTypeStepSchema = z
  .object({
    productType: productTypeSchema,
    sourceOfProduct: sourceOfProductSchema,
    applicationType: colaApplicationTypeSchema,
    stateOfSaleForExemption: z.string().trim().min(1).optional(),
    isResubmission: z.boolean().default(false),
    priorTtbId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.applicationType === "certificate_of_exemption" &&
      !value.stateOfSaleForExemption
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateOfSaleForExemption"],
        message:
          "State of sale is required when application type is Certificate of Exemption.",
      });
    }
    if (value.isResubmission && !value.priorTtbId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priorTtbId"],
        message: "Prior TTB ID is required when this is a resubmission.",
      });
    }
  });

export const permitSchema = z.object({
  permitNumber: z.string().trim().min(1),
  type: z.string().trim().optional(),
});

export const netContentValueSchema = z.string().trim().min(1);

export const wineFieldsSchema = z
  .object({
    vintageYear: z
      .union([
        z.number().int().min(1800).max(2100),
        z
          .string()
          .trim()
          .regex(/^\d{4}$/, "Use a 4-digit year"),
      ])
      .optional(),
    grapeVarietals: z.array(z.string().trim().min(1)).optional(),
    appellation: z.string().trim().optional(),
    containsSulfites: z.boolean().optional(),
    sulfiteDeclarationExpected: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.vintageYear && !value.appellation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appellation"],
        message: "Appellation is required when a vintage year is provided.",
      });
    }
  });

export const distilledSpiritsFieldsSchema = z.object({
  distinctiveBottleApprovalRequested: z.boolean().optional(),
  totalBottleCapacityBeforeClosure: z.string().trim().optional(),
  ageStatement: z.string().trim().optional(),
  stateOfDistillation: z.string().trim().optional(),
});

export const maltBeverageFieldsSchema = z.object({
  alcoholContentRequiredBecauseOfFlavorOrAddedIngredients: z
    .boolean()
    .optional(),
  containsFdCYellow5: z.boolean().optional(),
  containsAspartame: z.boolean().optional(),
  containsCochinealOrCarmine: z.boolean().optional(),
  containsSulfites: z.boolean().optional(),
});

export const colaInformationStepSchema = z.object({
  serialNumber: z.string().trim().optional(),
  permits: z.array(permitSchema).optional(),
  dbaTradeName: z.string().trim().optional(),
  brandName: z.string().trim().min(1, "Brand name is required."),
  fancifulName: z.string().trim().optional(),
  formulaId: z.string().trim().optional(),
  netContents: z.array(netContentValueSchema).optional(),
  alcoholContent: z.string().trim().optional(),
  nameAndAddress: z.string().trim().optional(),
  countryOfOrigin: z.string().trim().optional(),
  notesToSpecialist: z.string().trim().optional(),
  wine: wineFieldsSchema.optional(),
  distilledSpirits: distilledSpiritsFieldsSchema.optional(),
  maltBeverage: maltBeverageFieldsSchema.optional(),
});

export const labelImagePayloadSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().nonnegative(),
  labelImageType: labelImageTypeSchema.default("unknown"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /**
   * Base64-encoded payload, **without** the data URL prefix. Optional so the
   * orchestrator can run with metadata-only image references (e.g., samples).
   */
  base64: z.string().optional(),
});

export const uploadLabelsStepSchema = z.object({
  labelImages: z
    .array(labelImagePayloadSchema)
    .min(1, "At least one label image is required.")
    .max(10, "Up to 10 label images are supported."),
  foreignTextTranslation: z.string().trim().optional(),
  specialWordingOrDesigns: z.string().trim().optional(),
  embossedBlownBrandedContainerText: z.string().trim().optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string(),
        mimeType: z.string(),
        size: z.number().nonnegative(),
      }),
    )
    .optional(),
});

export const colaApplicationSchema = z
  .object({
    applicationTypeStep: applicationTypeStepSchema,
    colaInformationStep: colaInformationStepSchema,
    uploadLabelsStep: uploadLabelsStepSchema,
  })
  .superRefine((value, ctx) => {
    const { productType, sourceOfProduct } = value.applicationTypeStep;
    const info = value.colaInformationStep;

    if (sourceOfProduct === "imported" && !info.countryOfOrigin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["colaInformationStep", "countryOfOrigin"],
        message:
          "Country of origin is required for imported products (will be flagged as a warning if omitted).",
      });
    }

    if (productType === "wine" && !info.wine) {
      // Wine block is optional in schema but recommended; not a hard error.
    }

    if (productType === "distilled_spirits" && !info.distilledSpirits) {
      // Same — soft expectation.
    }

    if (productType === "malt_beverage" && !info.maltBeverage) {
      // Same — soft expectation.
    }
  });

export type ColaApplication = z.infer<typeof colaApplicationSchema>;
export type ApplicationTypeStep = z.infer<typeof applicationTypeStepSchema>;
export type ColaInformationStep = z.infer<typeof colaInformationStepSchema>;
export type UploadLabelsStep = z.infer<typeof uploadLabelsStepSchema>;
export type LabelImagePayload = z.infer<typeof labelImagePayloadSchema>;
export type WineFields = z.infer<typeof wineFieldsSchema>;
export type DistilledSpiritsFields = z.infer<typeof distilledSpiritsFieldsSchema>;
export type MaltBeverageFields = z.infer<typeof maltBeverageFieldsSchema>;

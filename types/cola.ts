export type {
  ColaApplication,
  ApplicationTypeStep,
  ColaInformationStep,
  UploadLabelsStep,
  LabelImagePayload,
  WineFields,
  DistilledSpiritsFields,
  MaltBeverageFields,
} from "@/lib/schemas/cola-application.schema";

import type { z } from "zod";
import type {
  productTypeSchema,
  sourceOfProductSchema,
  colaApplicationTypeSchema,
  labelImageTypeSchema,
} from "@/lib/schemas/cola-application.schema";

export type ProductType = z.infer<typeof productTypeSchema>;
export type SourceOfProduct = z.infer<typeof sourceOfProductSchema>;
export type ColaApplicationType = z.infer<typeof colaApplicationTypeSchema>;
export type LabelImageType = z.infer<typeof labelImageTypeSchema>;

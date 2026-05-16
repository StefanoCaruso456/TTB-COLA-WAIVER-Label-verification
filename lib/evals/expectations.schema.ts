// Zod schemas for the eval fixture manifest. Validated at load time by the
// runner so a malformed manifest fails fast instead of producing confusing
// per-fixture errors later.
//
// See docs/specs/phase-1-eval-infrastructure.md.

import { z } from "zod";

import { colaApplicationSchema, labelImagePayloadSchema } from "@/lib/schemas/cola-application.schema";
import { overallStatusSchema, verificationStatusSchema } from "@/lib/schemas/verification-result.schema";

export const fixtureFileSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  application: colaApplicationSchema,
  mockScenario: z.string().optional(),
  // Optional override; runner injects a stub PNG when missing.
  images: z
    .array(
      labelImagePayloadSchema.extend({
        base64: z.string().optional(),
      }),
    )
    .optional(),
  clientName: z.string().optional(),
  applicantName: z.string().optional(),
  productName: z.string().optional(),
});

export type FixtureFile = z.infer<typeof fixtureFileSchema>;

const fieldStatusExpectationSchema = z.object({
  fieldKey: z.string().min(1),
  status: verificationStatusSchema,
});

export const expectationsSchema = z.object({
  overallStatus: z.array(overallStatusSchema).min(1),
  minFailingChecks: z.number().int().nonnegative().optional(),
  maxFailingChecks: z.number().int().nonnegative().optional(),
  mustHaveFieldStatus: z.array(fieldStatusExpectationSchema).optional(),
  mustHaveCommodityConflict: z.boolean().optional(),
});

export type Expectations = z.infer<typeof expectationsSchema>;

export const manifestEntrySchema = z.object({
  id: z.string().min(1),
  category: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  description: z.string().min(1),
  fixtureFile: z.string().min(1),
  expectations: expectationsSchema,
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export const manifestSchema = z.array(manifestEntrySchema).min(1);

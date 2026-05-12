import { z } from "zod";

import { colaApplicationSchema } from "@/lib/schemas/cola-application.schema";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";
import type { VerificationRecordSummary } from "@/types/verification-record";

import { resolveCommodityIntent } from "./commodity-router";
import {
  type LabelExtractionService,
} from "./label-extraction.service";
import { getExtractionService } from "./extraction-service-factory";
import { verifyApplication } from "./verification.service";
import { createVerificationRecord } from "./verification-record.service";

export interface RunVerificationInput {
  clientName?: string;
  applicantName?: string;
  productName?: string;
  application: unknown;
  images: LabelImagePayload[];
  /** Mock-only: lets sample data drive intentional discrepancies. */
  mockScenario?: string;
  /** Override for tests / sample-driven flows. */
  extractionService?: LabelExtractionService;
  /** Skip persistence (useful for sample previews / tests). */
  persist?: boolean;
}

export interface RunVerificationResult {
  record?: VerificationRecordSummary;
  report: VerificationReport;
  extractedLabel: ExtractedLabel;
  application: ColaApplication;
}

export class VerificationInputError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message);
    this.name = "VerificationInputError";
  }
}

export async function runVerification(
  input: RunVerificationInput,
): Promise<RunVerificationResult> {
  const parsed = colaApplicationSchema.safeParse(input.application);
  if (!parsed.success) {
    throw new VerificationInputError(
      "Application failed schema validation.",
      parsed.error.issues,
    );
  }
  const application = parsed.data;

  if (!input.images || input.images.length === 0) {
    throw new VerificationInputError("At least one label image is required.", [
      {
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "At least one label image is required.",
      },
    ]);
  }

  const extractionService =
    input.extractionService ?? getExtractionService();

  const extractedLabel = await extractionService.extract({
    application,
    images: input.images,
    mockScenario: input.mockScenario,
  });

  const commodityIntent = resolveCommodityIntent({
    selectedProductType: application.applicationTypeStep.productType,
    inferredProductType: extractedLabel.inferredProductType,
    inferredConfidence: extractedLabel.inferredProductTypeConfidence,
  });

  const report = verifyApplication({
    application,
    extractedLabel,
    commodityIntent,
  });

  let record: VerificationRecordSummary | undefined;
  if (input.persist !== false) {
    record = await createVerificationRecord({
      clientName: input.clientName,
      applicantName: input.applicantName,
      productName: input.productName,
      application,
      extractedLabel,
      report,
      imageMetadata: input.images,
    });
  }

  return { record, report, extractedLabel, application };
}

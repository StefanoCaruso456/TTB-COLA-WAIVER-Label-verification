import { z } from "zod";

import { colaApplicationSchema } from "@/lib/schemas/cola-application.schema";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";
import type { VerificationRecordSummary } from "@/types/verification-record";

import { resolveCommodityIntent } from "./commodity-router";
import {
  type LabelExtractionService,
  resolveExtractionMode,
} from "./label-extraction.service";
import { getExtractionService } from "./extraction-service-factory";
import { verifyApplication } from "./verification.service";
import { createVerificationRecord } from "./verification-record.service";
import { preprocessImage } from "./image-preprocess";
import {
  computeLatencyScore,
  computeVerificationScores,
  tracedVerify,
} from "@/lib/observability/braintrust";

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
  /**
   * Skip image preprocessing. Used by the mock extractor (which doesn't look at
   * the image) and the test suite. Production calls go through preprocessing
   * unless `IMAGE_PREPROCESS_ENABLED=false` is set in the env.
   */
  skipImagePreprocess?: boolean;
  /**
   * Optional FK to a BatchSubmission. When set, the persisted VerificationRecord
   * is linked back to that submission, so a batch can be reassembled by
   * `listVerificationRecords({ batchId })` later. Backward-compatible: omitting
   * preserves all single-label call sites.
   */
  batchSubmissionId?: string;
}

export interface RunVerificationResult {
  record?: VerificationRecordSummary;
  report: VerificationReport;
  extractedLabel: ExtractedLabel;
  application: ColaApplication;
  imagePreprocess?: {
    originalSizeKB: number;
    resizedSizeKB: number;
    durationMs: number;
  };
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

  return tracedVerify(async (span) => {
    const verifyStartMs = Date.now();
    span.log({
      input: {
        productType: application.applicationTypeStep.productType,
        sourceOfProduct: application.applicationTypeStep.sourceOfProduct,
        applicationType: application.applicationTypeStep.applicationType,
        isResubmission: application.applicationTypeStep.isResubmission,
        brandNameExpected: application.colaInformationStep.brandName,
        imageCount: input.images.length,
      },
      metadata: {
        productType: application.applicationTypeStep.productType,
        sourceOfProduct: application.applicationTypeStep.sourceOfProduct,
        applicationType: application.applicationTypeStep.applicationType,
        isResubmission: application.applicationTypeStep.isResubmission,
        extractionMode: input.extractionService
          ? "injected"
          : resolveExtractionMode(),
        mockScenario: input.mockScenario,
        batchSubmissionId: input.batchSubmissionId,
        clientName: input.clientName,
        applicantName: input.applicantName,
        productName: input.productName,
        imageCount: input.images.length,
      },
    });

    const extractionService =
      input.extractionService ?? getExtractionService();

    const envFlag = process.env.IMAGE_PREPROCESS_ENABLED;
    const preprocessEnabled =
      envFlag === undefined ? true : envFlag.toLowerCase() !== "false";
    const shouldPreprocess =
      preprocessEnabled && !input.skipImagePreprocess && !input.mockScenario;

    let imagesForExtraction = input.images;
    let imagePreprocessSummary: RunVerificationResult["imagePreprocess"];

    if (shouldPreprocess) {
      const start = Date.now();
      let originalSum = 0;
      let resizedSum = 0;
      imagesForExtraction = await Promise.all(
        input.images.map(async (image) => {
          if (!image.base64) return image;
          try {
            const inputBuffer = Buffer.from(image.base64, "base64");
            const result = await preprocessImage(inputBuffer);
            originalSum += result.originalSizeKB;
            resizedSum += result.resizedSizeKB;
            return {
              ...image,
              base64: result.buffer.toString("base64"),
              mimeType: result.mimeType,
              size: result.buffer.byteLength,
            };
          } catch (err) {
            // Don't fail the verification if one image is unreadable by sharp —
            // pass through and let the extractor surface a clearer error.
            console.warn(
              `[orchestrator] image preprocess failed for ${image.id}; passing original through`,
              err,
            );
            return image;
          }
        }),
      );
      imagePreprocessSummary = {
        originalSizeKB: originalSum,
        resizedSizeKB: resizedSum,
        durationMs: Date.now() - start,
      };
    }

    const extractedLabel = await extractionService.extract({
      application,
      images: imagesForExtraction,
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
        batchSubmissionId: input.batchSubmissionId,
      });
    }

    span.log({
      output: {
        overallStatus: report.overallStatus,
        overallConfidence: report.overallConfidence,
        recordId: record?.id ?? null,
        auditSummary: report.auditSummary,
        inferredProductType: extractedLabel.inferredProductType,
      },
      metadata: {
        recordId: record?.id ?? null,
        commodityConflict: commodityIntent.conflictDetected,
        inferredProductType: extractedLabel.inferredProductType,
        originalSizeKB: imagePreprocessSummary?.originalSizeKB,
        resizedSizeKB: imagePreprocessSummary?.resizedSizeKB,
      },
      metrics: {
        imagePreprocessMs: imagePreprocessSummary?.durationMs ?? 0,
        verifyTotalMs: Date.now() - verifyStartMs,
      },
      scores: {
        ...computeVerificationScores(report),
        "verification.latencyUnder5s": computeLatencyScore(
          Date.now() - verifyStartMs,
        ),
      },
    });

    return {
      record,
      report,
      extractedLabel,
      application,
      imagePreprocess: imagePreprocessSummary,
    };
  });
}

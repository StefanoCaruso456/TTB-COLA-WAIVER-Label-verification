import { z } from "zod";

import { colaApplicationSchema } from "@/lib/schemas/cola-application.schema";
import { BATCH_DEFAULT_CONCURRENCY } from "@/lib/schemas/verify-batch-request.schema";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { OverallStatus, VerificationReport } from "@/types/verification";
import type { VerificationRecordSummary } from "@/types/verification-record";

import { resolveCommodityIntent } from "./commodity-router";
import {
  type LabelExtractionService,
} from "./label-extraction.service";
import { getExtractionService } from "./extraction-service-factory";
import { GeminiExtractionError } from "./gemini-label-extraction.service";
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

export interface BatchVerificationItemInput extends RunVerificationInput {
  itemKey?: string;
}

export type BatchItemErrorCode =
  | "schema_validation"
  | "extraction_failed"
  | "unexpected";

export interface BatchVerificationItemResult {
  index: number;
  itemKey?: string;
  success: boolean;
  recordId?: string;
  status?: OverallStatus;
  report?: VerificationReport;
  extractedLabel?: ExtractedLabel;
  durationMs: number;
  error?: {
    code: BatchItemErrorCode;
    message: string;
    issues?: z.ZodIssue[];
  };
}

export interface RunVerificationBatchOptions {
  concurrency?: number;
  extractionService?: LabelExtractionService;
}

export interface RunVerificationBatchResult {
  results: BatchVerificationItemResult[];
  counts: { total: number; success: number; failed: number };
  durationMs: number;
  concurrency: number;
}

export async function runVerificationBatch(
  items: BatchVerificationItemInput[],
  options: RunVerificationBatchOptions = {},
): Promise<RunVerificationBatchResult> {
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? BATCH_DEFAULT_CONCURRENCY, items.length),
  );
  const results: BatchVerificationItemResult[] = new Array(items.length);
  const startedAt = Date.now();

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await runSingleBatchItem(items[index], index, options);
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );

  const success = results.filter((r) => r.success).length;
  return {
    results,
    counts: { total: results.length, success, failed: results.length - success },
    durationMs: Date.now() - startedAt,
    concurrency,
  };
}

async function runSingleBatchItem(
  item: BatchVerificationItemInput,
  index: number,
  options: RunVerificationBatchOptions,
): Promise<BatchVerificationItemResult> {
  const itemStart = Date.now();
  const base = {
    index,
    itemKey: item.itemKey,
  };
  try {
    const result = await runVerification({
      ...item,
      extractionService: item.extractionService ?? options.extractionService,
    });
    return {
      ...base,
      success: true,
      recordId: result.record?.id,
      status: result.report.overallStatus,
      report: result.report,
      extractedLabel: result.extractedLabel,
      durationMs: Date.now() - itemStart,
    };
  } catch (err) {
    return {
      ...base,
      success: false,
      durationMs: Date.now() - itemStart,
      error: toBatchItemError(err),
    };
  }
}

function toBatchItemError(err: unknown): BatchVerificationItemResult["error"] {
  if (err instanceof VerificationInputError) {
    return {
      code: "schema_validation",
      message: err.message,
      issues: err.issues,
    };
  }
  if (err instanceof GeminiExtractionError) {
    return {
      code: "extraction_failed",
      message: err.message,
    };
  }
  const message =
    err instanceof Error ? err.message : "Unexpected verification error.";
  return { code: "unexpected", message };
}

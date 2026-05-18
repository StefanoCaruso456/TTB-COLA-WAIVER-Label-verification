// Phase 6 fast path. See docs/specs/phase-6-batch-ui-first-row-fast-path.md.
//
// Synchronously verifies the first submission of a batch in the POST handler
// so the UI can render its result inline while the background worker drains
// rows 2…N. Mirrors `processOne` in batch-worker.ts but:
//   - returns the verification report + extracted label to the caller
//   - stamps Batch.firstSubmissionId so a polling client can resolve "the
//     row that was processed inline" without a separate query
// Failure isolation matches the worker: a thrown error inside runVerification
// is captured as a `failed` submission with the structured errorCode from
// `error-taxonomy.ts`; the batch as a whole is not aborted.

import { prisma } from "@/lib/prisma";
import { classifyError } from "./error-taxonomy";
import { getFileStorage } from "./file-storage-factory";
import { runVerification } from "./verification-orchestrator";
import {
  recordSubmissionFailure,
  recordSubmissionVerification,
  transitionSubmissionStatus,
} from "./batch-service";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";

export interface FirstSubmissionInput {
  batchId: string;
  submission: {
    id: string;
    fileName: string;
    fileMimeType: string;
    fileSize: number;
    fileStorageKey: string;
    applicationJson: unknown;
  };
}

export type FirstSubmissionResult =
  | {
      ok: true;
      submissionId: string;
      fileName: string;
      report: VerificationReport;
      extractedLabel: ExtractedLabel;
      verificationRecordId: string;
    }
  | {
      ok: false;
      submissionId: string;
      fileName: string;
      errorCode: string;
      errorMessage: string;
    };

export async function runFirstSubmissionInline(
  input: FirstSubmissionInput,
): Promise<FirstSubmissionResult> {
  const { batchId, submission } = input;

  try {
    await transitionSubmissionStatus(submission.id, "processing");

    const buffer = await getFileStorage().getBuffer(submission.fileStorageKey);
    const application = submission.applicationJson as ColaApplication;

    const imagePayload: LabelImagePayload = {
      id: `batch-${batchId}-sub-${submission.id}`,
      fileName: submission.fileName,
      mimeType: submission.fileMimeType,
      size: submission.fileSize,
      labelImageType: "brand",
      base64: buffer.toString("base64"),
    };

    const result = await runVerification({
      application,
      images: [imagePayload],
      batchSubmissionId: submission.id,
      productName: submission.fileName,
    });

    await transitionSubmissionStatus(submission.id, "extracted");
    await transitionSubmissionStatus(submission.id, "verified");

    if (!result.record?.id) {
      // runVerification's `persist !== false` default writes a record, so the
      // missing-id case is a contract bug rather than a runtime condition.
      // Fail loud so we don't silently drop the FK and the inline result.
      throw new Error(
        "runVerification returned without a persisted record id; cannot link batch submission.",
      );
    }

    await recordSubmissionVerification({
      submissionId: submission.id,
      batchId,
      verificationRecordId: result.record.id,
    });

    // Stamp the batch with the first-submission FK. Done after the verification
    // record link so a partial crash between these two writes leaves the batch
    // in a consistent state (no dangling firstSubmissionId pointing at an
    // unlinked row).
    await prisma.batch.update({
      where: { id: batchId },
      data: { firstSubmissionId: submission.id },
    });

    return {
      ok: true,
      submissionId: submission.id,
      fileName: submission.fileName,
      report: result.report,
      extractedLabel: result.extractedLabel,
      verificationRecordId: result.record.id,
    };
  } catch (err) {
    const errorCode = classifyError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    try {
      await transitionSubmissionStatus(submission.id, "failed");
    } catch {
      // Transition itself may fail if the row is in an unexpected state. The
      // failure counters still need updating below so the operator sees the
      // failed submission in the response.
    }
    await recordSubmissionFailure({
      submissionId: submission.id,
      batchId,
      errorCode,
      errorMessage,
    });

    // Even on failure, mark this submission as the inline row so the UI shows
    // "row 1 failed" rather than waiting on a row that's already terminal.
    try {
      await prisma.batch.update({
        where: { id: batchId },
        data: { firstSubmissionId: submission.id },
      });
    } catch {
      // Batch update failure here is non-fatal — the response can still carry
      // the failure shape; the polling client will discover the submission's
      // failed state through the existing submissions query.
    }

    return {
      ok: false,
      submissionId: submission.id,
      fileName: submission.fileName,
      errorCode,
      errorMessage,
    };
  }
}

// Phase 5 async worker. See docs/specs/phase-5-async-queue.md.
//
// Drains `queued` submissions for a batch with bounded concurrency. Runs
// in-process on the Next.js server (Railway long-lived Node). Each
// submission goes through the same runVerification pipeline as the
// synchronous Phase 3 path used to; only the scheduling changes.

import { prisma } from "@/lib/prisma";
import { classifyError } from "./error-taxonomy";
import { getFileStorage } from "./file-storage-factory";
import { runVerification } from "./verification-orchestrator";
import {
  finalizeBatch,
  recordSubmissionFailure,
  recordSubmissionVerification,
  transitionSubmissionStatus,
} from "./batch-service";
import type {
  ColaApplication,
  LabelImagePayload,
} from "@/types/cola";

export const DEFAULT_WORKER_CONCURRENCY = 3;
const MIN_WORKER_CONCURRENCY = 1;
const MAX_WORKER_CONCURRENCY = 10;

export function resolveConcurrency(
  raw: string | undefined = process.env.BATCH_WORKER_CONCURRENCY,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WORKER_CONCURRENCY;
  const clamped = Math.max(
    MIN_WORKER_CONCURRENCY,
    Math.min(MAX_WORKER_CONCURRENCY, Math.floor(n)),
  );
  return clamped;
}

interface QueuedSubmission {
  id: string;
  fileName: string;
  fileMimeType: string;
  fileSize: number;
  fileStorageKey: string;
  applicationJson: unknown;
  batchId: string;
}

async function processOne(
  submission: QueuedSubmission,
  batchId: string,
): Promise<void> {
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
    if (result.record?.id) {
      await recordSubmissionVerification({
        submissionId: submission.id,
        batchId,
        verificationRecordId: result.record.id,
      });
    }
  } catch (err) {
    const errorCode = classifyError(err);
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    try {
      await transitionSubmissionStatus(submission.id, "failed");
    } catch {
      // Transition itself may fail if the row is in an unexpected state.
      // The failure counters still need updating below so the operator
      // sees the failed submission in the response.
    }
    await recordSubmissionFailure({
      submissionId: submission.id,
      batchId,
      errorCode,
      errorMessage,
    });
  }
}

/**
 * Drain a batch's queued submissions. Bounded by concurrency; failures
 * per submission are isolated. Finalizes the batch at the end so the
 * counters and overall status are correct even on partial failure.
 */
export async function processBatch(
  batchId: string,
  options: { concurrency?: number } = {},
): Promise<void> {
  const concurrency = options.concurrency ?? resolveConcurrency();

  const queued = await prisma.batchSubmission.findMany({
    where: { batchId, status: "queued" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileName: true,
      fileMimeType: true,
      fileSize: true,
      fileStorageKey: true,
      applicationJson: true,
      batchId: true,
    },
  });

  if (queued.length === 0) {
    await finalizeBatch(batchId);
    return;
  }

  let cursor = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (cursor < queued.length) {
      const idx = cursor++;
      await processOne(queued[idx] as QueuedSubmission, batchId);
    }
  };
  for (let w = 0; w < Math.min(concurrency, queued.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);

  await finalizeBatch(batchId);
}

/**
 * Fire-and-forget entry called from the POST handler. Logs failures so an
 * unhandled rejection can't take down the Node process.
 */
export function startBatchInBackground(batchId: string): void {
  processBatch(batchId).catch((err) => {
    console.error(`[batch-worker] batch ${batchId} crashed`, err);
  });
}

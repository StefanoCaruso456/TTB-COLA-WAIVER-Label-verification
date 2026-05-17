// Phase 5 startup recovery. See docs/specs/phase-5-async-queue.md.
//
// Why this exists: the Phase 5 worker runs in-process. When the Next.js
// process restarts (deploy, crash, OOM), any submission still in
// `processing` is stranded — the inner Promise that was driving it died
// with the process. On boot we sweep those rows back to `queued` so the
// worker can resume them.
//
// Threshold is age-based (default 10 min). Anything younger than that is
// still actively being processed by the live worker; only rows older than
// the threshold are presumed stranded from a previous process generation.

import { prisma } from "@/lib/prisma";
import { startBatchInBackground } from "./batch-worker";

export const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

export interface RecoverySummary {
  requeued: number;
  resumedBatchIds: string[];
}

export async function requeueStaleProcessing(
  thresholdMs: number = STALE_PROCESSING_THRESHOLD_MS,
): Promise<RecoverySummary> {
  const cutoff = new Date(Date.now() - thresholdMs);

  const stranded = await prisma.batchSubmission.findMany({
    where: { status: "processing", updatedAt: { lt: cutoff } },
    select: { id: true, batchId: true },
  });

  if (stranded.length === 0) {
    // Still resume batches with leftover queued submissions from before
    // the restart (the worker died before draining them all).
    const partial = await prisma.batchSubmission.findMany({
      where: { status: "queued" },
      select: { batchId: true },
      distinct: ["batchId"],
    });
    const resumedBatchIds = partial.map((p) => p.batchId);
    for (const id of resumedBatchIds) {
      startBatchInBackground(id);
    }
    return { requeued: 0, resumedBatchIds };
  }

  await prisma.batchSubmission.updateMany({
    where: { id: { in: stranded.map((s) => s.id) } },
    data: { status: "queued" },
  });

  const resumedBatchIds = Array.from(new Set(stranded.map((s) => s.batchId)));
  // Also pick up any batches that have queued (non-stranded) submissions.
  const partial = await prisma.batchSubmission.findMany({
    where: { status: "queued" },
    select: { batchId: true },
    distinct: ["batchId"],
  });
  for (const p of partial) {
    if (!resumedBatchIds.includes(p.batchId)) {
      resumedBatchIds.push(p.batchId);
    }
  }
  for (const id of resumedBatchIds) {
    startBatchInBackground(id);
  }

  return { requeued: stranded.length, resumedBatchIds };
}

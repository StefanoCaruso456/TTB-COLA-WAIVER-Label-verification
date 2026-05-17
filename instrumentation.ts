// Next.js boot hook. Runs once per process startup on the server.
// See docs/specs/phase-5-async-queue.md.
//
// Idempotent: a flag on globalThis guards against double-invocation in
// dev hot-reload. The recovery sweep is also safe to call twice (it
// only updates rows older than the staleness threshold).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as typeof globalThis & {
    __batchRecoveryRan?: boolean;
  };
  if (g.__batchRecoveryRan) return;
  g.__batchRecoveryRan = true;

  try {
    const { requeueStaleProcessing } = await import(
      "@/lib/services/batch-recovery"
    );
    const summary = await requeueStaleProcessing();
    if (summary.requeued > 0 || summary.resumedBatchIds.length > 0) {
      console.info(
        `[batch-recovery] requeued ${summary.requeued} stranded submissions, resumed ${summary.resumedBatchIds.length} batch(es)`,
      );
    }
  } catch (err) {
    console.error("[batch-recovery] startup sweep failed", err);
  }
}

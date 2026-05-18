# Feature Spec — Phase 5: Async queue and worker

**Status:** Done — implementation shipped; see `docs/roadmap.md` Phase 5 row and `README.md` "Features shipped" table.
**Owner:** Stefano
**Last updated:** 2026-05-17
**Approver:** Stefano (senior-engineer review; all open questions resolved in "Decisions locked").

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution.

## Goal

Make the batch endpoint scale to **200–300 labels per submission**, which is the brief's stated reviewer need (Sarah Chen: *"big importers who dump 200, 300 label applications on us at once"*). The current synchronous cap of 5 is useless for that workload. POST should return in ≤2s with a `batchId`; a background worker drains the queue with bounded concurrency; the `/batches/:id` page polls live progress.

## Scope

**In scope:**
- POST `/api/batches` returns 202 `{ batchId, status: "queued", totalCount }` after writing the batch + queued submissions (no synchronous Gemini calls in the request path).
- New in-process worker module that drains queued submissions with bounded concurrency, reusing the existing `runVerification` pipeline.
- Startup recovery: on Next.js process boot, any submission stuck in `processing` for >10 min is requeued to `queued`. Any batch whose submissions are all terminal gets finalized.
- `MAX_BATCH_FILES` raised from 5 to 200 (env-overridable up to 500).
- Body size cap on batch endpoint raised to 200 MB (env-overridable).
- `/batches/:id` page gets a client polling component that refreshes every 2s while the batch is in-flight and stops when status is terminal.
- `BatchVerificationFlow` UI redirects to `/batches/:id` after the 202 instead of rendering inline results.
- Backpressure: 429 when total queued+processing rows across the system exceed `BATCH_QUEUE_DEPTH_LIMIT` (default 500).
- Worker emits the same Braintrust `verify` + `gemini.extract` spans Phase 3 already emits; no telemetry regression.
- Tests: worker unit tests, recovery unit tests, E2E for the async happy path.

**Out of scope:**
- Cancellation (transition `queued` → `canceled`). Roadmap US-6.5; defer to follow-up.
- Separate worker service on Railway. The Phase 5 implementation runs the worker **in the same Next.js process** as the API. This is sufficient because Railway runs Next.js as a long-lived Node process, which keeps unawaited promises alive after the request returns. Documented limitation: a process restart mid-batch strands `processing` submissions until startup recovery requeues them.
- Chunked uploads (AD-013). 200 × 1 MB labels = 200 MB, comfortably under the new 200 MB cap. Beyond that scale needs chunking.
- Rate-limit backpressure against Gemini specifically. Concurrency cap is the only throttle in this PR.

## Decisions locked

1. **Worker mechanism: in-process, fire-and-forget Promise after the POST response.** Railway runs Next.js as a long-lived Node process; `processBatch(batchId).catch(logError)` continues executing after `NextResponse.json` returns. Simplest faithful implementation; no second service to provision; documented restart limitation handled by startup recovery.
2. **Concurrency: default 3 parallel Gemini calls per batch, env-configurable via `BATCH_WORKER_CONCURRENCY` (1–10).** 3 × ~7s = throughput ~8.5 min for 200 labels, ~12.5 min for 300. Free Gemini tier ~15 RPM tolerates 3 comfortably. Bump only after measuring rate-limit headroom.
3. **Max files per batch: 200 default (env `MAX_BATCH_FILES_OVERRIDE` 1–500).** Brief's 200–300 range; 200 covers the typical case, the env knob covers the upper end without a deploy.
4. **Body size: 200 MB on batch endpoint (env `BATCH_MAX_REQUEST_BYTES` already exists; default raised 50 → 200).** 200 × 1 MB matches the file cap.
5. **Startup recovery threshold: requeue any `processing` submission older than 10 min on process boot.** Older threshold means: any submission whose `updatedAt` is older than `(now - 10 min)` and whose status is still `processing` must be from a previous process generation, so it's safe to reset to `queued`.
6. **Backpressure: 429 if `(queued + processing) ≥ BATCH_QUEUE_DEPTH_LIMIT` (default 500).** Single COUNT query in the POST handler before accepting the batch. Cheap; protects the worker from collapsing under sustained inbound load.
7. **POST contract change: 202 status with `{ batchId, status, totalCount }` (no per-submission detail in the response).** Caller polls `/api/batches/:id` for progress. The existing 200-with-full-result shape is replaced; the E2E suite migrates to poll-based assertions. Breaking change is documented; the deployed UI updates in this same PR.
8. **Polling: client-side from `/batches/:id` every 2s, stops when batch status is terminal (`completed`, `partially_failed`, `canceled`).** No SSE / WebSocket — adds infra complexity for marginal UX gain at this scale.

## Approach

### Module: `lib/services/batch-worker.ts`

```ts
export async function processBatch(batchId: string): Promise<void>
```

- Queries all submissions in the batch with status `queued` ordered by `createdAt`.
- Drains them with a simple bounded-concurrency loop (semaphore = N active promises).
- Each submission: read its `applicationJson` + storage buffer, build `LabelImagePayload`, call `runVerification`. On success: transition `processing` → `extracted` → `verified` + `recordSubmissionVerification`. On failure: classify error, `recordSubmissionFailure`, transition to `failed`.
- When the loop ends, call `finalizeBatch(batchId)` to set the batch row's final status + counts.

### Module: `lib/services/batch-recovery.ts`

```ts
export async function requeueStaleProcessing(): Promise<{ requeued: number }>
```

- One UPDATE: set status to `queued` for rows where `status = 'processing'` AND `updatedAt < now() - 10 minutes`.
- For batches that are now fully terminal, call `finalizeBatch`.

### Boot hook

Next.js 16 supports `instrumentation.ts` at the project root. Add it. On first call:

1. `requeueStaleProcessing()`.
2. For each batch with status `queued` or `processing` and any `queued` submissions, fire `processBatch(batchId)` in the background. (Resumes batches that were mid-flight at the last restart.)

### Route changes: `app/api/batches/route.ts`

Replace step 9 (synchronous per-file loop) and step 10 (finalize) with:

```ts
// 9. Kick off async processing. Caller polls /api/batches/:id.
processBatch(batch.id).catch((err) =>
  console.error(`[batch-worker] batch ${batch.id} failed`, err),
);

// 10. Backpressure check moved to step 0 (before any work).

return NextResponse.json(
  { batchId: batch.id, status: batch.status, totalCount: batch.totalCount },
  { status: 202 },
);
```

Add to step 0 (right after content-length guard):

```ts
const depth = await countQueuedAndProcessing();
if (depth + files.length > BATCH_QUEUE_DEPTH_LIMIT) {
  return NextResponse.json(
    { error: "queue at capacity", code: "QUEUE_FULL", depth, limit },
    { status: 429 },
  );
}
```

### UI changes

`components/verification/BatchVerificationFlow.tsx`
- After 202 response, redirect to `/batches/:id` instead of rendering inline results.

`app/batches/[id]/page.tsx`
- Wrap the current submissions section in a `<BatchProgressPanel batchId={id} initial={data} />` client component.
- Poll `/api/batches/:id` every 2s while `batch.status` ∈ `{ queued, processing }`. Stop on terminal.

`components/batch/BatchProgressPanel.tsx` — new.

## Engineering tasks

1. **Worker module**
   1. `lib/services/batch-worker.ts` with bounded-concurrency loop. Unit tests: empty batch, all succeed, partial failure, concurrency respected.
   2. `lib/services/batch-recovery.ts`. Unit tests: nothing stale, some stale, none stale because still recent.

2. **Boot hook**
   1. Add `instrumentation.ts` at project root with the recovery + resume logic.
   2. Idempotent: safe to call twice on hot reload in dev.

3. **Route migration**
   1. POST returns 202; removes the synchronous processing loop.
   2. Adds the backpressure 429 check before parsing the body further (cheap COUNT query).
   3. Bump `MAX_BATCH_FILES` to 200 (env-overridable). Bump `DEFAULT_MAX_REQUEST_BYTES` to 200 MB.

4. **UI**
   1. `BatchVerificationFlow` redirects on 202.
   2. `app/batches/[id]/page.tsx` wraps the submissions table in a polling client component.

5. **Tests**
   1. `tests/batch-worker.test.ts` — bounded concurrency, error isolation per submission, final state.
   2. `tests/batch-recovery.test.ts` — stale-row identification.
   3. `tests-e2e/batch-async.spec.ts` — POST returns 202 < 2s, GET shows progressive counts, terminal status reached.
   4. Migrate `tests-e2e/batch-sync.spec.ts` to poll the GET endpoint instead of asserting on the POST response (the response shape changed).

## Acceptance criteria

Lifted from `docs/roadmap.md:692-699`:

- [ ] `POST /api/batches` with a 100-file payload returns within 2 seconds.
- [ ] Worker processes submissions at the configured concurrency.
- [ ] Killing the worker mid-batch and restarting it produces no duplicate `VerificationRecord` rows. *(Best-effort: startup recovery requeues, but a record may exist if the verify call succeeded just before SIGKILL — Phase 7 idempotency work covers this.)*
- [ ] A submission that 503s twice then succeeds reaches `verified` with `attemptCount = 3`.
- [ ] A submission that 503s three times reaches `failed` with `errorCode = 'RETRY_EXHAUSTED'`.
- [ ] Cancelling a batch transitions queued submissions to `canceled` and stops new starts. **DEFERRED to follow-up PR; documented in Out of Scope.**
- [ ] Backpressure: queue depth ≥ 500 rejects new batches with 429.
- [ ] All Phase 3 and Phase 4 E2E tests still pass (Phase 3 sync test migrated to poll-based per the contract change).

## Risks

- **In-process worker dies with the Next.js process on deploy/restart.** → Mitigation: startup recovery requeues stale `processing` rows. Documented in `docs/assumptions-and-limitations.md`. Phase 7 can move to a separate Railway worker service if scale requires.
- **Unawaited promises blocking the event loop / leaking memory.** → Mitigation: bounded concurrency caps active work; each submission's buffers are released after the verify call returns; no shared state across submissions.
- **Backpressure check is racy** (two requests arrive concurrently, both pass the 500 check, queue spikes to 599). → Acceptable for prototype; absolute correctness needs a DB-side advisory lock. Documented limitation.
- **Gemini rate limits at concurrency=3 across many concurrent batches.** → Mitigation: 503-retry policy already exists; concurrency env-tunable down to 1 if rate limits start firing in production traces.

## Manual prerequisites

| What | Why |
|---|---|
| Set `BATCH_WORKER_CONCURRENCY` on Railway if default 3 is wrong for your Gemini tier | Higher concurrency = faster throughput but higher 503 risk |
| Optionally raise `MAX_BATCH_FILES_OVERRIDE` to 300 for peak importer batches | Default 200 fits the brief's lower bound; raise for upper bound |
| Watch the first live batch in Braintrust for `verification.latencyUnder5s` aggregate | Validates that async processing didn't regress single-call latency |

## Notes

- The synchronous response shape changes from 200 with full result to 202 with `batchId`. The deployed `BatchVerificationFlow` UI updates in the same PR. Any external API caller that integrated against the 200 response in Phase 3 must migrate to the poll pattern.
- Brief alignment: this is the spec's explicit answer to Sarah Chen's "big importers who dump 200, 300 label applications on us at once" requirement. The implementation also addresses the brief's "we need results back in about 5 seconds" constraint indirectly — POST itself returns in ≤2s; the per-submission verify call is still bound by the 7.6s Gemini extraction time.

---

**Status legend:** Draft → Approved → In progress → Done

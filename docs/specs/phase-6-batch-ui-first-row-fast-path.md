# Feature Spec — Phase 6: Batch UI with first-row fast path

**Status:** Done (2026-05-18) — backend + UI + E2E specs landed; one Playwright path (`firstSubmission.ok=false`) marked `test.skip` until a clean failure trigger is wired into the mock extractor.
**Owner:** Stefano
**Last updated:** 2026-05-18

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. Content is original.

## Goal

Make a bulk batch upload feel as fast as a single-label upload. Today, POST `/api/batches` returns 202 immediately and the user stares at a polling spinner for ~6 seconds per row × N rows before they see anything. This spec keeps the existing async worker but adds a **first-row fast path**: the POST blocks just long enough to verify row 1, returns that result inline (the same UI used for single-label `/api/verify`), then the user watches a live progress bar as rows 2…N finish in the background. Goal: time-to-first-result under the 5 s SLO, while a 199-row batch still completes in roughly N × 6 s ÷ concurrency.

This spec also closes the rest of Phase 6 (dropzone, drill-down, pre-submit validation) per the roadmap.

## Scope

**In scope:**

- **First-row fast path** — `runFirstSubmissionInline()` orchestrator helper that synchronously processes row 1, persists its `VerificationRecord` and `BatchSubmission`, and returns the report + extracted label in the POST response. Rows 2…N are queued and processed by the existing `batch-worker.ts` exactly as today.
- **`Batch.firstSubmissionId` FK** so a polling client can resolve "the row that was processed inline" without a separate query.
- **`/batches/:id` page** redesign:
  - First-result banner at the top — same component used on `/verification/:id` (the single-label result UI).
  - Live progress bar (percent, `completed / total`, "X processing now", failed count).
  - Submissions table with row#, file name, status badge, pass/fail verdict, overall confidence, mismatch count, link to per-row report.
- **`/batches/new` redesign** — drag-and-drop dropzone with image previews + per-file size; CSV manifest drop alongside it; pre-submit validation panel (orphan rows / orphan files / required-column check) before POST.
- **Drill-down** — clicking a submission row opens a side panel with the full `VerificationReport` without navigating away (Phase 6.4 from roadmap).
- **Exponential backoff** for Gemini 503/429 — replace the fixed `[5000, 10000]` ms delays in `callWithRetryOn503` with exponential delays `[1000, 2000, 4000, 8000]` ms. Adds 429 to the trigger list. (Roadmap-tier reliability work that's a one-line change once we're in the file.)
- **`processingCount` and `percentComplete` in `GET /api/batches/:id`** — derived, no schema change.
- **Tests** — Vitest for `runFirstSubmissionInline` + exponential-backoff helper. Playwright E2E for "upload 5-file batch → first result banner renders before progress bar finishes."

**Out of scope:**

- New `/api/bulk-verification/*` route namespace. The existing `/api/batches/*` routes stay; renaming would invalidate every Phase 5 test for no gain.
- SSE/WebSocket. Existing 2 s polling (`BatchProgressPoller.tsx`) is sufficient — SSE adds Railway-side complexity (long-lived connections, edge buffering) that we don't need at N=199. Deferred to Phase 7 if load tests show polling is a problem.
- New "retrying" status. Phase 5 already covers retry semantics: a row transitions back to `queued` between attempts. Adding a UI badge that surfaces "this row is mid-retry" is cheap if we want it (open question below) but no schema change is needed.
- A new `firstResult` JSON column on `Batch`. Cleaner to use `firstSubmissionId` FK and join — keeps `Batch` lean and avoids denormalized state drift.
- Cancel button (Phase 6.5 from roadmap) — keep on Phase 6 plan, not blocking the fast-path work; can ship in the same PR if time allows.
- Submissions-tab batchId filter (Phase 6.6) — same: keep on Phase 6, defer if scope slips.
- TABC-data PDF ingestion. The TABC CSV at `data/external/tabc-labels-199.csv` references PDFs by URL; the batch endpoint accepts uploaded image files only. A separate `scripts/tabc-prepare-batch.ts` (PDF → PNG conversion) is its own spec — see Manual prerequisites.

## Approach

Surgical change over re-architecture. Existing flow:

```
POST /api/batches  (multipart: manifest CSV + N image files)
  → validate manifest                       [synchronous]
  → persist Batch + N BatchSubmissions      [synchronous]
  → startBatchInBackground(batchId)         [async, returns immediately]
  → respond 202 { batchId, status: queued } [synchronous]
```

New flow with first-row fast path:

```
POST /api/batches
  → validate manifest                       [synchronous]
  → persist Batch + N BatchSubmissions      [synchronous]
  → runFirstSubmissionInline(submissions[0])  ← NEW [synchronous, ~5–7 s]
  → startBatchInBackground(batchId, skipFirst=true)  [async]
  → respond 200 {                            [synchronous]
       batchId,
       totalRows: N,
       firstSubmission: {
         id, rowIndex: 0, status: 'verified',
         report, extractedLabel, recordId
       }
     }
```

Module impact:

- **New** `lib/services/run-first-submission-inline.ts` — thin adapter that calls `runVerification()` (the same orchestrator `/api/verify` uses) on submission row 1, awaits, updates the `BatchSubmission` row, returns the result.
- **Touch** `app/api/batches/route.ts` — call the new helper between the persist step and the background-worker kickoff. Existing 202 response shape extended (additive; not breaking) to include `firstSubmission` when row 1 verified successfully, or `firstSubmissionError` when row 1 failed.
- **Touch** `lib/services/batch-worker.ts` — accept `skipFirst` flag so the background pass doesn't re-process row 1. One-line change to the row selector (`where: { rowIndex: { gt: 0 } }`).
- **Touch** `prisma/schema.prisma` — add `firstSubmissionId String? @unique` FK on `Batch`. Migration is additive.
- **Touch** `lib/services/gemini-label-extraction.service.ts` — swap `GEMINI_503_RETRY_DELAYS_MS = [5000, 10000]` to a computed exponential schedule with optional jitter; widen `is503Error` to also classify 429s (`Too Many Requests`). Tests assert the new schedule.
- **Touch** `app/api/batches/[id]/route.ts` — add `processingCount` and `percentComplete` to the response payload. Derived from existing counts.
- **New** `components/verification/BatchFirstResultBanner.tsx` — wraps the existing single-label result component (already at `components/verification/VerificationReport.tsx` or wherever the single-label flow renders its result — verify path during implementation).
- **Touch** `app/batches/[id]/page.tsx` — render the banner above the existing progress poller; extend the submissions table with verdict + confidence + mismatch columns; add right-side drill-down panel.
- **Touch** `app/batches/new/page.tsx` (or its component, e.g. `components/batches/NewBatchFlow.tsx`) — dropzone + manifest validation panel.

Error isolation contract (unchanged from Phase 5):

- A failed row 1 does not block the batch. POST returns 200 with `firstSubmission.status: 'failed'` and the structured `errorCode` / `errorMessage` from `error-taxonomy.ts`. The rest of the batch processes regardless.
- A failed row 2…N updates only that `BatchSubmission`; `Batch.failedCount` increments; the worker moves on.

## Engineering tasks

1. **Migration + schema**
   1. Add `firstSubmissionId String? @unique` to `Batch` in `prisma/schema.prisma`. Add `firstSubmission BatchSubmission? @relation("BatchFirstSubmission", fields: [firstSubmissionId], references: [id])`.
   2. Generate migration: `prisma migrate dev --name batch_first_submission_id`.

2. **Inline first-row orchestrator**
   1. Create `lib/services/run-first-submission-inline.ts` exporting `runFirstSubmissionInline({ batchId, submission }): Promise<FirstSubmissionResult>`.
   2. Internally: load file bytes from `file-storage`, call `runVerification` with `batchSubmissionId` set, on success update the `BatchSubmission` row (`status: verified`, link to created `VerificationRecord`) and stamp `Batch.firstSubmissionId`, increment `Batch.completedCount`. On failure: mark `status: failed` with `errorCode` from `classifyError`, increment `Batch.failedCount`.
   3. Unit tests in `tests/run-first-submission-inline.test.ts`: success path, failure path, persistence assertions.

3. **POST `/api/batches` route update**
   1. After `createBatchSubmissions` returns, before `startBatchInBackground`, call `runFirstSubmissionInline` on `submissions[0]`.
   2. Pass `skipFirstSubmission: true` into `startBatchInBackground`.
   3. Extend the 200 response to include `firstSubmission` (when verified) or `firstSubmissionError` (when failed). Update the response Zod schema in `lib/schemas/batch-api.schema.ts`.
   4. Integration test in `tests/batch-api-first-row.test.ts`: POST with 3 rows, assert the response body includes a verified `firstSubmission`, assert `Batch.completedCount = 1` immediately after the POST.

4. **`batch-worker` skip flag**
   1. Add optional `{ skipFirstSubmission?: boolean }` to `startBatchInBackground` (and the internal `processBatch`). When true, the selector adds `rowIndex: { gt: 0 }`.
   2. Unit test in `tests/batch-worker.test.ts`: with `skipFirstSubmission: true`, row 0 is not picked up.

5. **Exponential backoff**
   1. In `gemini-label-extraction.service.ts`, replace `GEMINI_503_RETRY_DELAYS_MS = [5000, 10000]` with `[1000, 2000, 4000, 8000]` (4 attempts, ≈15 s max). Add small jitter (`±20%`) to avoid thundering herd.
   2. Widen `is503Error` → `isRetryableError` to match 503 and 429 (or `Rate limit` / `RESOURCE_EXHAUSTED` in the message).
   3. Update tests in `tests/gemini-retry.test.ts` to assert the new schedule and 429 trigger. Keep `GEMINI_503_RETRY_DELAYS_MS` as a deprecated re-export so any external import doesn't break.

6. **Progress payload**
   1. In `app/api/batches/[id]/route.ts`, compute `processingCount = totalCount - completedCount - failedCount - canceledCount` and `percentComplete = Math.round((completedCount + failedCount) / totalCount * 100)`. Add both to the response body.
   2. Update the consuming React types in `types/batch.ts` and the client poller.

7. **`/batches/:id` UI**
   1. New `components/verification/BatchFirstResultBanner.tsx` — renders `firstSubmission.report` using the same component the single-label `/verification/:id` page uses. Verify component reuse path during implementation.
   2. Update `app/batches/[id]/page.tsx` to (a) load the batch, (b) render the banner if `firstSubmissionId` is set, (c) keep the existing poller below for the rest.
   3. Extend the submissions table with new columns: row#, pass/fail verdict, overall confidence (3-decimal), mismatch count. Source from each submission's linked `VerificationRecord`.
   4. Add right-side drill-down panel: click a row → shows full `VerificationReport` in a slide-in panel without losing list scroll position.

8. **`/batches/new` UI**
   1. Dropzone component in `components/batches/BatchDropzone.tsx` with image previews + size readouts. Use `react-dropzone` if it's already a dep; otherwise raw HTML5 drag/drop (no new dep just for this).
   2. Manifest drop with pre-submit validation: parse the CSV client-side, run a lightweight echo of `manifest-validator.ts` (orphan-row / orphan-file / required-column checks), render the validation panel inline before POST is allowed.
   3. Submit button disabled until validation passes.

9. **Playwright E2E**
   1. `tests-e2e/batch-first-row-fast-path.spec.ts` — upload 5-file batch with a CSV; assert the first-result banner appears before the progress bar reads 100%.
   2. `tests-e2e/batch-drill-down.spec.ts` — click a completed submission, assert the drill-down panel renders the report.
   3. `tests-e2e/batch-manifest-validation.spec.ts` — drop a manifest with one orphan row, assert the validation panel highlights it and POST is disabled.

10. **Docs**
    1. Update `docs/roadmap.md` Phase 6 section: mark 6.1–6.4 done in this spec; flag 6.5 (Cancel) and 6.6 (filter) as deferred if not in scope this PR.
    2. Append to `docs/assumptions-and-limitations.md` under "Latency": "First-row fast path returns row 1 inline (~5–7 s under load); remaining rows continue in the existing background worker."
    3. Update `docs/specs/phase-5-async-queue.md` Status to "Done" if not already.

## Acceptance criteria

- [ ] POST `/api/batches` returns 200 with a `firstSubmission` object whose `status` is `verified` or `failed`, never `queued` or `processing`.
- [ ] Time-to-first-result, measured server-side as `Date.now() - requestStart` in the POST handler, is under 8 s on `gemini-2.5-flash-lite` (model swap must have landed; see Manual prerequisites). Target ≤ 6 s.
- [ ] Remaining rows are processed by the existing worker; final `Batch.status` reaches `verified` (or `verified_with_failures`) without intervention.
- [ ] One failed row does not block any other row. `Batch.failedCount` increments correctly; the batch completes.
- [ ] `GET /api/batches/:id` includes `processingCount` and `percentComplete` in the JSON body.
- [ ] `/batches/:id` page renders the first-row report at the top within one render after POST; the progress bar updates on the same poll cycle (2 s).
- [ ] Clicking a row in the submissions table opens a drill-down without a full page navigation.
- [ ] `/batches/new` rejects POST if the manifest has orphan rows or missing required columns, with a panel that names each problem row.
- [ ] Exponential backoff: first retry delay ≈ 1 s, fourth retry delay ≈ 8 s, total time-to-give-up ≈ 15 s (± jitter). 429s trigger the same path.
- [ ] All Vitest + Playwright tests pass; `npx tsc --noEmit` passes.

## Evals

- `tests/run-first-submission-inline.test.ts` — asserts (a) success path persists `VerificationRecord`, links `Batch.firstSubmissionId`, increments `completedCount`, (b) failure path marks `BatchSubmission.status = failed` with a structured `errorCode`, increments `failedCount`, returns the error without throwing.
- `tests/batch-api-first-row.test.ts` — integration test that POSTs a 3-row batch and asserts response shape + DB state immediately after the POST.
- `tests/batch-worker.test.ts` (extended) — assert `skipFirstSubmission: true` excludes `rowIndex: 0`.
- `tests/gemini-retry.test.ts` (extended) — assert the new exponential schedule, jitter bounds, 429 classification.
- `tests-e2e/batch-first-row-fast-path.spec.ts` — Playwright: first-result banner renders before progress reaches 100%.
- `tests-e2e/batch-drill-down.spec.ts` — Playwright: drill-down panel renders the report.
- `tests-e2e/batch-manifest-validation.spec.ts` — Playwright: orphan-row panel + POST disabled.

## Open questions

- **Should POST return 200 or 202 now that it blocks for ~6 s?** Lean: **200**. Status code semantics aside, the response now carries a real result, not just an accepted-for-processing acknowledgement. Callers that previously consumed 202 will need a one-line type update; the only existing caller is our own UI, which we control.
- **What happens if row 1 alone takes longer than the Next.js route's `maxDuration` (60 s)?** Lean: hard-fail with 504 and the structured error from `error-taxonomy.ts`; the rest of the batch is *not* persisted in that case, so the user retries from scratch. Mitigation: `maxDuration` is 60 s and a single Gemini call is ~6 s, so we have headroom unless the model regresses.
- **Add a visible "retrying" status badge?** Lean: **no for v1**. Phase 5's retry transitions back to `queued`, so the UI already reflects it. If reviewers find it confusing during dogfooding, add a `lastErrorAt` timestamp + badge in a follow-up.
- **Do we expose first-row failures differently from other-row failures?** Lean: **no**. Same `BatchSubmission` shape, same error taxonomy; the UI just renders the banner with the failure verdict and a retry-row button.
- **Concurrency cap — keep at 3 or bump to 5?** Lean: keep at **3** until Phase 7 load test gives us 429 telemetry to justify a bump. Tunable via `BATCH_WORKER_CONCURRENCY` env var if needed.

## Risks

- **Time-to-first-result is gated by the live deployed model.** As of the most recent trace (`docs/traces/2026-05-17-trace-4e392da9.md`) the deploy is still running `gemini-2.5-flash` because the Railway `GEMINI_MODEL` env var overrides the code default. → mitigation: spec is **blocked on the model swap landing** (Manual prerequisites). The 5–6 s target won't pass acceptance until that's done. The implementation itself isn't blocked.
- **POST handler latency budget.** Blocking POST for ~6 s changes the user perception of "upload". → mitigation: spinner copy on the client ("Verifying first label…"), and we already commit row 1 to durable state before calling Gemini, so a client-side abort doesn't lose the batch.
- **Migration vs running queue.** Adding `firstSubmissionId` to `Batch` while batches may be processing. → mitigation: the column is nullable and additive; existing rows stay null and the new code path only writes it on new POSTs.
- **Worker race on row 0.** Background worker must not pick up row 0 between the inline run and the kickoff. → mitigation: `runFirstSubmissionInline` sets `BatchSubmission.status = verified | failed` synchronously *before* `startBatchInBackground` is invoked, and the worker's selector filters by status.
- **Drill-down panel re-fetches every click.** → mitigation: cache the last opened report in component state; clear on batch refresh.

## Manual prerequisites

| What | Why |
|---|---|
| Confirm `GEMINI_MODEL=gemini-2.5-flash-lite` (or env var deleted) on Railway, then redeploy and re-run a single label to confirm the trace shows `model: "gemini-2.5-flash-lite"` and `geminiCallMs ≤ 4500`. | Until the model swap lands, the 5–6 s first-row target is unachievable regardless of implementation quality. See `docs/traces/2026-05-17-trace-4e392da9.md`. |
| Decide: include Phase 6.5 (Cancel) and 6.6 (batchId filter) in this PR, or split? | Affects PR size and review time. Default: split, ship them in a small follow-up. |
| Decide: TABC `data/external/tabc-labels-199.csv` is *not* a usable input for the batch endpoint (URLs to PDFs, not multipart-uploaded images). Either approve a separate `scripts/tabc-prepare-batch.ts` (PDF → PNG conversion + verifier-format manifest) as a sibling spec, or pick a different bulk-test source. | Affects whether the 199-row demo actually runs against the new fast path. |

## Notes

- Existing batch architecture mapped in detail in the Phase-6 prep audit (Explore agent run, 2026-05-18). All 12 sections of the original feature request map to existing code except for the first-row fast path, drill-down panel, and inline verdict columns called out above.
- The single-label result component intended for reuse in the first-result banner lives in `components/verification/` — exact filename to be confirmed during implementation (likely `VerificationReportView.tsx` or similar). If the component is currently tangled with `NewVerificationFlow.tsx`, a small refactor to extract a pure-presentational version may be required and should be folded into task 7.1.
- Adopted pattern reference: "fast-path then background queue" is the same pattern Stripe uses for `setup_intent` confirmation (sync confirm + async webhook). No code copy — pattern only.

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written. See `docs/roadmap.md` → "How to read this document".

# Feature Spec — Phase 3: Synchronous Batch Path

**Status:** Approved
**Owner:** Stefano
**Last updated:** 2026-05-16

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label) with attribution. See `docs/specs/_template.md`.

## Goal

End-to-end batch processing for **up to 5 files** in a single HTTP request, processed serially, with **per-file error isolation**. Proves the data model and storage layer from Phase 2 work in practice and gives operators a working batch endpoint to point a UI at in Phase 6. Synchronous and capped at 5 files — that cap moves to 300 in Phase 5 when the async worker lands.

## Scope

**In scope:**
- `POST /api/batches` — multipart/form-data, ≤5 files, 50 MB body cap (AD-012), processes serially, returns final state inline.
- `GET /api/batches/:id` — returns the batch + per-submission summary (no full reports inline, to keep response small).
- `app/batches/[id]/page.tsx` — server component that lists submissions, links verified ones to existing `/verification/:id`, shows inline errors on failed ones.
- `lib/services/batch-service.ts` — `createBatch`, `getBatchById`, `transitionSubmissionStatus`, `recordSubmissionVerification`, `recordSubmissionFailure`. The service-layer gap surfaced by the Phase 2 audit.
- Extend `lib/services/verification-orchestrator.ts` so `runVerification` accepts an optional `batchSubmissionId` that gets persisted on the `VerificationRecord`.
- Extend `lib/services/verification-record.service.ts` `createVerificationRecord` to accept the same optional FK.
- Submissions tab gains a `batchId` query-param filter (`/?batchId=...`).
- E2E test driving 3 fixtures through the new endpoint (2 happy + 1 designed to fail) — proves per-file isolation.

**Out of scope:**
- Manifest parsing (Phase 4).
- Async queue / background worker (Phase 5). Phase 3 is **synchronous** — the HTTP request holds open for the full batch.
- Batch UI for upload (Phase 6). Phase 3 ships an API + a *read-only* batch detail page; no upload form.
- Chunked POSTs / 200-file batches (AD-013, Phase 5).
- Cost tracking, structured logs, retry semantics (Phase 5/7).
- Cancellation endpoint (Phase 5).

## Approach

### File map (new + modified)

| Path | Status | Purpose |
|---|---|---|
| `app/api/batches/route.ts` | New | `POST /api/batches`. |
| `app/api/batches/[id]/route.ts` | New | `GET /api/batches/:id`. |
| `app/batches/[id]/page.tsx` | New | Read-only batch detail page. |
| `lib/services/batch-service.ts` | New | Pure data-access + state-transition helpers. |
| `lib/services/verification-orchestrator.ts` | Modified | `runVerification` accepts optional `batchSubmissionId`. |
| `lib/services/verification-record.service.ts` | Modified | `createVerificationRecord` accepts optional `batchSubmissionId`. |
| `lib/schemas/batch-api.schema.ts` | New | Zod request body + response schemas for the new endpoint. |
| `components/verification/VerificationHistoryTable.tsx` | Modified | Honor `?batchId=...` filter from the URL. |
| `tests/batch-service.test.ts` | New | Unit tests for service helpers (no DB; use Prisma mock or in-process test). |
| `tests/batch-api.schema.test.ts` | New | Zod schema unit tests. |
| `tests-e2e/batch-sync.spec.ts` | New | End-to-end: 3 files, 1 designed to fail, assert batch reaches `partially_failed` with 2 verified + 1 failed. |

### Endpoint — POST /api/batches

**Request shape (multipart/form-data):**

```
POST /api/batches
Content-Type: multipart/form-data; boundary=...

files[]:        the N image files (1–5)
applications:   JSON string — array of N ColaApplication objects, in same order as files
batchMetadata:  optional JSON string — { clientName?, applicantName? }
```

**Body size limit: 50 MB (AD-012).** Enforced by checking `Content-Length` header before reading the body. Rejected requests get `413 Payload Too Large` with a typed error.

**Validation order (fail fast, before any storage write):**

1. `Content-Length` ≤ 50 MB → else 413.
2. `files.length` between 1 and 5 → else 400.
3. `applications` parses as JSON array with `length === files.length` → else 400.
4. Each application validates against `colaApplicationSchema` → else 422 with Zod issues, pointing at the file index.
5. Compute sha256 of each file. No two files in the same request share a hash → else 400 with `DUPLICATE_FILE_IN_BATCH` error pointing at the duplicate indices.
6. `batchMetadata`, if present, parses as JSON object → else 400.

**Processing (after validation):**

1. For each file: `FileStorage.put({ buffer, mimeType })`. Stored bytes are the **original** uploaded bytes (preprocessing happens at verification time, not at storage time — preserves audit trail).
2. Create `Batch` row with `status='processing'`, `totalCount=N`.
3. Create N `BatchSubmission` rows with `status='queued'`, linked to the batch, with `fileHash`, `fileName`, `fileSize`, `fileMimeType`, `fileStorageKey`, `applicationJson`.
4. For each submission, in declared order:
   - Transition `queued → processing` via `transitionSubmissionStatus`.
   - Read the file bytes via `FileStorage.getBuffer(fileStorageKey)`.
   - Build a `LabelImagePayload` with the buffer as base64, hand to `runVerification({ ..., batchSubmissionId: submission.id })`.
   - On success: `runVerification` already persisted the `VerificationRecord` (with the batch FK set). Transition `processing → extracted → verified` (two transitions; valid per the transition table). Increment `batch.completedCount`.
   - On failure: classify the error via `classifyError`. Set `BatchSubmission.errorCode` and `errorMessage`. Transition `processing → failed`. Increment `batch.failedCount`.
5. After all submissions: compute final `Batch.status`:
   - `completed` if `failedCount === 0`
   - `partially_failed` if `0 < failedCount < totalCount`
   - `partially_failed` if `failedCount === totalCount` (still partial — *the batch itself completed*, individual submissions failed; reserving `failed` for batch-level infra failures we don't have in Phase 3).
6. Set `Batch.completedAt = now()`.

**Response (always 200 if the batch was created — even with failures, since per-file isolation is the design):**

```json
{
  "batchId": "cmpxxx",
  "status": "partially_failed",
  "totalCount": 3,
  "completedCount": 2,
  "failedCount": 1,
  "submissions": [
    { "id": "cmsxxx", "fileName": "wine1.jpg", "status": "verified", "verificationRecordId": "cmrxxx" },
    { "id": "cmsxxx", "fileName": "wine2.jpg", "status": "verified", "verificationRecordId": "cmrxxx" },
    { "id": "cmsxxx", "fileName": "wine3.jpg", "status": "failed", "errorCode": "GEMINI_OTHER", "errorMessage": "..." }
  ]
}
```

### Endpoint — GET /api/batches/:id

Returns the batch + submission summaries. No full `report` payload (keeps response small; client navigates to `/verification/:recordId` for detail).

```json
{
  "batch": { "id", "status", "createdAt", "completedAt", "totalCount", "completedCount", "failedCount", "canceledCount" },
  "submissions": [
    { "id", "fileName", "fileSize", "status", "errorCode?", "errorMessage?", "verificationRecordId?", "createdAt", "completedAt?" }
  ]
}
```

404 if no such batch.

### Page — `/batches/:id`

Server component. Reads batch via `getBatchById(id)`. Renders:

- Header: batch ID (mono), createdAt, status badge (reuse existing badge styling), counters (`X verified · Y failed · Z queued`).
- Table: one row per submission. Columns: file name, file size, status badge, action.
  - Verified rows: action = "View report →" linking to `/verification/:verificationRecordId`.
  - Failed rows: action = error message inline (short — error code as a chip, message as text). No retry button in Phase 3 (retry is Phase 5).
  - Queued rows: action = "—" (Phase 3 is sync so this won't appear post-response; included for forward-compat with Phase 5).
- "Back to Submissions" link to `/`.

### Service — `lib/services/batch-service.ts`

```ts
// Pure data-access. No HTTP concerns, no orchestration of runVerification —
// that lives in the route handler.

export async function createBatch(input: {
  clientName?: string;
  applicantName?: string;
  totalCount: number;
}): Promise<Batch>;

export async function createBatchSubmissions(input: {
  batchId: string;
  submissions: Array<{
    fileHash: string;
    fileName: string;
    fileSize: number;
    fileMimeType: string;
    fileStorageKey: string;
    applicationJson: unknown;
  }>;
}): Promise<BatchSubmission[]>;

export async function getBatchById(id: string): Promise<{
  batch: Batch;
  submissions: BatchSubmission[];
} | null>;

export async function transitionSubmissionStatus(
  id: string,
  to: BatchSubmissionStatus,
): Promise<BatchSubmission>;
// Throws InvalidBatchTransitionError if isValidBatchSubmissionTransition(from, to) is false.

export async function recordSubmissionVerification(
  submissionId: string,
  verificationRecordId: string,
): Promise<void>;
// Updates the VerificationRecord's batchSubmissionId FK and bumps batch.completedCount atomically.

export async function recordSubmissionFailure(
  submissionId: string,
  errorCode: BatchErrorCode,
  errorMessage: string,
): Promise<void>;
// Sets errorCode + errorMessage, transitions to failed, bumps batch.failedCount atomically.

export async function finalizeBatch(batchId: string): Promise<Batch>;
// Recomputes Batch.status based on counter state and sets completedAt.
```

All counter updates use Prisma's `{ increment: 1 }` to avoid lost updates.

### Orchestrator change

`runVerification` gains one optional input field:

```ts
export interface RunVerificationInput {
  // ...existing fields unchanged...
  batchSubmissionId?: string;  // NEW
}
```

Passed through to `createVerificationRecord`, which sets it on the persisted row. No behavior change when omitted (existing single-label callers stay green).

### Submissions tab filter

`VerificationHistoryTable.tsx` reads `useSearchParams()` for `batchId`. If present, filters the rendered records to those whose `batchSubmissionId` belongs to that batch. (Requires server-side filter in the page's `listVerificationRecords` call — extend the service to accept an optional `batchId` filter.)

### Body size guard implementation

Next.js 16 App Router route handlers do NOT enforce a body size limit out of the box. Strategy:

1. In `POST /api/batches`, read `request.headers.get('content-length')` first.
2. If missing → 411 Length Required.
3. If > `BATCH_MAX_REQUEST_BYTES` (default 50 * 1024 * 1024) → 413 Payload Too Large with a structured error.
4. Only then call `request.formData()`.

Configurable via env `BATCH_MAX_REQUEST_BYTES` (default 52428800). Documented in `.env.example`.

## Engineering tasks

1. **Service layer**
   1. Create `lib/services/batch-service.ts` with the 6 functions above. Each uses Prisma directly.
   2. `transitionSubmissionStatus` reads the current status, calls `isValidBatchSubmissionTransition` from `lib/schemas/batch.schema.ts`, throws `InvalidBatchTransitionError` (new typed error) on invalid transitions.
   3. Use Prisma `$transaction` for the verification + counter update + transition triple (so a crash mid-step doesn't leave the batch in an inconsistent state).

2. **Schema**
   1. Create `lib/schemas/batch-api.schema.ts`:
      - `createBatchRequestApplicationsSchema` — `z.array(colaApplicationSchema).min(1).max(5)`.
      - `createBatchRequestMetadataSchema` — `{ clientName?, applicantName? }`.
      - `createBatchResponseSchema` — the response shape above.
   2. Export inferred types.

3. **Orchestrator + record service**
   1. Add `batchSubmissionId?: string` to `RunVerificationInput`.
   2. Pass through to `createVerificationRecord` input.
   3. `createVerificationRecord` sets it on the Prisma create. Backward-compatible: defaulting to `undefined` for single-label callers.

4. **POST /api/batches**
   1. Body-size guard (Content-Length check).
   2. Parse `request.formData()`.
   3. Validation cascade (file count, applications count, each application schema, sha256 dedup, batchMetadata).
   4. For each file: read into Buffer, `FileStorage.put`, capture `storageKey`.
   5. `createBatch` + `createBatchSubmissions`.
   6. Loop: `transitionSubmissionStatus(queued→processing)` → load buffer → `runVerification` → on success transition `processing→extracted→verified` and `recordSubmissionVerification` → on failure `classifyError` + `recordSubmissionFailure`.
   7. `finalizeBatch`.
   8. Return JSON.

5. **GET /api/batches/:id**
   1. Call `getBatchById`, return 404 if null.
   2. Map to API response shape (no full report).

6. **`/batches/:id` page**
   1. Server component, async, reads param.
   2. Calls `getBatchById`.
   3. Renders header + table.
   4. Reuses existing `OverallStatusBadge`-style component (or new `BatchSubmissionStatusBadge` if needed — see Open Q4).

7. **Submissions filter**
   1. Extend `listVerificationRecords` to accept `{ batchId?: string }`.
   2. Update `app/page.tsx` to read `searchParams.batchId` and pass through.
   3. Update `VerificationHistoryTable.tsx` to show a chip "Showing batch: cmpxxx — clear filter" when active.

8. **`.env.example`**
   1. Add `BATCH_MAX_REQUEST_BYTES=52428800`.

9. **Tests**
   1. `tests/batch-service.test.ts` — see Evals.
   2. `tests/batch-api.schema.test.ts` — see Evals.
   3. `tests-e2e/batch-sync.spec.ts` — see Evals.

## Acceptance criteria

- [ ] `POST /api/batches` with 3 valid files returns 200 with `batchId`, `totalCount=3`, `status` in {completed, partially_failed}, and a `submissions` array of length 3.
- [ ] `POST /api/batches` with 6 files returns 400 with `TOO_MANY_FILES`.
- [ ] `POST /api/batches` with `Content-Length` > 52428800 returns 413 with `PAYLOAD_TOO_LARGE`.
- [ ] `POST /api/batches` with mismatched files/applications counts returns 400.
- [ ] `POST /api/batches` with two identical files returns 400 with `DUPLICATE_FILE_IN_BATCH`.
- [ ] `POST /api/batches` with one application that fails Zod returns 422 with the file index in the error.
- [ ] When one of 3 submissions fails extraction (e.g., mock returns missing warning), the other 2 still complete verified. Batch reaches `partially_failed` with counts 2 / 1.
- [ ] `GET /api/batches/:id` returns the batch + submission summaries; no full reports inline.
- [ ] `/batches/:id` page renders the table; verified rows link to `/verification/:recordId`.
- [ ] `/?batchId=cmpxxx` filters the Submissions tab to records from that batch.
- [ ] The new E2E spec passes locally and in CI.
- [ ] `npm test` continues to pass (122 prior + new batch-service + batch-api.schema tests).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` succeeds.
- [ ] `npm run eval:full` continues to pass (no regression on the single-label pipeline).

## Evals

- `tests/batch-service.test.ts`:
  - `createBatch_sets_status_processing`
  - `createBatchSubmissions_creates_N_rows_with_queued_status`
  - `transitionSubmissionStatus_allows_queued_to_processing`
  - `transitionSubmissionStatus_rejects_queued_to_verified` (throws InvalidBatchTransitionError)
  - `recordSubmissionVerification_sets_FK_on_VerificationRecord_and_bumps_completedCount`
  - `recordSubmissionFailure_sets_errorCode_errorMessage_and_bumps_failedCount`
  - `finalizeBatch_marks_completed_when_failedCount_zero`
  - `finalizeBatch_marks_partially_failed_when_some_failed`

- `tests/batch-api.schema.test.ts`:
  - `applications_schema_rejects_empty_array`
  - `applications_schema_rejects_more_than_5`
  - `applications_schema_accepts_3_valid_applications`
  - `applications_schema_rejects_invalid_application` (one bad app rejects the array)
  - `metadata_schema_accepts_clientName_and_applicantName`
  - `metadata_schema_rejects_unknown_fields` (strict)
  - `response_schema_round_trips_a_partial_failure`

- `tests-e2e/batch-sync.spec.ts`:
  - `batch_with_3_files_processes_with_per_file_isolation` — POST 3 files (2 happy, 1 with mockScenario=missing-warning), assert response: totalCount=3, completedCount=2, failedCount=1, status=partially_failed. Then GET /api/batches/:id, assert same shape. Navigate to /batches/:id, assert table renders 3 rows with correct status badges.

## Open questions

- **Q1: Should the response always 200, or 207 (Multi-Status) when there are failures?** Lean: **always 200**. Rationale: HTTP status reflects the batch *operation*, not the individual results. The batch itself succeeded in creating + processing. Per-submission results live in the body. 207 is technically more correct but rarely used and confuses tooling. Match common REST batch-API conventions (Stripe, etc.).
- **Q2: Store preprocessed bytes or original?** Lean: **original**. Rationale: audit trail. Preprocessing is a transient transformation for Gemini; if we later switch model or want to re-verify, original bytes are the source of truth.
- **Q3: If `runVerification` throws during the first submission, do we still create the Batch row?** Lean: **yes**. Rationale: the Batch + BatchSubmission rows are created upfront (step 2–3), before any processing. A single submission's failure transitions only that row. Batch always reaches `completed` or `partially_failed`.
- **Q4: Reuse `OverallStatusBadge` styling for BatchSubmission status?** Lean: **new `BatchSubmissionStatusBadge`**. Rationale: the status enums are different (`queued`/`processing`/`extracted`/`verified`/`failed`/`canceled` vs `pass`/`needs_review`/`fail`). Reusing would force confusing color semantics.
- **Q5: When a file is invalid (sharp can't read it), fail at upload or at extraction?** Lean: **at extraction**. Rationale: the orchestrator's existing pre-processing wrapping (Phase 0) catches sharp failures and passes the original through. Gemini will produce an error, the submission is marked failed with `INVALID_IMAGE`, batch continues. Validating upfront would duplicate logic and slow the happy path.

## Risks

- **Synchronous processing pinned to one HTTP request.** 5 files × ~5s each = ~25s round-trip. Railway / Next default timeout is comfortably above; Vercel is 60s and we're under that. The existing `/api/verify` already declares `maxDuration = 60`. The new endpoint will too. → Phase 5 removes this entirely.
- **`request.formData()` reads the full body into memory.** 50 MB is fine; Phase 5's chunked uploads keep per-request memory bounded as batch sizes grow.
- **Two `BatchSubmission.status` transitions per success path** (`processing → extracted → verified`). If we crash between them the row is left in `extracted` and a Phase 5 worker would need to handle that. → Acceptable for Phase 3 (synchronous; crash means the whole request fails and the row stays where it is); document for Phase 5.
- **Dedup is per-request, not cross-batch.** Two batches uploading the same file produce two `BatchSubmission` rows pointing at the same `fileStorageKey` (because `LocalDiskFileStorage` is content-addressed). That's intentional — separate batches are separate audit trails — but worth noting.
- **Storage write happens *before* validation of all files succeeds.** Currently the flow is: validate → store. Good. → Verify in implementation that no storage writes happen before all 5 files pass validation.

## Manual prerequisites

| What | When | Blocking? |
|---|---|---|
| **Approve this spec** | Before any code is written | Yes (spec-first rule) — already approved on chat |
| **Mount Railway Volume + set `BATCH_FILE_STORAGE_PATH=/data/batch-files`** | Before Phase 3 *deploys* to production | **No for this PR.** Local dev / CI use `./.local/batch-files`. |

## Notes

- This is the **first phase** where any non-test code imports `Batch` / `BatchSubmission` types or the `FileStorage` interface. Phase 2's acceptance criterion "No code in app/, components/, or existing services imports the new batch types" was scoped to Phase 2's PR — Phase 3 is the intended consumer.
- Phase 5 will replace the inline processing loop with an enqueue + worker drain. The data model and FileStorage layer don't change; only the route handler changes from "loop synchronously" to "create rows queued, return batchId immediately".
- After this spec is Done, mark Phase 3 acceptance complete in `docs/roadmap.md`.

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written.

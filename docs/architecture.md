# Architecture

> Canonical system-architecture reference for the TTB COLA Label Verifier. Read this first if you're new to the codebase — every other doc (`roadmap.md`, the per-phase specs, `assumptions-and-limitations.md`) is either a deeper dive into one slice of what's described here or a record of how we got here.

**Last updated:** 2026-05-18 (Phase 6 / first-row fast path landed).

---

## 1. TL;DR

A reviewer drops a label image (or a batch of them + a manifest) on the web UI. The Next.js server preprocesses the image, sends it to Google Gemini for structured OCR, runs deterministic field-by-field comparators against the applicant-declared values, persists the report to Postgres, and renders it. Batches up to 200 are accepted; the first row is verified inline before the HTTP response so the reviewer sees a real result inside the 5-second SLO while rows 2…N drain in a background worker.

Three things to remember:

1. **Two execution paths** — single-label synchronous (POST → response with report), batch synchronous-first-row + asynchronous-rest (POST → response with row-1 report → poll `/batches/:id`).
2. **The AI is bounded.** Gemini extracts what's on the label. Comparisons happen in plain TypeScript. The AI never decides "pass / fail."
3. **The worker lives inside the Next.js process.** Railway runs Node as a long-lived process; we exploit that with an in-process queue. No separate worker service. Restart-survives via a startup-recovery sweep.

---

## 2. System diagram

```
                            ┌──────────────────────────────────────────────────┐
                            │              Next.js App (Railway)               │
                            │                                                  │
                            │   Browser ─► UI ──┐                              │
                            │                   │                              │
                            │                   ├─► POST /api/verify           │
                            │                   │      └─► runVerification()   │
                            │                   │            │                 │
                            │                   ├─► POST /api/batches          │
                            │                   │      ├─► storeFiles()        │
                            │                   │      ├─► parseManifest()     │
                            │                   │      ├─► runFirstSubmission  │
                            │                   │      │     Inline() ◄──┐     │
                            │                   │      └─► startBatchIn  │     │
                            │                   │            Background()│     │
                            │                   │              │         │     │
                            │                   └─► GET /api/batches/:id │     │
                            │                                            │     │
                            │   ┌─────────────────────────┐              │     │
                            │   │  In-process worker      │ ◄─── poll ───┤     │
                            │   │  (concurrency 1..10)    │  every 200ms │     │
                            │   │   processBatch()        │ ─────────────┘     │
                            │   │     └─► processOne() ◄──────────┐            │
                            │   └─────────────────────────┘       │            │
                            │                                     │            │
                            │   verification-orchestrator.ts ◄────┘            │
                            │     │                                            │
                            │     ├─► image-preprocess (sharp → JPEG 1024)     │
                            │     ├─► label-extraction.service                 │
                            │     │      ├─► MockLabelExtractionService        │
                            │     │      └─► GeminiLabelExtractionService ─────┼──► Gemini API
                            │     │           └─► retry [1s,2s,4s,8s] ±20%     │
                            │     ├─► commodity-router                         │
                            │     ├─► verification.service                     │
                            │     │      └─► compare-* helpers (pure)          │
                            │     └─► verification-record.service ──┐          │
                            │                                       │          │
                            │   instrumentation.ts ─► batch-recovery│ Prisma   │
                            │      (boot) requeueStaleProcessing()  ▼          │
                            │                                                  │
                            │   Braintrust wrapper ◄─ trace every extract +    │
                            │     (lazy-init via BRAINTRUST_API_KEY) verify    │
                            │                                                  │
                            │   LocalDiskFileStorage ──► Railway Volume        │
                            │     (sha256-addressed)                           │
                            └──────────────────────────────────────────────────┘
                                            │
                                            ▼
                                     Postgres (Railway)
                                     ├─ VerificationRecord
                                     ├─ Batch
                                     └─ BatchSubmission
```

---

## 3. Domain model

Three first-class concepts. Everything else (extracted labels, reports, comparator results) is JSON inside these.

### `VerificationRecord`

One row per completed verification — whether it came from `/api/verify` (single label) or from a batch row. Stores the entire application JSON, extracted-label JSON, and report JSON as columns; the structured `productType` / `brandName` / `applicantName` etc. columns are projections of those blobs surfaced for indexing + UI sorting. Optional FK back to a `BatchSubmission` when the record originated from a batch.

### `Batch`

The container for a multi-label upload. Tracks rollup counts (`totalCount`, `completedCount`, `failedCount`, `canceledCount`), batch-level metadata (`clientName`, `applicantName`), and points at its first submission via `firstSubmissionId` so the UI knows which row to render in the inline banner.

### `BatchSubmission`

One row per file in a batch. Owns the file's storage key, content hash, per-row application JSON, status, error code/message, attempt count. Cascade-deleted with its parent `Batch`. Has a 1:1 link to `VerificationRecord` once verified.

---

## 4. Database schema

ER diagram, simplified to the relations you'll actually navigate:

```
┌─────────────────────────────────┐
│        VerificationRecord       │
├─────────────────────────────────┤
│ id              PK              │
│ createdAt                       │
│ updatedAt                       │
│ status                          │  ← reviewer-state ("new", "in_review", "approved", …)
│ productType                     │
│ clientName, applicantName       │
│ brandName, productName          │
│ applicationJson (jsonb)         │  ← input
│ extractedJson   (jsonb)         │  ← Gemini output
│ reportJson      (jsonb)         │  ← comparator output
│ imageJson       (jsonb)         │
│ reviewerStatus                  │
│ reviewerNotes                   │
│ assignedReviewer                │
│ batchSubmissionId  FK ───┐      │
└──────────────────────────┼──────┘
                           │ 1:1 (nullable)
                           ▼
┌────────────────────────────────┐         ┌──────────────────────────────┐
│      BatchSubmission           │  N:1    │           Batch              │
├────────────────────────────────┤  ────►  ├──────────────────────────────┤
│ id              PK             │ (cascade)│ id              PK          │
│ batchId         FK ────────────┼─────────┤ createdAt, updatedAt         │
│ createdAt, updatedAt           │         │ completedAt                  │
│ startedAt, completedAt         │         │ status                       │  ← lifecycle
│ status                         │         │ totalCount                   │
│ errorCode, errorMessage        │         │ completedCount               │
│ attemptCount                   │         │ failedCount                  │
│ fileHash                       │ ◄───────┤ canceledCount                │
│ fileName, fileSize             │  1:1    │ clientName, applicantName    │
│ fileMimeType                   │ (opt.)  │ manifestJson  (jsonb)        │
│ fileStorageKey                 │         │ metadata      (jsonb)        │
│ applicationJson (jsonb)        │         │ firstSubmissionId  FK ──────►│ (Phase 6 fast path)
└────────────────────────────────┘         └──────────────────────────────┘
```

Schema source of truth: `prisma/schema.prisma`. Each Phase added migrations under `prisma/migrations/`; the most recent is `20260518000000_batch_first_submission`.

---

## 5. State machines

### `BatchSubmission.status`

```
                          ┌──────────────┐
                          │   canceled   │  ← terminal
                          └──────────────┘
                                 ▲
                                 │
                ┌────────────────┴──────────────────┐
                │                                   │
       ┌────────┴────────┐                          │
       │     queued      │ ─────────────────────────┘
       └────────┬────────┘
                │ worker picks row
                ▼
       ┌────────────────┐ ──── failure ──── ► ┌──────────┐ ─── retry ──┐
       │   processing   │                      │  failed  │             │
       └────────┬───────┘                      └──────────┘             │
                │ Gemini returns                    │                   │
                │ valid ExtractedLabel               │ (manual / Phase  │
                ▼                                   │  7 idempotency)   │
       ┌────────────────┐ ──── compare fails ──► ──┘                   │
       │   extracted    │                                              │
       └────────┬───────┘                                              │
                │ comparators pass                                     │
                ▼                                                      │
       ┌────────────────┐  ← terminal (verified ✓)                     │
       │   verified     │                                              │
       └────────────────┘                                              │
                                                                       │
       processing ─── stale > 10 min ── requeueStaleProcessing() ──────┘
```

| Transition | Where it happens |
|---|---|
| `queued → processing` | `batch-worker.ts:54`, `run-first-submission-inline.ts:61` |
| `processing → extracted → verified` | `batch-worker.ts:75-76`, `run-first-submission-inline.ts:82-83` |
| `* → failed` | `batch-worker.ts:89`, `run-first-submission-inline.ts:122` |
| `processing → queued` (stale recovery) | `batch-recovery.ts:48-50` |
| `failed → queued` (manual retry) | Phase 7 idempotency work; not yet automated |
| `queued → canceled` | `batch-service.cancel` (Phase 6.5; deferred) |

Validation of legal transitions: `lib/schemas/batch.schema.ts:21-44`.

### `Batch.status`

```
queued ─► processing ─┬─► completed         (failedCount == 0)
                      ├─► partially_failed  (failedCount > 0, all rows reached terminal)
                      └─► canceled          (operator action; not yet wired)
```

Batches are created in `processing` (we don't queue-then-start — the POST handler kicks the worker in the same request via `startBatchInBackground`). Finalization runs in `batch-service.ts:217-228` once `completedCount + failedCount + canceledCount == totalCount`.

---

## 6. Request lifecycle — single label

```
Browser                Next.js API           Orchestrator         Gemini      Postgres
   │                      │                      │                 │              │
   │── POST /api/verify ─►│                      │                 │              │
   │   {application,      │                      │                 │              │
   │    images}           │                      │                 │              │
   │                      │── runVerification ──►│                 │              │
   │                      │                      │── validate Zod ─┤              │
   │                      │                      │── preprocess img│              │
   │                      │                      │── extract ─────►│              │
   │                      │                      │                 │ Gemini call  │
   │                      │                      │                 │ (≈3-4s,      │
   │                      │                      │◄── ExtractedLabel│  retry      │
   │                      │                      │     (Zod-validated) on 503/429)│
   │                      │                      │── route by commodity           │
   │                      │                      │── compare-* helpers            │
   │                      │                      │   (pure, deterministic)        │
   │                      │                      │── persist ────────────────────►│
   │                      │                      │                 │              │
   │                      │◄── {recordId, report}│                 │              │
   │◄── 200 + report ─────│                      │                 │              │
   │                                                                              │
   │── GET /verification/:id ─► server-render VerificationResults ─► reads from Postgres
```

End-to-end target: **≤ 5 s** ("about 5 seconds" — Sarah Chen interview). Current dominant cost is the Gemini call (~3–4 s on `gemini-2.5-flash-lite` per `docs/traces/`). The deterministic comparator pass is sub-millisecond.

---

## 7. Request lifecycle — batch (first-row fast path)

This is the most-surprising path in the codebase. Read carefully if you're modifying anything in `/api/batches`.

```
Browser           POST /api/batches      runFirstSubmission        Worker          Postgres
   │                   │                       Inline()              (in-proc)         │
   │── multipart ─────►│                                                                │
   │  (files+manifest) │                                                                │
   │                   │── parse manifest ──────────────────────────────────────────────│
   │                   │── createBatch + N BatchSubmissions (status="queued")──────────►│
   │                   │── runFirstSubmission ─► (synchronous, same path as /verify)    │
   │                   │     Inline(row 0)          │                                   │
   │                   │                            │── extract, compare, persist ─────►│
   │                   │                            │── stamp Batch.firstSubmissionId   │
   │                   │◄─── {ok, report,           │                                   │
   │                   │     verificationRecordId}  │                                   │
   │                   │                                                                │
   │                   │── startBatchInBackground(batchId) ─►┐                          │
   │◄── 200 + {batchId,│                                     │                          │
   │     firstSubmission,                                    │                          │
   │     totalCount}   │                                     │                          │
   │                   │                                     ▼                          │
   │                                                  ┌──────────────┐                  │
   │                                                  │ processBatch │                  │
   │                                                  │ concurrency  │                  │
   │                                                  │ workers      │                  │
   │                                                  │ pick "queued"│ (row 1 is now    │
   │                                                  │   rows only  │  "verified", not │
   │                                                  └──────┬───────┘  picked up)      │
   │                                                         │                          │
   │── poll GET /api/batches/:id (every 2s, UI) ─────────────┼─────────────────────────►│
   │   ◄── { batch, submissions[], percentComplete }         │                          │
   │                                                         │                          │
   │── (each row drains)                                  ───┘                          │
   │   ◄── status flips per row, table updates live                                     │
   │                                                                                    │
   │  (worker exits when no queued rows remain; batch finalizes to                      │
   │   completed | partially_failed)                                                    │
```

Key invariants:

- **Row 1 is verified inline before the HTTP response returns.** That's how time-to-first-result fits in the SLO at batch scale.
- **The worker only picks `status="queued"` rows.** Row 1 is `verified` (or `failed`) by the time the worker starts polling, so it's never re-processed. No flag needed.
- **`Batch.firstSubmissionId` is stamped synchronously** in `runFirstSubmissionInline`. The detail page reads it to render the inline banner above the table.
- **POST 200 vs 202.** Phase 5 returned 202 (accepted, nothing visible). Phase 6 returns 200 with the row-1 report inline. Backwards-compat: the rest of the response shape is unchanged.

---

## 8. In-process worker model

The single most-surprising architectural choice. Document Phase 5 spec (`docs/specs/phase-5-async-queue.md`) covers the decision rationale.

### Why in-process

Railway runs the Next.js app as a long-lived Node process. Promises started during a request continue to execute after the response is sent. We exploit that: the POST handler calls `startBatchInBackground(batchId)`, which returns immediately but kicks off `processBatch(batchId)` as a fire-and-forget Promise. The worker runs in the same Node process, picks queued rows, processes them concurrently.

Trade-off accepted: **a process restart strands in-flight rows.** Mitigation = startup recovery (next subsection). The "right" long-term answer is a separate Railway worker service consuming from a queue (Phase 7); the in-process model is fine through hundreds-of-batches-per-day scale.

### Concurrency

Env var `BATCH_WORKER_CONCURRENCY`, default **3**, clamped to **[1, 10]**. Resolved in `batch-worker.ts:27-36`. Each worker pulls the next `queued` row off a shared cursor; when the cursor exhausts, all workers exit and the batch finalizes.

### Backpressure

POST `/api/batches` counts active (`queued` + `processing`) rows across the system. If depth ≥ `BATCH_QUEUE_DEPTH_LIMIT` (default **500**, env-tunable), the endpoint rejects with **429**. Prevents queue runaway when an importer dumps 5× 200 batches in succession.

### Startup recovery

`instrumentation.ts` runs `requeueStaleProcessing()` on Next.js boot. It flips any `BatchSubmission` whose `status="processing"` and `updatedAt < now - 10min` back to `queued`. A subsequent worker pass picks them up again. Threshold: `STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000` (`batch-recovery.ts:16`).

10 minutes is the cap on "row processing wedged in Gemini call" — longer than the longest plausible Gemini retry sequence (1+2+4+8 = 15s), shorter than any operator will tolerate a stuck-row indicator.

### What this model does NOT give you

- Cross-region failover (single Railway service).
- Cross-process concurrency limits (each replica has its own concurrency counter).
- Exactly-once delivery (a process killed mid-Gemini-call may re-extract on recovery; we accept the duplicate Gemini cost in exchange for simplicity — Phase 7 idempotency work addresses this).

---

## 9. Extraction provider seam

`lib/services/label-extraction.service.ts` defines a single interface:

```ts
interface LabelExtractionService {
  extract(input: LabelExtractionInput): Promise<ExtractedLabel>;
}
```

Two implementations ship today — `GeminiLabelExtractionService` and `MockLabelExtractionService` — selected at request time by `resolveExtractionMode(env)`. The orchestrator and every downstream verification rule are **provider-agnostic**: they consume `ExtractedLabel`, not a model response.

This matters for production deployment inside TTB's network. Marcus Williams flagged that "our network blocks outbound traffic to a lot of domains"; the public Gemini API will not survive a TTB security review. When TTB selects a network-reachable provider (most likely Azure OpenAI inside their FedRAMP Azure tenant), the swap is a single new file implementing the interface plus a one-line addition to `resolveExtractionMode`. Nothing else changes — no comparator edits, no schema migration, no UI changes, no eval rewrites.

Full option matrix: `docs/research/2026-05-18-firewall-fallback.md`.

### Gemini retry policy

`lib/services/gemini-label-extraction.service.ts`. Exponential backoff with delays `[1s, 2s, 4s, 8s]`, ±20% jitter, minimum 100ms floor. `isRetryableError` matches: status 503 / 429, message containing "503" / "429", `RESOURCE_EXHAUSTED`, `/rate.?limit/i`. Up to 4 attempts; on the 5th failure the row goes to `failed` with `errorCode="RETRY_EXHAUSTED"`.

### Image preprocessing

`lib/services/image-preprocess.ts`. Every label image gets resized (sharp, longest-edge to **1024 px** default, clamped to `[256, 4096]` via `IMAGE_MAX_EDGE_PX`) and re-encoded as JPEG quality 85 before being sent to Gemini. Rationale: vision-token cost dominates Gemini latency; 1024 is the bottom of Google's recommended range and saves ~30% on the call without measurable accuracy loss on the fixture set. Operators can raise it for small-print labels.

---

## 10. File storage

Interface: `lib/services/file-storage.ts` — `FileStorage` with `put / getBuffer / delete / exists` and `StoredFileMetadata { storageKey, size, mimeType, hash }`.

Single implementation today: `LocalDiskFileStorage` (`file-storage-disk.ts`). Stores files at `<root>/<yyyy>/<mm>/<dd>/<hash[0..1]>/<hash>`. Root resolves from `BATCH_FILE_STORAGE_PATH` env var, default `./.local/batch-files`. In production this points at a Railway Volume mount.

**Content-addressed**: `storageKey === sha256(file)`. Two uploads of identical bytes share one stored file. Per `BatchSubmission.fileHash` dedup means we can re-run a batch row without re-uploading.

Future: S3 / Tigris swap-in (interface is ready; no adapter shipped).

---

## 11. Comparator inventory

All under `lib/verification/`. Pure deterministic helpers — no I/O, no async, no AI. Inputs are normalized via `normalize.ts` (whitespace collapse, smart-quote replacement, trademark-symbol stripping, Levenshtein similarity).

| File | Compares | Severity surface |
|---|---|---|
| `compare-brand.ts` | Brand name, 0.85 similarity threshold | `error` on hard mismatch, `needs_review` on near-match |
| `compare-abv.ts` | ABV (% or proof), ±0.1 pp tolerance, 2× proof handling | `error` on mismatch, `warning` on missing |
| `compare-volume.ts` | Net contents (mL / L / fl oz / cL → mL), ±0.5 mL tolerance | `error` on mismatch |
| `compare-country-origin.ts` | Country, gated by `sourceOfProduct` | `error` for imports if missing; `n/a` for domestic |
| `compare-warning.ts` | Government warning text fragments + `GOVERNMENT WARNING:` prefix uppercase | `error` on missing fragment; `human_review_required` for bold/font enforcement (not automated) |
| `compare-wine-fields.ts` | Wine: producer, appellation, varietals, vintage | per-field |
| `compare-distilled-spirits-fields.ts` | Spirits: distillery, age statement, proof | per-field |
| `compare-malt-fields.ts` | Malt beverage: ABV, class/type, government warning | per-field |
| `image-quality.ts` | Maps Gemini-reported `imageQuality` (good/fair/poor) into a verdict | `warning` if `poor` |
| `normalize.ts` | Shared normalization + similarity utilities | n/a |

---

## 12. Trust boundaries + threat model

| Boundary | Trust | Mitigations |
|---|---|---|
| Browser → Server | **untrusted** | All inputs Zod-validated at the route handler; multipart payload size capped (200 MB body, 200 files); per-file size cap; mime-type allow-list |
| Server → Gemini | trusted outbound, **untrusted inbound** | Gemini response Zod-validated against `ExtractedLabel`; structured-output mode + JSON-schema constraint; fence-stripping fallback for occasional Markdown wrapping |
| Server → Postgres | trusted | Prisma-typed writes; no raw SQL |
| Server → Local disk (file storage) | trusted | Path is `<root>/<sha256-derived>`; no user-controlled path components reach the FS |
| Server → Braintrust | best-effort | Lazy-init; failure of telemetry never blocks a request |

**Threats explicitly out of scope** for this prototype: authentication (open access; protected only by the deploy URL not being publicly advertised), CSRF (no auth so no session to hijack), rate-limiting beyond the queue-depth 429, abuse of the Gemini API key (rotated manually). All called out in `docs/assumptions-and-limitations.md` → Storage & Reliability sections.

---

## 13. Observability

`lib/observability/braintrust.ts` is the single integration point.

### What's traced

Every Gemini extraction call (`tracedExtract`) and every end-to-end verification (`tracedVerify`). Spans carry:

- **Extraction span:** input (`productType`, `imageCount`, `promptHash`), output (extracted `rawText` summary, inferred type, populated field keys, `finishReason`), metrics (`geminiCallMs`, prompt + completion token counts, cost estimate), scores.
- **Verification span:** end-to-end timing, comparator outcomes, persisted `recordId`.

### Scoring

Binary or scalar scores per trace, viewable in the Braintrust Monitor:

- `extraction.latencyUnder5s` — 1 if `geminiCallMs ≤ 5000`, else 0. **This is how we track the 5-second SLO without a separate metrics stack.**
- `extraction.fieldCoverage` — ratio of populated OCR targets.
- `extraction.brandNamePresent`, `extraction.classOrTypePresent`, `extraction.governmentWarningPresent`, `extraction.netContentsPresent`, `extraction.alcoholContentPresent` — per-target presence.
- `extraction.imageReadability` — good → 1, fair → 0.5, poor → 0.
- `verification.passes` — 1 if `overallStatus == "pass"`, 0.5 if `"needs_review"`, 0 else.
- `verification.errorRatio`, `verification.warningRatio`.

### Lazy initialization

`initBraintrust()` reads `BRAINTRUST_API_KEY`. If absent, the wrapper is a true no-op — no network calls, no errors. The app must function without a key (hard CI requirement). `BRAINTRUST_PROJECT` defaults to `"ttb-cola-verifier"`.

Forensic traces from production are written up in `docs/traces/` when investigating regressions. Example: `docs/traces/2026-05-17-trace-4e392da9.md`.

---

## 14. Performance characteristics

### Target

≤ 5 s per-label end-to-end. Sourced from the Sarah Chen interview: "If we can't get results back in about 5 seconds, nobody's going to use it."

### Where the time goes (typical wine label, `gemini-2.5-flash-lite`)

| Stage | Wall time |
|---|---|
| Multipart parse + Zod validate | <50 ms |
| Image preprocess (sharp resize + JPEG re-encode) | 100–300 ms |
| Gemini call (1024-px image, 21-target prompt, structured output) | 3–4 s |
| Deterministic comparators (all rules for the commodity) | <5 ms |
| Postgres write (single `VerificationRecord` row) | 20–50 ms |
| **Total** | **~3.5–4.5 s** |

### Levers we've used

- **Model swap** — `gemini-2.5-flash` (full) → `gemini-2.5-flash-lite` (~2× decode speed); env-tunable via `GEMINI_MODEL`.
- **Image downsize** — 1280 px → 1024 px max edge (env `IMAGE_MAX_EDGE_PX`); ~30% Gemini token saving.
- **Drop `rawText` from prompt** — saved ~400 redundant output tokens nothing downstream read.
- **Thinking disabled** — `thinkingBudget: 0`; this codebase doesn't need chain-of-thought.

### Levers documented but not pulled

- Aggressive downscale to 800 px (small-print risk).
- Trim the JSON example from the prompt.
- Looser "every target must appear" rule.

### What dominates at batch scale

A 200-row batch on `concurrency=3` ≈ 200 × 4 s / 3 ≈ **4.5 minutes total wall time**, with row 1 visible to the reviewer inside the per-label SLO via the fast path. Worker concurrency is the primary lever; raising `BATCH_WORKER_CONCURRENCY` reduces wall time but risks Gemini rate-limits (the retry policy handles bursts but won't save us from sustained excess).

---

## 15. API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/verify` | Single-label synchronous verification |
| GET | `/api/verifications` | List verification records |
| GET | `/api/verifications/[id]` | Fetch single verification record |
| PATCH | `/api/verifications/[id]` | Update reviewer notes / status / assignee |
| POST | `/api/batches` | Create batch — verify row 1 inline, queue rows 2…N |
| GET | `/api/batches/[id]` | Batch progress + per-submission table data |

Request and response shapes are Zod-defined under `lib/schemas/`. Every route handler validates inbound shape before doing anything else.

---

## 16. Deployment

- Railway service builds with `npm run build` (runs `prisma generate` then `next build`).
- Railway Postgres plugin provides `DATABASE_URL`.
- Required env vars: `GEMINI_API_KEY`, `DATABASE_URL`. Optional: `USE_MOCK_EXTRACTION`, `GEMINI_MODEL`, `IMAGE_MAX_EDGE_PX`, `BATCH_WORKER_CONCURRENCY`, `BATCH_QUEUE_DEPTH_LIMIT`, `MAX_BATCH_FILES_OVERRIDE`, `BATCH_FILE_STORAGE_PATH`, `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT`.
- Migrations: `npm run prisma:migrate` (release step) or manually before first deploy.
- File storage: bind a Railway Volume at `BATCH_FILE_STORAGE_PATH` (default `./.local/batch-files`) so uploaded label images survive deploys.
- Live URL: https://ttb-cola-waiver-label-verification-production.up.railway.app/

Future production deployment inside TTB's network: see `docs/research/2026-05-18-firewall-fallback.md` (recommendation: Azure OpenAI in a FedRAMP region via Private Link, swappable via the extraction provider seam in §9).

---

## 17. Where to read next

In order, if you're new:

1. **`README.md`** — pitch + quick-start.
2. **This file** (`docs/architecture.md`) — system-level model.
3. **`docs/requirements-map.md`** — what fields the verifier actually checks, per commodity.
4. **`docs/assumptions-and-limitations.md`** — what we explicitly didn't do and why.
5. **`docs/roadmap.md`** — phase-by-phase history; useful for understanding why a thing is the way it is.
6. **`docs/specs/phase-*-…md`** — read the relevant spec when you're about to touch a phase's surface area.
7. **`docs/traces/`** — recorded production investigations; read the most recent one before declaring "this is impossible."
8. **`docs/research/`** — long-form planning notes that aren't specs.

If you're about to:

- **Add a new comparator** → §11, then `lib/verification/` patterns.
- **Add a new commodity** → `lib/rules/`, then the per-commodity comparator file, then the schema in `lib/schemas/`.
- **Touch the batch endpoint** → §7 (lifecycle), §8 (worker), §5 (state machines).
- **Swap the extraction provider** → §9, then `docs/research/2026-05-18-firewall-fallback.md`.
- **Investigate a latency regression** → §13 (observability), then `docs/traces/` for past examples.
- **Modify the data model** → §3, §4, then `prisma/schema.prisma` + a new migration.

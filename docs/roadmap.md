# TTB COLA Label Verifier — Master Roadmap

**Version:** 1.0
**Last updated:** 2026-05-16
**Status:** Draft (awaiting your approval before Phase 0 spec is written)
**Owner:** Stefano (with engineering execution by Claude)

---

## How to read this document

This is the strategic plan. It defines, in this hierarchy:

```
phase → features → user stories → (engineering tasks live in the per-phase spec)
```

The roadmap covers **phases**, **features delivered**, **user stories**, **acceptance criteria**, **risks**, **manual prerequisites**, and **open architectural decisions**.

The roadmap does *not* contain **engineering tasks**, **file paths**, **function signatures**, or **deliverable lists** — those live in per-phase specs at `docs/specs/phase-N-<slug>.md`. The roadmap is the schedule; the spec is the contract.

**Rules:**
1. A phase's spec must be **Approved** before that phase's code is written.
2. A phase must meet its **Acceptance criteria** before the next phase starts.
3. Specs are written **one phase at a time**, when that phase is ready to start — not all upfront.

---

## Table of contents

1. [Executive summary](#executive-summary)
2. [Current state of the codebase](#current-state-of-the-codebase)
3. [Target end state](#target-end-state)
4. [Reference inputs](#reference-inputs)
5. [Cross-cutting principles](#cross-cutting-principles)
6. [Phase 0 — Foundation](#phase-0--foundation)
7. [Phase 1 — Eval infrastructure](#phase-1--eval-infrastructure)
8. [Phase 2 — Data model and storage abstraction](#phase-2--data-model-and-storage-abstraction)
9. [Phase 3 — Synchronous batch path](#phase-3--synchronous-batch-path)
10. [Phase 4 — Manifest support](#phase-4--manifest-support)
11. [Phase 5 — Async queue and worker](#phase-5--async-queue-and-worker)
12. [Phase 6 — Batch UI](#phase-6--batch-ui)
13. [Phase 7 — Hardening and scale test](#phase-7--hardening-and-scale-test)
14. [Phase 8 — Operational polish (optional)](#phase-8--operational-polish-optional)
15. [Architectural decisions log](#architectural-decisions-log)
16. [Manual prerequisites summary](#manual-prerequisites-summary)
17. [Glossary](#glossary)

---

## Executive summary

You have a **single-label verification prototype** working end-to-end: Next.js 16 + React 19 on Railway with Postgres + Prisma, Gemini extraction (with a mock toggle), a multi-commodity comparator suite (wine / sake / spirits / malt), a Submissions tab styled as a CRM pipeline, and a small Playwright E2E suite. 51 unit tests pass, 4 Playwright tests pass.

The business requirement is to scale from one label at a time to **50–300 labels in a batch**, with manifest support and per-file error isolation. None of that is built.

A peer prototype ([fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label) — `cola-verify`) is process-rigorous and contains seven patterns we should adopt before building batch. None of those patterns are batch-related; they make every single-label call faster, more observable, and more testable, which is exactly what batch processing needs underneath.

**This roadmap delivers, in order:**
1. Engineering discipline + per-call optimizations (no new product features).
2. A fixture-based eval harness — which alone satisfies "tested with 50–100 labels" for the single-label path.
3. Batch data model and storage.
4. Synchronous batch (≤5 files) end-to-end.
5. Manifest (CSV / JSON) support.
6. Async queue and worker for 50–300 file scale.
7. Production-grade batch UI.
8. Hardening, observability, cost tracking, and load testing at 50 / 100 / 300.

**Total estimated effort:** 14–19 engineering days. Phases 0–1 are the prerequisites; phases 2–7 are the batch feature.

---

## Current state of the codebase

Evidence-based. Files referenced exist on `claude/setup-tbb-remote-access-OljNd` at commit `f5b2275`.

### Tech stack (locked)

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16.2.6 (App Router) | Locked |
| Runtime | Node 22 | Locked |
| Language | TypeScript 5, strict mode | Locked |
| Styling | Tailwind v4 | Locked |
| DB | Postgres via Prisma 5.22 | Locked |
| AI | Gemini 2.5 Flash via `@google/genai` | May benchmark and switch — Phase 0 |
| Deploy | Railway | Locked |
| Tests | Vitest + Playwright | Locked |
| CI | GitHub Actions | Locked |

### What is built

- `POST /api/verify` — single-label verification: schema-validates application → calls extraction → runs comparators → persists `VerificationRecord`.
- `GET /api/verifications` and `GET /api/verifications/[id]` and `PATCH /api/verifications/[id]` (notes, reviewer status, assignee).
- 4 commodities routed through `lib/services/commodity-router.ts`: wine, sake, distilled spirits, malt beverage.
- Comparator suite in `lib/verification/`: brand, ABV, volume, country-origin, warning, plus commodity-specific aggregators.
- Mock extraction service (`USE_MOCK_EXTRACTION=true`) with sample scenarios in `data/samples/`.
- Submissions tab at `/` — list view with status pipeline (`pending → in_review → approved → rejected`), inline-editable reviewer status and assignee, four filters, search.
- `New verification` form at `/new` — single label, multi-angle image upload (treated as one submission).
- Verification detail page at `/verification/[id]`.
- Prisma migrations: `20260514000000_init` and `20260516000000_add_submission_review_fields`.
- 51 unit tests (`tests/`) covering comparators and the orchestrator.
- 4 Playwright E2E tests (`tests-e2e/submissions.spec.ts`).
- CI workflow with `verify` job (typecheck + tests + build) and `e2e` job with Postgres service.

### What is explicitly NOT built

| Capability | Status |
|---|---|
| Batch upload (multiple labels at once) | Not started |
| Per-file error isolation in a batch | N/A — no batch flow |
| Batch results aggregate view | N/A |
| CSV / JSON manifest import | Not started |
| File storage abstraction | Not started — base64-over-HTTP today |
| Async / background processing | Not started — all sync |
| Worker process | Not started |
| Load tested at 50–300 labels | Not done |
| Image preprocessing | Not done — full-size base64 sent to Gemini |
| Per-phase timing instrumentation | Not done |
| Retry policy on Gemini 503 | Not done |
| Bug tracker | Not maintained |
| Spec-first workflow | Not formalized |
| Cost tracking / token logging | Not done |

### Constraints to know

- Vercel-style edge function timeouts do **not** apply here (Railway runs persistent processes), but the existing API route declares `maxDuration = 60` in `app/api/verify/route.ts` for future portability.
- Postgres is on Railway; connection pool size is the default. Will tune in Phase 7.
- No file storage today. Phase 2 introduces Railway Volume (decided).
- Real `GEMINI_API_KEY` is configured in Railway env (decided).

---

## Target end state

A reviewer at TTB-COLA can:

1. **Upload many labels at once** — drag 50–300 image files into the browser, optionally with a CSV or JSON manifest mapping filenames to expected application data.
2. **See the batch process live** — a progress page polls every few seconds and shows queued / processing / pass / needs-review / fail / failed-to-process counts plus a per-file table.
3. **Drill into any submission** — clicking a row opens the existing single-label verification detail view, which shows per-field pass / fail / note alongside the original image.
4. **Survive failures gracefully** — one bad image or one Gemini 503 marks one row failed; the batch keeps going. Failed rows can be retried.
5. **Track cost** — per-batch Gemini token usage and estimated dollar cost is logged.

An engineer can:

1. **Run `npm run eval:quick`** in CI to smoke-test the pipeline on 5–6 fixtures in ~30 seconds.
2. **Run `npm run eval:full`** before deploys to sweep 30+ fixtures.
3. **Run `npm run loadtest --size=100`** to drive 100 fixtures through the batch system and get p50/p95/p99 timings.
4. **Open the deployed site, run a verification, open devtools, and read a `console.table`** of per-phase server timings — without any extra instrumentation.
5. **Read `docs/bugs.md`** and see severity-tagged, root-caused, evals-confirmed bug history.

---

## Reference inputs

### Functional requirements (from your 7-item checklist)

1. Upload multiple images/PDFs at once.
2. Process each label separately.
3. Batch results table (pass / fail / needs review).
4. Drill into failed label and see which fields failed.
5. CSV / JSON manifest with expected values.
6. Per-file error isolation.
7. Tested with 50–100 labels.

### Patterns adopted from cola-verify (with attribution)

Source: [github.com/fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label), MIT-equivalent (no license file but public, prototype). Each adopted file will include a one-line attribution comment at the top.

| Pattern | Source file | Adopted in | Why |
|---|---|---|---|
| Spec template (`Status / Goal / Scope / Approach / Acceptance / Evals / Open questions / Notes`) | `docs/specs/_template.md` | Phase 0 | Forces design before code. |
| Bug tracker with severity legend and live-eval confirmation | `docs/bugs.md` | Phase 0 | Root-cause discipline. |
| Image preprocessing (resize to 1280px max edge, JPEG 85%) | `lib/image-preprocess.ts` | Phase 0 | Cuts Gemini payload ~85%, ~3× latency win. |
| Per-phase server timings (`AnalysisTimings` type + `console.table` client log) | `app/api/analyze/route.ts`, `types/cola.ts` | Phase 0 | Free observability. |
| `callWithRetryOn503` wrapper with explicit delays and tests | `lib/gemini.ts` | Phase 0 | Transient-failure hardness. |
| Fixture-based eval runner (categorized expectations, `--url` and `--only` flags) | `scripts/run-fixture-evals.ts` | Phase 1 | The load-test harness. |
| Model A/B benchmark (multiple Gemini models × fixtures, p50 / accuracy / 503 rate) | `scripts/model-benchmark.ts` | Phase 0 | Data-driven model choice. |
| CSV header-map import for flexible columns | `lib/parsers/csv-import.ts` | Phase 4 | Manifest support. |
| Cross-validation vs. compliance-advisories stream independence | `docs/specs/compliance-advisories.md` + `lib/validators/compliance.ts` | Future (not in this roadmap) | Once we add compliance rules. |

### Out of scope for this roadmap

- Auth / multi-user / RBAC.
- Real-time websockets (use polling).
- Mobile-first UI.
- PDF support (defer to v2; image-only for v1).
- Compliance-advisories engine (your friend's #2 stream).
- Wine / malt / sake compliance rules beyond current comparators.
- Persistence of original images beyond batch completion + retention window.
- Multi-tenant data isolation.

---

## Cross-cutting principles

These apply to every phase and every spec.

1. **Spec-first.** Status: `Draft → Approved → In progress → Done`. No code on a Draft spec. No merge without Done.
2. **Evals alongside features.** Every feature spec ships with its evals listed and implemented in the same PR. Never deferred.
3. **Mock first.** New features land working under `USE_MOCK_EXTRACTION=true` before real Gemini is wired. Keeps tests free, fast, and deterministic.
4. **Backwards-compatible migrations.** New columns are nullable or defaulted. No destructive Prisma changes without an explicit decision in this roadmap.
5. **Observe before optimizing.** Add timings / logs first; tune second.
6. **Smallest end-to-end first.** Three files happy path beats a perfect queue that doesn't run yet.
7. **Per-file isolation always.** Once batch exists, a single failure never propagates to siblings.
8. **One bug entry per real bug.** Roll up, root-cause, link the spec and evals that confirm the fix.
9. **One commit per logical change.** No grab-bag commits.

---

## Phase 0 — Foundation

> **Goal: install engineering process discipline and per-call optimizations on the existing single-label pipeline. No new product features. This is the cheapest highest-ROI phase and a prerequisite for any meaningful testing of the work that follows.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 0.1 | Spec template + workflow rule | Engineering |
| 0.2 | Bug tracker | Engineering |
| 0.3 | Image preprocessing on upload | End user (faster) |
| 0.4 | Per-phase server timings in API response | Engineering (devtools) |
| 0.5 | Retry-on-503 for Gemini | End user (fewer failures) |
| 0.6 | Model benchmark script | Engineering |

### User stories

- **US-0.1** — As an engineer, I want a documented spec workflow so every non-trivial change is reviewable before code is written.
- **US-0.2** — As an engineer, I want a bug tracker so issues are root-caused, scoped, and confirmed with evals, not patched in passing.
- **US-0.3** — As a reviewer uploading a 6 MB phone photo, I want the system to verify within a few seconds, not 20+.
- **US-0.4** — As an engineer debugging a slow verification, I want to open devtools and see exactly how long each phase took.
- **US-0.5** — As a reviewer, I want Gemini 503 outages to be retried transparently so I don't see a transient failure on my screen.
- **US-0.6** — As a tech lead choosing a Gemini model, I want to compare candidates on accuracy, latency, and 503 rate against real fixtures.

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] `docs/specs/_template.md` exists with attribution and full template.
- [ ] `CLAUDE.md` documents the spec workflow and approval rule.
- [ ] `docs/bugs.md` exists with severity legend.
- [ ] A 4 MB+ JPEG uploaded via `/new` returns a result within 3× faster wall-clock than before (verified by `timings.geminiExtractionMs` + `imagePreprocessMs` comparison).
- [ ] API response includes a complete `timings` object on success.
- [ ] Client logs `console.table` of timings on every verification.
- [ ] Forcing a 503 in tests causes 2 retries with logged delays.
- [ ] `npm test` passes with new retry tests added.
- [ ] `npm run benchmark -- --cases=wine-clean-pass,wine-abv-mismatch` produces a comparison table in <2 minutes.
- [ ] All existing tests still pass.
- [ ] Production build succeeds.

### Evals

- `image-preprocess.test.ts` — resize correctness, aspect preservation, output is JPEG.
- `gemini-retry.test.ts` — 6 cases listed above.
- `image-preprocess-pipeline.test.ts` — orchestrator integration: large input → preprocessed buffer passed to extraction.

### Risks

- `sharp` requires native binaries. Railway uses Nixpacks; should be supported, but a fresh `npm ci` deploy must be confirmed manually.
- `console.table` is harmless if the client is a non-browser environment (Playwright). Confirmed by skipping in non-browser context.
- Real benchmark requires real Gemini calls — small cost (~$0.005 per full run).

### Manual prerequisites

| What | Why |
|---|---|
| Confirm Railway build succeeds with `sharp` after first deploy | `sharp` adds native code; first deploy may need a `nixpacks.toml` tweak. Will be flagged at PR time. |
| Provide a small budget signal for benchmark runs | Default benchmark hits real Gemini; ~$0.005 per full sweep. Negligible but noted. |
| Approve attribution wording for adopted docs | One-line `Adopted from fsyeddev/ttb-label — see ROADMAP.md` header. |

### Estimated effort

**1.5–2 engineer-days.** Five small PRs (one per feature 0.1–0.6) or one combined PR with clean commits.


## Phase 1 — Eval infrastructure

> **Goal: build a fixture-based eval runner that drives the existing single-label pipeline at scale (10s of cases) and runs against any deployed URL. This is the test harness that will, in Phase 7, also load-test the batch path.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 1.1 | Categorized fixture directory + manifest | Engineering |
| 1.2 | `scripts/run-fixture-evals.ts` runner | Engineering |
| 1.3 | `npm run eval:quick` (~30s smoke) | Engineering / CI |
| 1.4 | `npm run eval:full` (~5min sweep) | Engineering |
| 1.5 | Eval runner integrated into CI | Engineering |

### User stories

- **US-1.1** — As an engineer, I want fixtures organized by expected outcome (pass / mismatch / fail) so I can assert category-level behavior, not row-level brittle equality.
- **US-1.2** — As an engineer, I want `npm run eval:quick` to run in CI on every PR so I catch regressions before merge.
- **US-1.3** — As an engineer, I want to point the eval runner at the deployed Railway URL to confirm a production change works.
- **US-1.4** — As an engineer, I want `npm run eval:full` to sweep 30+ fixtures in <5 minutes when I'm about to deploy.

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] At least 10 mock-mode fixtures exist across at least 4 categories.
- [ ] `npm run eval:quick` exits 0 against `http://localhost:3001` with the dev server running.
- [ ] `npm run eval:quick` runs in CI on every PR and gates merge.
- [ ] `npm run eval:full` exits 0 in <5 minutes.
- [ ] `--url=https://<railway-url>` works against a deployed instance.
- [ ] Failure output names which fixture, which category, and why it failed (e.g., `02-mismatch-01: overall PASS not in [FAIL|REVIEW]`).

### Evals

The runner itself is the eval. Self-validating: if its assertions are wrong, the team will notice the first time a real change breaks something the runner missed.

### Risks

- Mock-only fixtures may not catch real Gemini regressions. Mitigated by including a small `--real-gemini` test set runnable locally.
- Fixture rot as schemas evolve. Mitigated by `manifest.json` being version-checked.

### Manual prerequisites

| What | Why |
|---|---|
| Decide quantity of real-image fixtures, if any | Cost ~$0.0001/call. Default: zero (mock-only). Recommended: 5–10 in Phase 7. |
| Provide real label images if you want them | Phone-photo or web-scraped acceptable. Best from real TTB applications. |

### Estimated effort

**1–1.5 engineer-days.**


## Phase 2 — Data model and storage abstraction

> **Goal: define the batch entity, per-submission lifecycle, and file-storage interface. Schema changes only; no UI, no batch endpoint yet.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 2.1 | `Batch` and `BatchSubmission` Prisma models | Engineering |
| 2.2 | `FileStorage` interface | Engineering |
| 2.3 | `RailwayVolumeFileStorage` implementation | Engineering |
| 2.4 | Prisma migration | DBA / Engineering |

### User stories

- **US-2.1** — As an engineer, I want a `Batch` row that groups N `BatchSubmission` rows so I can model many-to-one verification jobs.
- **US-2.2** — As an engineer, I want each `BatchSubmission` to have its own status (`queued / processing / extracted / verified / failed / canceled`) so per-file lifecycle is explicit.
- **US-2.3** — As an engineer, I want a single `FileStorage` interface so business logic doesn't depend on whether files are on local disk, Railway Volume, or S3.

### Data model (decided)

```prisma
model Batch {
  id              String   @id @default(cuid())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  completedAt     DateTime?
  status          String   // queued | processing | completed | partially_failed | canceled
  clientName      String?
  applicantName   String?
  manifestJson    Json?    // raw manifest as uploaded, for debugging
  metadata        Json?    // free-form: source, notes, etc.
  totalCount      Int      @default(0)
  completedCount  Int      @default(0)
  failedCount     Int      @default(0)
  canceledCount   Int      @default(0)
  submissions     BatchSubmission[]

  @@index([createdAt])
  @@index([status])
}

model BatchSubmission {
  id                  String   @id @default(cuid())
  batchId             String
  batch               Batch    @relation(fields: [batchId], references: [id], onDelete: Cascade)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  status              String   // queued | processing | extracted | verified | failed | canceled
  errorMessage        String?
  errorCode           String?  // taxonomy: TIMEOUT | GEMINI_503 | INVALID_IMAGE | VALIDATION_ERROR | UNKNOWN
  attemptCount        Int      @default(0)
  fileHash            String   // sha256, used for dedup within a batch
  fileName            String
  fileSize            Int
  fileMimeType        String
  fileStorageKey      String   // opaque key into FileStorage
  applicationJson     Json     // per-submission expected values
  verificationRecordId String? @unique
  verificationRecord  VerificationRecord? @relation(fields: [verificationRecordId], references: [id])
  startedAt           DateTime?
  completedAt         DateTime?

  @@index([batchId])
  @@index([status])
  @@index([batchId, status])
}

// Extend existing model:
model VerificationRecord {
  // ...existing fields...
  batchSubmissionId   String? @unique  // back-reference for joins; optional for legacy rows
  batchSubmission     BatchSubmission?
}
```

### FileStorage interface

```ts
// lib/services/file-storage.ts
export interface FileStorage {
  put(input: { buffer: Buffer; mimeType: string; metadata?: Record<string, string> }): Promise<{ storageKey: string; size: number }>;
  getStream(storageKey: string): Promise<{ stream: ReadableStream; size: number; mimeType: string }>;
  getBuffer(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}
```

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] Migration applies cleanly to a fresh database and to one with existing rows.
- [ ] Existing `Submissions` page still loads (no regression).
- [ ] `npm test` includes new `file-storage.test.ts` cases.
- [ ] `RailwayVolumeFileStorage` round-trips a 1 MB buffer.
- [ ] `getBuffer` for an unknown key throws a typed `FileNotFoundError`.

### Evals

- `file-storage.test.ts` — put, get, delete, exists, sharding correctness, idempotent delete.

### Risks

- Railway Volume mount syntax may have changed; will verify manually before merge.
- Local dev uses a project-local directory; needs `.gitignore` entry.

### Manual prerequisites

| What | Why |
|---|---|
| **Mount the Railway Volume** | Required for deployed batches to persist files. UI in Railway dashboard. Confirm mount path matches `BATCH_FILE_STORAGE_PATH`. |
| Set `BATCH_FILE_STORAGE_PATH` env var on Railway | Should be `/data/batch-files` after mounting. |

### Estimated effort

**1.5–2 engineer-days.**


## Phase 3 — Synchronous batch path

> **Goal: working batch flow for up to 5 files end-to-end, processed serially in a single HTTP request. Proves the data model. No async yet.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 3.1 | `POST /api/batches` accepting multipart with N files | API consumer |
| 3.2 | `GET /api/batches/:id` returning per-submission status | API consumer |
| 3.3 | Per-file try/catch in the verification loop | End user |
| 3.4 | Minimal `/batches/:id` page | End user |

### User stories

- **US-3.1** — As an API consumer, I can POST a list of file+application pairs to `/api/batches` and get back a `batchId`.
- **US-3.2** — As an API consumer, I can GET `/api/batches/:id` and see per-submission status with FK to the verification record.
- **US-3.3** — As a reviewer, when one file in a batch fails extraction, the other files still complete.
- **US-3.4** — As a reviewer, I can navigate to `/batches/:id` and see a table of all submissions in the batch.

### Constraints

- **Batch size cap: 5 files** for this phase. Enforced by Zod. Removed in Phase 5.
- **Synchronous:** the HTTP request holds open for the duration. Acceptable for ≤5 × ~5s each = ~25s.
- **No retries yet.** A failed extraction marks the submission `failed` and moves on.

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] POST /api/batches with 3 valid files returns `batchId` and final state within 30s.
- [ ] One failing submission does not affect siblings.
- [ ] GET /api/batches/:id reflects accurate counts.
- [ ] `/batches/:id` page renders all submissions with status badges.
- [ ] E2E test passes in CI.
- [ ] `npm run eval:quick` still passes (no regression).

### Evals

- Existing eval runner extended with `--batch` mode that POSTs to /api/batches.
- E2E test above.

### Risks

- 5-file synchronous batch will hit ~25–30s on real Gemini. Acceptable for Phase 3; the cap moves in Phase 5.
- Multipart upload size limit: Next.js default 4 MB per request body. Need explicit override (`next.config.ts` `experimental.serverActions.bodySizeLimit`) or use multipart streaming. **Decision required: configure body size limit to 50 MB for batch endpoint.**

### Manual prerequisites

| What | Why |
|---|---|
| **Confirm Railway Volume is mounted and writable** | Phase 3 is the first phase that actually writes to the volume. |
| Approve body size limit increase to ~50 MB | Required for ≤5 × ~5 MB files in one request. |

### Estimated effort

**2 engineer-days.**


## Phase 4 — Manifest support

> **Goal: accept a CSV or JSON manifest that pairs filenames with expected application data, with strict pre-flight validation. Eliminates manual form-filling for batch.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 4.1 | CSV manifest parser with flexible headers | End user |
| 4.2 | JSON manifest parser | End user |
| 4.3 | Pre-flight validation report (matched / unmatched) | End user |
| 4.4 | Endpoint accepts manifest as alternative to inline application array | API consumer |

### User stories

- **US-4.1** — As a reviewer with 50 labels, I want to upload a CSV with one row per label so I don't fill in 50 forms.
- **US-4.2** — As a reviewer, I want flexible CSV headers (`brand_name`, `brand`, `Brand Name`) so I'm not forced to one schema.
- **US-4.3** — As a reviewer, when my manifest has typos or missing files, I want clear errors **before** any Gemini call is made.
- **US-4.4** — As a reviewer using a custom tool, I want a JSON manifest as an alternative to CSV.

### Manifest formats

#### CSV (one row per label)

```csv
file_name,product_type,brand_name,abv,net_contents,country_of_origin,...
wine-01.jpg,wine,Bayview Reserve,13.5% Alc./Vol.,750 mL,USA,...
wine-02.jpg,wine,Cypress Hills,14.0% Alc./Vol.,750 mL,USA,...
```

Required columns: `file_name`, `product_type`, `brand_name`. Optional: all other application fields.

Header normalization (from cola-verify pattern):
- `brand_name`, `brand`, `Brand Name`, `brand name` → `brand_name`
- `abv`, `alcohol`, `alcohol by volume`, `alc/vol`, `% alc` → `abv`
- `net_contents`, `volume`, `size`, `net contents`, `bottle size` → `net_contents`
- etc.

#### JSON

```json
{
  "batchMetadata": { "clientName": "Acme Wines", "applicantName": "Stefano" },
  "submissions": [
    { "file_name": "wine-01.jpg", "application": { ...full ColaApplication... } },
    { "file_name": "wine-02.jpg", "application": { ... } }
  ]
}
```

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] CSV with 5 rows + 5 matching image files creates 5 submissions.
- [ ] Manifest row without matching file → 400 with `validationReport` showing the orphan row.
- [ ] Image file without matching manifest row → 400 with the orphan file listed.
- [ ] CSV accepts 4+ header variants per field.
- [ ] JSON manifest validated by Zod with clear error messages.
- [ ] Old (inline `applications` array) path still works (backward compatible).

### Evals

- `manifest-csv.test.ts` — 8+ cases including header variants and edge cases.
- `manifest-json.test.ts` — 6+ cases.
- `manifest-validator.test.ts` — matching logic.

### Risks

- Manifest schema drift as commodities evolve. Mitigated by Zod refining `product_type` enum.

### Manual prerequisites

| What | Why |
|---|---|
| Decide policy: orphan file → fail batch, or fall back to form-fill | Default: fail. UI in Phase 6 may allow override. |
| Provide a sample manifest CSV if you have a real one | Helps shape the HEADER_MAP. |

### Estimated effort

**1.5 engineer-days.**


## Phase 5 — Async queue and worker

> **Goal: move batch processing off the HTTP request. POST returns in <2s; a worker processes submissions in the background with bounded concurrency, retries, and graceful shutdown. Removes the 5-file cap.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 5.1 | Worker process (separate Railway service) | Ops |
| 5.2 | Postgres-backed job queue (`FOR UPDATE SKIP LOCKED`) | Engineering |
| 5.3 | Bounded concurrency cap | Engineering |
| 5.4 | Per-submission retry with backoff | End user (fewer failures) |
| 5.5 | Graceful shutdown on SIGTERM | Ops |
| 5.6 | Crash recovery (resume in-flight submissions) | Ops |
| 5.7 | Cancel-batch action | End user |

### User stories

- **US-5.1** — As a reviewer, when I submit a batch of 100 files, the POST returns within 2 seconds with a batch ID.
- **US-5.2** — As a reviewer, I can poll `/api/batches/:id` to see live progress.
- **US-5.3** — As an engineer, I can configure Gemini concurrency via env var.
- **US-5.4** — As a reviewer, when a Gemini call fails once, the worker retries up to 2× with backoff before marking the submission failed.
- **US-5.5** — As ops, when I deploy a new version, in-flight work completes gracefully on SIGTERM; the next worker resumes any remaining queued submissions.
- **US-5.6** — As ops, if the worker crashes mid-batch, the next worker resumes from the last persisted state without duplicate work or stuck submissions.
- **US-5.7** — As a reviewer, I can cancel a batch that's still queued; in-flight submissions complete but no new ones start.

### Architecture

```
                                    ┌──────────────────────┐
                                    │  HTTP server (Next)  │
                                    │  POST /api/batches   │ → enqueue + return id
                                    │  GET  /api/batches/x │ → read state
                                    └──────────┬───────────┘
                                               │
                                          Postgres
                                               │
                                    ┌──────────┴───────────┐
                                    │  Worker process      │  ← separate Railway service
                                    │  worker-entry.ts     │
                                    │  - Poll loop         │
                                    │  - Concurrency cap   │
                                    │  - SKIP LOCKED       │
                                    │  - Retry policy      │
                                    │  - SIGTERM handler   │
                                    └──────────────────────┘
```

### Queue mechanics

```sql
BEGIN;
SELECT id FROM "BatchSubmission"
WHERE status = 'queued'
ORDER BY "createdAt" ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE "BatchSubmission"
SET status = 'processing', "startedAt" = now(), "attemptCount" = "attemptCount" + 1
WHERE id = $1;
COMMIT;
```

The worker process executes this in a Prisma transaction. Multiple worker processes / replicas safely coexist because `SKIP LOCKED` guarantees each row is claimed by exactly one worker.

### Retry policy

- Per-submission attempt cap: 3 (1 initial + 2 retries).
- On retryable error (Gemini 503, network timeout, internal 5xx): increment `attemptCount`, set `status = 'queued'` with a `nextAttemptAfter` timestamp, log warning.
- On non-retryable error (invalid image, validation failure): `status = 'failed'`, set `errorMessage` and `errorCode`.
- After 3 attempts of retryable failures: `status = 'failed'`, `errorCode = 'RETRY_EXHAUSTED'`.

### Concurrency

- Env var `BATCH_MAX_CONCURRENT_EXTRACTIONS` (default 4).
- Worker maintains an in-flight count and only claims new work below the cap.

### Shutdown

- On `SIGTERM`: stop claiming new work; wait for in-flight to finish or up to `BATCH_SHUTDOWN_GRACE_MS` (default 30000); exit.

### Cancellation

- `POST /api/batches/:id/cancel` sets `Batch.status = 'canceled'` and updates queued submissions to `canceled`. In-flight submissions are not interrupted (Gemini call is in-flight; we let it finish to avoid wasted spend).

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] `POST /api/batches` with a 100-file payload returns within 2 seconds.
- [ ] Worker processes submissions at the configured concurrency.
- [ ] Killing the worker mid-batch and restarting it produces no duplicate `VerificationRecord` rows.
- [ ] A submission that 503s twice then succeeds reaches `verified` with `attemptCount = 3`.
- [ ] A submission that 503s three times reaches `failed` with `errorCode = 'RETRY_EXHAUSTED'`.
- [ ] Cancelling a batch transitions queued submissions to `canceled` and stops new starts.
- [ ] Backpressure: queue depth ≥ 500 rejects new batches with 429.
- [ ] All Phase 3 and Phase 4 E2E tests still pass.

### Evals

- `worker.test.ts` — 6+ scenarios above.
- Extended `tests-e2e/batch-async.spec.ts`.
- `eval:quick` still green.

### Risks

- **Long-running connections.** Worker holds a Prisma connection; need to confirm pool sizing.
- **Race conditions on counter updates.** Use atomic increments (`{ failedCount: { increment: 1 } }`).
- **In-flight Gemini calls during cancel.** We let them finish; documented.

### Manual prerequisites

| What | Why |
|---|---|
| **Create a second Railway service for the worker** | Web and worker are separate processes. Same env, same DB, same Volume. |
| Configure worker service start command (`npm run worker`) | Railway dashboard. |
| Set `BATCH_MAX_CONCURRENT_EXTRACTIONS=4` (or other) | Start conservative; tune in Phase 7. |
| Confirm Gemini rate limits on your account | Free tier: 20 req/day per model. Paid tier: higher. Required to choose concurrency. |

### Estimated effort

**3 engineer-days.** This is the most complex phase.


## Phase 6 — Batch UI

> **Goal: production-grade UI for batch upload, live progress, results review, and drill-into-failed.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 6.1 | `/batches/new` upload page with dropzone + manifest input | Reviewer |
| 6.2 | Pre-submit validation panel | Reviewer |
| 6.3 | `/batches/:id` live progress page | Reviewer |
| 6.4 | Per-submission drill-down | Reviewer |
| 6.5 | Cancel-batch button | Reviewer |
| 6.6 | Submissions tab `batchId` filter | Reviewer |

### User stories

- **US-6.1** — As a reviewer, I can drag-and-drop 50 image files at once with previews and per-file size readouts.
- **US-6.2** — As a reviewer, I can drop a CSV manifest alongside my files and see a pre-submit validation panel that highlights orphan rows and orphan files.
- **US-6.3** — As a reviewer, after I click Submit, I land on a batch progress page that polls every 2–3 seconds and shows live counts.
- **US-6.4** — As a reviewer, I can click any submission row to see its full report (pass / fail / per-field) without leaving context.
- **US-6.5** — As a reviewer, I can cancel a batch that's still queued if I uploaded the wrong files.
- **US-6.6** — As a reviewer, I can filter the Submissions tab by `batchId` to see all results from one batch.

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] Reviewer can drag 5 files + a manifest CSV and submit a batch in under 30 seconds (including extraction time).
- [ ] Live progress updates without page reload.
- [ ] Failed submission rows show error message inline.
- [ ] Drill-down from batch table → verification detail works.
- [ ] Cancel button visible for in-progress batches; cancellation reflected in UI within one poll cycle.
- [ ] All three Playwright E2E tests pass.
- [ ] Mobile / responsive layout acceptable (not pixel-perfect).

### Evals

- 3 new Playwright specs.
- Existing eval suite still green.

### Risks

- Polling load on the server. Mitigated by `If-None-Match` ETags or simple version timestamps.
- Drag-and-drop UX edge cases (drop on different elements, paste, etc.). Acceptable to defer fancy edge cases.

### Manual prerequisites

| What | Why |
|---|---|
| Approve UI mockup before implementation | Optional — recommended but not blocking. |

### Estimated effort

**3 engineer-days.**


## Phase 7 — Hardening and scale test

> **Goal: validate the system at 50, 100, and 300 labels. Tune concurrency. Add cost tracking. Structured logs.**

### Features delivered

| # | Feature | Visible to |
|---|---|---|
| 7.1 | `npm run loadtest --size=N` | Engineering |
| 7.2 | Token usage + cost per batch | Engineering / billing |
| 7.3 | Structured logging (pino) | Engineering / ops |
| 7.4 | Tuned concurrency cap based on data | End user (perf) |
| 7.5 | Cost cap per batch | Ops |

### User stories

- **US-7.1** — As an engineer, I can run `npm run loadtest -- --size=100` and get a report of p50/p95/p99 timing, throughput, error rate, and total cost.
- **US-7.2** — As ops, I can read `Batch.metadata.cost` to know exactly what a batch cost in Gemini fees.
- **US-7.3** — As an engineer, I can grep production logs for a `batchId` and see every event for that batch in order.
- **US-7.4** — As a reviewer, I can run a 100-label batch and have it complete in under 10 minutes.
- **US-7.5** — As ops, I can configure a max cost per batch and reject batches that exceed it before any extraction runs.

### Engineering tasks

*Lives in the per-phase spec (`docs/specs/`) once the phase is approved — see the spec-first rule.*

### Acceptance criteria

- [ ] `npm run loadtest -- --size=50` completes within 10 minutes.
- [ ] 50-label batch p95 extraction time < 12 seconds.
- [ ] 100-label batch completes within 20 minutes with concurrency=4.
- [ ] 300-label batch documented (may be cost-prohibitive to run; estimate documented).
- [ ] Per-batch cost displayed on the batch progress page.
- [ ] Cost cap rejects an overly large batch before queueing.
- [ ] All log lines include `batchId` and `submissionId` where relevant.
- [ ] No memory growth over 1-hour worker run (verify with `process.memoryUsage()` snapshots).

### Evals

- `scripts/loadtest-report.ts` — turns the JSON artifact into a printed report.
- Manual verification of cost numbers vs. Gemini billing dashboard.

### Risks

- **Gemini rate limits.** Without paid tier with >100 RPM, 300-label tests will throttle. May limit Phase 7 to 50 / 100 in practice.
- **Real Gemini cost for 300 labels.** At ~$0.0001/call, ~$0.03. Affordable. But repeated load tests add up.

### Manual prerequisites

| What | Why |
|---|---|
| **Provide Gemini tier and rate limits** | Required to choose concurrency cap. Find in [Google AI Studio dashboard](https://aistudio.google.com/). |
| Approve max cost cap value (default $5) | Per-batch safety guard. |
| Decide whether to run the 300-label sweep | Cost: ~$0.03. Time: ~30–60 minutes depending on concurrency. |

### Estimated effort

**2 engineer-days.**


## Phase 8 — Operational polish (optional)

Each item below is a separate spec; pick what's needed.

- **Notifications** — email or Slack on batch completion / failure.
- **Dead-letter view** — admin page listing all `failed` submissions with retry button.
- **Per-user batches** — once auth exists, scope batches to users.
- **Export results** — download batch results as CSV / Excel.
- **Retention policy** — auto-delete files older than N days.
- **Admin dashboard** — system-wide throughput, error rates, cost trends.
- **Real images at scale** — replace mock fixtures with real-label corpus.

---

## Architectural decisions log

Each decision either: **Decided** (locked, with rationale) or **Open** (needs resolution).

### Decided

| ID | Decision | Rationale | When |
|---|---|---|---|
| AD-001 | File storage: Railway Volume | Simplest, no new accounts, fits prototype scale. Migrate to S3 in production if needed. | 2026-05-16 |
| AD-002 | Async via Postgres queue (`SKIP LOCKED`) | No new infra dependency, transactional with batch state, simple to reason about. Migrate to BullMQ + Redis if throughput >> 50 RPM. | 2026-05-16 |
| AD-003 | Worker as separate Railway service | Isolates long-running work from HTTP, allows independent scaling. | 2026-05-16 |
| AD-004 | Concurrency capped via env var | Configurable; default 4 until Phase 7 tunes. | 2026-05-16 |
| AD-005 | Manifest matching by filename (case-insensitive) | Simplest, matches user mental model. | 2026-05-16 |
| AD-006 | Spec template adopted from cola-verify with attribution | Avoid reinventing a proven pattern. | 2026-05-16 |
| AD-007 | Mock-first development for new features | Keeps CI free and fast. Real Gemini wired before merge. | 2026-05-16 |
| AD-008 | Image preprocessing via `sharp`, 1280px max edge, JPEG q=85 | Matches cola-verify's empirical setting. ~3× speedup. | 2026-05-16 |
| AD-009 | Gemini retry on 503 only, [5000, 10000] ms delays, max 2 retries | Matches cola-verify's tested pattern. | 2026-05-16 |
| AD-010 | Real `GEMINI_API_KEY` available in Railway env | Confirmed. | 2026-05-16 |
| AD-011 | PDF support deferred to v2 | Images only for v1. | 2026-05-16 |

### Open — needed before stated phase

| ID | Decision | Needed before | Notes |
|---|---|---|---|
| AD-O1 | Body size limit for batch upload endpoint | Phase 3 | Recommend 50 MB. |
| AD-O2 | Policy on orphan files / orphan rows in manifest | Phase 4 | Default: reject. UI in Phase 6 may allow override. |
| AD-O3 | Worker service definition in Railway | Phase 5 | Create separate service via dashboard. |
| AD-O4 | Gemini tier and rate limits on your account | Phase 5 / 7 | Drives concurrency cap. |
| AD-O5 | Max cost per batch (USD) | Phase 7 | Default proposal: $5. |
| AD-O6 | Whether to run 300-label load test in production | Phase 7 | Cost ~$0.03, time 30–60 min. |

---

## Manual prerequisites summary

What you (Stefano) need to do, by phase. Most items take 5–15 minutes.

### Before Phase 0 starts

- [x] Confirm `GEMINI_API_KEY` is in Railway env — **done**
- [x] Approve spec-template attribution wording — **done**
- [ ] Acknowledge the spec-first workflow rule will gate code

### Before Phase 1 starts

- [ ] Decide quantity of real-image fixtures, if any (default: 0)
- [ ] Optionally provide real label images for fixtures

### Before Phase 2 starts

- [ ] **Mount a Railway Volume to your service** at `/data/batch-files`. Railway dashboard → Service → Volumes → New volume.
- [ ] Set `BATCH_FILE_STORAGE_PATH=/data/batch-files` env var on Railway.

### Before Phase 3 starts

- [ ] Approve body size limit increase to ~50 MB
- [ ] Confirm Railway Volume is writable (Phase 2 tests will verify)

### Before Phase 4 starts

- [ ] Decide manifest orphan policy (reject vs. allow form-fill fallback)
- [ ] Optionally provide a sample manifest CSV

### Before Phase 5 starts

- [ ] **Create a second Railway service for the worker.** Same repo, same env, same DB, same Volume. Start command: `npm run worker`.
- [ ] Provide Gemini account tier and rate limits (find in [Google AI Studio](https://aistudio.google.com/))
- [ ] Set `BATCH_MAX_CONCURRENT_EXTRACTIONS` env var (start at 4)
- [ ] Set `BATCH_MAX_QUEUE_DEPTH` env var (default 500)

### Before Phase 6 starts

- [ ] Optionally approve UI mockup

### Before Phase 7 starts

- [ ] Approve max cost cap per batch (default $5)
- [ ] Decide whether to run the 300-label sweep (~$0.03)
- [ ] Confirm DB connection pool sizing acceptable for load test

---

## Glossary

- **Application** — the COLA form data submitted by an applicant (brand, ABV, net contents, etc.). Source of truth for cross-validation.
- **Batch** — a group of one or more `BatchSubmission`s submitted together for verification.
- **BatchSubmission** — one row per file in a batch. Owns its own status lifecycle. Optionally produces a `VerificationRecord` on success.
- **Concurrency cap** — max simultaneous Gemini calls. Env var `BATCH_MAX_CONCURRENT_EXTRACTIONS`.
- **Cross-validation** — comparing extracted label data against the submitted application. Drives PASS / FAIL / NEEDS REVIEW.
- **Extraction** — Gemini call that returns structured JSON from a label image.
- **Fixture** — a labeled test case (image + expected outcome). Lives in `evals/fixtures/`.
- **Manifest** — a CSV or JSON document that pairs filenames to expected application data for a batch.
- **Mock extraction** — `USE_MOCK_EXTRACTION=true` short-circuits Gemini and returns predetermined scenarios from `data/samples/`.
- **Spec** — a `docs/specs/<name>.md` file with `Status / Goal / Scope / Approach / Acceptance / Evals / Open questions / Notes`. Required before code.
- **Verification** — the full cycle of extraction + cross-validation on one label.
- **VerificationRecord** — DB row capturing the result of one verification.
- **Worker** — separate process that drains the batch queue.

---

## Appendix A: Approvals

| Phase | Approval needed | Approved by | Date |
|---|---|---|---|
| 0 | Roadmap (this doc) | Stefano | _pending_ |
| 0 | Phase 0 spec | Stefano | _pending_ |
| 1 | Phase 1 spec | Stefano | _pending_ |
| 2 | Phase 2 spec | Stefano | _pending_ |
| 3 | Phase 3 spec | Stefano | _pending_ |
| 4 | Phase 4 spec | Stefano | _pending_ |
| 5 | Phase 5 spec | Stefano | _pending_ |
| 6 | Phase 6 spec | Stefano | _pending_ |
| 7 | Phase 7 spec | Stefano | _pending_ |

---

## Appendix B: References

- Peer prototype: [github.com/fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label) — patterns adopted with attribution per Reference inputs table.
- TTB COLA regulations: 27 CFR Part 4 (wine), Part 5 (distilled spirits), Part 7 (malt beverages).
- Next.js docs: [App Router](https://nextjs.org/docs/app), [Server Actions size limits](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions).
- Railway docs: [Volumes](https://docs.railway.com/reference/volumes), [Services](https://docs.railway.com/reference/services).
- Prisma docs: [`SKIP LOCKED` via raw SQL](https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access).

---

*End of roadmap. Next action: Stefano reviews and approves; Claude writes Phase 0 spec.*

# Implementation Roadmap — Brief-Aligned

Source of truth: `docs/take-home-brief.docx` (stakeholder interviews + technical
requirements). Companion: `docs/pre-research-decisions.md` §22 (MVP build order)
and §24 (deferred items).

## MVP build order (§22) — status

Phases 0–12 (docs, schemas, router, extraction, verification, orchestrator,
persistence, API, UI, samples, tests, README, Railway prep) are complete. See
the README and `docs/architecture.md` for the implemented surface.

## Brief-driven gap analysis

| Brief signal | Source | Status |
| --- | --- | --- |
| Brand / ABV / warning / net contents / class / origin matching | Sarah, "Technical Requirements" | Done — `lib/verification/compare-*.ts` |
| 5-second response budget | Sarah ("scanning vendor disaster") | Designed for (`gemini-2.5-flash` + mock fallback) |
| Easy UX for non-technical agents ("no hunting for buttons") | Sarah | Pages exist; audit pending |
| Word-for-word warning, all-caps `GOVERNMENT WARNING:` | Jenny | Done — `compare-warning.ts` |
| Judgment / nuance (`STONE'S THROW` ≡ `Stone's Throw`) | Dave | Done — `likely_match` via `normalize` + `similarity` |
| **Batch upload (200–300 applications)** | Sarah ("Janet from Seattle has been asking for years") | **Missing — only single-app flow** |
| Deployed URL | "Deliverables" | Railway config in repo; live URL is user-managed |
| Imperfect-image handling (angles, glare) | Jenny ("maybe out of scope") | Explicit OOS |
| Network-restricted environments | Marcus | `USE_MOCK_EXTRACTION=true` already covers demo path |

## Explicitly NOT in scope (per brief + docs)

- COLAs Online integration — Marcus: "not looking to integrate with COLA directly"
- PII / secure storage — Marcus: "we're not storing anything sensitive"
- Auth, full CRM, durable image blob storage — not in brief
- PDF / CSV export, LangGraph orchestration — README "future improvements", not brief
- Custom model training — `pre-research-decisions.md` §24
- Same-field-of-vision bounding-box detection — README "future"; current `human_review_required` path satisfies the brief

## Plan — one commit per task on `claude/review-roadmap-status-nnyGE`

### Task 1 — Roadmap doc (this file)

- **Goal:** Replace speculative deferred-list with brief-aligned plan.
- **Acceptance:** `docs/implementation-roadmap.md` exists; cross-linked from README "Future improvements".
- **Files:** `docs/implementation-roadmap.md`, `README.md`.

### Task 2 — Batch verification backend

- **Goal:** Support Sarah's "200–300 labels at once" request without breaking the
  single-verification flow or the 5-second-per-item budget.
- **Approach:**
  - Add `runVerificationBatch(items, options)` to the orchestrator that calls the
    existing `runVerification` per item with bounded concurrency
    (`BATCH_CONCURRENCY`, default 4). The orchestrator boundary stays the only
    composition point.
  - New API route `POST /api/verify/batch` accepting `{ items: VerifyRequest[] }`,
    capped at `BATCH_MAX_ITEMS` (default 50 for the prototype — brief mentions
    200–300 in production, but we should not invite a 5-minute server hang in a
    demo). Returns `{ results: [{ recordId, status, report?, error? }] }`.
  - Per-item failure does not fail the batch — each result carries success or
    error metadata.
  - Reuse `verificationRecord` persistence; each item is one row.
- **Out of scope:** Background job queue, websockets, retry policy beyond
  per-item try/catch.
- **Files:**
  - `lib/services/verification-orchestrator.ts` (add `runVerificationBatch`)
  - `app/api/verify/batch/route.ts` (new)
  - `lib/schemas/cola-application.schema.ts` (export the per-item request shape
    for reuse, if useful)
- **Acceptance:** Posting 6 sample scenarios returns 6 result objects, mix of
  pass/needs_review/fail; failed items return `error` instead of crashing the
  request.

### Task 3 — Batch verification UI

- **Goal:** Agent UI for kicking off a batch and reviewing the per-row outcome
  without leaving the page.
- **Approach:**
  - New page `app/batch/page.tsx` with a "Run all 6 sample scenarios" button as
    the demo path (mirroring the single-flow sample affordance on `/new`).
  - File-upload affordance is deferred until we have a clear JSON/zip format
    decision; the brief specifies the *agent* request shape, not a file format.
    Sample-driven batch is enough to demonstrate the flow against the brief.
  - Results render in a sortable table: row → application brand, product type,
    overall status badge, checks summary, "Open report" link to existing
    `/verification/[id]`.
  - Dashboard (`/`) gets a "New batch" CTA next to the existing "New verification" CTA.
- **Files:**
  - `app/batch/page.tsx` (new)
  - `components/verification/BatchRunner.tsx` (new)
  - `components/verification/BatchResultsTable.tsx` (new)
  - `app/page.tsx` (add CTA)
- **Acceptance:** From `/batch`, clicking "Run sample batch" shows a progress
  count → final results table with 6 rows; each row links to the saved
  `/verification/[id]`.

### Task 4 — Batch tests + fixtures

- **Goal:** Lock the batch contract before UI iteration.
- **Approach:**
  - Vitest: `tests/run-verification-batch.test.ts` covers
    (a) all-success, (b) mixed success/failure, (c) concurrency cap is
    respected (assert max parallel in-flight via instrumented mock service).
  - Schema test: batch request shape.
- **Files:** `tests/run-verification-batch.test.ts` (new).
- **Acceptance:** `npm test` passes including the new file.

### Task 5 — UX audit pass

- **Goal:** Run the existing UI against the brief's accessibility / clarity
  expectation ("clean, obvious, no hunting for buttons", half the team over 50).
- **Approach:** Use `web-design-guidelines` skill on the changed/new pages.
  Address P0/P1 findings; defer cosmetic P2 to a follow-up.
- **Files:** Wherever the audit lands.
- **Acceptance:** No P0/P1 violations remain on `/`, `/new`, `/batch`,
  `/verification/[id]`.

### Task 6 — End-to-end verification suite

- **Goal:** Prove every shipped feature works end-to-end without external
  services. Unit tests alone are insufficient — they don't catch wiring bugs
  between route handlers, the orchestrator, the mock extractor, persistence,
  and the UI.
- **Approach:** Three layers, all hermetic:
  - **API integration** (Vitest): mock `@/lib/prisma` with an in-memory store,
    import each route handler directly, exercise happy paths + error codes for
    `/api/verify`, `/api/verify/batch`, `/api/verifications`,
    `/api/verifications/[id]`.
  - **Live HTTP smoke** (`scripts/e2e-smoke.mjs`): boots `next dev` with
    `PRISMA_MOCK=true USE_MOCK_EXTRACTION=true` and hits every endpoint with
    `fetch`. Survives in firewalled environments where Playwright's browser
    binary can't be downloaded.
  - **Browser E2E** (Playwright): Chromium specs for `/`, `/new`, `/batch`,
    `/verification/[id]` against the same `PRISMA_MOCK`-backed dev server.
  - Wrap the three suites in a `.claude/skills/e2e-test/SKILL.md` runbook so
    `/e2e-test` runs them in order and reports a single summary.
  - Add `PRISMA_MOCK` toggle to `lib/prisma.ts` (rejected in production) so
    the Playwright + smoke runs don't need Postgres.
- **Files:** `tests/e2e/_helpers/*.ts`, `tests/e2e/api-*.test.ts`,
  `tests/e2e/browser/*.spec.ts`, `playwright.config.ts`, `scripts/e2e-smoke.mjs`,
  `lib/prisma-mock.ts`, `.claude/skills/e2e-test/SKILL.md`.
- **Acceptance:** `npm test` 76/76 green; `npm run test:smoke` exits 0 with
  every endpoint check passing; Playwright specs run when Chromium is
  available; skill discoverable as `/e2e-test`.

## Out of this roadmap

Anything not driven by the brief stays in `pre-research-decisions.md` §24 and
README "Future improvements". Adding it requires a new brief signal.

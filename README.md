# TTB LabelCheck AI

> AI-assisted alcohol-beverage label verification — a TTB COLAs Online-style reviewer experience that extracts label content with Gemini and runs deterministic field-by-field compliance checks against the application.

Built as a take-home for the AI-Powered Alcohol Label Verification project. Single-label and batch (up to 200 labels per submission) workflows. End-to-end observability via Braintrust. ~3–4 s per Gemini extraction in production.

## 🔗 Live demo

**[https://ttb-cola-waiver-label-verification-production.up.railway.app/](https://ttb-cola-waiver-label-verification-production.up.railway.app/)**

Open in a browser — no login. Try the **Single label** flow first (drop in a wine/spirits/malt label and click Run verification), then flip to **Batch** mode to drop a manifest + multiple images. The first row of any batch renders inline within ~6 s while the rest fill in live.

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start (local)](#quick-start-local)
- [Stack](#stack)
- [Architecture](#architecture)
- [Features shipped](#features-shipped)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Fixture evals](#fixture-evals)
- [Deploying to Railway](#deploying-to-railway)
- [Repo layout](#repo-layout)
- [License](#license)

> Approach, key decisions, and assumptions live in [`docs/final-deliverable.md`](docs/final-deliverable.md) — the single hiring-manager-facing summary.

---

## What it does

A compliance reviewer can:

1. **Single label** — pick a product type, enter COLA-style application data, upload up to 10 images of one bottle (front / back / neck), and get a field-by-field verification report.
2. **Batch** — upload up to 200 labels in one submission with a CSV or JSON manifest pairing each image to its application data. The async worker drains the queue with bounded concurrency and the `/batches/:id` page polls for live progress.
3. **Audit** — every verification is persisted with the full application + extraction + comparator output as a `VerificationRecord` reviewers can browse later.

The tool **assists** human reviewers — it never auto-approves, never makes a legal determination, and never submits to COLAs Online.

---

## Quick start (local)

```bash
git clone https://github.com/StefanoCaruso456/TTB-COLA-WAIVER-Label-verification.git
cd TTB-COLA-WAIVER-Label-verification

npm install
cp .env.example .env

# Demo mode: zero external dependencies (no Gemini key, no Postgres needed).
echo "USE_MOCK_EXTRACTION=true" >> .env
npm run dev
# open http://localhost:3000/new
```

For the Gemini path, set `GEMINI_API_KEY` and unset `USE_MOCK_EXTRACTION`. For persistence and the batch endpoints, set `DATABASE_URL` (Postgres) and run `npm run prisma:migrate:dev`.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 | Server-rendered pages + API routes in one tree; fits the prototype scope without microservices |
| Language | TypeScript (strict) | End-to-end types from Zod schemas through the comparator pipeline |
| Validation | Zod | Same schemas validate inbound requests and infer all public types |
| Database | Prisma + Postgres | `VerificationRecord`, `Batch`, `BatchSubmission`; migrations checked in |
| AI | `@google/genai` 1.52 + `gemini-2.5-flash` | Multimodal OCR + structured-output mode; thinking disabled for latency |
| Image pipeline | `sharp` | Resize to 1280 px max edge, JPEG 85% — ~85% payload reduction |
| Telemetry | Braintrust SDK | One `verify` parent span + one `gemini.extract` child per call; latency, cost, token, and scoring metrics |
| Storage | Filesystem (`LocalDiskFileStorage`) | Content-addressed; deploys to a Railway Volume in production |
| Testing | Vitest (unit) + Playwright (E2E) | Deterministic comparators + endpoint coverage |

No LangChain / LangGraph in the MVP — the orchestration is direct TS calls. Rationale in [`docs/pre-research-decisions.md`](docs/pre-research-decisions.md).

---

## Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │            Next.js App Router                │
                  │                                              │
   /new      ───► │  pages: /new, /batches/[id], /verification/  │
                  │  api:   /api/verify, /api/batches            │
                  └────────────────────┬─────────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────────┐
                  │           verification-orchestrator          │
                  │   parses → preprocesses → extracts →         │
                  │   routes commodity → compares → persists     │
                  └─┬──────────────┬──────────────┬──────────────┘
                    │              │              │
                    ▼              ▼              ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │   sharp      │  │  Gemini      │  │  Prisma /    │
         │  preprocess  │  │  extraction  │  │  Postgres    │
         └──────────────┘  │  (mock/real) │  └──────────────┘
                           └──────┬───────┘
                                  │
                                  ▼
                           ┌──────────────┐
                           │ comparators  │
                           │ (TS, no LLM) │
                           └──────────────┘

   Batch path:  POST → write files + queue → 202 → background worker drains
                with bounded concurrency → UI polls /batches/:id every 2s.

   Telemetry:   every verify call emits a `verify` span (input/output/
                metadata/latency/scores) with a `gemini.extract` child span
                (tokens, cost, finishReason). Off when BRAINTRUST_API_KEY
                is unset; lazy `initLogger` so it's a true no-op.
```

Full diagram + trust boundaries: [`docs/architecture.md`](docs/architecture.md).

---

## Features shipped

| Capability | Status | Where |
|---|:---:|---|
| Single-label verification with mock + Gemini extraction | ✓ | `/new` (Standard mode) |
| Multi-label batch (up to 200 per submission, manifest-driven) | ✓ | `/new` (Batch mode) → `POST /api/batches` → `/batches/:id` |
| CSV manifest with header aliases (4+ per required field) | ✓ | `lib/services/manifest-parser.ts` |
| JSON manifest with Zod validation | ✓ | same |
| Pre-flight validation (orphan rows, orphan files, dup names) | ✓ | `lib/services/manifest-validator.ts` |
| Async worker + bounded concurrency (default 3, env-tunable 1–10) | ✓ | `lib/services/batch-worker.ts` |
| Startup recovery (requeue rows stranded by process restart) | ✓ | `instrumentation.ts` + `lib/services/batch-recovery.ts` |
| Backpressure (429 at 500-row global queue depth) | ✓ | `app/api/batches/route.ts` |
| Live progress polling on `/batches/:id` | ✓ | `components/batch/BatchProgressPoller.tsx` |
| Persistent audit history (`VerificationRecord`) | ✓ | `prisma/schema.prisma` |
| Content-addressed file storage (Railway Volume in prod) | ✓ | `lib/services/file-storage-disk.ts` |
| Image preprocessing (1280 px max, JPEG 85%) | ✓ | `lib/image-preprocess.ts` |
| Braintrust telemetry (parent + child spans, latency/cost/scores) | ✓ | `lib/observability/braintrust.ts` |
| Eval harness (mock + live fixtures, CI gate) | ✓ | `evals/` + `npm run eval:quick \| eval:full` |
| Per-call cost telemetry (`estimated_cost_usd`) | ✓ | env-tunable rates |
| Per-call SLO scoring (`*.latencyUnder5s` 1/0) | ✓ | reads in Braintrust Monitor view as "% under SLO" |

---

## Environment variables

**Minimum to run** depends on the mode:

| Mode | Required |
|---|---|
| Demo (no Gemini, no DB) | `USE_MOCK_EXTRACTION=true` |
| Real Gemini, no audit history | `GEMINI_API_KEY` |
| Real Gemini + audit history | `GEMINI_API_KEY` + `DATABASE_URL` |
| All of the above + telemetry | also `BRAINTRUST_API_KEY` |

### Required (under at least one mode)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required for persistence + the batch endpoints. |
| `GEMINI_API_KEY` | Gemini API key. Required **unless** `USE_MOCK_EXTRACTION=true`. |
| `BRAINTRUST_API_KEY` | Required only if you want telemetry. Unset = lazy no-op; nothing leaks. |

### Optional — defaults in code, listed so operators know the knobs exist

| Variable | Default | Purpose |
|---|---|---|
| `USE_MOCK_EXTRACTION` | `false` | `true` forces deterministic mock extraction (no Gemini call). |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Override to a different Gemini model (e.g. a dated lite variant like `gemini-2.5-flash-lite-preview-06-17` once you confirm availability on your API tier). |
| `IMAGE_PREPROCESS_ENABLED` | `true` | Resize uploads to JPEG before Gemini. |
| `IMAGE_MAX_EDGE_PX` | `1024` | Longest-edge target after resize. Clamped 256..4096. Raise to 1280–1568 if a corpus has small print that benefits. |
| `EXTRACTION_DEBUG_LOG` | `false` | When `true`, log the first 2 KB of every Gemini response (operator debug). |
| `BATCH_FILE_STORAGE_PATH` | `./.local/batch-files` | Batch storage root. Point at a Railway Volume in production. |
| `BATCH_MAX_REQUEST_BYTES` | `209715200` (200 MB) | Cap on `POST /api/batches` body. |
| `MAX_BATCH_FILES_OVERRIDE` | `200` | Files per batch. Hard ceiling 500. |
| `BATCH_WORKER_CONCURRENCY` | `3` | Parallel Gemini calls per batch. Clamped 1..10. |
| `BATCH_QUEUE_DEPTH_LIMIT` | `500` | Global `queued + processing` count above which POST returns 429. |
| `BRAINTRUST_PROJECT` | `ttb-cola-verifier` | Project name in Braintrust. |
| `GEMINI_INPUT_USD_PER_M` | `0.30` | Cost-estimate input rate, $/1M tokens. |
| `GEMINI_OUTPUT_USD_PER_M` | `2.50` | Cost-estimate output rate (incl. thinking), $/1M tokens. |

A complete template lives in [`.env.example`](.env.example).

---

## Testing

```bash
npm test                  # Vitest unit + integration suite
npx tsc --noEmit          # Strict typecheck
npm run lint              # ESLint (Next.js config)
npm run build             # Production build (runs prisma generate)
npm run test:e2e          # Playwright E2E (needs a local dev server + Postgres)
```

Suite at last commit: **208 unit tests pass** across 25 files. Coverage:

- Text normalization, similarity, brand / ABV / volume / warning / country comparators
- Commodity router, OCR target maps, image preprocessing
- Gemini 503-retry policy, JSON-fence stripping
- All Zod schemas (application, extracted label, batch APIs, manifest)
- Manifest parser (CSV + JSON), validator, header aliases
- Braintrust tracer (no-op without API key), scorers, cost / latency helpers
- Async batch worker concurrency resolver

The full Gemini path is **not** asserted against the live model in unit tests — that's the job of the fixture eval suite below.

---

## Fixture evals

A second tier drives a deployed instance against categorized fixtures:

```bash
npm run dev                               # in one terminal

npm run eval:quick                        # smoke sweep, one per category, ~1s
npm run eval:full                         # 10 fixtures across 6 categories
npm run eval:full -- --url=https://...    # target a deployed instance
npm run eval:full -- --only=02-mismatch-abv-wine,03-missing-warning-spirits
npm run eval:full -- --verbose            # per-check details on failure
```

Fixtures + manifest in [`evals/fixtures/generated/`](evals/fixtures/generated). Design: [`docs/specs/phase-1-eval-infrastructure.md`](docs/specs/phase-1-eval-infrastructure.md). CI runs `eval:quick` on every PR.

---

## Deploying to Railway

1. Create a Railway project; add the **Postgres** plugin. `DATABASE_URL` is exposed automatically.
2. Deploy this repo as a service. Build command: `npm run build` (runs `prisma generate` then `next build`). Start command: `npm start`.
3. Set env vars per the table above. At minimum:
   - `GEMINI_API_KEY` (or `USE_MOCK_EXTRACTION=true` for a demo-safe deploy)
   - `BATCH_FILE_STORAGE_PATH=/data/batch-files` if you attach a Railway Volume
   - `BRAINTRUST_API_KEY` if you want telemetry
4. Apply migrations on first deploy: `npm run prisma:migrate` as a release step (or once manually via the Railway shell).
5. Open `/new` to run a verification.

---

## Repo layout

```
app/                                     Next.js App Router
  new/                                   single + batch UI (mode toggle)
  batches/[id]/                          live-polling batch detail
  verification/[id]/                     saved report detail
  api/verify/                            POST → single-label verify
  api/batches/                           POST (202) + GET batch state
  api/verifications/                     GET history, GET/PATCH one record

components/
  layout/AppShell.tsx                    chrome
  verification/                          NewVerificationFlow, BatchVerificationFlow,
                                         VerificationModeSwitcher, results cards
  batch/BatchProgressPoller.tsx          2s router.refresh while in-flight

lib/
  schemas/                               Zod (application, extracted-label, batch-api,
                                         manifest, batch.schema)
  rules/                                 OCR targets, product rule sets, gov-warning text
  services/                              orchestrator, extraction (mock + Gemini),
                                         comparator runner, persistence, batch service,
                                         manifest parser/validator, async worker, recovery
  verification/                          pure comparators (brand, ABV, volume, warning,
                                         country, image quality, product-specific)
  observability/                         Braintrust tracer, scorers, cost & SLO helpers
  image-preprocess.ts                    sharp pipeline

prisma/                                  VerificationRecord, Batch, BatchSubmission

data/samples/                            mock-mode scenarios + sample manifests (CSV + JSON)

evals/                                   fixture-driven eval harness

instrumentation.ts                       Next.js boot hook (batch recovery sweep)

docs/
  architecture.md
  assumptions-and-limitations.md
  pre-research-decisions.md
  requirements-map.md
  roadmap.md
  bugs.md
  specs/                                 per-phase + per-bug specs

tests/                                   Vitest
tests-e2e/                               Playwright
```

---

## License

Prototype only. Not affiliated with the U.S. Department of the Treasury or the Alcohol and Tobacco Tax and Trade Bureau. No labels are submitted to COLAs Online from this tool.

Patterns adopted with attribution from the open-source [`fsyeddev/ttb-label`](https://github.com/fsyeddev/ttb-label) prototype (spec template, retry policy, bug-tracker structure) — itemized in `docs/roadmap.md` under "Patterns adopted".

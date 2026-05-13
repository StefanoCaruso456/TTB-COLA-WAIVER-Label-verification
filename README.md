# TTB LabelCheck AI

AI-assisted alcohol label verification prototype, inspired by the TTB COLAs
Online workflow.

A compliance reviewer can:

1. Pick a product type (wine / domestic sake / distilled spirits / malt beverage).
2. Enter COLA-style application data.
3. Upload one or more label images (up to 10).
4. Run an AI extraction + deterministic field-level verification.
5. See a human-reviewable report with per-field match / mismatch / missing /
   needs-review statuses.
6. Save every verification as an audit record.

This prototype **assists** human reviewers. It does not auto-approve labels,
replace legal judgment, or integrate with COLAs Online. See
[`docs/assumptions-and-limitations.md`](docs/assumptions-and-limitations.md).

## Stack

- Next.js 16 (App Router) · TypeScript · Tailwind v4
- Zod schemas for application + extracted-label validation
- Prisma + Postgres for verification history
- `@google/genai` for Gemini-powered OCR/vision extraction
- Plain TypeScript orchestration (no LangChain / LangGraph in MVP — see
  [`docs/pre-research-decisions.md`](docs/pre-research-decisions.md))
- Vitest for deterministic-logic tests

## Architecture

```
UI form (App Router)
  → POST /api/verify
    → verification-orchestrator
        → Zod-validate application + images
        → label-extraction service (mock | Gemini)
        → commodity-router (user selection is source of truth)
        → verification.service (deterministic comparators)
        → verification-record.service (Prisma → Postgres)
    → returns { recordId, report }
```

Full picture: [`docs/architecture.md`](docs/architecture.md).

## Getting started

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env — at minimum, USE_MOCK_EXTRACTION=true is enough to demo without Gemini.

# 3. Generate Prisma client (also runs as part of `npm run build`)
npm run prisma:generate

# 4. If you have a Postgres database, run migrations
npm run prisma:migrate:dev

# 5. Run dev server
npm run dev
# http://localhost:3000
```

The app works **without** a Gemini key as long as `USE_MOCK_EXTRACTION=true`.
The mock extractor returns deterministic, scenario-driven extraction data so
you can demo verifications and load sample cases without external calls.

The app also works **without** Postgres — the home page will surface a
"Database not configured" notice, and saving to history will fail, but you can
still run verifications from `/new` and see reports.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Railway or local). Required for persistence. |
| `GEMINI_API_KEY` | Gemini API key. Required only when `USE_MOCK_EXTRACTION` is not `true`. |
| `USE_MOCK_EXTRACTION` | `true` forces the mock extractor; otherwise Gemini is used (falling back to mock if no key). |
| `GEMINI_MODEL` | Gemini model id (default `gemini-2.5-flash`). |
| `MAX_LABEL_IMAGES` | Upper bound on images per verification (default 10). |
| `PRISMA_MOCK` | `true` swaps the Prisma client for an in-memory store (non-production only). Used by `npm run test:smoke` and `npm run test:e2e`. |

## Sample scenarios

The `/new` page exposes "Try a sample scenario" buttons. Each sample drives
the mock extractor through a known case:

- **Wine — clean pass**: domestic Cabernet that should pass automated checks.
- **Wine — ABV mismatch**: extracted ABV diverges from the application.
- **Spirits — clean pass**: bourbon with same-field-of-vision review flag.
- **Spirits — missing government warning**: triggers an error-level missing warning check.
- **Malt — clean pass**: lager with ingredient disclosure handling.
- **Imported wine — missing country of origin**: imported product where the label is missing its origin statement.

Sample JSON lives in [`data/samples/`](data/samples).

## Testing

Three layers, none of which need Postgres or a Gemini key:

```bash
# 1. Unit + API integration (Vitest)
npm test

# 2. Live HTTP smoke (boots `next dev` with PRISMA_MOCK + USE_MOCK_EXTRACTION)
npm run test:smoke

# 3. Browser E2E (Playwright; one-time Chromium install)
npm run test:e2e:install
npm run test:e2e
```

What each layer covers:

- **`npm test`** — deterministic comparators (`normalizeText`, `similarity`,
  `compareBrand`, `compareAlcoholContent`, `compareVolumes`,
  `compareGovernmentWarning`, `compareCountryOfOrigin`), `resolveCommodityIntent`,
  Zod cross-field validation, end-to-end `verifyApplication` against the mock
  extractor for every sample scenario, the batch orchestrator with bounded
  concurrency, **and** the API routes themselves (`/api/verify`,
  `/api/verify/batch`, `/api/verifications`, `/api/verifications/[id]`) with a
  mocked Prisma store. ~76 tests, runs in seconds.
- **`npm run test:smoke`** — boots a real Next.js dev server with
  `PRISMA_MOCK=true USE_MOCK_EXTRACTION=true`, then hits every public route
  and asserts response shapes. Useful when Playwright's Chromium can't be
  downloaded (firewalled CI, sandboxes).
- **`npm run test:e2e`** — Playwright specs for `/`, `/new`, `/batch`,
  `/verification/[id]` driving the rendered UI. Requires `chromium` via
  `npm run test:e2e:install` (`~150MB`).

The whole thing is wrapped in the `e2e-test` agent skill — invoke it via
`/e2e-test` to run the suites in order and get a single pass/fail summary.

### PRISMA_MOCK

Set `PRISMA_MOCK=true` in non-production environments to swap the real
Prisma client for an in-memory store. Useful for demos and the test suites.
The toggle is ignored when `NODE_ENV=production`.

## Verification status model

Per check: `status ∈ {match, likely_match, mismatch, missing, not_applicable,
needs_review}`, `severity ∈ {info, warning, error}`, `automationLevel ∈
{automated, partially_automated, human_review_required}`.

Overall report status:

- **fail** — any error-level missing/mismatch on a critical required field.
- **needs_review** — any warning, likely_match, image-quality flag, or
  human-review-required check.
- **pass** — every required check matched.

## Deploying to Railway

1. Create a new Railway project.
2. Add a **Postgres** plugin. Railway exposes `DATABASE_URL` automatically.
3. Deploy the repo as a service. Set env vars:
   - `GEMINI_API_KEY` (or leave blank with `USE_MOCK_EXTRACTION=true`)
   - `USE_MOCK_EXTRACTION=true` for guaranteed demo reliability
4. Railway will run `npm run build`, which executes `prisma generate`
   followed by `next build`. Migrations can be applied with
   `npm run prisma:migrate` as a release/predeploy step (or once manually).
5. Open the deployed URL → `/` for the dashboard, `/new` to run a
   verification.

## Project layout

```
app/                          Next.js App Router pages + API routes
  api/verify                  POST → run verification
  api/verifications           GET → history
  api/verifications/[id]      GET / PATCH → single record
  new                         New verification flow
  verification/[id]           Saved report detail

components/                   Presentational React components
  layout/AppShell.tsx
  verification/...            Form, results, history components

lib/
  schemas/                    Zod schemas (application, extracted label, report, record)
  rules/                      OCR target maps, product rule sets, government warning text
  services/                   commodity-router, extraction services, orchestrator, verification, persistence
  verification/               Pure comparators (brand/abv/volume/warning/country/image quality + product-specific)

prisma/
  schema.prisma               VerificationRecord model

data/samples/                 JSON sample scenarios + loader

types/                        Public type re-exports inferred from Zod schemas

tests/                        Vitest unit + integration tests

docs/
  pre-research-decisions.md   Locked architectural decisions
  architecture.md             High-level diagram + trust boundaries
  requirements-map.md         Step → fields → OCR targets → rules mapping
  assumptions-and-limitations.md
```

## Agent skills

This repo bundles a few [open agent skills](https://skills.sh) that help
when iterating on the UI and on extensibility. Skills are checked in
under `.claude/skills/` (for Claude Code) and `.agents/skills/` (for
non-Claude agents). The exact source + version of each skill is pinned
in [`skills-lock.json`](skills-lock.json).

| Skill | Source | What it's for |
| --- | --- | --- |
| `find-skills` | `vercel-labs/skills` | Discover and install additional skills when the team needs new capabilities. |
| `frontend-design` | `anthropics/skills` | Distinctive, production-grade frontend design guidance when iterating on the new-verification UI. |
| `web-design-guidelines` | `vercel-labs/agent-skills` | Review UI code against Vercel's Web Interface Guidelines (accessibility, UX, layout). |
| `e2e-test` | (project-local) | Run all test layers (unit/API/smoke/Playwright) end-to-end and report a single pass/fail summary. |

Manage skills with the [Skills CLI](https://skills.sh):

```bash
npx skills list                        # what's installed
npx skills update -p                   # update project skills
npx skills add <owner/repo> -s <name>  # add another skill
```

Per-user permission grants (`.claude/settings.local.json`) are
gitignored — only shared skill content is tracked.

## Limitations

- **No COLAs integration.** Nothing is submitted to TTB from this tool.
- **No auto-approval.** Compliance/approval decisions are human-only.
- **Typography is out of automated scope.** Bold detection, font-size,
  same-field-of-vision, and exact layout positioning surface as
  `human_review_required` rather than auto-pass/auto-fail.
- **Image storage is metadata-only in MVP.** Binary content is processed in
  the request and not persisted as durable files.
- **Domestic sake reuses shared schema in MVP.** Wine-like optional fields
  are evaluated only when entered. A full sake-specific rule set is deferred.

## Future improvements

See [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md) for the
brief-aligned, prioritised plan. The bullets below are the longer speculative
list (not all driven by stakeholder requirements).

- Replace metadata-only image storage with S3-compatible object storage.
- Add LangGraph-based orchestration only if/when batch review,
  human-in-the-loop, or retry loops become first-class requirements.
- PDF / structured CSV export of the verification report.
- Multi-user auth + reviewer assignments.
- Real same-field-of-vision detection using bounding-box geometry.

## License

Prototype only. Not affiliated with the U.S. Department of the Treasury or
the Alcohol and Tobacco Tax and Trade Bureau.

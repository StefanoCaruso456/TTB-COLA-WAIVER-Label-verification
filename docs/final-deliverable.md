# Final Deliverable — TTB LabelCheck AI

Master document for hiring-manager review. One stop for **approach, tools, key decisions, and assumptions**. Other docs (`architecture.md`, `roadmap.md`, `specs/`, `bugs.md`, `traces/`) go deeper on individual surfaces.

---

## Approach

A linear, audit-able process — every step left a durable artifact in the repo.

1. **Read the brief carefully → understood the problem and goals.** The brief asked for a tool that's *accurate, fast, easy to operate, and honest about its limits*. Every downstream decision serves those four goals.
2. **Built a requirements checklist** from the brief — `docs/requirements-checklist.md`. Each requirement scored Met / Partial / Missed with the code reference that satisfies it. Living document; updated as features shipped.
3. **Ran a full pre-research pass before writing code** — `docs/pre-research-decisions.md`. Architecture decisions, library trade-offs, what to defer. Frozen at start; derived docs (`architecture.md`, `requirements-map.md`, `assumptions-and-limitations.md`) cite back to it.
4. **Sequenced the build as a roadmap** — `docs/roadmap.md`. Phases 0–8 with user stories per phase, engineer-facing spec tasks, and measurable outcomes (each spec has acceptance criteria + evals in the same PR).
5. **Configured agent skills before starting to code** so the assistant had clear direction in each domain — see the next section.
6. **Spec-first execution.** Every non-trivial change starts as a Draft spec in `docs/specs/`, moves to Approved before code, then to Done with merge ref. One PR per spec when reasonable. Every closed bug links the PRs that fixed it + the trace that confirmed it live.

---

## Skills configured for agent-assisted development

The development assistant (Claude Code) had a curated skill set configured in advance so each domain had the right helper available:

- **`frontend-design`** — production-grade UI scaffolding for the `/new`, `/batches/[id]`, and `/verification/*` pages.
- **`web-design-guidelines`** — accessibility + UX audits against established standards before shipping any UI surface.
- **`review`** — structured PR review pass on every non-trivial branch before opening the PR.
- **`security-review`** — security-only review pass on pending changes; especially relevant for the file-upload + manifest-parse paths.
- **`claude-api`** — Gemini / Anthropic SDK migration patterns, prompt-caching, and model-version transitions (used during the `@google/genai` 0.7 → 1.52 upgrade that fixed BUG-01).
- **`session-start-hook`** — bootstraps the dev environment on each new session so tests + linters run consistently across sessions.
- **`simplify`** — reuse / quality / efficiency pass on changed code; used periodically to catch over-abstraction early.
- **`init`** — generated the initial `CLAUDE.md` codebase guidance file that locks workflow conventions for every later session.
- **`find-skills`** — discoverability when a new gap appeared during development.

---

## Tools used

### Production stack

- **Next.js 16** (App Router, server-rendered pages + API routes)
- **React 19**
- **TypeScript** (strict mode end-to-end)
- **Zod** — schema validation; inferred types feed the whole pipeline
- **Prisma 5.22 + Postgres** — `VerificationRecord`, `Batch`, `BatchSubmission` models with migrations checked in
- **`@google/genai` 1.52** — Gemini SDK; replaced the silently-broken 0.7 that motivated BUG-01
- **`gemini-2.5-flash-lite`** — multimodal OCR / structured-output model (code default; production env override is the open item in BUG-02)
- **`sharp`** — image preprocessing (1280 px max edge, JPEG 85%)
- **Tailwind v4** (PostCSS plugin) — UI styling

### Infrastructure & operations

- **Railway** — production deploy + managed Postgres + persistent volume for file storage
- **Braintrust SDK** — end-to-end observability (parent + child spans, latency, cost, tokens, scoring metrics, `% under SLO` Monitor view)
- **GitHub** — source control, PR review, MCP integration for assistant-driven PR management

### Development workflow

- **Claude Code** — primary development assistant
- **GitHub MCP server** — issue / PR / review automation
- **Vitest 4** — unit + integration tests (284 currently passing)
- **Playwright 1.60** — E2E tests (`tests-e2e/`)
- **ESLint, Prettier** — lint + format
- **Prisma CLI** — migrations + studio

---

## Key decisions

1. **Deterministic comparators, not LLM judgments.** Every compliance call (`match / mismatch / missing / not_applicable / needs_review`) comes from a typed comparator in `lib/verification/`. The model only **extracts** what's visible on the label; the model never decides whether a label complies. Makes failures auditable and regressions findable in unit tests.

2. **Structured-output Gemini + strict Zod schema.** `responseMimeType: "application/json"` against `extractedLabelSchema`. Anything that doesn't match becomes a typed error with `finishReason` and a response prefix — operators see *why* extraction failed without redeploying.

3. **Thinking disabled on Gemini 2.5-flash.** A live incident showed `thoughtsTokens: 62 911`, pushing latency to ~4 min and cost to $0.16/call. The 0.7 SDK silently stripped `thinkingBudget`; upgrading to 1.52 made the field reach the API. Same model, ~30× faster, ~35× cheaper. Documented in `docs/bugs.md` (BUG-01 closed).

4. **Image preprocessing before Gemini.** `sharp` resizes to 1280 px max edge, JPEG 85%. ~85% payload reduction, ~3× latency improvement on large uploads. Toggleable via `IMAGE_PREPROCESS_ENABLED`.

5. **In-process async worker for batch.** Fire-and-forget Promise after the POST response; bounded concurrency; startup recovery requeues rows stranded by a process restart. Simpler than a separate worker service; sufficient for the prototype.

6. **Spec-first workflow.** Every non-trivial change starts Draft → Approved → Done. `docs/roadmap.md` defines the schedule; `docs/specs/` defines the contracts.

7. **End-to-end observability for free.** Braintrust spans on the orchestrator + Gemini call. Latency, cost, tokens, brand-match similarity, per-field coverage all logged. The Monitor view answers *"what % of calls are under 5s?"* without a separate metrics stack. No-op when `BRAINTRUST_API_KEY` is unset.

8. **Government-warning typography automated to Tier 1 + Tier 2.** Bold-prefix detection and relative font-size check (vs brand name) ship as part of PR #34 (`compare-warning-typography.ts`). Default severity `needs_review` until operator eval-calibrates Gemini's accuracy on real fixtures, then flips to `error` via env var. Tier 3 (absolute mm-size per 27 CFR 16.22) stays reviewer-side by design — the px → mm calibration gap is documented in `docs/research/2026-05-18-gov-warning-typography-enforcement.md`.

---

## Assumptions & limitations

Honest version in `docs/assumptions-and-limitations.md`. Highlights:

- **No COLAs integration.** Nothing is submitted to TTB from this tool.
- **No auto-approval.** Compliance decisions are human-only; the tool *assists* a reviewer.
- **5 s SLO currently missed by ~0.7 s.** Production traces (`docs/traces/`) measure 5.7 s Gemini call vs the 5 s budget. Root cause is a Railway env var (`GEMINI_MODEL=gemini-2.5-flash`) overriding the code's `gemini-2.5-flash-lite` default. One-variable fix; tracked as BUG-02; pending operator action.
- **Government-warning typography:** Tier 1 (bold prefix) + Tier 2 (relative size) automated as of PR #34; default to `needs_review` severity pending eval-calibration. Tier 3 (absolute mm-size per 27 CFR 16.22) is deliberately reviewer-side — requires physical-scale calibration the pipeline cannot do honestly.
- **In-process worker.** A process restart strands in-flight `processing` rows; startup recovery requeues them on next boot (≤10 min delay). A separate Railway worker service is the right long-term move.
- **Backpressure race.** Two concurrent POSTs can both pass the 500-row queue check. Acceptable for prototype; DB-side advisory lock is Phase 7.
- **Domestic sake reuses the wine schema.** Wine-like optional fields evaluated only when entered. A full sake-specific rule set is deferred.

---

## Where to read next

| You want to know… | Open |
| --- | --- |
| Whether the brief's requirements were met | `docs/requirements-checklist.md` |
| Why each architectural choice was made | `docs/pre-research-decisions.md` |
| The end-to-end system diagram + trust boundaries | `docs/architecture.md` |
| Schedule + status by phase + user stories | `docs/roadmap.md` |
| Per-feature contracts (Draft → Approved → Done) | `docs/specs/` |
| Open + closed bugs with traces and PR refs | `docs/bugs.md` |
| Live production traces with metric breakdowns | `docs/traces/` |
| Exhaustive list of caveats | `docs/assumptions-and-limitations.md` |

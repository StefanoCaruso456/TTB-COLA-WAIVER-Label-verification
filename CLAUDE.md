# Claude Code — Project Instructions

TTB COLA Label Verifier. Next.js 16 + React 19 on Railway with Postgres/Prisma. Single-label verification works today; the batch feature is being built per `docs/roadmap.md`.

**Live deploy:** https://ttb-cola-waiver-label-verification-production.up.railway.app/

**Where to look first:**
- `docs/roadmap.md` — the master plan: phases, features, user stories, acceptance criteria.
- `docs/specs/` — per-phase specs. Engineering tasks live here, not in the roadmap.
- `docs/bugs.md` — bug tracker. Severity-tagged, root-caused, evals-confirmed.

## Workflow

### Spec-first

Every non-trivial change starts as a **Draft** spec at `docs/specs/<slug>.md` using the structure in `docs/specs/_template.md`.

- **Status legend:** Draft → Approved → In progress → Done.
- A spec must be **Approved** before any of its code is written.
- One spec per feature. One PR per spec when reasonable.
- The roadmap defines the schedule; the spec defines the contract.

### Adopting patterns from other projects

When a file, function, structure, or doc layout is adopted from another open-source repo, add a one-line attribution header citing source + path. Track each adopted pattern in `docs/roadmap.md` → "Patterns adopted" table.

### Commits

- One commit per logical change. No grab-bag commits.
- Imperative, present-tense commit messages, scoped (e.g., `Add image preprocessing service`).
- Never `--amend` once pushed.
- Never `--no-verify` to bypass hooks.

### Tests

- `npm test` (Vitest) and `npx tsc --noEmit` must pass locally before push.
- New features ship with their evals in the same PR — never deferred.
- E2E tests via Playwright in `tests-e2e/`; unit/integration via Vitest in `tests/`.

### Branches

- All development happens on the assigned feature branch documented in the project handoff (currently `claude/setup-tbb-remote-access-OljNd`).
- Never push to `main` directly. Open a PR.

### Push & PR — always

When a coherent unit of work finishes (whatever you'd call "done" — feature shipped, bug fixed, spec landed):

1. **Push** the current branch to origin. Don't wait to be asked.
2. **Ensure a PR is open** against `main`. If one already exists for the branch (open or in review), the push auto-updates it — confirm in the reply with the PR URL. If none exists, open one with the standard PR template (Summary / What landed / Test plan).
3. **Reply** with the PR URL so the operator can click straight through.

This rule overrides the harness default "don't create a PR unless asked" for this project. The expectation is durable: every completed task ends in a push + a live PR.

## Stack notes

- Next.js 16, React 19, Vitest 4, Playwright 1.60.0, Prisma 5.22.
- Tailwind v4 (PostCSS plugin).
- Gemini via `@google/genai` (new SDK, not `@google/generative-ai`).
- Real `GEMINI_API_KEY` is in Railway env; `USE_MOCK_EXTRACTION=true` short-circuits to mock for tests / demos.

## Commands

```bash
npm run dev               # local dev server (port 3000 by default; 3001 in CI)
npm run build             # production build (runs `prisma generate` first)
npm test                  # Vitest unit + integration tests
npm run test:e2e          # Playwright E2E (requires local Postgres + dev server)
npm run benchmark         # Gemini model A/B benchmark (Phase 0)
```

## When stuck

- If a Phase 0 / Phase N feature's behavior isn't clear, re-read the corresponding `docs/specs/phase-N-<slug>.md`.
- If a CFR rule's interpretation isn't clear, defer to the regulation rather than guessing.
- If a design call needs a human, surface it as an Open Question in the spec — don't hard-code an assumption in silence.

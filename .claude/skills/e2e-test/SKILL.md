---
name: e2e-test
description: End-to-end verification of the TTB LabelCheck AI prototype. Runs deterministic unit tests, API-level integration tests (mocked Prisma), Playwright browser specs when Chromium is installed, and a curl-based smoke fallback when it isn't. Use when the user asks to "run all tests", "verify the app works", "smoke test", "prove the features work end to end", or before pushing a release-candidate branch.
metadata:
  author: ttb-labelcheck-ai
  version: "1.0.0"
---

# E2E Test Skill

Proves every feature of the TTB LabelCheck AI app actually works — from
deterministic comparators up through the rendered pages — without relying
on any external service (Postgres or Gemini).

## What this skill verifies

| Layer | Suite | Command | External deps |
| --- | --- | --- | --- |
| Pure logic | Vitest unit tests | `npm test` (includes deterministic + orchestrator suites) | None |
| HTTP / orchestrator wiring | Vitest API integration | `npm test` (includes `tests/e2e/*.test.ts`) | Prisma mocked in-process |
| Rendered UI | Playwright `tests/e2e/browser/*.spec.ts` | `npm run test:e2e` | Chromium binary |
| Live HTTP smoke | `scripts/e2e-smoke.mjs` | `npm run test:smoke` | None — boots `next dev` with `PRISMA_MOCK=true USE_MOCK_EXTRACTION=true` |

`PRISMA_MOCK` and `USE_MOCK_EXTRACTION` together let the entire app run with
in-memory persistence and the deterministic mock OCR scenarios, so the suites
exercise the same code paths as production but stay hermetic.

## How an agent should run this

Execute in this order. **Stop and report on the first failure.**

1. **Unit + API integration** (always runs)
   ```bash
   npm test
   ```
   Expected: every `Test Files` and `Tests` count is green. The output should
   include both `tests/*.test.ts` and `tests/e2e/api-*.test.ts`.

2. **Live HTTP smoke** (always safe to run — no browser needed)
   ```bash
   npm run test:smoke
   ```
   Expected output ends with `[smoke] N/N checks passed`. The script boots
   `next dev` on port 3110, hits `/`, `/new`, `/batch`, `POST /api/verify`,
   `POST /api/verify/batch`, `GET/PATCH /api/verifications/[id]`, asserts the
   response shapes, and tears the server down.

3. **Browser E2E** (if Chromium is installable)
   ```bash
   npm run test:e2e:install   # one-time; downloads ~150MB
   npm run test:e2e
   ```
   Expected: every `tests/e2e/browser/*.spec.ts` passes. The Playwright config
   boots `next dev` with `PRISMA_MOCK=true USE_MOCK_EXTRACTION=true` so the
   browser flows exercise real persistence with no Postgres needed.

   If `playwright install chromium` fails because the network blocks
   `cdn.playwright.dev`, **don't escalate** — the smoke script from step 2 is
   the supported fallback for restricted environments. Report this explicitly:
   *"Playwright browser unavailable in this environment; smoke covered the
   same surface area via HTTP."*

## Reporting format

After running, output a short summary:

```
Unit + API:    PASS (N/N)
HTTP smoke:    PASS (N/N) — durationS
Browser E2E:   PASS (N/N)   OR   SKIPPED (Chromium unavailable)
```

If any step fails, paste the relevant ~15 lines of test output and stop —
**do not** try to "fix" a failing test from inside this skill unless the
user explicitly asks.

## When to extend

- Add a new sample scenario → add the corresponding API+smoke assertions in
  `tests/e2e/api-verify.test.ts` and `scripts/e2e-smoke.mjs`.
- Add a new page → add a Playwright spec under `tests/e2e/browser/` and a
  `getHTML(path)` check in the smoke script.
- Add a new API route → mock its Prisma dependency in
  `tests/e2e/_helpers/mock-prisma.ts`, add tests in `tests/e2e/`, and a smoke
  check in `scripts/e2e-smoke.mjs`.

## Hard rules

- Never run these tests against a real Postgres or a real Gemini key — the
  point is hermetic verification.
- `PRISMA_MOCK` is rejected in `NODE_ENV=production`. Don't change that.
- Don't add `--no-verify` or skip hooks to make tests pass; fix the test or
  the code.

# Feature Spec — Phase 1: Eval Infrastructure

**Status:** Done — implementation shipped; see `docs/roadmap.md` Phase 1 row and `README.md` "Features shipped" table.
**Owner:** Stefano
**Last updated:** 2026-05-16

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label) with attribution. See `docs/specs/_template.md`.

## Goal

Build a fixture-based eval runner that drives the existing single-label `/api/verify` pipeline at scale (10+ cases) and runs against any deployed URL. This is the test harness that, in later phases, will load-test the batch path. It also satisfies one of the original 7-item batch requirements ("tested with 50–100 labels") **for the single-label path**, since the same harness will be reused.

## Scope

**In scope:**
- A directory of categorized fixtures at `evals/fixtures/generated/`, each one a `<id>.json` file describing one test case.
- A `manifest.json` listing every fixture with its category and expected behavior.
- A runner script `scripts/run-fixture-evals.ts` that POSTs each fixture to `/api/verify` and asserts category-level expectations on the response.
- `npm run eval:quick` — one fixture per category (~30 seconds, mock-only).
- `npm run eval:full` — all fixtures (target: under 5 minutes).
- CI integration: `eval:quick` runs in the existing `e2e` job after Playwright.
- 10 mock-mode fixtures spanning 6 categories (counts in "Approach" below).

**Out of scope:**
- Real-image fixtures driving real Gemini calls. Default is zero real fixtures (see Open Question Q1). They can be added later without changing the runner.
- Batch-mode driving — the runner targets `/api/verify`, not `/api/batches` (which doesn't exist yet). The batch-mode extension is a Phase 7 deliverable.
- Eval result caching across runs (deferred — would belong to Phase 7 hardening).
- A web UI for browsing eval results.
- Any change to comparator logic, schemas, or routes.

## Approach

### File map (new + modified)

| Path | Status | Purpose |
|---|---|---|
| `evals/fixtures/generated/manifest.json` | New | Array of all fixtures with `id`, `category`, `description`, `expectations`. |
| `evals/fixtures/generated/<id>.json` | New × 10 | One per fixture: `application` (full `ColaApplication`), `mockScenario?`, `images?` (default: 1× 1px stub). |
| `scripts/run-fixture-evals.ts` | New | Runner. Flags: `--url=<base>`, `--only=<id,id>`, `--verbose`, `--quick`. |
| `lib/evals/judge.ts` | New | Pure function `judge(actual: VerificationReport, expectations: Expectations) → { ok, reasons }`. Unit-tested. |
| `lib/evals/expectations.schema.ts` | New | Zod schema for the `expectations` object so manifests are validated at load time. |
| `package.json` | Modified | Add `eval:quick` and `eval:full` scripts. |
| `.github/workflows/ci.yml` | Modified | Add `npm run eval:quick` step to the `e2e` job. |
| `tests/judge.test.ts` | New | Unit tests for the judge function. |
| `README.md` | Modified | Brief section on running evals. |

### Categories (adapted to our verdict model)

Our `overallStatus` enum is `pass | needs_review | fail`. The system intentionally always returns at least `needs_review` for any submission because `shared.warningStyle` is hard-coded as `human_review_required` (see `lib/services/verification.service.ts:271-284`). Categories reflect that.

| # | Slug | Meaning | Expected `overallStatus` |
|---|---|---|---|
| 1 | `01-happy` | All comparators match; only human-review checks fire. | `needs_review` (because of warningStyle / same-field-of-vision) |
| 2 | `02-mismatch` | One or more comparators have an intentional mismatch. | `fail` or `needs_review` (depends on severity) |
| 3 | `03-missing-mandatory` | Government warning absent or empty. | `fail` |
| 4 | `04-commodity-conflict` | Inferred product type disagrees with selected at high confidence. | `needs_review` |
| 5 | `05-image-quality` | Poor readability / multiple high risks. | `needs_review` |
| 6 | `06-imported-missing-origin` | `sourceOfProduct=imported` but no `countryOfOrigin` extracted. | `fail` |

### Fixture set (10 fixtures)

| ID | Category | Description | Mock scenario | Commodity |
|---|---|---|---|---|
| `01-happy-wine` | 1 | Wine clean pass (Cypress Hills). | _(none)_ | wine |
| `01-happy-spirits` | 1 | Distilled spirits clean pass (Wildwood Bourbon). | _(none)_ | distilled_spirits |
| `01-happy-malt` | 1 | Malt beverage clean pass (Hopforth Lager). | _(none)_ | malt_beverage |
| `02-mismatch-abv-wine` | 2 | Wine with ABV mismatch. | `abv-mismatch` | wine |
| `02-mismatch-brand-wine` | 2 | Wine with brand typo. | `brand-typo` | wine |
| `02-mismatch-warning-case` | 2 | Title-case "Government Warning" prefix. | `warning-title-case` | wine |
| `03-missing-warning-spirits` | 3 | Spirits with missing government warning. | `missing-warning` | distilled_spirits |
| `04-commodity-conflict-wine` | 4 | Selected wine but inferred distilled_spirits at 0.86 confidence. | `commodity-conflict` | wine |
| `05-image-quality-poor-wine` | 5 | Wine with high blur and poor readability. | `image-quality-poor` | wine |
| `06-imported-missing-origin-wine` | 6 | Imported wine with no country extracted. | `imported-missing-origin` | wine |

### Manifest entry shape (Zod-validated)

```ts
interface ManifestEntry {
  id: string;                          // unique, kebab-case
  category: 1 | 2 | 3 | 4 | 5 | 6;
  description: string;                  // 1 sentence
  fixtureFile: string;                  // relative to evals/fixtures/generated/
  expectations: {
    overallStatus: Array<"pass" | "needs_review" | "fail">;  // any of these is acceptable
    minFailingChecks?: number;          // ≥ N checks with status in {fail, missing, mismatch}
    maxFailingChecks?: number;
    mustHaveFieldStatus?: Array<{       // a specific check must have this status
      fieldKey: string;
      status: "match" | "likely_match" | "mismatch" | "missing" | "needs_review" | "not_applicable";
    }>;
    mustHaveCommodityConflict?: boolean;
  };
}
```

### Fixture file shape

```ts
interface FixtureFile {
  id: string;
  description: string;
  application: ColaApplication;
  mockScenario?: string;
  // Optional override; defaults to a single 1x1 PNG stub.
  images?: Array<Omit<LabelImagePayload, "base64"> & { base64?: string }>;
}
```

The runner builds the POST body from these, injecting a stub `base64` for any image entry that lacks one. The mock extractor ignores image content; pre-processing is skipped when `mockScenario` is set (already wired in Phase 0).

### Judge function

```ts
// lib/evals/judge.ts
export interface JudgeResult {
  ok: boolean;
  reasons: string[];
}

export function judge(
  actual: VerificationReport,
  expectations: ManifestEntry["expectations"],
): JudgeResult;
```

Logic:
1. If `actual.overallStatus` not in `expectations.overallStatus`: append a reason.
2. Count `fail`-like statuses (`fail` | `missing` | `mismatch`); compare to `minFailingChecks` / `maxFailingChecks`.
3. For each `mustHaveFieldStatus` entry: find the check by `fieldKey`; if not present OR status doesn't match, append a reason.
4. If `expectations.mustHaveCommodityConflict === true` and `actual.commodityIntent.conflictDetected !== true`: append a reason.
5. `ok = reasons.length === 0`.

### Runner behavior

1. Parse CLI flags. Default `--url=http://localhost:3001`.
2. Load `manifest.json` and Zod-validate every entry. Fail fast on malformed manifest.
3. Apply filters: `--only=<id,id>` overrides `--quick`; `--quick` picks one fixture per category (lowest id-string per category).
4. For each fixture in order:
   - Load fixture JSON.
   - Build POST body: `{ clientName?, applicantName?, productName?, application, images: [stub-if-missing], mockScenario }`.
   - POST to `${baseURL}/api/verify`. Capture HTTP status, body, and round-trip duration.
   - Run `judge(response.report, manifestEntry.expectations)`.
   - Print `[id] <description (50ch)> ✓ <overallStatus> <Nms>` or `[id] <description> ✗ <reason; reason; reason>`.
   - If `--verbose`, also dump the failing checks' fieldKey + status + reason.
5. End-of-run summary: total time, pass/fail counts, per-category breakdown when any failed.
6. Exit code: `0` if all pass, `1` if any fail, `2` on infrastructure errors (manifest missing, server unreachable, etc.).

### npm scripts

```json
"eval:quick": "tsx scripts/run-fixture-evals.ts --quick",
"eval:full":  "tsx scripts/run-fixture-evals.ts"
```

Both require a running dev server. The CI workflow starts one inside the `e2e` job before Playwright; the eval step reuses the same instance.

### CI integration

In `.github/workflows/ci.yml` under `e2e`, append a step after `npm run test:e2e`:

```yaml
- name: Eval quick sweep
  run: npm run eval:quick -- --url=http://localhost:3001
  env:
    USE_MOCK_EXTRACTION: "true"
```

The Playwright `webServer` config already starts `npm run dev` on port 3001; the eval reuses it. If Playwright's webServer cleanup runs before our step, we'll need a separate `start-server-and-test` invocation — call out if observed in CI.

## Engineering tasks

1. **Manifest + fixtures**
   1. Create directory `evals/fixtures/generated/`.
   2. Write 10 `<id>.json` fixture files matching the table above.
   3. Write `manifest.json` listing all 10 with expectations.
   4. Each fixture's `application` is a full valid `ColaApplication` that passes `colaApplicationSchema`.
2. **Schemas + judge**
   1. Create `lib/evals/expectations.schema.ts` exporting `manifestEntrySchema` and `fixtureFileSchema`.
   2. Create `lib/evals/judge.ts` exporting `judge`.
3. **Runner**
   1. Create `scripts/run-fixture-evals.ts` with the flags described above.
   2. Use `node:fs` to load manifests; `fetch` for HTTP; ESM-friendly imports (`tsx`).
   3. Match cola-verify's output style (per-line `[id] desc … ✓/✗ overallStatus Nms`).
4. **npm scripts**
   1. Add `eval:quick` and `eval:full` to `package.json`.
5. **CI**
   1. Add an `Eval quick sweep` step to the `e2e` job after Playwright.
6. **Tests**
   1. `tests/judge.test.ts` — at least 6 unit tests covering: overallStatus accept-list, min/max failing checks, mustHaveFieldStatus pass + miss, mustHaveCommodityConflict.
   2. Existing test suite (70 cases) must still pass.
7. **Docs**
   1. Add a "Running evals" section to `README.md` linking to this spec.

## Acceptance criteria

- [ ] `evals/fixtures/generated/manifest.json` lists exactly 10 fixtures across the 6 categories.
- [ ] Every fixture JSON validates against `fixtureFileSchema` and its `application` validates against `colaApplicationSchema`.
- [ ] `npm run eval:quick` exits 0 against `http://localhost:3001` with the dev server running and `USE_MOCK_EXTRACTION=true`.
- [ ] `npm run eval:full` exits 0 in under 5 minutes locally.
- [ ] `--url=<deployed-url>` works without code change.
- [ ] `--only=02-mismatch-abv-wine,03-missing-warning-spirits` runs only those two fixtures.
- [ ] Failure output names which fixture, which category, and the specific reason (no need for `--verbose` to identify what failed).
- [ ] `tests/judge.test.ts` covers the 6 unit cases described in Engineering tasks.
- [ ] `npm test` continues to pass (existing 70 + new judge tests).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` succeeds.
- [ ] CI's `e2e` job runs `eval:quick` and fails the job on a fixture regression.

## Evals

The runner itself is the eval. Unit-test coverage:

- `tests/judge.test.ts`:
  - `accepts_when_overall_status_matches`
  - `fails_when_overall_status_not_in_accept_list`
  - `enforces_min_failing_checks`
  - `enforces_max_failing_checks`
  - `accepts_mustHaveFieldStatus_when_present_and_matches`
  - `fails_mustHaveFieldStatus_when_missing_or_wrong`
  - `accepts_mustHaveCommodityConflict_when_true`
  - `fails_mustHaveCommodityConflict_when_not_true`

## Open questions

- **Q1: Real-image fixtures — include any?** Lean: **no for v1**. The runner is extensible; real-image fixtures can be added later as `evals/fixtures/real/<id>.json` + corresponding `<id>.png`. Real Gemini calls would cost ~$0.0001 each and would not run in CI. Rationale: keep CI free and fast; add real fixtures only if mock fixtures stop catching regressions.
- **Q2: Should the runner reset DB state between fixtures?** Lean: **no for v1**. Each fixture's `/api/verify` POST creates a `VerificationRecord` row. After a full sweep the DB has ~10 extra rows, which is fine. If we ever need a clean slate, we can add `--reset-db` later. Rationale: DB writes are not part of what we're asserting; cleanup adds infra without value.
- **Q3: Output format — keep cola-verify's `[id] desc … ✓` lines or use vitest reporter?** Lean: **cola-verify style**. Looks tidy in CI logs; clearly distinguishable from vitest output. Rationale: this is a sweep tool, not a test framework.
- **Q4: Should `eval:quick` fail-fast on first error, or continue and show full results?** Lean: **continue**. Engineer wants to see the full picture in one run. Rationale: matches `vitest` default behavior.

## Risks

- **Dev server slow to start in CI.** → Mitigation: Playwright's webServer waits up to 120s. If eval step beats it, add a quick `curl` health-check loop before the eval invocation.
- **Mock scenario drift.** A scenario name in a fixture must match the switch case in `mock-label-extraction.service.ts`. Drift breaks fixtures silently. → Mitigation: in the runner, after loading each fixture, if `mockScenario` is set, validate it against a `KNOWN_MOCK_SCENARIOS` constant exported from the mock service.
- **Fixture rot when schemas change.** → Mitigation: Zod-validate every fixture's `application` against `colaApplicationSchema` at load time; CI fails clearly when a schema change breaks a fixture.
- **The harness becomes a hidden second test framework competing with vitest.** → Mitigation: keep its scope narrow (driving `/api/verify` at scale, no unit-level assertions); use vitest for unit tests of the judge itself.

## Manual prerequisites

| What | When | Why |
|---|---|---|
| **Approve this spec** | **Before any code is written** | Spec-first rule. |
| (Optional) Provide any real label images you want as fixtures | After spec approval, optional | Default is mock-only. Real images cost ~$0.0001 per call. Can add later. |
| Confirm Phase 0 (PR #6) is merged or accept stacking | At PR time | Phase 1 stacks on Phase 0; if PR #6 isn't merged, PR #7 will include both phases' commits. |

## Notes

- Pattern adopted from `fsyeddev/ttb-label/scripts/run-fixture-evals.ts` with attribution (per `docs/roadmap.md` AD-006).
- The fixture categories here differ from cola-verify's because his verdict enum is `PASS / REVIEW / FAIL` while ours adds `pass | needs_review | fail` plus the always-on `warningStyle` human-review check that prevents pure-PASS verdicts.
- After this spec is Approved and the implementation lands, mark Phase 1 acceptance complete in `docs/roadmap.md` (the same way Phase 0 was marked).

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written.

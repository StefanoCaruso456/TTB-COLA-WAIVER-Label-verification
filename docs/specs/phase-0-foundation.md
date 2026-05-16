# Feature Spec — Phase 0: Foundation

**Status:** Approved
**Owner:** Stefano
**Last updated:** 2026-05-16

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label) with attribution. See `docs/specs/_template.md`.

## Goal

Install engineering process discipline (spec workflow, bug tracker) and harden the existing single-label verification pipeline with per-call optimizations (image preprocessing, timings, retry-on-503) before any batch work begins. This phase ships **no new product features** for the end user beyond a faster single-label verification; its real deliverables are observability and process.

## Scope

**In scope:**
- Spec template (`docs/specs/_template.md`) — already created in this PR.
- Workflow rule documented in `CLAUDE.md` at the repo root.
- Bug tracker (`docs/bugs.md`) with severity legend and section structure.
- Image preprocessing: server-side resize to ≤1280px max edge, JPEG re-encode at quality 85, via `sharp`.
- Per-phase server timings: typed `AnalysisTimings` returned in every `/api/verify` response; client logs `console.table`.
- Gemini 503 retry wrapper: 2 retries on `[5000, 10000]` ms delays, non-503 errors not retried.
- Model benchmark script (`scripts/model-benchmark.ts`) usable for empirical model selection.
- Unit tests for every new module.

**Out of scope:**
- Any batch feature (Phase 2+).
- Any eval fixture infrastructure (Phase 1).
- Compliance advisory engine (deferred — see roadmap "Out of scope").
- UI changes beyond the `console.table` log.
- Database / schema changes.
- New API endpoints — `/api/verify` stays. Response shape gets one new field (`timings`).

## Approach

### File map (new + modified)

| Path | Status | Purpose |
|---|---|---|
| `docs/specs/_template.md` | New (already in this PR) | Spec template, adopted from cola-verify. |
| `docs/specs/phase-0-foundation.md` | New (this file) | This spec. |
| `docs/bugs.md` | New | Bug tracker. Seeded with structure; no entries. |
| `CLAUDE.md` | New | Repo-root agent-instructions doc. Workflow section + commit conventions. |
| `lib/services/image-preprocess.ts` | New | `preprocessImage(buffer: Buffer): Promise<PreprocessResult>`. |
| `lib/services/gemini-label-extraction.service.ts` | Modified | Wrap `client.models.generateContent` with `callWithRetryOn503`. Export `GEMINI_503_RETRY_DELAYS_MS`. |
| `lib/services/verification-orchestrator.ts` | Modified | Optionally preprocess images before passing to extraction service (env-gated). |
| `types/verification.ts` | Modified | Add `AnalysisTimings` interface; extend `VerificationReport` or `AnalysisResponse` to carry timings. |
| `app/api/verify/route.ts` | Modified | Instrument with `Date.now()` markers between phases; include `timings` in response. |
| `components/verification/NewVerificationFlow.tsx` | Modified | After successful POST, `console.groupCollapsed` + `console.table` the timings. |
| `scripts/model-benchmark.ts` | New | CLI: `--models=<a,b>`, `--cases=<id,id>`, optional `--save`. Hits real Gemini. |
| `package.json` | Modified | Add `sharp` dep, `npm run benchmark` script. |
| `tests/image-preprocess.test.ts` | New | Resize correctness, aspect preservation, JPEG output, size reduction. |
| `tests/gemini-retry.test.ts` | New | 6 cases (see Evals). |
| `tests/image-preprocess-pipeline.test.ts` | New | Orchestrator end-to-end with mock extractor: large input gets preprocessed. |

### Workflow rule (in `CLAUDE.md`)

```
## Workflow

Spec-first:
- Every non-trivial change starts as a Draft spec at `docs/specs/<slug>.md`.
- A spec must be **Approved** before any of its code is written.
- Status legend: Draft → Approved → In progress → Done.
- One spec per feature. One PR per spec when reasonable.

Adopting patterns from other projects:
- When a file, function, or doc structure is adopted from another repo,
  add a one-line attribution header citing source + commit/path.

Commits:
- One commit per logical change.
- Commit messages: imperative, present-tense, scoped (e.g., "Add image preprocessing service").
- Never `--amend` once pushed.
- Never `--no-verify` to bypass hooks.

Tests:
- `npm test` and `npx tsc --noEmit` must pass locally before push.
- New features ship with their evals in the same PR.

Branches:
- All development goes to the assigned feature branch documented in the project handoff.
```

### Bug tracker structure (in `docs/bugs.md`)

Sections (in this order):

1. **Severity legend** — 🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Low.
2. **Open bugs** — one entry per bug. Entry shape: severity, ID, title, case observed, symptom, why it matters, suspected area, fix scope, status.
3. **Closed bugs** — moved entries with resolution, evals added, commit hash that closed it.
4. **Fixture quality issues** — for bad fixtures (not product bugs).
5. **Eval infrastructure issues** — for runner / instrumentation gaps.
6. **Triage notes** — patterns observed, suggested ordering.

Pattern adopted from `fsyeddev/ttb-label/docs/bugs.md`. Seeded with structure and severity legend; no entries.

### Image preprocessing module

```ts
// lib/services/image-preprocess.ts

import sharp from 'sharp';

// Gemini's effective vision resolution is ~1024–1568px on the longest edge.
// 1280px is a comfortable ceiling that keeps detail while cutting typical
// phone-photo payloads ~85%. Reference: fsyeddev/ttb-label.
const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 85;

export interface PreprocessResult {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  originalWidth: number;
  originalHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  originalSizeKB: number;
  resizedSizeKB: number;
}

export async function preprocessImage(input: Buffer): Promise<PreprocessResult>;
```

Behavior:
- If longest edge > 1280px: resize down preserving aspect ratio, with `withoutEnlargement: true`.
- Always re-encode as JPEG at quality 85 (no PNG/WebP output).
- Throw a typed error if `sharp` fails to read the buffer (caller surfaces a 400).

Wire-in: optional, env-gated via `IMAGE_PREPROCESS_ENABLED` (default `true`). The orchestrator decodes each `LabelImagePayload.base64`, preprocesses, re-encodes to base64 + sets `mimeType: 'image/jpeg'` before calling the extraction service. Mock service ignores preprocessing.

### Per-phase server timings

```ts
// types/verification.ts (extend)

export interface AnalysisTimings {
  formParseMs: number;
  imageDecodeMs: number;
  imagePreprocessMs: number;
  geminiExtractionMs: number;
  validationMs: number;
  totalServerMs: number;
  imageSizeKB: number;       // first image
  resizedSizeKB: number;     // first image after preprocess
}
```

The existing `/api/verify` response gains an optional `timings: AnalysisTimings` field. The client (`NewVerificationFlow.tsx`) logs them inside a collapsed group:

```ts
console.groupCollapsed(`[verify] ${fileName} — ${totalMs}ms`);
console.table({ 'form parse (server)': { ms: t.formParseMs }, ... });
console.groupEnd();
```

Skipped silently when running under Node (e.g., Playwright) where `window` is undefined.

### Retry-on-503

```ts
// lib/services/gemini-label-extraction.service.ts (extend)

export const GEMINI_503_RETRY_DELAYS_MS = [5000, 10000] as const;

function is503Error(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; message?: unknown };
  if (e.status === 503) return true;
  if (typeof e.message === 'string' && /\b503\b/.test(e.message)) return true;
  return false;
}

async function callWithRetryOn503<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!is503Error(err) || attempt >= GEMINI_503_RETRY_DELAYS_MS.length) throw err;
      const delayMs = GEMINI_503_RETRY_DELAYS_MS[attempt];
      console.warn(`[gemini] 503 — retrying in ${delayMs}ms (attempt ${attempt + 1}/${GEMINI_503_RETRY_DELAYS_MS.length})`);
      await new Promise((r) => setTimeout(r, delayMs));
      attempt++;
    }
  }
}
```

Wired around `this.client.models.generateContent({...})` inside `GeminiLabelExtractionService.extract`. The retry wrapper is a free function (not a class method) so it's trivially testable.

### Model benchmark script

```
npm run benchmark -- \
  --models=gemini-2.5-flash,gemini-2.5-flash-lite \
  --cases=wine-clean-pass,wine-abv-mismatch,spirits-missing-warning \
  [--save]
```

Loads cases from `data/samples/` (already in repo). For each (model, case) pair, runs extraction → comparators → verdict. Captures latency, verdict, error type. Outputs:
- Summary table (per-model: correct count, avg/p50 latency, error count, 503 count).
- Cross-model matrix (per-case row × per-model column).
- Optional `--save` writes `benchmark-<timestamp>.json`.

Cost: real Gemini calls. Approx $0.0001 per call. Default run (2 models × 3 cases = 6 calls) ≈ $0.0006.

## Engineering tasks

1. **Spec workflow + bug tracker (docs only)**
   1. Spec template already exists at `docs/specs/_template.md` (this PR).
   2. This file (`phase-0-foundation.md`) already exists (this PR).
   3. Create `CLAUDE.md` at repo root with the Workflow section above plus a one-line repo summary and links to `docs/roadmap.md`.
   4. Create `docs/bugs.md` seeded with severity legend + empty sections per structure above. Cite `fsyeddev/ttb-label/docs/bugs.md` in the header.

2. **Image preprocessing**
   1. `npm install sharp@^0.34.5` (matches cola-verify version; latest 0.3x is fine).
   2. Verify `nixpacks.toml` / Railway build picks up `sharp` native binary. If first Railway deploy fails on native libs, add `nixpacks.toml` with `nixPkgs = ["...nodejs_22...", "vips"]`. Flag in PR description.
   3. Create `lib/services/image-preprocess.ts` with the signature above.
   4. Wire into `lib/services/verification-orchestrator.ts`:
      - After `getExtractionService()`, before `extractionService.extract`, iterate `input.images` and call `preprocessImage` per image whose `base64` exists.
      - Replace each image's `base64` and `mimeType` with the preprocessed result.
      - Skip if env var `IMAGE_PREPROCESS_ENABLED` is `"false"` (default on).
      - Skip when running under the mock extraction service (already gated by env in tests).
   5. Add `IMAGE_PREPROCESS_ENABLED=true` to `.env.example`.

3. **Per-phase timings**
   1. Add `AnalysisTimings` interface to `types/verification.ts`.
   2. Extend the response shape in `app/api/verify/route.ts` to include `timings`. Update Zod / TypeScript types if there's a response schema.
   3. Instrument `app/api/verify/route.ts` with `Date.now()` markers around: form parse, image decode (base64 → Buffer), image preprocess, extraction, validation. Sum to `totalServerMs`. Capture first image's `imageSizeKB` and `resizedSizeKB`.
   4. Update `components/verification/NewVerificationFlow.tsx`:
      - After receiving a successful response, if `json.timings` exists AND `typeof window !== 'undefined'`, log `console.groupCollapsed` + `console.table`.
      - No `eslint-disable` needed unless the project's ESLint config flags `console.table`. Check.

4. **Retry-on-503**
   1. Add `GEMINI_503_RETRY_DELAYS_MS`, `is503Error`, `callWithRetryOn503` to `lib/services/gemini-label-extraction.service.ts`.
   2. Wrap `this.client.models.generateContent({...})` with `callWithRetryOn503(() => ...)`.
   3. Export `GEMINI_503_RETRY_DELAYS_MS` for testability.
   4. Ensure non-503 errors still bubble up wrapped in `GeminiExtractionError`.

5. **Model benchmark**
   1. Create `scripts/model-benchmark.ts`.
   2. Parse `--models`, `--cases`, `--save` flags from `process.argv`.
   3. Reuse `getSampleScenarios()` from `data/samples/` for case definitions.
   4. For each (model, case): instantiate `GeminiLabelExtractionService` with the model id; call `extract`; run `verifyApplication`; capture verdict + timing + error type.
   5. Print summary + matrix tables to stdout. Optional `--save` writes JSON.
   6. Add `"benchmark": "tsx --env-file=.env scripts/model-benchmark.ts"` to `package.json`. Verify `tsx` is available (may need `npm install -D tsx`).

6. **Tests**
   1. `tests/image-preprocess.test.ts` — see Evals.
   2. `tests/gemini-retry.test.ts` — see Evals.
   3. `tests/image-preprocess-pipeline.test.ts` — see Evals.

## Acceptance criteria

- [ ] `docs/specs/_template.md` exists.
- [ ] `docs/specs/phase-0-foundation.md` is marked **Approved** in this PR before any code lands.
- [ ] `CLAUDE.md` exists at repo root with Workflow section.
- [ ] `docs/bugs.md` exists with severity legend + section structure, zero open entries.
- [ ] `sharp` is a runtime dependency in `package.json`.
- [ ] A 4 MB JPEG uploaded via `/new` produces `timings.resizedSizeKB` that is < 25% of `timings.imageSizeKB`.
- [ ] API response on `/api/verify` includes a `timings` object with all 8 fields populated and numeric.
- [ ] Browser devtools shows a `[verify] <filename> — Nms` collapsed group containing a console.table of phase timings.
- [ ] Tests cover the retry path: 1× retry success, 2× retry success, exhaustion, no-retry-on-non-503, message-text fallback detection, no-retry on success.
- [ ] `npm run benchmark -- --models=gemini-2.5-flash,gemini-2.5-flash-lite --cases=wine-clean-pass,wine-abv-mismatch` prints summary + matrix tables in under 2 minutes.
- [ ] `npm test` passes (existing 51 tests + new retry, preprocess, pipeline tests).
- [ ] `npx tsc --noEmit` is clean.
- [ ] `npm run build` succeeds.
- [ ] Railway deploy succeeds with `sharp` (manually confirmed by Stefano).
- [ ] Roadmap (`docs/roadmap.md`) Phase 0 acceptance section gets all boxes checked.

## Evals

- `tests/image-preprocess.test.ts`:
  - `resizes_4000px_to_1280px` — input 4000×3000, output longest edge = 1280, aspect ratio preserved within 1px.
  - `preserves_under_1280px` — input 800×600 untouched in dimensions (still re-encoded JPEG).
  - `output_is_jpeg` — `mimeType === 'image/jpeg'` regardless of input format.
  - `output_smaller_than_input_for_large_jpeg` — 4 MB+ JPEG → output strictly smaller bytes.
  - `throws_on_invalid_buffer` — random bytes → typed error.

- `tests/gemini-retry.test.ts`:
  - `succeeds_first_try` — fn resolves once → returns value, zero waits.
  - `succeeds_after_1_retry` — fn throws 503 once then resolves → returns value, 1 wait at 5000ms (verified via `vi.useFakeTimers`).
  - `succeeds_after_2_retries` — fn throws 503 twice then resolves → returns value, 2 waits at 5000+10000ms.
  - `fails_after_exhaustion` — fn throws 503 three times → throws the 3rd 503, total 2 retries.
  - `does_not_retry_non_503` — fn throws 500 → throws immediately, zero waits.
  - `detects_503_in_message_text` — fn throws `Error('Service Unavailable: 503')` → retries.

- `tests/image-preprocess-pipeline.test.ts`:
  - `orchestrator_preprocesses_before_extraction` — mock extractor records what it received; assertion confirms image was resized.
  - `orchestrator_skips_preprocess_when_env_disabled` — same setup with `IMAGE_PREPROCESS_ENABLED=false` → extractor receives original buffer dimensions.

## Open questions

- **Q: Should preprocessing happen for the mock extractor too?**
  Lean: **no**. The mock doesn't see images; gating off when the mock is active avoids the sharp import cost in test runs. Rationale: nothing downstream cares about the buffer when mock is used.
- **Q: Where does the timing for `validationMs` end — before or after Prisma persistence?**
  Lean: **before persistence**. `validationMs` measures comparators only; persistence is excluded. Add a separate `persistenceMs` if it becomes interesting later. Rationale: comparators are CPU; persistence is I/O. Mixing them obscures both.
- **Q: Should the retry log line be `console.warn` or structured (pino)?**
  Lean: **`console.warn` for now**. Structured logging arrives in Phase 7. Rationale: don't introduce pino just for one log line.
- **Q: Do we benchmark against real Gemini in CI?**
  Lean: **no**. CI stays mock-only. Benchmark runs locally on demand. Rationale: cost + flakiness.

## Risks

- **`sharp` native dependency may fail on Railway build.** Mitigation: test-deploy this PR to a staging Railway environment first; if `libvips` is missing, add `nixpacks.toml` with `nixPkgs = ["nodejs_22", "vips"]`. Document the working config in `CLAUDE.md`.
- **Preprocessing adds latency for small images.** Mitigation: `sharp` is fast (~10–50ms on ≤1MB images). Worst-case adds 50ms; net win is large for >2MB images.
- **`console.table` may produce noisy logs in production.** Mitigation: it's gated on a successful response — only fires when the user actually verifies a label. Acceptable for a prototype.
- **Real Gemini retry tests are slow.** Mitigation: tests use `vi.useFakeTimers` so the 5000ms / 10000ms delays don't actually wait. Total retry suite runs in <1 second.
- **Benchmark script costs money.** Mitigation: default to 6 calls (~$0.0006). Document cost in script help output.

## Manual prerequisites

| What | When | Why |
|---|---|---|
| Approve this spec | **Before any code is written** | Spec-first rule. Without your approval signal, no implementation PR opens. |
| Confirm Railway build works with `sharp` | First deploy after implementation merges | `sharp` adds native libs; Railway should auto-include `libvips` but needs verification. |
| Confirm `GEMINI_API_KEY` is set in Railway env | Already confirmed (roadmap AD-010) | Needed for the benchmark to run real Gemini. |
| Approve attribution wording in `CLAUDE.md` and `docs/bugs.md` | At spec review | One-line "Adopted from fsyeddev/ttb-label" header on each. |

## Notes

- Patterns adopted from cola-verify with attribution (per AD-006 in `docs/roadmap.md`):
  - Spec template structure → `docs/specs/_template.md`.
  - Bug tracker shape → `docs/bugs.md`.
  - Image preprocessing values (1280px / Q85) → `lib/services/image-preprocess.ts`.
  - 503 retry delays + wrapper structure → `lib/services/gemini-label-extraction.service.ts`.
- After this spec is Approved and the code PR lands, mark Phase 0 acceptance criteria complete in `docs/roadmap.md`.
- Phase 1 (eval infrastructure) is the natural next step and depends on nothing from Phase 0 except the bug tracker doc and spec workflow.

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written.

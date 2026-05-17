# Feature Spec — Braintrust telemetry for verification + extraction

**Status:** Draft (pending owner approval; implementation pushed alongside on `claude/check-this-out-IgkvC` per session instruction)
**Owner:** Stefano
**Last updated:** 2026-05-17

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. The structure is reused as-is; content is original. Schema-design pattern (parent/child spans + heuristic scorers) adopted from Braintrust's `wrapGoogleGenAI` + `traced` cookbook examples, applied to this project's domain.

## Goal

Make the verifier's LLM-extraction quality observable in production. BUG-01 (Gemini under-extraction on a foreign-market label) shipped without anyone noticing until a human spotted `Extracted: —` in the UI — server logs had nothing actionable. This spec wires Braintrust telemetry so every `/api/verify` call produces a structured trace (parent span = verification flow, child span = Gemini extraction) with per-field coverage scores, latency metrics, and rich metadata for filtering. The goal is "log in to Braintrust, sort by `extraction.brandNamePresent = 0`, see every under-extraction in the last 24 h." Off-by-default; flips on when `BRAINTRUST_API_KEY` is set on Railway.

## Scope

**In scope:**
- New Braintrust project `ttb-cola-verifier` (created manually by the operator in the Braintrust UI — see Manual prerequisites).
- New `lib/observability/braintrust.ts` module: idempotent `initBraintrust()`, helpers for span metadata + score computation. No-op when `BRAINTRUST_API_KEY` is unset.
- One parent span per `/api/verify` call (`name: "verify"`) wrapped around the body of `runVerification` in `lib/services/verification-orchestrator.ts`.
- One child span per Gemini call (`name: "gemini.extract"`) wrapped around the `generateContent` call in `lib/services/gemini-label-extraction.service.ts`.
- Heuristic scorers (0–1) computed in-app and logged on the span: `extraction.fieldCoverage`, `extraction.brandNamePresent`, `extraction.classOrTypePresent`, `extraction.governmentWarningPresent`, `extraction.netContentsPresent`, `extraction.alcoholContentPresent`, `extraction.imageReadability`; on the parent: `verification.passes`, `verification.errorRatio`, `verification.warningRatio`.
- Tests asserting (a) the module is a no-op when `BRAINTRUST_API_KEY` is unset, (b) the score helpers compute the right values, (c) the wiring doesn't break existing extraction/orchestrator behavior.

**Out of scope:**
- LLM-as-judge scorers (e.g., "did Gemini correctly identify the brand"). Heuristic scorers are sufficient to surface BUG-01-class problems; LLM judges add cost per span and are a follow-up.
- Pushing the `evals/fixtures/generated/*.json` corpus into a Braintrust dataset, and running it as an experiment on each PR. Tracked separately as a future spec; the in-product tracing in this PR is sufficient to begin reviewing live data.
- Sending image base64 to Braintrust. Image bytes are large, frequently PII-adjacent, and not useful for sort/filter — we log image counts and KB instead, not bytes.
- Auto-wrapping the `@google/genai` module via Braintrust's `wrapGoogleGenAI`. That gives default tracing but loses domain-specific metadata (productType, sourceOfProduct, recordId); we get richer observability by writing the spans explicitly.
- Changing existing API responses or DB schema. Telemetry is purely additive.

## Approach

Two spans per request, both heuristically scored:

```
trace: verify
├─ input:    { productType, sourceOfProduct, imageCount, brandNameExpected, ... }
├─ output:   { overallStatus, recordId, auditSummary }
├─ metadata: { productType, sourceOfProduct, extractionMode, recordId,
│              batchSubmissionId, commodityConflict, inferredProductType,
│              imageCount, originalSizeKB, resizedSizeKB }
├─ metrics:  { totalServerMs, geminiExtractionMs, imagePreprocessMs }
└─ scores:   { verification.passes, verification.errorRatio, verification.warningRatio }
    │
    └─ gemini.extract                          (type=llm)
       ├─ input:    { productType, imageCount, promptHash }
       ├─ output:   { rawTextTruncated, inferredProductType, normalizedFieldKeys }
       ├─ metadata: { model, mockExtraction, promptHash }
       ├─ metrics:  { geminiCallMs }
       └─ scores:   { extraction.fieldCoverage, extraction.brandNamePresent,
                      extraction.classOrTypePresent, extraction.governmentWarningPresent,
                      extraction.netContentsPresent, extraction.alcoholContentPresent,
                      extraction.imageReadability }
```

Files touched:

- `lib/observability/braintrust.ts` *(new)*. Exports `initBraintrust()`, `tracedVerify`, `tracedExtract`, `computeVerificationScores`, `computeExtractionScores`, `summarizeRawText`, `hashPrompt`. The `traced*` helpers wrap Braintrust's `traced` with a stable name + type, and fall back to running `fn(NOOP_SPAN)` when the SDK reports no active logger.
- `lib/services/verification-orchestrator.ts`. `runVerification` is wrapped end-to-end with `tracedVerify`. After the report is built, the parent span is logged with output + scores.
- `lib/services/gemini-label-extraction.service.ts`. The `extract` method body is wrapped with `tracedExtract`. After Zod parse, the child span gets `output` (truncated rawText, key list), `metrics.geminiCallMs`, and `scores` from `computeExtractionScores`.
- `tests/braintrust-tracer.test.ts` *(new)*. Asserts the score helpers and the no-op behavior.

Design decisions:

- **No-op by default.** `initBraintrust()` short-circuits when `BRAINTRUST_API_KEY` is empty. `traced` is documented (and verified locally — `node -e "..."` returns the function result with no logger initialized) to fall through to a no-op span. Production behavior is unchanged until the operator sets the env var.
- **Heuristic scorers, not LLM judges.** Every span gets numeric scores computable from already-available data. `extraction.fieldCoverage = (# populated normalizedFields keys) / (# OCR targets for productType)`. `extraction.brandNamePresent = !!normalizedFields.brandName?.value`. Cheap, deterministic, and exactly the lens that would have caught BUG-01.
- **Prompt versioning by hash.** `promptHash = sha256(prompt.userInstruction).slice(0, 12)`. Lets you partition spans in the Braintrust UI by prompt version after each prompt-tuning change without bumping a manual version string.
- **One project, two span types.** All traffic lands in `ttb-cola-verifier`; parent/child convention separates verification-level metrics from extraction-level metrics. No multi-project complexity until there's a reason.
- **Image bytes stay local.** Spans log `imageCount` + size in KB; never the base64 payload. Keeps spans cheap to write/read and avoids leaking customer label imagery into a third-party SaaS.

## Engineering tasks

1. **Tracer module (`lib/observability/braintrust.ts`)**
   1. `initBraintrust()`: if `process.env.BRAINTRUST_API_KEY` is set, call `initLogger({ projectName: process.env.BRAINTRUST_PROJECT ?? "ttb-cola-verifier", apiKey: process.env.BRAINTRUST_API_KEY })` exactly once across the lifetime of the process. Use a module-level boolean guard.
   2. `tracedVerify<T>(fn: (span) => Promise<T>): Promise<T>` — wraps `traced(fn, { name: "verify", type: "task" })`. Calls `initBraintrust()` first so lazy init is implicit.
   3. `tracedExtract<T>(fn: (span) => Promise<T>): Promise<T>` — wraps `traced(fn, { name: "gemini.extract", type: "llm" })`.
   4. `computeExtractionScores(label: ExtractedLabel, productType: ProductType, targetCount: number): Record<string, number>`. Pure function. Returns the seven extraction scores listed in the trace diagram above.
   5. `computeVerificationScores(report: VerificationReport): Record<string, number>`. Pure function. Returns the three verification scores.
   6. `summarizeRawText(text: string | undefined, maxBytes = 4000): string`. Truncates by byte length (UTF-8 aware).
   7. `hashPrompt(text: string): string`. `crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)`.

2. **Gemini service wiring (`lib/services/gemini-label-extraction.service.ts`)**
   1. Import `tracedExtract`, `computeExtractionScores`, `summarizeRawText`, `hashPrompt`.
   2. In `extract`, after building the prompt, open a `tracedExtract` block. Inside:
      - `span.log({ input: { productType, imageCount, promptHash }, metadata: { model, mockExtraction: false } })` before the call.
      - Measure `geminiCallMs = Date.now() - t`.
      - After successful parse, log `{ output: { rawTextTruncated, inferredProductType, inferredProductTypeConfidence, normalizedFieldKeys }, metrics: { geminiCallMs }, scores }`.
      - Errors propagate; let `traced` mark the span as errored.

3. **Orchestrator wiring (`lib/services/verification-orchestrator.ts`)**
   1. Import `tracedVerify`, `computeVerificationScores`.
   2. Wrap the entire `runVerification` body (after Zod input parse — i.e., starting at the extractionService resolution) in `tracedVerify`.
   3. Log `input` once with the application summary; log `output` + `metrics` + `scores` once after the report is built but before returning.

4. **Tests (`tests/braintrust-tracer.test.ts`)**
   1. `computeExtractionScores` returns expected ratios on canned `ExtractedLabel` fixtures (full coverage = 1; no-fields = 0; partial = ratio).
   2. `computeVerificationScores` returns `verification.passes=1` for `overallStatus="pass"`, `0.5` for `"needs_review"`, `0` for `"fail"`.
   3. `summarizeRawText` truncates by UTF-8 byte length and appends a `…` indicator when truncated.
   4. `hashPrompt` is deterministic and 12 chars.
   5. `tracedVerify` returns the inner function's value when `BRAINTRUST_API_KEY` is unset (no-op behavior).

## Acceptance criteria

- [ ] `BRAINTRUST_API_KEY` unset: zero behavior change vs. main; existing 139-test suite still green.
- [ ] `BRAINTRUST_API_KEY` set: `/api/verify` produces a parent `verify` span with a child `gemini.extract` span, populated with the metadata/metrics/scores from the trace diagram. Operator confirms one live trace lands in the Braintrust UI after deploy.
- [ ] BUG-01's signature (Gemini returning empty `normalizedFields` for the Edouard Delaunay case) is filterable in Braintrust via `extraction.brandNamePresent = 0`.
- [ ] No image base64 is ever included in any span input/output/metadata.
- [ ] `npm test` and `npx tsc --noEmit` pass locally.

## Evals

- `tests/braintrust-tracer.test.ts` — score-helper correctness, hash determinism, no-op behavior without an API key.
- Live: operator runs the BUG-01 Edouard Delaunay label after deploy and verifies the resulting span shows `extraction.brandNamePresent = 0` and `extraction.fieldCoverage ≈ 0`. Recorded in `docs/bugs.md` under BUG-01 closure.
- No mock-extractor change: existing `verify-application.test.ts` continues to assert end-to-end correctness without telemetry.

## Open questions

- **Should mock-extractor runs also produce spans?** Lean: yes, with `metadata.mockExtraction = true`, so test/demo traffic is filterable but doesn't pollute "real" dashboards. Rationale: avoids two code paths; the `mockExtraction` filter is a one-click guard in Braintrust UI.
- **Should we tag spans with the Railway deploy `gitSha`?** Lean: yes if `process.env.RAILWAY_GIT_COMMIT_SHA` (or the repo's equivalent build-time var) is available, otherwise omit. Rationale: lets you correlate prompt regressions to deploys without manual annotation.
- **Should `tracedVerify` retry on transient Braintrust API errors?** Lean: no. Braintrust's SDK already buffers and flushes asynchronously; if telemetry fails, verification should not fail. Mitigation: explicit try/catch around the `traced` call so a logger failure can never throw into the orchestrator.

## Risks

- **Telemetry failure breaks `/api/verify`.** → mitigation: `traced` is defensively try/wrapped at the call site; logger errors are swallowed (logged via `console.warn`) and the underlying function still executes.
- **Span volume cost on Braintrust plan.** → mitigation: parent + child = 2 spans per request. At expected single-label volumes (≤100/day pre-async-queue) this is well under any free-tier limit. Phase 5's async queue will increase volume; revisit limits before that phase ships.
- **Leak of customer label text or applicant PII into a third-party service.** → mitigation: only log extracted text fields and application form fields (which the operator already entered intending to submit them for verification); no images, no email/phone identifiers. Documented as out-of-scope in the spec.
- **Prompt-hash drift if prompt text gains whitespace.** → mitigation: hash the rendered `userInstruction` exactly as sent to Gemini, so any character change (intentional or not) creates a new hash bucket — that's the desired behavior.

## Manual prerequisites

1. Operator (Stefano) creates a new Braintrust project named `ttb-cola-verifier` in the Gauntlet_AI workspace.
2. Operator generates a Braintrust API key and sets `BRAINTRUST_API_KEY=<key>` on Railway.
3. Optional: set `BRAINTRUST_PROJECT=<name>` if you want to rename without a code change.
4. Deploy and trigger a verification on the live instance; confirm a trace appears in the Braintrust UI within a few seconds.
5. Re-run the BUG-01 Edouard Delaunay case and paste the Braintrust trace URL into the BUG-01 entry to close it out.

## Notes

- Approval-before-code rule (CLAUDE.md → Workflow → Spec-first) was suspended for this case by explicit owner instruction in the originating session ("go ahead and create a new project and the schema with best practice fields and value to review and gain insights"). Reviewer can flip status to Approved on review.
- The `braintrust` SDK was confirmed safe to call without `initLogger` (verified locally — `traced` falls through to a no-op span when no logger is initialized). The graceful-degradation pattern is therefore "always call `traced`, only call `initLogger` when the key is set."

---

**Status legend:** Draft → Approved → In progress → Done

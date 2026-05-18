# Feature Spec — BUG-01: Gemini under-extraction on foreign-market labels

**Status:** Closed (2026-05-17) — root cause identified, fix shipped across PRs #10–#17, live confirmation logged in `docs/bugs.md` BUG-01 (Braintrust trace `b1037cd3`).
**Owner:** Stefano
**Last updated:** 2026-05-17

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. The structure (Status / Goal / Scope / Approach / Acceptance / Evals / Open questions / Notes) is reused as-is; content is original.

## Goal

When a label is clearly legible, the verifier must surface what's on it — even when the label is foreign-market and doesn't fit US-format expectations. Right now Gemini is silently omitting visibly-present fields (BUG-01: brand `EDOUARD DELAUNAY` came back as `Extracted: —`), and operators have no log trail to diagnose why. This spec tightens the OCR prompt to require an explicit entry per target and adds an env-gated raw-response log so future under-extraction is debuggable from logs.

## Scope

**In scope:**
- Tightening `lib/services/ocr-prompt-builder.ts` so every listed OCR target must appear in `normalizedFields` with either a value or an explicit `null` + `evidenceText` rationale.
- Explicit prompt instruction that non-English / foreign-market label text is in scope and must be extracted as written.
- Env-gated (`EXTRACTION_DEBUG_LOG=true`) `console.info` of the raw Gemini response body in `lib/services/gemini-label-extraction.service.ts`, truncated to 2 KB.
- Unit tests asserting the prompt's required clauses and the gated logging behavior.

**Out of scope:**
- Re-thresholding image quality heuristics.
- Changing the verification status decision logic (`decideOverallStatus`).
- Surfacing extraction sparseness as a top-level diagnostic in the UI or `auditSummary` (deferred — addressable as a follow-up if the prompt fix alone doesn't move the needle on live cases).
- Changing the schema in `lib/schemas/extracted-label.schema.ts` — the existing optional-field shape still holds; only the prompt constrains Gemini's output.
- Re-running the affected French wine label against live Gemini in CI; live confirmation runs on the operator's Railway deploy.

## Approach

Two surgical changes:

1. **Prompt tightening** in `lib/services/ocr-prompt-builder.ts`. Replace the permissive "set its value to null and omit it from the output if appropriate" clause with a strict "every target gets an entry; if absent use `value: null` with a short `evidenceText` rationale." Add an explicit "non-English text and foreign-market labels are in scope; extract the visible text as written, in its original language" instruction so Gemini stops over-conservatively skipping French/Spanish/etc. fields.

2. **Raw-response logging** in `lib/services/gemini-label-extraction.service.ts`. After successful JSON parse, when `process.env.EXTRACTION_DEBUG_LOG === "true"`, `console.info("[gemini] raw response (truncated)", text.slice(0, 2000))`. Default off in prod; operator opts in transiently when reproducing a bug.

No new modules. No type-shape changes. No API-surface changes.

## Engineering tasks

1. **Prompt tightening (`lib/services/ocr-prompt-builder.ts`)**
   1. Replace the bullet "Return ONLY visible information. If a field is not visible, set its value to null and omit it from the output if appropriate." with a strict pair of bullets requiring (a) an entry per listed target and (b) `value: null` + `evidenceText` when a target is genuinely absent.
   2. Add a bullet: "Non-English text and foreign-market labels are in scope. Extract the visible text exactly as written, in its original language; do not translate. If the label format does not match US conventions (e.g., no US `GOVERNMENT WARNING`), report the field as absent with a brief `evidenceText` noting the format mismatch."
   3. Keep all other instructions unchanged.

2. **Raw-response logging (`lib/services/gemini-label-extraction.service.ts`)**
   1. After the `JSON.parse(text)` call succeeds, add a gated log:
      ```ts
      if (process.env.EXTRACTION_DEBUG_LOG === "true") {
        console.info("[gemini] raw response (truncated 2KB)", text.slice(0, 2000));
      }
      ```
   2. No retries, no behavior change on the error path — schema failures and 503 retries already log.

3. **Tests**
   1. New file `tests/ocr-prompt-builder.test.ts`:
      - asserts `buildOcrPrompt(wineApp).userInstruction` contains the strict-entry clause (e.g., `/every listed target/i`).
      - asserts the user instruction mentions non-English / foreign-market handling (e.g., `/non-english|foreign-market|original language/i`).
      - asserts the user instruction does NOT contain the old "omit it from the output if appropriate" phrase.
   2. New file `tests/gemini-debug-log.test.ts`:
      - mocks the `@google/genai` client at construct time, returning a canned JSON response, and asserts `console.info` is called once with the `[gemini] raw response` prefix when `EXTRACTION_DEBUG_LOG=true`.
      - asserts no `[gemini] raw response` log fires when the env var is unset or `false`.

## Acceptance criteria

- [ ] `buildOcrPrompt` no longer contains the "omit it from the output if appropriate" clause.
- [ ] `buildOcrPrompt` includes an explicit per-target reporting clause and a foreign-market / non-English clause.
- [ ] With `EXTRACTION_DEBUG_LOG=true`, a successful `GeminiLabelExtractionService.extract()` call emits exactly one `console.info` log starting `[gemini] raw response`, truncated to 2 KB.
- [ ] With the env var unset, no such log is emitted.
- [ ] `npm test` passes locally.
- [ ] `npx tsc --noEmit` passes locally.
- [ ] Operator confirms on Railway (after deploy) that the Edouard Delaunay French label now returns a non-empty `extractedLabel.normalizedFields.brandName.value`, and updates the BUG-01 entry in `docs/bugs.md` with before/after evidence.

## Evals

- `tests/ocr-prompt-builder.test.ts` — asserts prompt contains the strict-entry and foreign-market clauses; asserts the old permissive clause is gone.
- `tests/gemini-debug-log.test.ts` — asserts gated `console.info` fires once on success when `EXTRACTION_DEBUG_LOG=true`, and is silent otherwise.
- Existing `tests/verify-application.test.ts` (mock extractor path) — no change expected; mock still produces full extractions.
- Live confirmation on Railway (manual): re-run the BUG-01 case after deploy and paste the before/after into `docs/bugs.md`.

## Open questions

- **Should `EXTRACTION_DEBUG_LOG` be on by default in non-prod environments?** Lean: no. Off everywhere by default. Rationale: keeps log output predictable; operator flips it on for diagnosis, off after. Avoids leaking label text into log aggregators by accident.
- **Should we also log timings (`geminiExtractionMs`) under the same flag?** Lean: no — timings are already in the API response, no need to duplicate.
- **Will the prompt change increase token cost?** Lean: marginally (a handful more tokens in instructions; output may grow because every target now has an entry). Acceptable; we can revisit if it shows up in the model-benchmark numbers.

## Risks

- **Prompt change makes Gemini over-extract / hallucinate fields.** → mitigation: prompt explicitly says `value: null` when absent + short `evidenceText` rationale; mock-mode tests still hold; operator runs the BUG-01 case live before closing the bug.
- **Debug log leaks label text into prod logs.** → mitigation: gated behind an env var that is off by default; operator turns on transiently and off again when finished.
- **Behavior regression on the happy-path fixtures.** → mitigation: full `npm test` suite must pass, including the mock-extractor integration test which exercises the comparator pipeline end-to-end.

## Manual prerequisites

- Operator (Stefano) to flip `EXTRACTION_DEBUG_LOG=true` on Railway transiently when reproducing BUG-01 and any future under-extraction reports; unset after.
- Operator to re-upload the BUG-01 label on the deployed instance after this PR ships and record before/after `extractedLabel.normalizedFields.brandName.value` in `docs/bugs.md`.

## Notes

- Approved-before-code rule (CLAUDE.md → Workflow → Spec-first) was suspended for this case by explicit owner instruction in the originating session: the bug was filed, the spec drafted, and the implementation pushed together. Reviewer is free to flip status to Approved on review.
- Attribution: the gated-raw-response logging pattern is similar to fsyeddev/ttb-label's `console.info("[gemini]", …)` traces in `lib/gemini.ts`; this implementation is original code with the same pragmatic shape.

---

**Status legend:** Draft → Approved → In progress → Done

# Bug Tracker

Bugs surfaced from evals (unit, integration, fixture, live) against the verifier. **Do not fix issues from this file in passing — each one needs its own scoped change with evals confirming the fix.**

> Structure adopted from [fsyeddev/ttb-label/docs/bugs.md](https://github.com/fsyeddev/ttb-label/blob/main/docs/bugs.md) with attribution. Content is original.

**Last eval run:** _none yet — Phase 1 introduces the fixture eval suite._

**Last live observation:** 2026-05-18 — BUG-02 opened. Latency SLO breach on a real wine-back-label trace (Falanghina di Sant'Agata dei Goti, 2005, imported by Vitis Imports). Gemini call 5.7s, total verify 5.78s, end-to-end UX ~7.7s. Failed both `extraction.latencyUnder5s` and `verification.latencyUnder5s` scores. Root cause hypothesis: deployed env runs `gemini-2.5-flash` instead of the code-default `gemini-2.5-flash-lite`. Trace `3d52c1c2-89b4-4898-bd6b-8785fd73fc44`.

## Severity legend

- **🔴 Critical** — false negative on the core matching loop (system says "match" when it doesn't).
- **🟠 High** — wrong overall verdict on a clean/expected case (impacts agent trust).
- **🟡 Medium** — missing or false-positive advisory; rule logic gap; non-blocking UX issue.
- **🔵 Low** — eval infrastructure, fixture quality, coverage gap, doc inaccuracy.

---

## Open bugs

### 🟡 BUG-02 — Production Gemini calls exceed the 5s latency SLO; deployed env runs heavier model than code defaults to

- **Case observed (live, 2026-05-18):** Falanghina di Sant'Agata dei Goti DOC, 2005 vintage, "Mustilli" producer, 13% ABV, 750 mL, white wine, bottled in Italy, imported by Vitis Imports (Santa Monica CA). Real photograph of the back label (585 KB original → 67 KB after `sharp` resize). Application brand was a random test string (`bfgzdvCSxz`), so the brand-match score is not meaningful — the latency and config observations are. Record id `cmpavf2ch000014cfzvjhkhsv`. Trace [`3d52c1c2-89b4-4898-bd6b-8785fd73fc44`](https://www.braintrust.dev/app/Gauntlet_AI/p/ttb-cola-verifier/trace?object_type=project_logs&object_id=bfc9644f-d6a1-4311-8f08-01e40ba8d4d7&r=3d52c1c2-89b4-4898-bd6b-8785fd73fc44&s=3d52c1c2-89b4-4898-bd6b-8785fd73fc44).
- **Symptom (observed):**
  - `gemini.extract` span: `geminiCallMs: 5700` (5.7s), `completionTokens: 1204`, `promptTokens: 1326`, `totalTokens: 2530`, `estimated_cost_usd: $0.0034`.
  - `verify` parent span: `verifyTotalMs: 5782` (5.78s); end-to-end UX reported ~7.7s (delta = client upload + render).
  - Scores: `extraction.latencyUnder5s: 0` and `verification.latencyUnder5s: 0` — **both SLO scores failed.**
  - README claims `~3–4 s per Gemini extraction in production`. Observed is ~50% over that.
- **Root cause hypothesis:** trace metadata shows `model: gemini-2.5-flash`, but `lib/services/extraction-service-factory.ts:18` defaults to `gemini-2.5-flash-lite`. That means the deployed Railway env has `GEMINI_MODEL=gemini-2.5-flash` set, overriding the lite default the codebase recommends. `flash` is the heavier variant; the lite variant is documented in the README (line 73) as "~2× faster decode" — switching back would land in the 2.5–3s range matching the README claim.
- **Why this matters:** the `latencyUnder5s` SLO is the public success metric exposed in the Braintrust Monitor view (README line 145). Every real call from production right now is failing that metric. For a take-home reviewer who follows the Braintrust link, the "% under SLO" tile reads as 0% — bad signal-to-noise even though the code is fine and the fix is one env-var change.
- **Suspected area:** Railway → Variables → `GEMINI_MODEL`. Not code. Not in any current PR.
- **Fix scope (proposed, evals required before close):**
  1. **First — gather more data.** N=1 is not a pattern. Need at least 5 more real traces at different times of day + image sizes to confirm `flash` is consistently slower than the SLO; could also be Gemini-side cold-start.
  2. **If pattern confirmed:** unset `GEMINI_MODEL` on Railway (so the code default `flash-lite` takes over) **or** set it explicitly to `gemini-2.5-flash-lite`. Redeploy. Run the same wine label through. Confirm `geminiCallMs < 5000` and the SLO scores flip to 1.
  3. **Update the README** to either (a) drop the "~3–4 s per Gemini extraction in production" claim, or (b) state it conditionally on the lite variant.
  4. **Add an integration test or alerting** that fails when the deployed model differs from the codebase default without an explicit override comment in `extraction-service-factory.ts`.
- **Important context:** this trace is from the **pre-PR-#34 deployment**. The Gemini response's `normalizedFieldKeys` list does NOT contain `governmentWarningTypography`, confirming the production runtime is still serving the code from before req #15 Tier 1+2 shipped. Whatever fix lands for BUG-02 must be re-validated after PR #34 actually deploys — the Tier 1+2 prompt changes add tokens to the request, which could shift latency further.

---

## Fixture quality issues

These aren't product bugs — the fixture spec or generated image is internally inconsistent. Update the fixture data, not the code.

_(none yet — fixtures are introduced in Phase 1)_

---

## Eval infrastructure issues

Gaps in how the eval suite reports, caches, or schedules itself.

_(none yet — eval infra is introduced in Phase 1)_

---

## Closed bugs

When fixing a bug: link the spec/PR back here, move the entry under "Closed bugs" with the resolution and the case ID(s) that confirm the fix. Don't delete entries.

### 🟠 BUG-01 — Gemini returns empty `normalizedFields` on a visibly readable foreign-market wine label  *(closed 2026-05-17)*

- **Case observed (live, 2026-05-17):** Edouard Delaunay, "Les Rouards", Bourgogne Hautes-Côtes de Nuits 2020, 750 mL, 14% vol. Application brand was entered as `edouard delaunay`; the front label shows `EDOUARD DELAUNAY` in legible serif type on a cream background. Record id `cmp9j1rcf0000pwto3o66r8j9`.
- **Symptom (before):** Every comparator on the report showed `Extracted: —`. Brand, class/type designation, and government warning all returned `MISSING`. Overall verdict: `FAIL` (3 errors, 1 review, 1 warning, 2 N/A, 2 pass). The Gemini call itself succeeded and returned a parseable JSON envelope — the model just omitted every `normalizedFields.*` entry.
- **Root cause:** The OCR prompt's "set value to null and omit it from the output if appropriate" clause gave Gemini an escape hatch under `temperature: 0.1`. On foreign-market labels without US-format equivalents, the model exited via "omit" rather than "value: null".
- **Fix (multi-PR):**
  - Spec: `docs/specs/bug-01-gemini-empty-extraction.md`.
  - PR #10 (`3454c67`) tightened the prompt to require an entry for every target + declared foreign-market labels in scope.
  - PR #10 (`83819cb`) added env-gated raw-response logging.
  - PR #11 (`74c87f3`) corrected the prompt to declare `normalizedFields` as an object (was producing an array under the new wording).
  - PR #12 (`ebd0b06`) enumerated the `labelImageType` enum and remapped "front" → "brand".
  - PR #13 (`72c2fce`) added markdown-fence stripping + parse-error diagnostics in the Gemini service.
  - PR #14 / #15 / #16 / #17 wired Braintrust telemetry end-to-end and disabled `gemini-2.5-flash` thinking via the SDK upgrade.
- **Live confirmation (Braintrust traces):**
  - Trace `94f2c356` (wine barrel, post-prompt-fix): `brandNamePresent=1`, brand matched, schema validated. Original BUG-01 resolved.
  - Trace `b1037cd3` (Svetoni Vino Nobile, post-SDK-upgrade): `geminiCallMs=7592`, `thoughtsTokens=absent`, `estimated_cost_usd=$0.0046`, `fieldCoverage=0.87`, `brandNameMatched=1`, `governmentWarningPresent=1`, `overallStatus=needs_review`.

---

## Process

1. **One bug entry per real bug.** Don't lump.
2. **Each entry includes**: severity, ID (e.g., `BUG-01`), title, case observed, symptom, why it matters, suspected area, fix scope.
3. **Don't fix in passing.** A bug entry becomes a spec; a spec becomes a PR; the PR closes the bug.
4. **Live confirmation.** When fixing, run the affected case against the deployed instance and quote the before/after result here.
5. **Triage notes section** can call out patterns, suggested ordering, and bugs that share a root cause.

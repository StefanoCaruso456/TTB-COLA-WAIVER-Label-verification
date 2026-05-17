# Bug Tracker

Bugs surfaced from evals (unit, integration, fixture, live) against the verifier. **Do not fix issues from this file in passing — each one needs its own scoped change with evals confirming the fix.**

> Structure adopted from [fsyeddev/ttb-label/docs/bugs.md](https://github.com/fsyeddev/ttb-label/blob/main/docs/bugs.md) with attribution. Content is original.

**Last eval run:** _none yet — Phase 1 introduces the fixture eval suite._

**Last live observation:** 2026-05-17 — BUG-01 closed after live confirmation. Latency / cost incident on `gemini-2.5-flash` (62k thoughtsTokens pushing calls to 237s and $0.16) found via Braintrust and fixed by `@google/genai` 0.7 → 1.52 upgrade in PR #17 (trace `b1037cd3`: 7.6s end-to-end, $0.0046/call, brandNameMatched=1).

## Severity legend

- **🔴 Critical** — false negative on the core matching loop (system says "match" when it doesn't).
- **🟠 High** — wrong overall verdict on a clean/expected case (impacts agent trust).
- **🟡 Medium** — missing or false-positive advisory; rule logic gap; non-blocking UX issue.
- **🔵 Low** — eval infrastructure, fixture quality, coverage gap, doc inaccuracy.

---

## Open bugs

_(none — see "Closed bugs" below.)_

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

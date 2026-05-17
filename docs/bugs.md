# Bug Tracker

Bugs surfaced from evals (unit, integration, fixture, live) against the verifier. **Do not fix issues from this file in passing — each one needs its own scoped change with evals confirming the fix.**

> Structure adopted from [fsyeddev/ttb-label/docs/bugs.md](https://github.com/fsyeddev/ttb-label/blob/main/docs/bugs.md) with attribution. Content is original.

**Last eval run:** _none yet — Phase 1 introduces the fixture eval suite._

**Last live observation:** 2026-05-17 — BUG-01 (Gemini under-extraction on a foreign-market wine label).

## Severity legend

- **🔴 Critical** — false negative on the core matching loop (system says "match" when it doesn't).
- **🟠 High** — wrong overall verdict on a clean/expected case (impacts agent trust).
- **🟡 Medium** — missing or false-positive advisory; rule logic gap; non-blocking UX issue.
- **🔵 Low** — eval infrastructure, fixture quality, coverage gap, doc inaccuracy.

---

## Open bugs

### 🟠 BUG-01 — Gemini returns empty `normalizedFields` on a visibly readable foreign-market wine label

- **Case observed (live, 2026-05-17):** Edouard Delaunay, "Les Rouards", Bourgogne Hautes-Côtes de Nuits 2020, 750 mL, 14% vol. Application brand was entered as `edouard delaunay`; the front label shows `EDOUARD DELAUNAY` in legible serif type on a cream background. Record id `cmp9j1rcf0000pwto3o66r8j9`.
- **Symptom:** Every comparator on the report shows `Extracted: —`. Brand, class/type designation, and government warning all return `MISSING`. Overall verdict: `FAIL` (3 errors, 1 review, 1 warning, 2 N/A, 2 pass). However, `commodityIntent.inferredProductType=wine` came back, so the Gemini call itself succeeded and returned a parseable JSON envelope — the model just omitted every `normalizedFields.*` entry.
- **Why it matters:** The verifier's job is "does the label say what the application says?" A `MISSING` on a clearly-readable brand name destroys reviewer trust and produces a `FAIL` for the wrong reason (under-extraction vs. a genuine label gap). Two of the three errors on this case (government warning, class/type) _are_ correct — this is a French-market label without US-mandated wording — but the brand `MISSING` is wrong and the user cannot distinguish "extractor under-performed" from "label genuinely lacks the field."
- **Suspected area:**
  - `lib/services/ocr-prompt-builder.ts:28` — the instruction "If a field is not visible, set its value to null **and omit it from the output if appropriate**" gives Gemini an escape hatch. Combined with `temperature: 0.1` and the schema's `.optional()` fields, the conservative path is to omit fields the model is uncertain how to slot (e.g., is `EDOUARD DELAUNAY` the brand, the producer, or the trade name?).
  - No raw-response logging in `lib/services/gemini-label-extraction.service.ts` — root-causing under-extraction live currently requires re-running the call with custom instrumentation.
- **Fix scope:** Spec `docs/specs/bug-01-gemini-empty-extraction.md`. Tighten the OCR prompt to require an explicit entry (value or null + evidenceText) for every listed target, clarify that non-English / foreign-market labels are in scope, and add an env-gated raw-response log so operators can diagnose future under-extraction from logs.

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

_(none yet)_

---

## Process

1. **One bug entry per real bug.** Don't lump.
2. **Each entry includes**: severity, ID (e.g., `BUG-01`), title, case observed, symptom, why it matters, suspected area, fix scope.
3. **Don't fix in passing.** A bug entry becomes a spec; a spec becomes a PR; the PR closes the bug.
4. **Live confirmation.** When fixing, run the affected case against the deployed instance and quote the before/after result here.
5. **Triage notes section** can call out patterns, suggested ordering, and bugs that share a root cause.

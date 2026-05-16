# Bug Tracker

Bugs surfaced from evals (unit, integration, fixture, live) against the verifier. **Do not fix issues from this file in passing — each one needs its own scoped change with evals confirming the fix.**

> Structure adopted from [fsyeddev/ttb-label/docs/bugs.md](https://github.com/fsyeddev/ttb-label/blob/main/docs/bugs.md) with attribution. Content is original.

**Last eval run:** _none yet — Phase 1 introduces the fixture eval suite._

## Severity legend

- **🔴 Critical** — false negative on the core matching loop (system says "match" when it doesn't).
- **🟠 High** — wrong overall verdict on a clean/expected case (impacts agent trust).
- **🟡 Medium** — missing or false-positive advisory; rule logic gap; non-blocking UX issue.
- **🔵 Low** — eval infrastructure, fixture quality, coverage gap, doc inaccuracy.

---

## Open bugs

_(none yet)_

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

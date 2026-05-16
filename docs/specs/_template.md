# Feature Spec — <Title>

**Status:** Draft
**Owner:** Stefano
**Last updated:** YYYY-MM-DD

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. The structure (Status / Goal / Scope / Approach / Acceptance / Evals / Open questions / Notes) is reused as-is; content is original.

## Goal

<1–2 sentences describing the user-visible problem this feature solves, or the engineering capability it enables. State the **why**, not the **how**.>

## Scope

**In scope:**
- ...

**Out of scope:**
- ...

## Approach

<Modules touched, data flow, new files, key design decisions. Reference existing modules by relative path (e.g., `lib/services/verification-orchestrator.ts`). Include type signatures or SQL fragments where they sharpen the contract. No full implementations — the spec is a contract, not the code.>

## Engineering tasks

<Numbered list of concrete tasks a senior engineer can execute without re-deriving design decisions. Each task names files, types, and tests. Group related sub-tasks under bold headings.>

1. **<topic>**
   1. ...
   2. ...
2. **<topic>**
   1. ...

## Acceptance criteria

<Checkboxes for the testable conditions that must all be true before the spec moves to Done. Aim for properties an external reviewer can confirm without reading the code.>

- [ ] ...
- [ ] ...

## Evals

<Concrete named test cases. Ship in the same PR as the feature — never deferred. Each entry: filename plus the assertions it makes.>

- `<file_or_suite>` — <what it asserts>

## Open questions

<Questions whose answers will be locked before the spec moves to Approved. Each open question gets a leaning answer where one exists, so reviewers can react to a proposal rather than free-respond.>

- **<Q>** — Lean: <A>. Rationale: <why>.

## Risks

<Each risk gets a mitigation. If there's no mitigation, the spec needs more thinking before approval.>

- **<risk>** → mitigation: <approach>.

## Manual prerequisites

<What the operator (Stefano) must do or decide before this spec can be implemented. Things that can't be automated.>

- ...

## Notes

<Reference links, design conversations, decisions made in slack/chat that should be captured here for posterity.>

- ...

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written. See `docs/roadmap.md` → "How to read this document".

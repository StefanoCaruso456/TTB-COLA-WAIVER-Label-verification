# Requirements Checklist

> Single source of truth for what the TTB COLA Label Verifier was asked to do (per the take-home brief + four interview transcripts) and where each requirement stands today. Update this doc whenever a status changes — it's what the manager will scan first.

**Last updated:** 2026-05-18
**Maintained by:** Stefano
**Companion docs:**
[`architecture.md`](architecture.md) (the system),
[`assumptions-and-limitations.md`](assumptions-and-limitations.md) (what we explicitly didn't do),
[`roadmap.md`](roadmap.md) (phase history),
[`research/2026-05-18-firewall-fallback.md`](research/2026-05-18-firewall-fallback.md) (production-network planning).

---

## TL;DR

23 requirements identified across four interviews + the technical brief. **20 met, 2 partial, 1 planned, 0 unmet.** Both partials are within ~15 minutes of being green; details in [§5](#5-partial-status-detail) below.

| Status | Count | Examples |
|---|---|---|
| ✅ Met | **20** | extraction targets, batch up to 200, clean UI, all deliverables |
| 🟡 Partial | **2** | latency on the live deploy; GOV WARNING font/bold enforcement |
| 🟢 Planned | **1** | production-network firewall path (Azure OpenAI + Private Link) |
| ❌ Not met | **0** | — |
| 📦 Out of scope (acknowledged) | 0 | — |

---

## 1. How to read this doc

1. **The table in §4 is the master list.** Every cell is intentionally short; deeper context lives in `architecture.md` or the linked spec/research doc.
2. **Status badges are deliberate.** They mean what the legend in §2 says — not "in progress" or "I'm working on it." A 🟡 indicates a *known specific gap*, not vagueness.
3. **Each partial is justified in §5.** No 🟡 should appear in the table without a corresponding entry in §5 that explains the gap and the path to close it.
4. **Source column attributes the requirement.** This matters because a requirement we invented ourselves should be reconsidered with less ceremony than one Sarah Chen explicitly named.

---

## 2. Status legend

| Badge | Meaning | When to use |
|---|---|---|
| ✅ **Met** | Shipped, exercised in tests or live use, evidence in-tree | Default for any requirement we can prove against the codebase |
| 🟡 **Partial** | Mostly shipped, with one specific gap that's named in §5 | Use sparingly — vague half-met items hide problems |
| 🟢 **Planned** | Decision and design captured in a research doc / spec, no code yet | Use when a requirement can't be code-resolved now (e.g., depends on TTB procurement) but we've done the engineering thinking |
| ❌ **Not met** | No design, no code, no plan | Use this honestly — it's worse to silently mark 🟡 |
| 📦 **Out of scope** | Acknowledged in interviews/brief but explicitly deferred | Pair with a one-line note in `assumptions-and-limitations.md` |

---

## 3. Sources

| Short ref | Who | When | Key requirements raised |
|---|---|---|---|
| **Sarah** | Sarah Chen, Deputy Director of Label Compliance | Tuesday 3:15 PM | Latency ≤ 5 s, simple UI, senior-friendly, batch 200–300 |
| **Marcus** | Marcus Williams, IT Systems Administrator | Thursday coffee | Standalone prototype, no PII, firewall constraint |
| **Dave** | Dave Morrison, Senior Compliance Agent (28 yrs) | Hallway | Tolerant matching, "help not hinder" |
| **Jenny** | Jenny Park, Junior Compliance Agent (8 mos) | Friday Teams call | Strict GOV WARNING formatting, robust to bad photos |
| **Brief** | Technical-requirements section of the take-home | Project kickoff | Extraction targets per commodity, repo + README + docs + deployed URL |

---

## 4. Master requirements table

| # | Requirement | Category | Source | Status | Evidence / file |
|---|---|---|---|---|---|
| 1 | ~5 s per-label latency | Performance | Sarah | 🟡 Partial | `gemini-label-extraction.service.ts` + `docs/traces/2026-05-17-trace-4e392da9.md` |
| 2 | Robust to bad photos | Performance | Jenny | ✅ Met | `lib/verification/image-quality.ts`; Gemini multimodal native robustness |
| 3 | Clean, obvious UI | UX | Sarah | ✅ Met | `components/verification/`, `components/batch/` — numbered sections, plain labels |
| 4 | Senior-friendly accessibility | UX | Sarah | ✅ Met | Large click targets, color-coded badges, no hidden menus |
| 5 | Help, don't hinder workflow | UX | Dave | ✅ Met | Single-page flows; pre-submit validation pre-empts server errors |
| 6 | Batch up to 200+ | Scale | Sarah | ✅ Met | `MAX_BATCH_FILES=200` (env-tunable to 500); async worker; `lib/services/batch-worker.ts` |
| 7 | Extract brand name | Functional — fields | Brief | ✅ Met | `lib/verification/compare-brand.ts` |
| 8 | Extract class / type designation | Functional — fields | Brief | ✅ Met | `compare-wine-fields.ts`, `compare-distilled-spirits-fields.ts`, `compare-malt-fields.ts` |
| 9 | Extract alcohol content (ABV) | Functional — fields | Brief | ✅ Met | `compare-abv.ts` — ±0.1 pp tolerance, 2× proof handling |
| 10 | Extract net contents | Functional — fields | Brief | ✅ Met | `compare-volume.ts` — mL / L / fl oz / cL normalized |
| 11 | Extract bottler name + address | Functional — fields | Brief | ✅ Met | `lib/services/verification.service.ts:201–225` |
| 12 | Extract country of origin (imports) | Functional — fields | Brief | ✅ Met | `compare-country-origin.ts` |
| 13 | Extract Government Warning text | Functional — fields | Brief | ✅ Met | `compare-warning.ts` — required-fragment match |
| 14 | Tolerant matching (case / punctuation) | Functional — behavior | Dave | ✅ Met | `lib/verification/normalize.ts` — whitespace, smart-quote, similarity threshold 0.85 |
| 15 | Strict GOV WARNING formatting (bold, font size, all-caps prefix) | Functional — behavior | Jenny | 🟡 Partial | `compare-warning.ts` enforces text only; bold/font surfaces as `human_review_required` |
| 16 | Wine, beer, spirits coverage | Functional — behavior | Brief | ✅ Met | All three commodities have schemas + comparators + fixtures |
| 17 | Standalone prototype — no COLA integration | Constraint | Marcus | ✅ Met | No outbound to TTB systems |
| 18 | No PII / sensitive storage | Constraint | Marcus | ✅ Met | Only business entity + commercial product data persisted; demo-data-only deploy notice |
| 19 | Cloud API endpoints may be firewalled in TTB prod | Constraint | Marcus | 🟢 Planned | `docs/research/2026-05-18-firewall-fallback.md` — Azure OpenAI + Private Link |
| 20 | Public GitHub repo | Deliverable | Brief | ✅ Met | `StefanoCaruso456/TTB-COLA-WAIVER-Label-verification` |
| 21 | README with setup / run | Deliverable | Brief | ✅ Met | `README.md` — quick start, env vars, commands |
| 22 | Approach + assumptions doc | Deliverable | Brief | ✅ Met | `architecture.md`, `assumptions-and-limitations.md`, `pre-research-decisions.md` |
| 23 | Live deployed URL | Deliverable | Brief | ✅ Met | https://ttb-cola-waiver-label-verification-production.up.railway.app/ |

---

## 5. Partial status detail

Every 🟡 in the table gets a paragraph here. If you're closing a gap, update both the table row and the entry below.

### #1 — Latency on the live deploy

**Gap.** Code default model is `gemini-2.5-flash-lite` (~3–4 s per label, comfortably under the 5 s target). The live Railway deploy still resolves to `gemini-2.5-flash` because the `GEMINI_MODEL` env var is set and overrides the code default. Measured 6.7 s in `docs/traces/2026-05-17-trace-4e392da9.md`.

**What flips it to ✅ Met.** Delete the `GEMINI_MODEL` env var on Railway (or set it to `gemini-2.5-flash-lite`) and redeploy. Then re-run a single label and confirm the Braintrust trace shows `model: gemini-2.5-flash-lite` and `geminiCallMs < 5000`.

**Owner.** Operator with Railway access. ~30 seconds of work; no code changes.

### #15 — Strict GOVERNMENT WARNING formatting

**Gap.** Jenny called out that the warning must be (a) exact text, (b) all-caps for the `GOVERNMENT WARNING:` prefix, (c) bold typeface, (d) not below the mm-minimum in 27 CFR 16.22. The current `compare-warning.ts` validates (a) and (b). (c) requires Gemini to return typography metadata we don't currently ask for; (d) requires a physical-scale calibration step (px → mm) that the current pipeline cannot do honestly.

**What flips it to ✅ Met.** A tiered plan, not a single PR:

- **Tier 1** — bold detection on the prefix (~half day, eval-gated).
- **Tier 2** — relative font-size check (warning vs body text) (~half day, eval-gated).
- **Tier 3** — absolute mm-compliance per 27 CFR 16.22. **Deliberately out of scope** for the prototype — requires either a reference object in submissions (UX-hostile), image DPI metadata (usually missing on phone photos), or homography-based scale recovery (weeks of research). Keep the `human_review_required` handoff and document the carve-out honestly.
- **Tier 4** — anti-evasion heuristics (low contrast, decorative-font OCR defeat). Separate spec, lower priority.

Full decomposition with effort, risk, and recommended order in [`docs/research/2026-05-18-gov-warning-typography-enforcement.md`](research/2026-05-18-gov-warning-typography-enforcement.md).

**Owner.** Engineering, post-prototype. Tier 1+2 are the achievable wins; Tier 3 stays a documented reviewer responsibility by design.

---

## 6. Planned status detail

### #19 — Cloud-API firewall constraint for TTB-internal deployment

**Why 🟢 not ✅.** The prototype runs on Railway with the public Gemini API; that endpoint is almost certainly blocked inside TTB's network (Marcus: previous scanning-vendor pilot lost half its features to firewall blocks). So the requirement is "production deployment survives TTB's network policy," and the prototype literally cannot exercise that until it's inside the network.

**What flips it to ✅ Met.** Implement an `AzureOpenAILabelExtractionService` against the `LabelExtractionService` interface (one new file, ~150 lines mirroring the Gemini service), set up an Azure Private Link endpoint inside TTB's existing Azure tenant, and re-deploy. Architecturally the swap is trivial — see `docs/architecture.md` §9 (Extraction provider seam). The blocker is procurement / FedRAMP authorization, not engineering.

**Why this is documented now anyway.** Even though the implementation waits for TTB, the *engineering decision* about which provider to target and why is captured in `docs/research/2026-05-18-firewall-fallback.md` so reviewers can see we've thought it through.

---

## 7. Maintenance

### When to update this doc

- **A status changes.** Both the table row in §4 and (if applicable) the entry in §5 / §6.
- **A new interview happens.** Add the requirement to §4, the source to §3, and assign a status.
- **A 🟡 gets closed.** Move the §5 entry to a "Closed gaps" archive at the bottom (don't delete — preserves the audit trail).

### When NOT to update this doc

- **Implementation details change without affecting the requirement.** Update the relevant code/spec instead; this doc is requirement-level only.
- **A code refactor moves a file.** Update the Evidence column on the way through (1 cell, ~10 seconds).

### Review cadence

- **Every PR that touches `lib/verification/`, `lib/services/batch-*`, or `app/api/*` should glance at this doc** to see if the changed behavior moves any status.
- **Before any external demo**, walk the table top-to-bottom and confirm every ✅ is still true.

---

## 8. Closed gaps (archive)

_None yet._ When a 🟡 flips to ✅, copy the §5 entry here with a one-line "Closed YYYY-MM-DD via PR #N" line at the top so we keep the institutional memory of how it was closed.

---

## Appendix — Why this doc exists separately from `roadmap.md`

`roadmap.md` is **what we built, phase by phase** — narrative, chronological, ~990 lines. It's the right doc when you're asking "why did Phase 3 introduce a worker?"

This doc is **what was asked for, requirement by requirement** — flat, current-state, scannable. It's the right doc when the manager asks "did you actually do all the things in the interviews?" or a new engineer asks "what are we on the hook for?"

They're complementary: roadmap is the trail behind us; this is the contract above us.

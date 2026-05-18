# Research note — Government Warning typography enforcement

**Author:** Stefano
**Date:** 2026-05-18
**Status:** Planning research — informs but does not commit to an implementation path.
**Tracks:** `docs/requirements-checklist.md` requirement **#15** (Strict GOV WARNING formatting).
**Related:** `lib/verification/compare-warning.ts` (today's implementation), `docs/architecture.md` §11 (Comparator inventory).

---

## 1. Why this exists

Jenny Park (Interview Notes 2024) put it this way:

> "The warning statement check is actually trickier than it sounds. It has to be exact. Like, word-for-word, and the 'GOVERNMENT WARNING:' part has to be in all caps and bold. People try to get creative with the warning all the time. Smaller font, different wording, burying it in tiny text. I caught one last month where they used 'Government Warning' in title case instead of all caps. Rejected."

That single paragraph is four distinct compliance checks rolled into one requirement. The current `compare-warning.ts` ships two of them. The remaining two are what the 🟡 in the requirements checklist represents — and the path to close them is non-trivial, which is the whole point of this note.

---

## 2. What the regulation actually demands

The controlling text is **27 CFR Part 16 — Alcoholic Beverage Health Warning Statement.**

- **§ 16.21** specifies the verbatim warning text and the typographic emphasis on `GOVERNMENT WARNING:`.
- **§ 16.22** specifies minimum type size, expressed in millimeters and scaled by container volume. Smaller containers have a smaller minimum; bigger containers have a larger one. The thresholds are stated as physical measurements (`mm`), not as relative-to-the-label ratios.

For engineering purposes, that breaks into four orthogonal checks:

| # | Check | Determinism | What it needs |
|---|---|---|---|
| **A** | Exact wording matches federal statute | deterministic text compare | OCR'd text (we have it) |
| **B** | `GOVERNMENT WARNING:` prefix is all-caps | deterministic text compare | OCR'd text (we have it) |
| **C** | The prefix is bold-weight | visual judgment | typography signal (we don't extract) |
| **D** | Type size meets the mm minimum for the container size | visual measurement + physical calibration | bounding box + px-to-mm scale (we have neither) |

Reading the regulation literally, **A through D are co-equal compliance requirements**. A violation of any one is a rejection — that's why Jenny said "Rejected" about a title-case prefix.

---

## 3. What we ship today

`lib/verification/compare-warning.ts` covers A and B:

- **A (text):** required-fragment matching against the federal statute, with `normalize.ts` collapsing whitespace and stripping decorative punctuation before comparison.
- **B (capitalization):** literal substring check for `GOVERNMENT WARNING:` in the extracted text.

C and D are out of reach with the current `ExtractedLabel` schema. Gemini returns the warning's plain text, not its visual properties. When the warning is present but suspect on typography, our comparator returns `human_review_required` so a human catches what we can't measure.

That handoff is the correct conservative posture **until** we close the gap honestly — not a cop-out. The wrong posture would be to silently return `pass` because the text is right while the typeface is regular.

---

## 4. Why closing the gap is hard

Closing C and D is not "add another comparator." It's a multi-step inference chain with a calibration step that the current pipeline doesn't support:

```
                  ┌───────────────────────────────────────────────────────────┐
                  │ Step 1. Visual feature extraction                         │
                  │   ─ Is the prefix bold?                                   │
                  │   ─ What is the prefix's bounding box (px)?               │
                  │   ─ What is the body text's bounding box (px)?            │
                  │                                                           │
                  │   Source: Gemini vision model with an expanded schema.    │
                  │   Risk:  Gemini's typography-classification accuracy is   │
                  │          unverified on stylized labels.                   │
                  └────────────────────────┬──────────────────────────────────┘
                                           │
                                           ▼
                  ┌───────────────────────────────────────────────────────────┐
                  │ Step 2. Physical-scale calibration                        │
                  │   ─ Convert pixel height → millimeters.                   │
                  │                                                           │
                  │   Requires ONE of:                                        │
                  │     (a) A reference object of known size in the photo     │
                  │         (e.g., a ruler). UX-hostile.                      │
                  │     (b) Image DPI metadata. Often missing; TTB labels     │
                  │         are usually photographed, not scanned.            │
                  │     (c) Known container shape + label-on-bottle geometry. │
                  │         Research-grade homography problem; weeks of work. │
                  │                                                           │
                  │   THIS is the part the current pipeline cannot do.        │
                  └────────────────────────┬──────────────────────────────────┘
                                           │
                                           ▼
                  ┌───────────────────────────────────────────────────────────┐
                  │ Step 3. Regulatory lookup                                 │
                  │   container.netContents → 27 CFR 16.22 min height (mm)    │
                  │   verdict = measured ≥ required ?                         │
                  │                                                           │
                  │   Easy once step 2 is solved.                             │
                  └───────────────────────────────────────────────────────────┘
```

**Step 2 is the choke point.** Without it, "the prefix is 18 pixels tall" tells us nothing about whether it satisfies a `2 mm` regulatory minimum. Gemini doesn't know how big the bottle is in the photo, and neither do we without explicit calibration.

---

## 5. Tiered solution

Senior-engineering posture: don't chase 100% coverage in one swing. Decompose into tiers, decide which are worth shipping at this prototype's cost-of-effort, and be honest about what stays human-reviewed.

### Tier 0 — text + capitalization (shipped)

What we have today. Catches Jenny's "Government Warning vs GOVERNMENT WARNING" example outright.

- **Status:** ✅ Met
- **Files:** `lib/verification/compare-warning.ts`, `lib/verification/normalize.ts`
- **Eval coverage:** existing fixtures under `data/samples/`

### Tier 1 — bold detection on the prefix

Ask Gemini in the structured-output schema to return a new field: `governmentWarning.prefixTypography: { isBold: boolean; isAllCaps: boolean }`. Add a new comparator that flags `prefixIsBold === false` as an `error`.

- **Effort:** ~half day
  - Schema change: add field to `ExtractedLabel` in `lib/schemas/extracted-label.schema.ts`.
  - Prompt change: extend the OCR prompt to ask for typography metadata on the warning prefix.
  - New helper: `compare-warning-typography.ts` returns a `VerificationCheck` per orthogonal property.
  - Wire into `verification.service.ts` for all commodities.
- **Critical pre-ship requirement:** build a fixture eval set with ~20 labels (bold-correct + bold-violating mix), validate that Gemini's accuracy at "is this text bold?" exceeds some honest threshold (suggest ≥ 95% on the eval set). **Do not ship without the eval.** Gemini might call any visually-heavy font "bold" and we'd over-reject.
- **Risk:** if Gemini's bold detection is below threshold, we surface as `needs_review` instead of `error`. The eval tells us which.
- **Recommendation:** **ship after eval.**

### Tier 2 — relative font-size check

Once we have bounding boxes (a natural extension of Tier 1's schema change), check that the warning text bounding box height is at least within some ratio of the body text. Doesn't satisfy the regulation (which is in mm, not relative ratios), but catches "buried in tiny text" violations that Jenny mentioned — applicants who put the warning at 50% the size of the brand name.

- **Effort:** ~half day after Tier 1 lands.
  - Extend schema to include `boundingBoxPx: {x,y,width,height}` for warning and at least one body-text reference (brand name is the obvious one — already extracted).
  - Comparator: `warningHeightRatio < threshold` → `warning` or `error`.
  - Threshold needs eval-calibration; suggest starting at 0.5 (warning < 50% of brand name height = flag).
- **Limitation:** this is heuristic, not regulatory. A label can pass the ratio check but still violate 27 CFR 16.22 if the absolute size is below the mm minimum. **We must not market this as regulatory compliance.**
- **Recommendation:** **ship after Tier 1; clearly label as "relative-sizing check, not absolute mm compliance."**

### Tier 3 — absolute mm-compliance per 27 CFR 16.22

The full regulatory check. Requires the physical-scale calibration step from §4 above.

- **Effort:** weeks, mostly research.
  - Need to either (a) require a reference object in submissions (UX-hostile), (b) extract image DPI from photo EXIF (usually missing on phone photos), or (c) build a homography pipeline that uses known container dimensions to triangulate label scale (research-grade computer vision, weeks of work with uncertain accuracy on irregular bottles).
- **Recommendation:** **document as out-of-scope for the prototype.** Keep the `human_review_required` handoff. Be honest about the limit in `docs/assumptions-and-limitations.md` and on the reviewer-facing UI: "Font size in mm not automated; reviewer must verify against 27 CFR 16.22."
- **Why this is the right call:** the cost of getting Tier 3 wrong (false rejects → applicant friction; false accepts → regulatory exposure) is high enough that human-in-the-loop is actually the *correct* design for the prototype, not a deferred-feature compromise.

### Tier 4 — anti-evasion heuristics

Jenny's "people try to get creative" framing. Beyond bold/size, applicants try low-contrast text, decorative fonts that defeat OCR, embedding the warning in an image rather than as text, or placing it where it's obscured by other label elements.

- **Effort:** 1–2 days, mostly prompt-engineering + eval.
  - Add a "warning concealment risk" check: ask Gemini to rate the warning's visual prominence on a 1–5 scale and surface a `warning` for low scores.
  - Add a check for warning-as-image-not-text: if Gemini's `evidenceText` field for the warning is empty but the image classifier says "warning is present somewhere," flag.
- **Risk:** false positives on legitimately-designed labels with subtle styling. Eval-calibration required.
- **Recommendation:** **separate spec, lower priority.** This is interesting research that addresses the spirit of the regulation (warnings must be conspicuous) but isn't strictly required to close requirement #15.

---

## 6. Recommendation

Ship **Tier 1 + Tier 2** as a single spec; defer Tier 3 explicitly; punt Tier 4 to a future research pass.

Estimated total scope: **~1 day** (half-day each), plus eval-calibration time before either tier ships. Closes requirement #15 from 🟡 to ✅ with an honest carve-out documented in the assumptions doc that absolute mm-compliance is human-reviewed by design.

### Implementation order

1. **Build the fixture eval first.** ~20 labels mixed across bold-compliant / bold-violating / size-compliant / size-violating. Manual labels = ground truth. This is the source of truth for whether Tier 1 and Tier 2 can ship.
2. **Schema + prompt change.** Add `prefixTypography` and `boundingBoxPx` fields to `ExtractedLabel`. Update the OCR prompt to request them. Run the eval — measure accuracy.
3. **If accuracy ≥ 95% for bold detection:** ship Tier 1 with `error` severity. Below 95%, ship with `needs_review` severity.
4. **Tier 2 follows the same shape:** comparator + eval + severity-tier decision.
5. **Update `compare-warning.ts`** to delegate typography checks to the new helper rather than punting to `human_review_required`.
6. **Update `docs/assumptions-and-limitations.md`** to reflect the new posture: Tier 1+2 automated, Tier 3 deliberately reviewer-side.
7. **Update `docs/requirements-checklist.md`** — flip #15 from 🟡 to ✅, add an entry to the "Closed gaps" archive with the PR ref.

---

## 7. Open questions

Things that need a human decision (probably yours) before promotion to a spec:

1. **Bold-detection accuracy threshold for shipping as `error` severity.** I suggested 95%; the right number depends on tolerance for false rejections. Reviewers' time saved (true positives) vs reviewers' time wasted (false positives) — needs a back-of-envelope.
2. **Should Tier 2's relative-ratio threshold be configurable (env var) or hard-coded?** I'd vote env var because the right threshold may change as we see more labels — but a hard-coded default needs to be defensible. Starting at 0.5 (warning ≥ 50% of brand name height) is a guess.
3. **Does TTB or a regulatory subject-matter expert want to weigh in on the threshold?** Better to ask than guess. Sarah Chen could route us.
4. **Tier 4 priority.** Is "warning conspicuousness" something the team wants automated, or is it the kind of judgment that belongs with the reviewer regardless?

---

## 8. Risks

- **Schema migration risk:** adding `prefixTypography` / `boundingBoxPx` to `ExtractedLabel` is a non-breaking change (optional fields), but every fixture-eval baseline needs re-recording. Plan ~half day to refresh evals when the schema lands.
- **Gemini accuracy regression on other fields:** changing the prompt to request typography metadata may shift OCR accuracy on unrelated fields. The existing fixture eval suite (`scripts/run-fixture-evals.ts`) is the safety net — must run green before and after the prompt change.
- **False rejection cost:** any new automated check that returns `error` adds friction for legitimate applicants. Eval-calibration is the controlling discipline; without it, we're shipping noise.
- **Calibration trap (Tier 3):** if a future engineer reads this note and decides "let's just estimate mm from pixel height assuming a 750 mL standard bottle" — that's the trap. The estimate is wrong often enough that it's worse than no check. Document this trap explicitly in the implementation spec if/when one gets written.

---

## 9. What this note is NOT

- **Not a spec.** Promotion to a spec happens after the open questions get answers and someone is ready to write code. The right next step is a conversation, not a PR.
- **Not a commitment.** Tier 1+2 is a recommended path; the team may choose a different cost/benefit cut (e.g., "skip Tier 2, just ship Tier 1").
- **Not a substitute for regulatory review.** I've cited 27 CFR Part 16 from training-data familiarity. Before shipping any automated typography check that produces an `error`-severity verdict, a regulatory SME should confirm the exact thresholds in the current version of the regulation. The numbers may have changed; the regulation evolves.

---

## 10. Sources & further reading

- **27 CFR Part 16** — Alcoholic Beverage Health Warning Statement. Look up the current version at ecfr.gov; the part numbers (16.21, 16.22) are stable but exact thresholds may have been amended.
- **`lib/verification/compare-warning.ts`** — today's implementation.
- **`lib/schemas/extracted-label.schema.ts`** — the schema we'd extend.
- **`scripts/run-fixture-evals.ts`** — the eval harness that would gate Tier 1 / Tier 2 ship decisions.
- **Jenny Park interview notes (2024)** — the original requirement source.
- **`docs/assumptions-and-limitations.md`** — where the "Tier 3 is reviewer-side by design" note would land.
- **`docs/architecture.md` §9, §11** — extraction provider seam (prompt change happens here) and comparator inventory (new comparator lands here).

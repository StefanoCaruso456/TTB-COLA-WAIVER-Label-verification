# Feature Spec — Government Warning typography enforcement (Tier 1 + Tier 2)

**Status:** Approved (2026-05-18) — scope confirmed in chat; closes the implementation half of `docs/research/2026-05-18-gov-warning-typography-enforcement.md`.
**Owner:** Stefano
**Last updated:** 2026-05-18

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. Content is original.

## Goal

Close requirement #15 from 🟡 Partial to ✅ Met (or to a documented-honest Partial if the eval shows Gemini's typography accuracy isn't trustworthy enough to ship at `error` severity). Implements **Tier 1 (bold detection on the `GOVERNMENT WARNING:` prefix)** and **Tier 2 (relative font-size check)** from the research note.

Tier 3 (absolute mm-compliance) stays explicitly out of scope — the calibration problem is documented in the research note and the assumptions doc.

## Scope

**In scope:**

- New schema field `governmentWarningTypography` on `ExtractedLabel` (optional, backward-compatible).
- Updated Gemini prompt requesting typography metadata for the warning prefix + body + an existing reference field (brand name) for relative sizing.
- Updated mock extraction service to return synthetic typography so the deterministic test path keeps working.
- New comparator `lib/verification/compare-warning-typography.ts` returning `VerificationCheck[]` for bold + relative-sizing.
- Wire into `verification.service.ts` for all three commodities (wine / spirits / malt) — typography rule is commodity-agnostic.
- Eval harness extension: per-fixture ground-truth annotations for bold + relative sizing under a new `fixtures.typography` block in `data/samples/*.json`.
- 8 unit tests for the new comparator (bold-pass, bold-fail, bold-missing, sizing-pass, sizing-fail, sizing-missing, integration with `compare-warning`, fail-safe on null typography input).
- Fail-safe behavior: if `governmentWarningTypography` is null/undefined (legacy records or Gemini failure to return), fall through to today's behavior — no regression, no new failures.
- Severity defaults to `needs_review` for both Tier 1 and Tier 2 checks until eval-calibration confirms Gemini accuracy. Env vars `GOV_WARNING_BOLD_SEVERITY` and `GOV_WARNING_SIZING_SEVERITY` flip to `error` once accuracy is validated.
- Update `docs/requirements-checklist.md` #15 — move from §5 to §8 (Closed gaps archive) with PR ref.
- Update `docs/assumptions-and-limitations.md` to reflect Tier 1+2 shipped, Tier 3 still deliberately out of scope.

**Out of scope:**

- Tier 3 (absolute mm-compliance per 27 CFR 16.22). Research note covers why.
- Tier 4 (anti-evasion heuristics). Separate spec.
- Re-running the full fixture-eval against real Gemini to validate accuracy — that's an operator task post-merge.
- Any UI change to surface the new typography check separately. It composes into the existing `VerificationCheckCard` flow via the standard `VerificationCheck` interface.
- Migration of existing `VerificationRecord` rows in the DB. New typography checks only appear on records created after this change ships.

## Approach

### Schema change (narrowest possible)

Add a single new optional field at the same level as `governmentWarning`:

```ts
// lib/schemas/extracted-label.schema.ts (additions only)
export const governmentWarningTypographySchema = z.object({
  prefixIsBold: z.boolean().optional(),
  prefixIsAllCaps: z.boolean().optional(),
  prefixBbox: bboxSchema.optional(),
  warningBbox: bboxSchema.optional(),
  // bodyBbox is the full warning text; warningBbox can equal it for now.
  brandReferenceBbox: bboxSchema.optional(), // for relative sizing
  notes: z.string().optional(),
});

// extractedLabelFieldsSchema gets one new line:
//   governmentWarningTypography: governmentWarningTypographySchema.optional(),
```

Backward-compatible: every field is optional, the parent object is optional, old `ExtractedLabel` JSON still validates.

### Prompt change

Extend the Gemini OCR prompt with one new instructions block:

> When you locate the Government Warning text on the label, also populate `governmentWarningTypography`:
> - `prefixIsBold` — is the `GOVERNMENT WARNING:` prefix in bold weight? (true/false)
> - `prefixIsAllCaps` — is the prefix all uppercase? (true/false)
> - `prefixBbox` — bounding box of the prefix, normalized 0–1
> - `warningBbox` — bounding box of the full warning text
> - `brandReferenceBbox` — bounding box of the brand name (for relative-size comparison)
> If you cannot determine bold weight with high confidence, omit `prefixIsBold` rather than guessing.

Keep the rest of the prompt unchanged. The new fields are an additive request.

### Mock extraction

Mock service synthesizes a typography block per fixture scenario:

- `valid` scenarios → `prefixIsBold: true`, `prefixIsAllCaps: true`, plausible bbox proportions
- `bold-violation` scenarios (new) → `prefixIsBold: false`
- `sizing-violation` scenarios (new) → `warningBbox.height` < 30% of `brandReferenceBbox.height`

Keeps the deterministic test path covering both happy and failure paths without depending on real Gemini.

### Comparator

```
// lib/verification/compare-warning-typography.ts
export interface WarningTypographyChecks {
  boldPrefix: VerificationCheck | null;
  relativeSizing: VerificationCheck | null;
}

export function compareWarningTypography(
  typography: GovernmentWarningTypography | null | undefined,
  config: { boldSeverity: 'error' | 'needs_review'; sizingThreshold: number; sizingSeverity: 'warning' | 'needs_review'; }
): WarningTypographyChecks
```

Returns `null` for either check when the relevant input is missing — caller decides whether that's a regression (it isn't; today we have zero typography enforcement, so null is current state).

### Wiring

`verification.service.ts` calls the new comparator after `compareGovernmentWarning`, gets back 0-2 additional `VerificationCheck`s, appends to the report. Existing `compare-warning.ts` stays unchanged — typography is an additive check, not a replacement.

### Severity config

Two env vars, both default to `needs_review`:

- `GOV_WARNING_BOLD_SEVERITY` — `error` | `needs_review` (default)
- `GOV_WARNING_SIZING_SEVERITY` — `warning` | `needs_review` (default)
- `GOV_WARNING_SIZING_THRESHOLD` — float 0–1 (default `0.5`, meaning warning height must be ≥ 50% of brand name height)

Operator flips to `error` after running the eval against real Gemini and confirming accuracy ≥ 95%.

### Eval annotations

Per-fixture ground-truth blocks in `data/samples/*.json`:

```json
{
  "scenario": "wine-valid",
  "groundTruth": {
    "warningTypography": {
      "prefixIsBold": true,
      "prefixIsAllCaps": true,
      "warningHeightRatioToBrand": 0.6
    }
  }
}
```

The eval harness already exists (`scripts/run-fixture-evals.ts`); it gets one new scoring function `extraction.warningTypographyBoldCorrect` that flips to 1 when Gemini's `prefixIsBold` matches ground truth, 0 otherwise. The aggregate accuracy is what determines the severity flip.

## Engineering tasks

1. **Schema** (`lib/schemas/extracted-label.schema.ts`)
   1. Add `governmentWarningTypographySchema`.
   2. Add `governmentWarningTypography` to `extractedLabelFieldsSchema` as optional.
   3. Export the inferred type.
2. **Required-warning rules** (`lib/rules/required-warning.ts`)
   1. Add a `BRAND_REFERENCE_FIELD` constant (`"brandName"`) so the prompt + comparator agree on which field is the size reference.
3. **Prompt** (`lib/services/gemini-label-extraction.service.ts` or wherever the prompt lives)
   1. Append the typography-request block.
   2. Add the new fields to the JSON example shown to the model.
4. **Mock extraction** (`lib/services/mock-label-extraction.service.ts` and `data/samples/*.json`)
   1. Synthesize plausible typography per scenario.
   2. Add `bold-violation` and `sizing-violation` scenarios to `data/samples/`.
5. **Comparator** (`lib/verification/compare-warning-typography.ts` — new file)
   1. Pure function. No I/O. No async.
   2. Returns `WarningTypographyChecks` with one or two `VerificationCheck` objects.
   3. Honors env-var-driven severity config (read once at module init via a resolver helper, not on every call).
6. **Severity resolver** (new helper inside the comparator file)
   1. `resolveTypographyConfig(env)` reads env vars, clamps to legal values, returns config object.
7. **Verification service** (`lib/services/verification.service.ts`)
   1. After `compareGovernmentWarning`, call `compareWarningTypography(extracted.normalizedFields.governmentWarningTypography, config)`.
   2. Append returned non-null checks to the `report.checks` array.
   3. Update `auditSummary` counts accordingly (already iterates over `report.checks`, so this is automatic).
8. **Unit tests** (`tests/compare-warning-typography.test.ts` — new file)
   1. `boldPrefix` returns `match` when `prefixIsBold: true`.
   2. `boldPrefix` returns `mismatch` with configured severity when `prefixIsBold: false`.
   3. `boldPrefix` returns `null` when `prefixIsBold` is undefined.
   4. `relativeSizing` returns `match` when warning height ≥ threshold × brand height.
   5. `relativeSizing` returns `mismatch` with configured severity when below threshold.
   6. `relativeSizing` returns `null` when either bbox is missing.
   7. Severity config respects env-var override (`error` instead of `needs_review`).
   8. Fail-safe: passing `null` typography input returns `{ boldPrefix: null, relativeSizing: null }`.
9. **Eval annotations**
   1. Add `groundTruth.warningTypography` to each existing fixture in `data/samples/`.
   2. New scoring function in `scripts/run-fixture-evals.ts` (or wherever scoring lives): `extraction.warningTypographyBoldCorrect`.
10. **Docs**
    1. Update `docs/requirements-checklist.md`: move #15 from §5 to §8 (Closed gaps archive) with PR ref + the eval-pending caveat about severity.
    2. Update `docs/assumptions-and-limitations.md`: Tier 1+2 are now automated at `needs_review` severity, flippable to `error` via env vars after operator eval-calibration; Tier 3 stays out of scope.
    3. Update `docs/architecture.md` §11 comparator inventory: add `compare-warning-typography.ts` row.

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] `npm test` — all existing tests pass + 8 new tests for the typography comparator.
- [ ] Mock-mode verification of a `bold-violation` fixture surfaces a `needs_review` check in the report (severity flips to `error` when `GOV_WARNING_BOLD_SEVERITY=error`).
- [ ] Mock-mode verification of a `sizing-violation` fixture surfaces a `needs_review` (or env-flipped `warning`) check.
- [ ] Legacy mock fixtures (without `governmentWarningTypography` populated) still pass through the orchestrator with zero new failures.
- [ ] Real-Gemini run against the existing fixture set returns the new fields on ≥ 80% of attempts (sanity threshold; operator's eval determines the trustworthy-enough-to-ship-as-error threshold).

## Evals

- `tests/compare-warning-typography.test.ts` — 8 unit tests (above).
- `scripts/run-fixture-evals.ts` — extended with `extraction.warningTypographyBoldCorrect` scoring function. Operator runs this against real Gemini key to inform the severity-flip decision.

## Open questions

Inherited from the research note; reproduced here so they don't get lost:

- **What's the bold-detection accuracy threshold to flip from `needs_review` to `error` severity?** Spec defaults to `needs_review`; operator decides post-eval. 95% is the suggestion in the research note.
- **Should the relative-sizing threshold (0.5) be configurable per-commodity?** Spec says no (single global threshold) — a wine label and a malt label have the same legibility expectations. Revisit if real-world fixtures show otherwise.

## Risks

- **Gemini prompt change may regress other field accuracy.** Mitigation: re-run existing fixture-eval suite before merge; new prompt block is purely additive (asks for more, doesn't change existing requests).
- **Gemini's bold detection on stylized labels may be unreliable.** Mitigation: ship at `needs_review` severity by default; operator validates accuracy on real fixtures and flips to `error` via env var only after evidence.
- **The relative-sizing check is heuristic, not regulatory.** Spec is explicit; assumptions doc is explicit; UI surfaces it as a check with its own reason text so reviewers know what they're looking at.
- **Schema change to `ExtractedLabel` invalidates Zod parse of legacy DB rows.** Mitigation: new field is optional at every level — old JSON validates unchanged.

## Manual prerequisites

| What | Why |
|---|---|
| Operator runs `npm run eval:full` against real Gemini after merge | Determines whether to flip severity to `error` |
| Operator decides accuracy threshold for flip | Spec defaults to suggestion (95%); operator confirms |

## Notes

- This spec implements two tiers, but is structured so that Tier 1 (bold) ships as a unit and Tier 2 (sizing) is a follow-up modification of the same comparator. If the implementation needs to ship in two PRs, the schema change + the bold check go first; the sizing check is appended in a follow-up.
- The comparator-coordinator pattern (keeping `compare-warning.ts` text-only and adding `compare-warning-typography.ts` for visual checks) intentionally mirrors the existing decomposition — comparators are pure, domain-specific, and composable. Senior-engineering principle: extend by adding, don't conflate by editing.

---

**Status legend:** Draft → Approved → In progress → Done

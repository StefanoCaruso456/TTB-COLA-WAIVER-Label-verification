// Requirement #15 — Tier 1 (bold detection) + Tier 2 (relative font sizing).
// Spec: docs/specs/gov-warning-typography-t1-t2.md. Research note that
// motivated the tier cuts: docs/research/2026-05-18-gov-warning-typography-
// enforcement.md.
//
// What this does NOT do: absolute mm-compliance per 27 CFR 16.22. That's
// Tier 3, deliberately out of scope until we can solve the px → mm
// calibration honestly. See the research note (§5) for why.

import type {
  GovernmentWarningTypography,
  ExtractedField,
} from "@/lib/schemas/extracted-label.schema";
import type {
  VerificationCheck,
  VerificationSeverity,
} from "@/lib/schemas/verification-result.schema";

export interface TypographyConfig {
  /** Severity used when bold-detection comes back false. Defaults to
   *  `needs_review` — operator flips to `error` after eval-validating
   *  Gemini's bold-detection accuracy (suggested threshold: ≥ 95%). */
  boldSeverity: Extract<VerificationSeverity, "error" | "warning"> | "needs_review";
  /** Minimum ratio: warning bounding-box height / brand reference height.
   *  Default 0.5 catches "buried in tiny text" violations. Below 0.3 is
   *  almost always a typography violation; above 0.7 is almost always
   *  fine. The 0.5 mid-point is a starting heuristic; revisit after
   *  real-fixture data informs the calibration. */
  sizingThreshold: number;
  /** Severity used when relative-sizing falls below threshold. Defaults to
   *  `needs_review` for the same reason as `boldSeverity`. */
  sizingSeverity:
    | Extract<VerificationSeverity, "error" | "warning">
    | "needs_review";
}

export const DEFAULT_TYPOGRAPHY_CONFIG: TypographyConfig = {
  boldSeverity: "needs_review",
  sizingThreshold: 0.5,
  sizingSeverity: "needs_review",
};

export interface WarningTypographyChecks {
  /** Null when `prefixIsBold` wasn't provided by the extractor. Today's
   *  contract: missing typography signal means we fall through to the
   *  existing text-only warning check — same posture as before this
   *  feature shipped, no regression. */
  boldPrefix: VerificationCheck | null;
  /** Null when either bbox is missing OR when the comparator can't
   *  compute a meaningful ratio (zero-height brand reference, etc.). */
  relativeSizing: VerificationCheck | null;
}

/**
 * Pure typography comparator. No I/O, no async. Mirrors the pattern of
 * other `lib/verification/compare-*` helpers.
 *
 * Returns up to two `VerificationCheck`s — one per Tier — or null per
 * check when input is insufficient. The caller (verification.service.ts)
 * appends non-null results to the report's `checks` array.
 *
 * Design note: this is intentionally additive to `compare-warning.ts`
 * (which still handles text + uppercase) rather than replacing it. Keeps
 * each comparator narrow + composable. Senior-engineering principle:
 * extend by adding, don't conflate by editing.
 */
export function compareWarningTypography(
  typography: GovernmentWarningTypography | null | undefined,
  brandReference: ExtractedField | null | undefined,
  config: TypographyConfig = DEFAULT_TYPOGRAPHY_CONFIG,
): WarningTypographyChecks {
  return {
    boldPrefix: checkBoldPrefix(typography, config),
    relativeSizing: checkRelativeSizing(typography, brandReference, config),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Individual checks (small, testable)
// ────────────────────────────────────────────────────────────────────────────

function checkBoldPrefix(
  typography: GovernmentWarningTypography | null | undefined,
  config: TypographyConfig,
): VerificationCheck | null {
  // Missing signal: fall through. This is the legacy contract — pre-Tier-1
  // records have no typography data; we don't want to flag every legacy
  // record as needing review.
  if (typography?.prefixIsBold === undefined) return null;

  const isBold = typography.prefixIsBold === true;
  if (isBold) {
    return makeCheck({
      id: "shared.governmentWarning.boldPrefix",
      label: "GOVERNMENT WARNING prefix is bold",
      status: "match",
      severity: "info",
      reason: "Prefix typography indicates bold weight (27 CFR 16.21).",
    });
  }

  return makeCheck({
    id: "shared.governmentWarning.boldPrefix",
    label: "GOVERNMENT WARNING prefix is bold",
    status: config.boldSeverity === "needs_review" ? "needs_review" : "mismatch",
    severity:
      config.boldSeverity === "needs_review" ? "warning" : config.boldSeverity,
    reason:
      "The GOVERNMENT WARNING: prefix does not appear bold. 27 CFR 16.21 " +
      "requires the prefix to be in bold type. Verify against the label image.",
    recommendation:
      "Confirm the prefix typeface manually; if non-bold, the label fails 27 CFR 16.21.",
  });
}

function checkRelativeSizing(
  typography: GovernmentWarningTypography | null | undefined,
  brandReference: ExtractedField | null | undefined,
  config: TypographyConfig,
): VerificationCheck | null {
  const warningH = typography?.warningBbox?.height;
  // Brand reference bbox can come from either the extractor's own
  // observation (typography.brandReferenceBbox) or from the brand-name
  // ExtractedField. Prefer the typography-side reference if present
  // because it's measured in the same pass as the warning bbox, but fall
  // back to the brand field's bbox if not — better than punting.
  const brandH =
    typography?.brandReferenceBbox?.height ?? brandReference?.bbox?.height;

  if (
    warningH === undefined ||
    brandH === undefined ||
    warningH <= 0 ||
    brandH <= 0
  ) {
    return null;
  }

  const ratio = warningH / brandH;
  const meetsThreshold = ratio >= config.sizingThreshold;

  if (meetsThreshold) {
    return makeCheck({
      id: "shared.governmentWarning.relativeSizing",
      label: "GOVERNMENT WARNING text is proportionally sized",
      status: "match",
      severity: "info",
      reason: `Warning text height is ${(ratio * 100).toFixed(0)}% of the brand name height (≥ ${(config.sizingThreshold * 100).toFixed(0)}% threshold).`,
    });
  }

  return makeCheck({
    id: "shared.governmentWarning.relativeSizing",
    label: "GOVERNMENT WARNING text is proportionally sized",
    status:
      config.sizingSeverity === "needs_review" ? "needs_review" : "mismatch",
    severity:
      config.sizingSeverity === "needs_review"
        ? "warning"
        : config.sizingSeverity,
    reason:
      `Warning text height is only ${(ratio * 100).toFixed(0)}% of the brand name height ` +
      `(threshold: ${(config.sizingThreshold * 100).toFixed(0)}%). This is a heuristic — absolute ` +
      `mm-compliance per 27 CFR 16.22 still requires human verification.`,
    recommendation:
      "Visually confirm the warning text meets 27 CFR 16.22 minimum size for the container volume.",
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Small factory — keeps every check's source/automationLevel consistent.
// ────────────────────────────────────────────────────────────────────────────

interface MakeCheckInput {
  id: string;
  label: string;
  status: VerificationCheck["status"];
  severity: VerificationSeverity;
  reason: string;
  recommendation?: string;
}

function makeCheck(input: MakeCheckInput): VerificationCheck {
  return {
    id: input.id,
    fieldKey: "governmentWarningTypography",
    label: input.label,
    status: input.status,
    severity: input.severity,
    source: "mandatory_label_presence",
    // Typography checks are partially automated: we measure the signal
    // from Gemini, but final regulatory verdict (especially for mm-size)
    // stays with the reviewer until Tier 3 is implemented.
    automationLevel: "partially_automated",
    reason: input.reason,
    recommendation: input.recommendation,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Env-driven config resolver. Lives here (not at module-init time) so the
// caller controls when env is read — important for tests that override
// process.env per-suite.
// ────────────────────────────────────────────────────────────────────────────

export function resolveTypographyConfig(
  env: NodeJS.ProcessEnv = process.env,
): TypographyConfig {
  const boldSeverity = parseSeverity(
    env.GOV_WARNING_BOLD_SEVERITY,
    DEFAULT_TYPOGRAPHY_CONFIG.boldSeverity,
  );
  const sizingSeverity = parseSeverity(
    env.GOV_WARNING_SIZING_SEVERITY,
    DEFAULT_TYPOGRAPHY_CONFIG.sizingSeverity,
  );
  const sizingThreshold = parseThreshold(
    env.GOV_WARNING_SIZING_THRESHOLD,
    DEFAULT_TYPOGRAPHY_CONFIG.sizingThreshold,
  );
  return { boldSeverity, sizingSeverity, sizingThreshold };
}

function parseSeverity(
  raw: string | undefined,
  fallback: TypographyConfig["boldSeverity"],
): TypographyConfig["boldSeverity"] {
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if (v === "error" || v === "warning" || v === "needs_review") return v;
  return fallback;
}

function parseThreshold(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
  return n;
}

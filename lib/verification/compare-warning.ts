import {
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_REQUIRED_FRAGMENTS,
} from "@/lib/rules/required-warning";
import type {
  VerificationSeverity,
  VerificationStatus,
} from "@/types/verification";

export interface GovernmentWarningCheckResult {
  status: VerificationStatus;
  severity: VerificationSeverity;
  reason?: string;
  missingFragments: string[];
  prefixUppercase: boolean;
}

export function compareGovernmentWarning(
  extracted: string | null | undefined,
): GovernmentWarningCheckResult {
  if (!extracted || !extracted.trim()) {
    return {
      status: "missing",
      severity: "error",
      missingFragments: [...GOVERNMENT_WARNING_REQUIRED_FRAGMENTS],
      prefixUppercase: false,
      reason: "Government warning text was not detected on the label.",
    };
  }

  const raw = extracted;
  const lower = raw.toLowerCase();

  const hasPrefix = lower.includes(GOVERNMENT_WARNING_PREFIX.toLowerCase());
  if (!hasPrefix) {
    return {
      status: "mismatch",
      severity: "error",
      missingFragments: [GOVERNMENT_WARNING_PREFIX],
      prefixUppercase: false,
      reason: `The "${GOVERNMENT_WARNING_PREFIX}" prefix was not detected.`,
    };
  }

  // Find the prefix in the raw text and check its casing.
  const prefixIndex = lower.indexOf(GOVERNMENT_WARNING_PREFIX.toLowerCase());
  const slice = raw.substring(
    prefixIndex,
    prefixIndex + GOVERNMENT_WARNING_PREFIX.length,
  );
  const prefixUppercase = slice === slice.toUpperCase();

  const missingFragments = GOVERNMENT_WARNING_REQUIRED_FRAGMENTS.filter(
    (frag) => !lower.includes(frag.toLowerCase()),
  );

  if (!prefixUppercase) {
    return {
      status: "mismatch",
      severity: "error",
      missingFragments,
      prefixUppercase,
      reason: 'The "GOVERNMENT WARNING" prefix must be uppercase.',
    };
  }

  if (missingFragments.length > 0) {
    return {
      status: "mismatch",
      severity: "error",
      missingFragments,
      prefixUppercase,
      reason: `Required wording missing from the warning: ${missingFragments.join(
        "; ",
      )}.`,
    };
  }

  return {
    status: "match",
    severity: "info",
    missingFragments,
    prefixUppercase,
  };
}

import { normalizeText, similarity } from "./normalize";
import type {
  VerificationSeverity,
  VerificationStatus,
} from "@/types/verification";
import type { SourceOfProduct } from "@/types/cola";

export interface CountryOriginCheckResult {
  status: VerificationStatus;
  severity: VerificationSeverity;
  reason?: string;
}

export function compareCountryOfOrigin(input: {
  sourceOfProduct: SourceOfProduct;
  expected?: string | null;
  extracted?: string | null;
}): CountryOriginCheckResult {
  const { sourceOfProduct, expected, extracted } = input;

  if (sourceOfProduct === "domestic") {
    return {
      status: "not_applicable",
      severity: "info",
      reason: "Country of origin is not required for domestic products.",
    };
  }

  const normalizedExpected = normalizeText(expected);
  const normalizedExtracted = normalizeText(extracted);

  if (!normalizedExpected) {
    return {
      status: "needs_review",
      severity: "warning",
      reason:
        "Imported product is missing a country of origin in the application; reviewer should confirm.",
    };
  }

  if (!normalizedExtracted) {
    return {
      status: "missing",
      severity: "error",
      reason: "Country of origin was not detected on the label.",
    };
  }

  if (normalizedExpected === normalizedExtracted) {
    return { status: "match", severity: "info" };
  }

  if (similarity(normalizedExpected, normalizedExtracted) >= 0.85) {
    return {
      status: "likely_match",
      severity: "warning",
      reason: `Country of origin "${extracted}" closely matches the expected "${expected}" but is not an exact match.`,
    };
  }

  return {
    status: "mismatch",
    severity: "error",
    reason: `Expected country of origin "${expected}" but label shows "${extracted}".`,
  };
}

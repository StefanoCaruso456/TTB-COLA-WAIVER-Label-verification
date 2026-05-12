import type { ProductType } from "@/types/cola";
import type { VerificationStatus } from "@/types/verification";

const ABV_TOLERANCE = 0.1;

export interface AlcoholComparisonResult {
  status: VerificationStatus;
  expectedAbv?: number;
  extractedAbv?: number;
  extractedProof?: number;
  reason?: string;
}

const ABV_REGEX = /(\d+(?:\.\d+)?)\s*%/;
const PROOF_REGEX = /(\d+(?:\.\d+)?)\s*proof/i;

/**
 * Parses an alcohol-content string into a numeric ABV percentage. Accepts
 * "45% Alc./Vol.", "45 % ABV", "ABV: 45.0%", or pure numerics like "45.5".
 * Returns undefined if the value cannot be parsed.
 */
export function parseAbvPercent(value?: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const abvMatch = trimmed.match(ABV_REGEX);
  if (abvMatch) {
    const n = Number(abvMatch[1]);
    return Number.isFinite(n) ? n : undefined;
  }

  const pureNumber = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (pureNumber) {
    const n = Number(pureNumber[1]);
    return Number.isFinite(n) ? n : undefined;
  }

  return undefined;
}

export function parseProof(value?: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(PROOF_REGEX);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

export interface CompareAlcoholInput {
  productType: ProductType;
  expectedAlcoholContent?: string | null;
  extractedAlcoholContent?: string | null;
  extractedProof?: string | null;
}

export function compareAlcoholContent(
  input: CompareAlcoholInput,
): AlcoholComparisonResult {
  const expectedAbv = parseAbvPercent(input.expectedAlcoholContent);
  const extractedAbv = parseAbvPercent(input.extractedAlcoholContent);
  const extractedProof = parseProof(input.extractedProof ?? input.extractedAlcoholContent);

  if (expectedAbv === undefined) {
    return {
      status: "not_applicable",
      reason: "No expected alcohol content provided.",
    };
  }

  // Prefer ABV directly; fall back to proof if available and product type is distilled spirits.
  if (extractedAbv === undefined && extractedProof === undefined) {
    return {
      status: "missing",
      expectedAbv,
      reason: "Could not parse extracted alcohol content from the label.",
    };
  }

  if (extractedAbv !== undefined) {
    if (Math.abs(extractedAbv - expectedAbv) <= ABV_TOLERANCE) {
      return {
        status: "match",
        expectedAbv,
        extractedAbv,
      };
    }
    return {
      status: "mismatch",
      expectedAbv,
      extractedAbv,
      reason: `Expected ${expectedAbv}% ABV but label shows ${extractedAbv}% ABV.`,
    };
  }

  // Only proof was found.
  if (extractedProof !== undefined) {
    const derivedAbv = extractedProof / 2;
    if (Math.abs(derivedAbv - expectedAbv) <= ABV_TOLERANCE) {
      return {
        status:
          input.productType === "distilled_spirits" ? "match" : "likely_match",
        expectedAbv,
        extractedProof,
        reason: `Label proof ${extractedProof} equals ${derivedAbv}% ABV.`,
      };
    }
    return {
      status: "mismatch",
      expectedAbv,
      extractedProof,
      reason: `Expected ${expectedAbv}% ABV but label proof ${extractedProof} implies ${derivedAbv}% ABV.`,
    };
  }

  return {
    status: "needs_review",
    expectedAbv,
    reason: "Could not reconcile expected ABV with extracted values.",
  };
}

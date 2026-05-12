import { normalizeText, similarity } from "./normalize";
import type { VerificationStatus } from "@/types/verification";

export interface BrandComparisonResult {
  status: VerificationStatus;
  similarity: number;
  normalizedExpected: string;
  normalizedExtracted: string;
}

export const BRAND_LIKELY_MATCH_THRESHOLD = 0.85;

export function compareBrand(
  expected: string | null | undefined,
  extracted: string | null | undefined,
): BrandComparisonResult {
  const normalizedExpected = normalizeText(expected);
  const normalizedExtracted = normalizeText(extracted);

  if (!normalizedExpected) {
    return {
      status: "not_applicable",
      similarity: 0,
      normalizedExpected,
      normalizedExtracted,
    };
  }

  if (!normalizedExtracted) {
    return {
      status: "missing",
      similarity: 0,
      normalizedExpected,
      normalizedExtracted,
    };
  }

  if (normalizedExpected === normalizedExtracted) {
    return {
      status: "match",
      similarity: 1,
      normalizedExpected,
      normalizedExtracted,
    };
  }

  const score = similarity(normalizedExpected, normalizedExtracted);
  if (score >= BRAND_LIKELY_MATCH_THRESHOLD) {
    return {
      status: "likely_match",
      similarity: score,
      normalizedExpected,
      normalizedExtracted,
    };
  }

  return {
    status: "mismatch",
    similarity: score,
    normalizedExpected,
    normalizedExtracted,
  };
}

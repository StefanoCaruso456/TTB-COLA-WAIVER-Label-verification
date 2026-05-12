import type { VerificationStatus } from "@/types/verification";

const VOLUME_TOLERANCE_ML = 0.5;

export interface ParsedVolume {
  raw: string;
  ml: number;
}

const VOLUME_REGEX =
  /(\d+(?:\.\d+)?)\s*(ml|millilit(?:re|er)s?|l|lit(?:re|er)s?|fl\s*oz|fluid\s*ounces?|cl|centilit(?:re|er)s?)/gi;

export function parseVolumes(input?: string | null): ParsedVolume[] {
  if (!input) return [];
  const matches: ParsedVolume[] = [];
  for (const m of input.matchAll(VOLUME_REGEX)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = m[2].toLowerCase().replace(/\s+/g, "");
    let ml: number | undefined;
    if (unit.startsWith("ml") || unit.startsWith("millilit")) {
      ml = value;
    } else if (unit === "l" || unit.startsWith("lit")) {
      ml = value * 1000;
    } else if (unit === "cl" || unit.startsWith("centilit")) {
      ml = value * 10;
    } else if (unit.startsWith("floz") || unit.startsWith("fluidounc")) {
      ml = value * 29.5735;
    }
    if (ml !== undefined) {
      matches.push({ raw: m[0], ml: Math.round(ml * 10) / 10 });
    }
  }
  return matches;
}

export function parseSingleVolume(input?: string | null): ParsedVolume | undefined {
  return parseVolumes(input)[0];
}

export interface VolumeComparisonResult {
  status: VerificationStatus;
  expectedVolumes: ParsedVolume[];
  extractedVolumes: ParsedVolume[];
  reason?: string;
}

export function compareVolumes(
  expected: (string | null | undefined)[] | undefined,
  extracted: (string | null | undefined)[] | undefined,
): VolumeComparisonResult {
  const expectedVolumes: ParsedVolume[] = (expected ?? [])
    .flatMap((v) => parseVolumes(v));
  const extractedVolumes: ParsedVolume[] = (extracted ?? [])
    .flatMap((v) => parseVolumes(v));

  if (expectedVolumes.length === 0) {
    return {
      status: "not_applicable",
      expectedVolumes,
      extractedVolumes,
      reason: "No expected net contents provided.",
    };
  }

  if (extractedVolumes.length === 0) {
    return {
      status: "missing",
      expectedVolumes,
      extractedVolumes,
      reason: "No net contents detected on the label.",
    };
  }

  const allExpectedFound = expectedVolumes.every((e) =>
    extractedVolumes.some((x) => Math.abs(x.ml - e.ml) <= VOLUME_TOLERANCE_ML),
  );

  if (allExpectedFound) {
    return {
      status: "match",
      expectedVolumes,
      extractedVolumes,
    };
  }

  const someMatch = expectedVolumes.some((e) =>
    extractedVolumes.some((x) => Math.abs(x.ml - e.ml) <= VOLUME_TOLERANCE_ML),
  );

  return {
    status: someMatch ? "likely_match" : "mismatch",
    expectedVolumes,
    extractedVolumes,
    reason: someMatch
      ? "Some expected net contents matched; others were not detected on the label."
      : "Expected net contents did not match any extracted values.",
  };
}

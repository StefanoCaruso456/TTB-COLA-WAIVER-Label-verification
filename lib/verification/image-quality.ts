import type { ImageQuality } from "@/types/extracted-label";
import type {
  VerificationSeverity,
  VerificationStatus,
} from "@/types/verification";

export interface ImageQualityCheckResult {
  status: VerificationStatus;
  severity: VerificationSeverity;
  reason?: string;
}

export function evaluateImageQuality(
  quality: ImageQuality | undefined,
): ImageQualityCheckResult {
  if (!quality) {
    return {
      status: "needs_review",
      severity: "warning",
      reason: "No image quality information available.",
    };
  }

  if (quality.overallReadability === "poor") {
    return {
      status: "needs_review",
      severity: "warning",
      reason:
        "Overall image readability is poor. Reviewer should manually inspect.",
    };
  }

  const highRisks = [
    quality.blurRisk,
    quality.glareRisk,
    quality.lowLightRisk,
    quality.orientationRisk,
  ].filter((r) => r === "high").length;

  if (highRisks > 0) {
    return {
      status: "needs_review",
      severity: "warning",
      reason: `One or more image quality risks are high (${highRisks}). Manual inspection recommended.`,
    };
  }

  const mediumRisks = [
    quality.blurRisk,
    quality.glareRisk,
    quality.lowLightRisk,
    quality.orientationRisk,
  ].filter((r) => r === "medium").length;

  if (mediumRisks >= 2) {
    return {
      status: "needs_review",
      severity: "warning",
      reason: `Multiple medium image quality risks detected (${mediumRisks}).`,
    };
  }

  return {
    status: "match",
    severity: "info",
  };
}

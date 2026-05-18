import { randomUUID } from "node:crypto";

import type { ColaApplication } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type {
  AuditSummary,
  CommodityIntent,
  OverallStatus,
  VerificationCheck,
  VerificationReport,
} from "@/types/verification";

import { compareBrand } from "@/lib/verification/compare-brand";
import { compareAlcoholContent } from "@/lib/verification/compare-abv";
import { compareVolumes } from "@/lib/verification/compare-volume";
import { compareGovernmentWarning } from "@/lib/verification/compare-warning";
import {
  compareWarningTypography,
  resolveTypographyConfig,
} from "@/lib/verification/compare-warning-typography";
import { compareCountryOfOrigin } from "@/lib/verification/compare-country-origin";
import { evaluateImageQuality } from "@/lib/verification/image-quality";
import { compareWineFields } from "@/lib/verification/compare-wine-fields";
import { compareDistilledSpiritsFields } from "@/lib/verification/compare-distilled-spirits-fields";
import { compareMaltFields } from "@/lib/verification/compare-malt-fields";
import { normalizeText, similarity } from "@/lib/verification/normalize";
import { getProductRuleSet } from "@/lib/rules/product-rules";

export interface VerifyApplicationInput {
  application: ColaApplication;
  extractedLabel: ExtractedLabel;
  commodityIntent: CommodityIntent;
}

export function verifyApplication(
  input: VerifyApplicationInput,
): VerificationReport {
  const { application, extractedLabel, commodityIntent } = input;
  const checks: VerificationCheck[] = [];

  const info = application.colaInformationStep;
  const fields = extractedLabel.normalizedFields;
  const { productType, sourceOfProduct } = application.applicationTypeStep;

  // Brand name (required).
  const brand = compareBrand(info.brandName, fields.brandName?.value);
  checks.push({
    id: "shared.brandName",
    fieldKey: "brandName",
    label: "Brand name",
    expectedValue: info.brandName,
    extractedValue: fields.brandName?.value ?? null,
    status: brand.status,
    severity:
      brand.status === "match"
        ? "info"
        : brand.status === "likely_match"
          ? "warning"
          : brand.status === "missing"
            ? "error"
            : "error",
    confidence: fields.brandName?.confidence,
    source: "application_field_match",
    automationLevel: "automated",
    reason:
      brand.status === "mismatch"
        ? `Brand name normalized similarity ${(brand.similarity * 100).toFixed(0)}% — manual review required.`
        : brand.status === "likely_match"
          ? `Normalized similarity ${(brand.similarity * 100).toFixed(0)}%.`
          : undefined,
    evidenceText: fields.brandName?.evidenceText,
  });

  // DBA / trade name (optional).
  if (info.dbaTradeName) {
    const dba = compareBrand(info.dbaTradeName, fields.dbaTradeName?.value);
    checks.push({
      id: "shared.dbaTradeName",
      fieldKey: "dbaTradeName",
      label: "DBA / trade name",
      expectedValue: info.dbaTradeName,
      extractedValue: fields.dbaTradeName?.value ?? null,
      status: dba.status,
      severity:
        dba.status === "match" || dba.status === "not_applicable"
          ? "info"
          : "warning",
      confidence: fields.dbaTradeName?.confidence,
      source: "application_field_match",
      automationLevel: "automated",
      evidenceText: fields.dbaTradeName?.evidenceText,
    });
  }

  // Fanciful name (optional).
  if (info.fancifulName) {
    const fanciful = compareBrand(
      info.fancifulName,
      fields.fancifulName?.value,
    );
    checks.push({
      id: "shared.fancifulName",
      fieldKey: "fancifulName",
      label: "Fanciful name",
      expectedValue: info.fancifulName,
      extractedValue: fields.fancifulName?.value ?? null,
      status: fanciful.status,
      severity:
        fanciful.status === "match" || fanciful.status === "not_applicable"
          ? "info"
          : "warning",
      confidence: fields.fancifulName?.confidence,
      source: "application_field_match",
      automationLevel: "automated",
      evidenceText: fields.fancifulName?.evidenceText,
    });
  }

  // Class / type designation present.
  const classOrType = fields.classOrTypeDesignation;
  checks.push({
    id: "shared.classOrTypeDesignation",
    fieldKey: "classOrTypeDesignation",
    label: "Class / type designation",
    expectedValue: "A class or type designation must appear on the label.",
    extractedValue: classOrType?.value ?? null,
    status: normalizeText(classOrType?.value) ? "match" : "missing",
    severity: normalizeText(classOrType?.value) ? "info" : "error",
    confidence: classOrType?.confidence,
    source: "mandatory_label_presence",
    automationLevel: "automated",
    reason: normalizeText(classOrType?.value)
      ? undefined
      : "Class or type designation was not detected on the label.",
    evidenceText: classOrType?.evidenceText,
  });

  // Net contents.
  const volumeCheck = compareVolumes(
    info.netContents,
    fields.netContents?.values
      .map((v) => v.value)
      .filter((v): v is string => !!v),
  );
  checks.push({
    id: "shared.netContents",
    fieldKey: "netContents",
    label: "Net contents",
    expectedValue: info.netContents?.join(", "),
    extractedValue:
      fields.netContents?.values
        ?.map((v) => v.value)
        .filter(Boolean)
        .join(", ") ?? null,
    status: volumeCheck.status,
    severity:
      volumeCheck.status === "match"
        ? "info"
        : volumeCheck.status === "likely_match"
          ? "warning"
          : volumeCheck.status === "missing"
            ? "error"
            : volumeCheck.status === "not_applicable"
              ? "info"
              : "warning",
    source: "application_field_match",
    automationLevel: "automated",
    reason: volumeCheck.reason,
  });

  // Alcohol content.
  const alcoholResult = compareAlcoholContent({
    productType,
    expectedAlcoholContent: info.alcoholContent,
    extractedAlcoholContent: fields.alcoholContent?.value,
    extractedProof: fields.proof?.value,
  });
  checks.push({
    id: "shared.alcoholContent",
    fieldKey: "alcoholContent",
    label: "Alcohol content",
    expectedValue: info.alcoholContent ?? null,
    extractedValue:
      fields.alcoholContent?.value ?? fields.proof?.value ?? null,
    status: alcoholResult.status,
    severity:
      alcoholResult.status === "match"
        ? "info"
        : alcoholResult.status === "likely_match"
          ? "warning"
          : alcoholResult.status === "not_applicable"
            ? "info"
            : alcoholResult.status === "missing"
              ? "warning"
              : "warning",
    confidence: fields.alcoholContent?.confidence ?? fields.proof?.confidence,
    source: "application_field_match",
    automationLevel: "automated",
    reason: alcoholResult.reason,
    evidenceText:
      fields.alcoholContent?.evidenceText ?? fields.proof?.evidenceText,
  });

  // Name & address (optional).
  if (info.nameAndAddress) {
    const expectedNorm = normalizeText(info.nameAndAddress);
    const extractedNorm = normalizeText(fields.nameAndAddress?.value);
    const score = expectedNorm && extractedNorm
      ? similarity(expectedNorm, extractedNorm)
      : 0;
    let status: VerificationCheck["status"] = "missing";
    if (!extractedNorm) status = "missing";
    else if (extractedNorm === expectedNorm) status = "match";
    else if (score >= 0.85) status = "likely_match";
    else status = "mismatch";

    checks.push({
      id: "shared.nameAndAddress",
      fieldKey: "nameAndAddress",
      label: "Name & address",
      expectedValue: info.nameAndAddress,
      extractedValue: fields.nameAndAddress?.value ?? null,
      status,
      severity:
        status === "match" ? "info" : status === "missing" ? "warning" : "warning",
      confidence: fields.nameAndAddress?.confidence,
      source: "application_field_match",
      automationLevel: "automated",
      evidenceText: fields.nameAndAddress?.evidenceText,
    });
  }

  // Country of origin (imported only).
  const countryCheck = compareCountryOfOrigin({
    sourceOfProduct,
    expected: info.countryOfOrigin,
    extracted: fields.countryOfOrigin?.value,
  });
  if (countryCheck.status !== "not_applicable") {
    checks.push({
      id: "shared.countryOfOrigin",
      fieldKey: "countryOfOrigin",
      label: "Country of origin",
      expectedValue: info.countryOfOrigin ?? null,
      extractedValue: fields.countryOfOrigin?.value ?? null,
      status: countryCheck.status,
      severity: countryCheck.severity,
      confidence: fields.countryOfOrigin?.confidence,
      source: "application_field_match",
      automationLevel: "automated",
      reason: countryCheck.reason,
      evidenceText: fields.countryOfOrigin?.evidenceText,
    });
  }

  // Government warning.
  const warningCheck = compareGovernmentWarning(fields.governmentWarning?.value);
  checks.push({
    id: "shared.governmentWarning",
    fieldKey: "governmentWarning",
    label: "Government warning",
    expectedValue:
      "Mandatory government warning, uppercase prefix, required wording present.",
    extractedValue: fields.governmentWarning?.value ?? null,
    status: warningCheck.status,
    severity: warningCheck.severity,
    confidence: fields.governmentWarning?.confidence,
    source: "mandatory_label_presence",
    automationLevel: "automated",
    reason: warningCheck.reason,
    evidenceText: fields.governmentWarning?.evidenceText,
  });

  // Requirement #15 Tier 1 + Tier 2: bold-prefix detection + relative
  // sizing (vs the brand name as a same-label reference). When the
  // extractor provides typography metadata, these checks supersede the
  // legacy "human review required" fallback below. When they don't (legacy
  // records, mock extractor without typography fields, or Gemini failing
  // to populate the new fields), we fall through to the human-review
  // check so the reviewer is still on the hook for the unknowns —
  // including absolute mm-compliance per 27 CFR 16.22 (Tier 3, out of
  // scope; see docs/research/2026-05-18-gov-warning-typography-enforcement.md).
  const typographyConfig = resolveTypographyConfig();
  const typographyChecks = compareWarningTypography(
    fields.governmentWarningTypography,
    fields.brandName,
    typographyConfig,
  );
  if (typographyChecks.boldPrefix) checks.push(typographyChecks.boldPrefix);
  if (typographyChecks.relativeSizing)
    checks.push(typographyChecks.relativeSizing);

  const anyTypographyAutomated =
    typographyChecks.boldPrefix !== null ||
    typographyChecks.relativeSizing !== null;

  if (!anyTypographyAutomated) {
    // Legacy fallback — no typography signal from the extractor, so the
    // reviewer is responsible for bold + size verification too.
    checks.push({
      id: "shared.warningStyle",
      fieldKey: "warningStyle",
      label: "Warning typeface, size, and contrast",
      expectedValue:
        "Government warning typeface, size, and contrast meet regulatory requirements.",
      extractedValue: null,
      status: "needs_review",
      severity: "warning",
      source: "human_review",
      automationLevel: "human_review_required",
      reason:
        "OCR did not return typography metadata; reviewer should confirm bold, size, and readability.",
    });
  } else {
    // Tier 3 (absolute mm-compliance) is still reviewer-side even when
    // Tier 1+2 are automated. Surface a narrower human-review check so
    // reviewers know the remaining responsibility.
    checks.push({
      id: "shared.warningStyle.absoluteSize",
      fieldKey: "warningStyle",
      label: "Warning meets minimum mm size for container (27 CFR 16.22)",
      expectedValue:
        "Type size satisfies the mm minimum scaled by container volume.",
      extractedValue: null,
      status: "needs_review",
      severity: "warning",
      source: "human_review",
      automationLevel: "human_review_required",
      reason:
        "Absolute font size in mm requires physical-scale calibration not currently automated. Reviewer confirms against 27 CFR 16.22.",
    });
  }

  // Image quality.
  const imageQualityResult = evaluateImageQuality(extractedLabel.imageQuality);
  checks.push({
    id: "shared.imageQuality",
    fieldKey: "imageQuality",
    label: "Image quality",
    expectedValue: "Label imagery should be sharp and well-lit.",
    extractedValue: imageQualityResult.reason ?? "OK",
    status: imageQualityResult.status,
    severity: imageQualityResult.severity,
    source: "image_quality",
    automationLevel: "automated",
    reason: imageQualityResult.reason,
  });

  // Commodity consistency.
  if (commodityIntent.conflictDetected) {
    checks.push({
      id: "shared.commodityConsistency",
      fieldKey: "commodityConsistency",
      label: "Commodity routing consistency",
      expectedValue: commodityIntent.selectedProductType,
      extractedValue: commodityIntent.inferredProductType ?? null,
      status: "needs_review",
      severity: "warning",
      source: "commodity_consistency",
      automationLevel: "partially_automated",
      reason: commodityIntent.reason,
    });
  } else {
    checks.push({
      id: "shared.commodityConsistency",
      fieldKey: "commodityConsistency",
      label: "Commodity routing consistency",
      expectedValue: commodityIntent.selectedProductType,
      extractedValue: commodityIntent.inferredProductType ?? null,
      status: "match",
      severity: "info",
      source: "commodity_consistency",
      automationLevel: "automated",
      reason: commodityIntent.reason,
    });
  }

  // Product-specific.
  if (productType === "wine" || productType === "domestic_sake") {
    checks.push(
      ...compareWineFields({
        wineFields: info.wine,
        extractedFields: fields,
      }),
    );
  }
  if (productType === "distilled_spirits") {
    checks.push(
      ...compareDistilledSpiritsFields({
        fields: info.distilledSpirits,
        extractedFields: fields,
      }),
    );
  }
  if (productType === "malt_beverage") {
    checks.push(
      ...compareMaltFields({
        fields: info.maltBeverage,
        extractedFields: fields,
      }),
    );
  }

  const auditSummary = buildAuditSummary(checks);
  const overallStatus = decideOverallStatus(checks);
  const overallConfidence = averageConfidence(checks);
  const ruleSet = getProductRuleSet(productType);

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    productType,
    sourceOfProduct,
    overallStatus,
    overallConfidence,
    checks,
    commodityIntent,
    auditSummary: {
      ...auditSummary,
      // Document the rule set used (informational).
      // We surface this in UI via auditSummary text; structure stays simple.
    },
    ...(ruleSet.notes ? {} : {}), // Notes intentionally not in summary contract.
  };
}

function buildAuditSummary(checks: VerificationCheck[]): AuditSummary {
  return {
    totalChecks: checks.length,
    passing: checks.filter((c) => c.status === "match").length,
    warnings: checks.filter((c) => c.severity === "warning").length,
    errors: checks.filter((c) => c.severity === "error").length,
    needsReview: checks.filter((c) => c.status === "needs_review").length,
    notApplicable: checks.filter((c) => c.status === "not_applicable").length,
  };
}

function decideOverallStatus(checks: VerificationCheck[]): OverallStatus {
  const hasFailingRequired = checks.some(
    (c) =>
      c.severity === "error" &&
      (c.status === "mismatch" || c.status === "missing"),
  );
  if (hasFailingRequired) return "fail";

  const hasNeedsReview = checks.some(
    (c) =>
      c.status === "needs_review" ||
      c.status === "likely_match" ||
      c.severity === "warning" ||
      c.automationLevel === "human_review_required",
  );
  if (hasNeedsReview) return "needs_review";

  return "pass";
}

function averageConfidence(checks: VerificationCheck[]): number | undefined {
  const withConfidence = checks
    .map((c) => c.confidence)
    .filter((c): c is number => typeof c === "number");
  if (withConfidence.length === 0) return undefined;
  const sum = withConfidence.reduce((a, b) => a + b, 0);
  return Math.round((sum / withConfidence.length) * 100) / 100;
}

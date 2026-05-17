import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeExtractionScores,
  computeVerificationScores,
  hashPrompt,
  resetForTests,
  summarizeRawText,
  tracedExtract,
  tracedVerify,
} from "@/lib/observability/braintrust";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";

function fullWineLabel(): ExtractedLabel {
  return {
    rawText: "ACME WINERY 2021 Cabernet 13.5%",
    inferredProductType: "wine",
    inferredProductTypeConfidence: 0.9,
    imagesAnalyzed: ["img-1"],
    imageQuality: { overallReadability: "good" },
    normalizedFields: {
      brandName: { value: "ACME WINERY", confidence: 0.9 },
      classOrTypeDesignation: { value: "Red Wine", confidence: 0.9 },
      governmentWarning: { value: "GOVERNMENT WARNING: ...", confidence: 0.9 },
      netContents: {
        values: [{ value: "750 mL", confidence: 0.9 }],
      },
      alcoholContent: { value: "13.5% Alc./Vol.", confidence: 0.9 },
      nameAndAddress: { value: "Bottled by ACME, Napa", confidence: 0.9 },
      countryOfOrigin: { value: "United States", confidence: 0.9 },
      vintageYear: { value: "2021", confidence: 0.9 },
      grapeVarietals: { values: [{ value: "Cabernet", confidence: 0.9 }] },
      appellation: { value: "Napa Valley", confidence: 0.9 },
      sulfiteDeclaration: { value: "Contains Sulfites", confidence: 0.9 },
      dbaTradeName: { value: "ACME LLC", confidence: 0.9 },
      fancifulName: { value: "Estate Reserve", confidence: 0.9 },
      foreignLanguageText: { value: "Vin Rouge", confidence: 0.9 },
      specialWordingOrDesigns: { value: "Award winning", confidence: 0.9 },
    },
  };
}

function emptyWineLabel(): ExtractedLabel {
  return {
    rawText: "",
    inferredProductType: "wine",
    inferredProductTypeConfidence: 0.4,
    imagesAnalyzed: ["img-1"],
    imageQuality: { overallReadability: "poor" },
    normalizedFields: {},
  };
}

function partialWineLabel(): ExtractedLabel {
  const base = fullWineLabel();
  return {
    ...base,
    imageQuality: { overallReadability: "fair" },
    normalizedFields: {
      brandName: base.normalizedFields.brandName,
      netContents: base.normalizedFields.netContents,
      alcoholContent: base.normalizedFields.alcoholContent,
    },
  };
}

function reportWith(
  status: "pass" | "needs_review" | "fail",
  audit: { totalChecks: number; passing: number; warnings: number; errors: number; needsReview: number; notApplicable: number },
): VerificationReport {
  return {
    id: "rep-1",
    createdAt: new Date().toISOString(),
    productType: "wine",
    sourceOfProduct: "domestic",
    overallStatus: status,
    overallConfidence: 0.9,
    checks: [],
    commodityIntent: {
      selectedProductType: "wine",
      inferredProductType: "wine",
      routingDecision: "wine",
      conflictDetected: false,
      reason: "ok",
    },
    auditSummary: audit,
  };
}

describe("computeExtractionScores", () => {
  it("returns 1.0 coverage and all-present flags on a fully-extracted wine label", () => {
    const scores = computeExtractionScores(fullWineLabel(), "wine");
    expect(scores["extraction.fieldCoverage"]).toBe(1);
    expect(scores["extraction.brandNamePresent"]).toBe(1);
    expect(scores["extraction.classOrTypePresent"]).toBe(1);
    expect(scores["extraction.governmentWarningPresent"]).toBe(1);
    expect(scores["extraction.netContentsPresent"]).toBe(1);
    expect(scores["extraction.alcoholContentPresent"]).toBe(1);
    expect(scores["extraction.imageReadability"]).toBe(1);
  });

  it("returns 0 coverage and 0 presence flags on an empty label (BUG-01 signature)", () => {
    const scores = computeExtractionScores(emptyWineLabel(), "wine");
    expect(scores["extraction.fieldCoverage"]).toBe(0);
    expect(scores["extraction.brandNamePresent"]).toBe(0);
    expect(scores["extraction.classOrTypePresent"]).toBe(0);
    expect(scores["extraction.governmentWarningPresent"]).toBe(0);
    expect(scores["extraction.netContentsPresent"]).toBe(0);
    expect(scores["extraction.alcoholContentPresent"]).toBe(0);
    expect(scores["extraction.imageReadability"]).toBe(0);
  });

  it("returns a partial coverage ratio when only some fields are populated", () => {
    const scores = computeExtractionScores(partialWineLabel(), "wine");
    expect(scores["extraction.fieldCoverage"]).toBeGreaterThan(0);
    expect(scores["extraction.fieldCoverage"]).toBeLessThan(1);
    expect(scores["extraction.brandNamePresent"]).toBe(1);
    expect(scores["extraction.governmentWarningPresent"]).toBe(0);
    expect(scores["extraction.imageReadability"]).toBe(0.5);
  });

  it("treats whitespace-only field values as not populated", () => {
    const label = emptyWineLabel();
    label.normalizedFields.brandName = { value: "   ", confidence: 0.5 };
    const scores = computeExtractionScores(label, "wine");
    expect(scores["extraction.brandNamePresent"]).toBe(0);
  });

  it("treats a netContents list with at least one non-empty value as populated", () => {
    const label = emptyWineLabel();
    label.normalizedFields.netContents = {
      values: [{ value: "750 mL", confidence: 0.9 }],
    };
    const scores = computeExtractionScores(label, "wine");
    expect(scores["extraction.netContentsPresent"]).toBe(1);
  });
});

describe("computeVerificationScores", () => {
  it("returns verification.passes=1 on pass", () => {
    const scores = computeVerificationScores(
      reportWith("pass", { totalChecks: 8, passing: 8, warnings: 0, errors: 0, needsReview: 0, notApplicable: 0 }),
    );
    expect(scores["verification.passes"]).toBe(1);
    expect(scores["verification.errorRatio"]).toBe(1);
    expect(scores["verification.warningRatio"]).toBe(1);
  });

  it("returns verification.passes=0.5 on needs_review", () => {
    const scores = computeVerificationScores(
      reportWith("needs_review", { totalChecks: 8, passing: 5, warnings: 2, errors: 0, needsReview: 1, notApplicable: 0 }),
    );
    expect(scores["verification.passes"]).toBe(0.5);
    expect(scores["verification.warningRatio"]).toBe(0.75);
  });

  it("returns verification.passes=0 and a low errorRatio on fail", () => {
    const scores = computeVerificationScores(
      reportWith("fail", { totalChecks: 8, passing: 2, warnings: 1, errors: 3, needsReview: 1, notApplicable: 1 }),
    );
    expect(scores["verification.passes"]).toBe(0);
    expect(scores["verification.errorRatio"]).toBe(0.63);
  });
});

describe("summarizeRawText", () => {
  it("returns the input unchanged when under the byte cap", () => {
    expect(summarizeRawText("hello world")).toBe("hello world");
  });

  it("truncates at the byte cap and appends a marker", () => {
    const long = "a".repeat(5000);
    const out = summarizeRawText(long, 4000);
    expect(out.endsWith("…")).toBe(true);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(4000 + 3);
  });

  it("does not slice mid-codepoint on multibyte input", () => {
    const multibyte = "é".repeat(3000);
    const out = summarizeRawText(multibyte, 100);
    expect(() => Buffer.from(out, "utf8").toString("utf8")).not.toThrow();
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for null/undefined", () => {
    expect(summarizeRawText(null)).toBe("");
    expect(summarizeRawText(undefined)).toBe("");
  });
});

describe("hashPrompt", () => {
  it("is deterministic and 12 hex characters", () => {
    const a = hashPrompt("some prompt text");
    const b = hashPrompt("some prompt text");
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs across different prompts", () => {
    expect(hashPrompt("prompt v1")).not.toBe(hashPrompt("prompt v2"));
  });
});

describe("tracedVerify / tracedExtract no-op behavior", () => {
  beforeEach(() => {
    resetForTests();
    delete process.env.BRAINTRUST_API_KEY;
  });

  afterEach(() => {
    resetForTests();
    delete process.env.BRAINTRUST_API_KEY;
  });

  it("tracedVerify returns the inner function value when BRAINTRUST_API_KEY is unset", async () => {
    const result = await tracedVerify(async (span) => {
      span.log({ input: "x" });
      return 42;
    });
    expect(result).toBe(42);
  });

  it("tracedExtract returns the inner function value when BRAINTRUST_API_KEY is unset", async () => {
    const result = await tracedExtract(async (span) => {
      span.log({ output: "y" });
      return "ok";
    });
    expect(result).toBe("ok");
  });

  it("propagates errors from the inner function", async () => {
    await expect(
      tracedVerify(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

import { describe, expect, it } from "vitest";

import { judge } from "@/lib/evals/judge";
import type { VerificationReport } from "@/types/verification";

function makeReport(overrides?: Partial<VerificationReport>): VerificationReport {
  return {
    id: "test",
    createdAt: "2026-05-16T00:00:00Z",
    productType: "wine",
    sourceOfProduct: "domestic",
    overallStatus: "needs_review",
    checks: [
      {
        id: "shared.brandName",
        fieldKey: "brandName",
        label: "Brand",
        expectedValue: "Cypress",
        extractedValue: "Cypress",
        status: "match",
        severity: "info",
        source: "application_field_match",
        automationLevel: "automated",
      },
    ],
    commodityIntent: {
      selectedProductType: "wine",
      routingDecision: "wine",
      conflictDetected: false,
      reason: "ok",
    },
    auditSummary: {
      totalChecks: 1,
      passing: 1,
      warnings: 0,
      errors: 0,
      needsReview: 0,
      notApplicable: 0,
    },
    ...overrides,
  };
}

describe("judge", () => {
  it("accepts_when_overall_status_matches", () => {
    const report = makeReport({ overallStatus: "needs_review" });
    const result = judge(report, { overallStatus: ["needs_review"] });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("fails_when_overall_status_not_in_accept_list", () => {
    const report = makeReport({ overallStatus: "fail" });
    const result = judge(report, { overallStatus: ["needs_review", "pass"] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/overallStatus=fail/);
  });

  it("enforces_min_failing_checks", () => {
    const report = makeReport({
      checks: [
        {
          id: "x",
          fieldKey: "x",
          label: "x",
          status: "match",
          severity: "info",
          source: "application_field_match",
          automationLevel: "automated",
        },
      ],
    });
    const result = judge(report, {
      overallStatus: ["needs_review"],
      minFailingChecks: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/expected ≥1/);
  });

  it("enforces_max_failing_checks", () => {
    const report = makeReport({
      checks: [
        {
          id: "a",
          fieldKey: "a",
          label: "a",
          status: "mismatch",
          severity: "error",
          source: "application_field_match",
          automationLevel: "automated",
        },
        {
          id: "b",
          fieldKey: "b",
          label: "b",
          status: "missing",
          severity: "error",
          source: "application_field_match",
          automationLevel: "automated",
        },
      ],
    });
    const result = judge(report, {
      overallStatus: ["needs_review"],
      maxFailingChecks: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/expected ≤1/);
  });

  it("accepts_mustHaveFieldStatus_when_present_and_matches", () => {
    const report = makeReport({
      checks: [
        {
          id: "shared.brandName",
          fieldKey: "brandName",
          label: "Brand",
          status: "match",
          severity: "info",
          source: "application_field_match",
          automationLevel: "automated",
        },
      ],
    });
    const result = judge(report, {
      overallStatus: ["needs_review"],
      mustHaveFieldStatus: [{ fieldKey: "brandName", status: "match" }],
    });
    expect(result.ok).toBe(true);
  });

  it("fails_mustHaveFieldStatus_when_check_missing", () => {
    const report = makeReport({ checks: [] });
    const result = judge(report, {
      overallStatus: ["needs_review"],
      mustHaveFieldStatus: [{ fieldKey: "brandName", status: "match" }],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/not present/);
  });

  it("fails_mustHaveFieldStatus_when_status_differs", () => {
    const report = makeReport({
      checks: [
        {
          id: "shared.brandName",
          fieldKey: "brandName",
          label: "Brand",
          status: "mismatch",
          severity: "error",
          source: "application_field_match",
          automationLevel: "automated",
        },
      ],
    });
    const result = judge(report, {
      overallStatus: ["needs_review"],
      mustHaveFieldStatus: [{ fieldKey: "brandName", status: "match" }],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/status=mismatch, expected match/);
  });

  it("accepts_mustHaveCommodityConflict_when_true", () => {
    const report = makeReport({
      commodityIntent: {
        selectedProductType: "wine",
        routingDecision: "wine",
        conflictDetected: true,
        reason: "conflict",
      },
    });
    const result = judge(report, {
      overallStatus: ["needs_review"],
      mustHaveCommodityConflict: true,
    });
    expect(result.ok).toBe(true);
  });

  it("fails_mustHaveCommodityConflict_when_not_true", () => {
    const report = makeReport();
    const result = judge(report, {
      overallStatus: ["needs_review"],
      mustHaveCommodityConflict: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/conflictDetected=false/);
  });
});

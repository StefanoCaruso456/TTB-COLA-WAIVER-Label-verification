// Judges a VerificationReport against a fixture's category-level expectations.
// Pure function so it's unit-testable independent of the runner.
//
// See docs/specs/phase-1-eval-infrastructure.md.

import type { VerificationReport } from "@/types/verification";
import type { Expectations } from "./expectations.schema";

export interface JudgeResult {
  ok: boolean;
  reasons: string[];
}

const FAIL_LIKE_STATUSES = new Set(["mismatch", "missing"]);

export function judge(actual: VerificationReport, expectations: Expectations): JudgeResult {
  const reasons: string[] = [];

  if (!expectations.overallStatus.includes(actual.overallStatus)) {
    reasons.push(
      `overallStatus=${actual.overallStatus} not in [${expectations.overallStatus.join("|")}]`,
    );
  }

  const failingChecks = actual.checks.filter((c) => FAIL_LIKE_STATUSES.has(c.status));
  const failingCount = failingChecks.length;

  if (
    expectations.minFailingChecks !== undefined &&
    failingCount < expectations.minFailingChecks
  ) {
    reasons.push(
      `failing checks=${failingCount}, expected ≥${expectations.minFailingChecks}`,
    );
  }

  if (
    expectations.maxFailingChecks !== undefined &&
    failingCount > expectations.maxFailingChecks
  ) {
    reasons.push(
      `failing checks=${failingCount}, expected ≤${expectations.maxFailingChecks}`,
    );
  }

  if (expectations.mustHaveFieldStatus) {
    for (const ex of expectations.mustHaveFieldStatus) {
      const check = actual.checks.find((c) => c.fieldKey === ex.fieldKey);
      if (!check) {
        reasons.push(`expected check fieldKey=${ex.fieldKey} not present in report`);
        continue;
      }
      if (check.status !== ex.status) {
        reasons.push(
          `fieldKey=${ex.fieldKey} status=${check.status}, expected ${ex.status}`,
        );
      }
    }
  }

  if (
    expectations.mustHaveCommodityConflict === true &&
    actual.commodityIntent.conflictDetected !== true
  ) {
    reasons.push("commodityIntent.conflictDetected=false, expected true");
  }

  return { ok: reasons.length === 0, reasons };
}

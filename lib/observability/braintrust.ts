import { createHash } from "node:crypto";
import { initLogger, traced } from "braintrust";

import { getOcrTargetsForProductType } from "@/lib/rules/ocr-targets";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { ProductType } from "@/types/cola";
import type { VerificationReport } from "@/types/verification";

const DEFAULT_PROJECT_NAME = "ttb-cola-verifier";

// Per-call latency SLO. From docs/roadmap.md (Phase 3, p.478) and
// phase-3-synchronous-batch.md (5 files × ~5s each = ~25s). Tracked as a
// binary score so the Braintrust Monitor view shows % of calls meeting SLO.
export const LATENCY_SLO_MS = 5000;

export function computeLatencyScore(
  durationMs: number,
  sloMs: number = LATENCY_SLO_MS,
): number {
  return durationMs <= sloMs ? 1 : 0;
}

let initialized = false;

export function initBraintrust(): void {
  if (initialized) return;
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    initialized = true;
    return;
  }
  try {
    initLogger({
      projectName: process.env.BRAINTRUST_PROJECT ?? DEFAULT_PROJECT_NAME,
      apiKey,
    });
  } catch (err) {
    console.warn("[braintrust] initLogger failed; telemetry disabled", err);
  }
  initialized = true;
}

export function resetForTests(): void {
  initialized = false;
}

type SpanLike = Parameters<Parameters<typeof traced>[0]>[0];

// Braintrust's `traced` catches its own infrastructure errors internally and
// only re-throws errors that originate inside the user-supplied function.
// Without an active logger it falls through to a no-op span and returns the
// inner function's value. So a thin wrapper is enough — no try/catch needed.

export async function tracedVerify<T>(
  fn: (span: SpanLike) => Promise<T>,
): Promise<T> {
  initBraintrust();
  return traced(fn, { name: "verify", type: "task" });
}

export async function tracedExtract<T>(
  fn: (span: SpanLike) => Promise<T>,
): Promise<T> {
  initBraintrust();
  return traced(fn, { name: "gemini.extract", type: "llm" });
}

function isFieldPopulated(field: unknown): boolean {
  if (!field || typeof field !== "object") return false;
  const v = (field as { value?: unknown; values?: unknown[] }).value;
  if (typeof v === "string" && v.trim().length > 0) return true;
  const list = (field as { values?: { value?: string | null }[] }).values;
  if (Array.isArray(list) && list.some((x) => x.value && x.value.trim().length > 0)) {
    return true;
  }
  return false;
}

export function computeExtractionScores(
  label: ExtractedLabel,
  productType: ProductType,
): Record<string, number> {
  const targets = getOcrTargetsForProductType(productType);
  const fields = label.normalizedFields ?? {};
  const populated = targets.filter((t) =>
    isFieldPopulated((fields as Record<string, unknown>)[t.key]),
  ).length;
  const fieldCoverage = targets.length === 0 ? 0 : populated / targets.length;

  const readabilityMap: Record<string, number> = {
    good: 1,
    fair: 0.5,
    poor: 0,
  };
  const readability = label.imageQuality?.overallReadability ?? "fair";

  return {
    "extraction.fieldCoverage": round2(fieldCoverage),
    "extraction.brandNamePresent": isFieldPopulated(fields.brandName) ? 1 : 0,
    "extraction.classOrTypePresent": isFieldPopulated(fields.classOrTypeDesignation)
      ? 1
      : 0,
    "extraction.governmentWarningPresent": isFieldPopulated(fields.governmentWarning)
      ? 1
      : 0,
    "extraction.netContentsPresent": isFieldPopulated(fields.netContents) ? 1 : 0,
    "extraction.alcoholContentPresent": isFieldPopulated(fields.alcoholContent)
      ? 1
      : 0,
    "extraction.imageReadability": readabilityMap[readability] ?? 0.5,
  };
}

export function computeVerificationScores(
  report: VerificationReport,
): Record<string, number> {
  const total = report.auditSummary.totalChecks || 1;
  const passes =
    report.overallStatus === "pass"
      ? 1
      : report.overallStatus === "needs_review"
        ? 0.5
        : 0;
  return {
    "verification.passes": passes,
    "verification.errorRatio": round2(1 - report.auditSummary.errors / total),
    "verification.warningRatio": round2(1 - report.auditSummary.warnings / total),
  };
}

export function summarizeRawText(
  text: string | undefined | null,
  maxBytes = 4000,
): string {
  if (!text) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;
  let safe = maxBytes;
  while (safe > 0 && (buf[safe] & 0xc0) === 0x80) safe--;
  return buf.subarray(0, safe).toString("utf8") + "…";
}

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function targetCountForProductType(productType: ProductType): number {
  return getOcrTargetsForProductType(productType).length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";

import { ImageQualityWarning } from "./ImageQualityWarning";
import { OverallStatusBadge } from "./OverallStatusBadge";
import { ProductTypeBadge } from "./ProductTypeBadge";
import { VerificationCheckCard } from "./VerificationCheckCard";

export function VerificationResults({
  report,
  extractedLabel,
}: {
  report: VerificationReport;
  extractedLabel?: ExtractedLabel;
}) {
  const { auditSummary, commodityIntent } = report;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <OverallStatusBadge status={report.overallStatus} />
          <ProductTypeBadge productType={report.productType} />
          <span className="text-xs text-slate-500">
            {report.sourceOfProduct === "imported" ? "Imported" : "Domestic"}
          </span>
          {typeof report.overallConfidence === "number" && (
            <span className="text-xs text-slate-500">
              Average extraction confidence:{" "}
              <span className="text-slate-700 font-medium">
                {(report.overallConfidence * 100).toFixed(0)}%
              </span>
            </span>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
          <SummaryCell label="Total" value={auditSummary.totalChecks} />
          <SummaryCell label="Passing" value={auditSummary.passing} accent="success" />
          <SummaryCell label="Warnings" value={auditSummary.warnings} accent="warning" />
          <SummaryCell label="Errors" value={auditSummary.errors} accent="danger" />
          <SummaryCell label="Review" value={auditSummary.needsReview} accent="warning" />
          <SummaryCell label="N/A" value={auditSummary.notApplicable} />
        </dl>

        {commodityIntent.conflictDetected ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-medium">Commodity routing conflict</div>
            <p className="text-xs">{commodityIntent.reason}</p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            <span className="font-medium">Routing:</span>{" "}
            {commodityIntent.reason}
          </div>
        )}
      </header>

      {extractedLabel?.imageQuality && (
        <ImageQualityWarning quality={extractedLabel.imageQuality} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {report.checks.map((check) => (
          <VerificationCheckCard key={check.id} check={check} />
        ))}
      </div>
    </section>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "success" | "warning" | "danger";
}) {
  const accentClass =
    accent === "success"
      ? "text-emerald-700"
      : accent === "warning"
        ? "text-amber-700"
        : accent === "danger"
          ? "text-rose-700"
          : "text-slate-700";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className={`text-lg font-semibold ${accentClass}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}

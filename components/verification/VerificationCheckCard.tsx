import type { VerificationCheck } from "@/types/verification";

const STATUS_STYLES: Record<VerificationCheck["status"], string> = {
  match: "border-emerald-200 bg-emerald-50",
  likely_match: "border-amber-200 bg-amber-50",
  mismatch: "border-rose-200 bg-rose-50",
  missing: "border-rose-200 bg-rose-50",
  needs_review: "border-amber-200 bg-amber-50",
  not_applicable: "border-slate-200 bg-slate-50",
};

const STATUS_LABEL: Record<VerificationCheck["status"], string> = {
  match: "Match",
  likely_match: "Likely match",
  mismatch: "Mismatch",
  missing: "Missing",
  needs_review: "Needs review",
  not_applicable: "Not applicable",
};

const SEVERITY_DOT: Record<VerificationCheck["severity"], string> = {
  info: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
};

export function VerificationCheckCard({ check }: { check: VerificationCheck }) {
  return (
    <article
      className={`rounded-xl border ${STATUS_STYLES[check.status]} p-4 flex flex-col gap-2`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${SEVERITY_DOT[check.severity]}`}
            aria-hidden
          />
          <h3 className="font-medium text-sm">{check.label}</h3>
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-700">
          {STATUS_LABEL[check.status]}
        </span>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Expected</dt>
          <dd className="font-mono break-words text-slate-900">
            {check.expectedValue ?? <span className="text-slate-400">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Extracted</dt>
          <dd className="font-mono break-words text-slate-900">
            {check.extractedValue ?? <span className="text-slate-400">—</span>}
          </dd>
        </div>
      </dl>

      {check.reason && (
        <p className="text-xs text-slate-700">{check.reason}</p>
      )}

      <footer className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-1">
        <span>
          Source: <span className="text-slate-700">{check.source}</span>
        </span>
        <span>
          Automation: <span className="text-slate-700">{check.automationLevel}</span>
        </span>
        {typeof check.confidence === "number" && (
          <span>
            Confidence:{" "}
            <span className="text-slate-700">
              {(check.confidence * 100).toFixed(0)}%
            </span>
          </span>
        )}
      </footer>

      {check.evidenceText && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer text-slate-500">Evidence</summary>
          <p className="mt-1 font-mono whitespace-pre-wrap">
            {check.evidenceText}
          </p>
        </details>
      )}
    </article>
  );
}

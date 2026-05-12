import type { OverallStatus } from "@/types/verification";

const STYLES: Record<OverallStatus, string> = {
  pass: "bg-emerald-50 text-emerald-800 border-emerald-200",
  needs_review: "bg-amber-50 text-amber-900 border-amber-200",
  fail: "bg-rose-50 text-rose-800 border-rose-200",
};

const LABELS: Record<OverallStatus, string> = {
  pass: "Pass",
  needs_review: "Needs review",
  fail: "Fail",
};

export function OverallStatusBadge({ status }: { status: OverallStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

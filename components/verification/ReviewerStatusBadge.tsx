import type { ReviewerStatus } from "@/lib/schemas/verification-record.schema";

const STYLES: Record<ReviewerStatus, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  in_review: "bg-sky-50 text-sky-800 border-sky-200",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-50 text-rose-800 border-rose-200",
};

const LABELS: Record<ReviewerStatus, string> = {
  pending: "Pending",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
};

export const REVIEWER_STATUS_OPTIONS: { value: ReviewerStatus; label: string }[] =
  [
    { value: "pending", label: "Pending" },
    { value: "in_review", label: "In review" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ];

export function ReviewerStatusBadge({ status }: { status: ReviewerStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

export function reviewerStatusLabel(status: ReviewerStatus): string {
  return LABELS[status];
}

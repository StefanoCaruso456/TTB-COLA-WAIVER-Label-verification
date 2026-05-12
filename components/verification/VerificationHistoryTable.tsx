import Link from "next/link";
import type { VerificationRecordSummary } from "@/types/verification-record";
import { OverallStatusBadge } from "./OverallStatusBadge";
import { ProductTypeBadge } from "./ProductTypeBadge";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export function VerificationHistoryTable({
  records,
}: {
  records: VerificationRecordSummary[];
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        <p>No verifications yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          Start a new verification to populate the history.
        </p>
        <Link
          href="/new"
          className="mt-4 inline-block rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-foreground)]"
        >
          New verification
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Client / Applicant</th>
            <th className="px-4 py-3">Brand</th>
            <th className="px-4 py-3">Product type</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Report</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-3 align-top text-xs text-slate-600">
                {formatDate(r.createdAt)}
              </td>
              <td className="px-4 py-3 align-top">
                <div>{r.clientName ?? r.productName ?? "—"}</div>
                <div className="text-xs text-slate-500">
                  {r.applicantName ?? ""}
                </div>
              </td>
              <td className="px-4 py-3 align-top">{r.brandName ?? "—"}</td>
              <td className="px-4 py-3 align-top">
                <ProductTypeBadge productType={r.productType} />
              </td>
              <td className="px-4 py-3 align-top text-xs text-slate-600 capitalize">
                {r.sourceOfProduct}
              </td>
              <td className="px-4 py-3 align-top">
                <OverallStatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3 align-top text-right">
                <Link
                  href={`/verification/${r.id}`}
                  className="text-[var(--accent)] text-sm hover:underline"
                >
                  View →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

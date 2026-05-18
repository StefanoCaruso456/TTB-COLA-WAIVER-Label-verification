"use client";

import { useState } from "react";

import { BatchDrillDownPanel } from "./BatchDrillDownPanel";

interface SubmissionRow {
  rowIndex: number;
  id: string;
  fileName: string;
  fileSize: number;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  verificationRecordId: string | null;
  reportSummary: {
    overallStatus: string;
    overallConfidence: number | null;
    mismatchCount: number;
  } | null;
  isFirstRow: boolean;
}

interface Props {
  submissions: SubmissionRow[];
}

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-200",
  processing: "bg-sky-50 text-sky-800 border-sky-200",
  extracted: "bg-sky-50 text-sky-800 border-sky-200",
  verified: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-rose-50 text-rose-800 border-rose-200",
  canceled: "bg-slate-100 text-slate-500 border-slate-200",
};

const VERDICT_STYLES: Record<string, string> = {
  pass: "text-emerald-700",
  needs_review: "text-amber-700",
  fail: "text-rose-700",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function BatchDetailView({ submissions }: Props) {
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3 text-right w-10">#</th>
              <th className="px-3 py-3">File</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Verdict</th>
              <th className="px-3 py-3 text-right">Confidence</th>
              <th className="px-3 py-3 text-right">Mismatches</th>
              <th className="px-3 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => {
              const clickable = s.verificationRecordId !== null;
              const verdictClass = s.reportSummary
                ? VERDICT_STYLES[s.reportSummary.overallStatus] ??
                  "text-slate-700"
                : "text-slate-400";
              return (
                <tr
                  key={s.id}
                  data-testid={`batch-row-${s.rowIndex}`}
                  className={`border-t border-slate-100 align-top ${
                    clickable
                      ? "cursor-pointer hover:bg-slate-50"
                      : ""
                  } ${s.isFirstRow ? "bg-emerald-50/30" : ""}`}
                  onClick={() => {
                    if (clickable) setOpenRecordId(s.verificationRecordId);
                  }}
                >
                  <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                    {s.rowIndex}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-slate-900">{s.fileName}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatBytes(s.fileSize)}
                      {s.isFirstRow ? " · row 1 (inline)" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className={`px-3 py-3 text-sm font-medium ${verdictClass}`}>
                    {s.reportSummary
                      ? s.reportSummary.overallStatus.replace(/_/g, " ")
                      : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-slate-700">
                    {s.reportSummary?.overallConfidence !== null &&
                    s.reportSummary?.overallConfidence !== undefined
                      ? `${(s.reportSummary.overallConfidence * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-slate-700">
                    {s.reportSummary ? s.reportSummary.mismatchCount : "—"}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-700">
                    {s.errorCode ? (
                      <>
                        <span className="mr-1 inline-block rounded bg-rose-100 px-2 py-0.5 font-mono text-[11px] text-rose-800">
                          {s.errorCode}
                        </span>
                        <span>{s.errorMessage}</span>
                      </>
                    ) : clickable ? (
                      <span className="text-[var(--accent)]">
                        click to view →
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BatchDrillDownPanel
        recordId={openRecordId}
        onClose={() => setOpenRecordId(null)}
      />
    </>
  );
}

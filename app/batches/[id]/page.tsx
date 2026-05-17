import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { getBatchById } from "@/lib/services/batch-service";

export const dynamic = "force-dynamic";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—";
}

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-200",
  processing: "bg-sky-50 text-sky-800 border-sky-200",
  extracted: "bg-sky-50 text-sky-800 border-sky-200",
  verified: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-rose-50 text-rose-800 border-rose-200",
  canceled: "bg-slate-100 text-slate-500 border-slate-200",
  completed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  partially_failed: "bg-amber-50 text-amber-900 border-amber-200",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let result: Awaited<ReturnType<typeof getBatchById>>;
  try {
    result = await getBatchById(id);
  } catch (err) {
    return (
      <AppShell>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <div className="font-medium">Could not load batch.</div>
          <p className="mt-1 text-xs">
            {err instanceof Error ? err.message : "Unknown database error."}
          </p>
        </div>
      </AppShell>
    );
  }

  if (!result) {
    notFound();
  }

  const { batch, submissions } = result;

  return (
    <AppShell>
      <div className="mb-6 space-y-2">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← Back to Submissions
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Batch</h1>
          <span className="font-mono text-sm text-slate-600">{batch.id}</span>
          <StatusBadge status={batch.status} />
        </div>
        <p className="text-xs text-slate-500">
          Created {formatDate(batch.createdAt)}
          {batch.completedAt ? ` · completed ${formatDate(batch.completedAt)}` : ""}
          {batch.clientName ? ` · ${batch.clientName}` : ""}
          {batch.applicantName ? ` · ${batch.applicantName}` : ""}
        </p>
        <div className="text-sm text-slate-700">
          <span className="font-semibold text-emerald-700">{batch.completedCount}</span> verified ·{" "}
          <span className="font-semibold text-rose-700">{batch.failedCount}</span> failed ·{" "}
          <span className="font-semibold text-slate-700">{batch.canceledCount}</span> canceled ·{" "}
          <span className="text-slate-500">{batch.totalCount} total</span>
          {" · "}
          <Link
            href={`/?batchId=${batch.id}`}
            className="text-[var(--accent)] hover:underline"
          >
            view in Submissions →
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Detail</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3">
                  <div className="text-slate-900">{s.fileName}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{s.id}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {formatBytes(s.fileSize)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-700">
                  {s.errorCode ? (
                    <>
                      <span className="inline-block rounded bg-rose-100 px-2 py-0.5 font-mono text-[11px] text-rose-800 mr-1">
                        {s.errorCode}
                      </span>
                      <span>{s.errorMessage}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {s.verificationRecordId ? (
                    <Link
                      href={`/verification/${s.verificationRecordId}`}
                      className="text-[var(--accent)] text-sm hover:underline"
                    >
                      View report →
                    </Link>
                  ) : (
                    <span className="text-slate-400 text-sm">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

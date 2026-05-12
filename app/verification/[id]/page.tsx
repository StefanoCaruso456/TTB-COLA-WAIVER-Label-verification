import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { VerificationResults } from "@/components/verification/VerificationResults";
import { getVerificationRecordById } from "@/lib/services/verification-record.service";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";

export const dynamic = "force-dynamic";

export default async function VerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let record: Awaited<ReturnType<typeof getVerificationRecordById>>;
  try {
    record = await getVerificationRecordById(id);
  } catch (err) {
    return (
      <AppShell>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <div className="font-medium">Could not load verification record.</div>
          <p className="mt-1 text-xs">
            {err instanceof Error ? err.message : "Unknown database error."}
          </p>
        </div>
      </AppShell>
    );
  }

  if (!record) {
    notFound();
  }

  const report = record.reportJson as VerificationReport;
  const extracted = record.extractedJson as ExtractedLabel;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link
            href="/"
            className="text-xs text-slate-500 hover:underline"
          >
            ← Back to history
          </Link>
          <h1 className="text-2xl font-semibold mt-2">
            {record.brandName ?? record.productName ?? "Verification report"}
          </h1>
          <p className="text-xs text-slate-500">
            {record.clientName ? `${record.clientName} · ` : ""}
            {new Date(record.createdAt).toLocaleString()} · record{" "}
            <span className="font-mono">{record.id}</span>
          </p>
        </div>
      </div>

      <VerificationResults report={report} extractedLabel={extracted} />
    </AppShell>
  );
}

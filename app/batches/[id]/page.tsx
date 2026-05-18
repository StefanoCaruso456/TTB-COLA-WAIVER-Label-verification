import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { BatchProgressPoller } from "@/components/batch/BatchProgressPoller";
import { BatchProgressBar } from "@/components/batch/BatchProgressBar";
import { BatchFirstResultBanner } from "@/components/verification/BatchFirstResultBanner";
import { BatchDetailView } from "@/components/batch/BatchDetailView";
import { getBatchById } from "@/lib/services/batch-service";
import { prisma } from "@/lib/prisma";
import type { VerificationReport } from "@/types/verification";
import type { ExtractedLabel } from "@/types/extracted-label";

export const dynamic = "force-dynamic";

function formatDate(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—";
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

  // Derived progress fields — same formulas as the GET /api/batches/:id route.
  const terminalCount =
    batch.completedCount + batch.failedCount + batch.canceledCount;
  const processingCount = Math.max(0, batch.totalCount - terminalCount);
  const percentComplete =
    batch.totalCount === 0
      ? 0
      : Math.min(100, Math.round((terminalCount / batch.totalCount) * 100));

  // Resolve the first-row banner content.
  //
  // We have three possible states:
  //   1. firstSubmissionId set + record exists → show success banner with report
  //   2. firstSubmissionId set + submission failed → show failure banner
  //   3. firstSubmissionId null → row 1 hasn't completed yet (or this is a
  //      legacy batch from before Phase 6). Show "pending" banner.
  //
  // For (1) we read the verification record directly here on the server so
  // the page never makes a client-side fetch for the inline result.
  let firstResultBanner: React.ReactNode = null;
  const firstSubmissionId = batch.firstSubmissionId ?? null;
  const firstSubmission =
    firstSubmissionId !== null
      ? submissions.find((s) => s.id === firstSubmissionId) ?? null
      : null;

  if (!firstSubmission) {
    firstResultBanner = <BatchFirstResultBanner kind="pending" />;
  } else if (
    firstSubmission.status === "failed" ||
    firstSubmission.verificationRecordId === null
  ) {
    firstResultBanner = (
      <BatchFirstResultBanner
        kind="failure"
        fileName={firstSubmission.fileName}
        errorCode={firstSubmission.errorCode}
        errorMessage={firstSubmission.errorMessage}
        remainingCount={processingCount}
      />
    );
  } else {
    const record = await prisma.verificationRecord.findUnique({
      where: { id: firstSubmission.verificationRecordId },
      select: { reportJson: true, extractedJson: true },
    });
    if (!record) {
      firstResultBanner = <BatchFirstResultBanner kind="pending" />;
    } else {
      firstResultBanner = (
        <BatchFirstResultBanner
          kind="success"
          fileName={firstSubmission.fileName}
          verificationRecordId={firstSubmission.verificationRecordId}
          report={record.reportJson as VerificationReport}
          extractedLabel={record.extractedJson as ExtractedLabel}
          remainingCount={processingCount}
        />
      );
    }
  }

  // Hand the table off to a client component so row-click → drill-down panel
  // can run without a full page navigation. We project the submissions down
  // to a serializable shape (Date → string) for client transport.
  const submissionsForClient = submissions.map((s, i) => ({
    rowIndex: i + 1,
    id: s.id,
    fileName: s.fileName,
    fileSize: s.fileSize,
    status: s.status,
    errorCode: s.errorCode,
    errorMessage: s.errorMessage,
    verificationRecordId: s.verificationRecordId,
    reportSummary: s.reportSummary,
    isFirstRow: s.id === firstSubmissionId,
  }));

  return (
    <AppShell>
      <BatchProgressPoller status={batch.status} />
      <div className="mb-6 space-y-2">
        <Link
          href="/"
          className="text-xs text-slate-500 hover:underline"
        >
          ← Back to Submissions
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Batch</h1>
          <span className="font-mono text-sm text-slate-600">{batch.id}</span>
        </div>
        <p className="text-xs text-slate-500">
          Created {formatDate(batch.createdAt)}
          {batch.completedAt
            ? ` · completed ${formatDate(batch.completedAt)}`
            : ""}
          {batch.clientName ? ` · ${batch.clientName}` : ""}
          {batch.applicantName ? ` · ${batch.applicantName}` : ""}
        </p>
      </div>

      {firstResultBanner}

      <BatchProgressBar
        totalCount={batch.totalCount}
        completedCount={batch.completedCount}
        failedCount={batch.failedCount}
        processingCount={processingCount}
        percentComplete={percentComplete}
        status={batch.status}
      />

      <BatchDetailView submissions={submissionsForClient} />
    </AppShell>
  );
}

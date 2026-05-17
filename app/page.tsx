import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { VerificationHistoryTable } from "@/components/verification/VerificationHistoryTable";
import { listVerificationRecords } from "@/lib/services/verification-record.service";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ batchId?: string }>;
}) {
  const { batchId } = await searchParams;
  let dbError: string | null = null;
  let records: Awaited<ReturnType<typeof listVerificationRecords>> = [];
  try {
    records = await listVerificationRecords({ batchId });
  } catch (err) {
    dbError =
      err instanceof Error
        ? err.message
        : "Could not connect to the verification history database.";
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Submissions</h1>
          <p className="text-sm text-slate-600">
            Every label submission and where it sits in the review pipeline.
            Filter, search, and assign reviewers.
          </p>
        </div>
        <Link
          href="/new"
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-foreground)]"
        >
          + New verification
        </Link>
      </div>

      {batchId && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <span>
            Showing submissions from batch{" "}
            <span className="font-mono">{batchId}</span>.
          </span>
          <Link href="/" className="text-xs text-sky-700 hover:underline">
            Clear filter
          </Link>
          <Link
            href={`/batches/${batchId}`}
            className="text-xs text-sky-700 hover:underline ml-auto"
          >
            View batch detail →
          </Link>
        </div>
      )}

      {dbError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <div className="font-medium">Database not configured</div>
          <p className="mt-1 text-xs">{dbError}</p>
          <p className="mt-2 text-xs">
            Set <code>DATABASE_URL</code> and run{" "}
            <code>npm run prisma:migrate:dev</code> to enable persistence. You
            can still try a verification from the
            <Link
              href="/new"
              className="underline text-[var(--accent)] ml-1"
            >
              New verification
            </Link>{" "}
            page — saving will fail but the report will still render.
          </p>
        </div>
      ) : (
        <VerificationHistoryTable records={records} />
      )}
    </AppShell>
  );
}

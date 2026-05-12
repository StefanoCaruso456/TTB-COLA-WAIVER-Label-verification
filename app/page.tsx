import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { VerificationHistoryTable } from "@/components/verification/VerificationHistoryTable";
import { listVerificationRecords } from "@/lib/services/verification-record.service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let dbError: string | null = null;
  let records: Awaited<ReturnType<typeof listVerificationRecords>> = [];
  try {
    records = await listVerificationRecords();
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
          <h1 className="text-2xl font-semibold">Verification history</h1>
          <p className="text-sm text-slate-600">
            Saved label verification reports. Each entry represents one
            human-reviewable verification.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/batch"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            Run batch
          </Link>
          <Link
            href="/new"
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-foreground)] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            + New verification
          </Link>
        </div>
      </div>

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

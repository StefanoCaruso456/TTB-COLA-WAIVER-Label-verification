import Link from "next/link";

import type { VerificationReport } from "@/types/verification";
import type { ExtractedLabel } from "@/types/extracted-label";

import { VerificationResults } from "./VerificationResults";

interface SuccessProps {
  kind: "success";
  fileName: string;
  verificationRecordId: string;
  report: VerificationReport;
  extractedLabel?: ExtractedLabel;
  remainingCount: number;
}

interface FailureProps {
  kind: "failure";
  fileName: string;
  errorCode: string | null;
  errorMessage: string | null;
  remainingCount: number;
}

interface PendingProps {
  kind: "pending";
}

type Props = SuccessProps | FailureProps | PendingProps;

/**
 * Phase 6 first-row banner. Reuses the single-label result component
 * (`VerificationResults`) so a reviewer sees the same UI for row 1 as
 * they do on `/verification/:id`, with a small header that contextualizes
 * it as the first of N and surfaces how many rows are still pending.
 */
export function BatchFirstResultBanner(props: Props) {
  if (props.kind === "pending") {
    return (
      <section className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" />
          <p className="text-sm text-sky-900">
            <span className="font-semibold">Scanning first label…</span>{" "}
            <span className="text-sky-700">
              The first row&apos;s result will appear here as soon as it finishes.
            </span>
          </p>
        </div>
      </section>
    );
  }

  if (props.kind === "failure") {
    return (
      <section className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
        <header className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-rose-900">
            First label failed
          </h2>
          <p className="text-xs text-rose-800">
            {props.remainingCount > 0
              ? `Processing remaining ${props.remainingCount} label${props.remainingCount === 1 ? "" : "s"}…`
              : "Batch complete."}
          </p>
        </header>
        <div className="text-xs text-rose-900">
          <span className="font-mono text-[11px]">{props.fileName}</span>
          {props.errorCode ? (
            <>
              {" — "}
              <span className="inline-block rounded bg-rose-100 px-2 py-0.5 font-mono text-[11px] text-rose-800">
                {props.errorCode}
              </span>
            </>
          ) : null}
          {props.errorMessage ? (
            <p className="mt-1 text-rose-800">{props.errorMessage}</p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/40 px-5 py-4"
      data-testid="batch-first-result-banner"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-900">
            First label scanned
          </h2>
          <p className="mt-0.5 text-xs text-emerald-800">
            <span className="font-mono">{props.fileName}</span>
            {" · "}
            <Link
              href={`/verification/${props.verificationRecordId}`}
              className="text-[var(--accent)] hover:underline"
            >
              open full report →
            </Link>
          </p>
        </div>
        <p className="text-xs text-emerald-900">
          {props.remainingCount > 0
            ? `Processing remaining ${props.remainingCount} label${props.remainingCount === 1 ? "" : "s"}…`
            : "Batch complete."}
        </p>
      </header>
      <VerificationResults
        report={props.report}
        extractedLabel={props.extractedLabel}
      />
    </section>
  );
}

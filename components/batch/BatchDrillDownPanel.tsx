"use client";

import { useEffect, useState } from "react";

import { VerificationResults } from "@/components/verification/VerificationResults";
import type { VerificationReport } from "@/types/verification";
import type { ExtractedLabel } from "@/types/extracted-label";

interface Props {
  recordId: string | null;
  onClose: () => void;
}

// The existing GET /api/verifications/:id returns `{ record: ... }` with the
// raw DB shape — reportJson / extractedJson are unknown blobs. We narrow at
// the consumer boundary and treat schema mismatches as a render-time error
// rather than a runtime crash.
interface RawDetailResponse {
  record: {
    reportJson: VerificationReport;
    extractedJson?: ExtractedLabel;
    productName?: string | null;
    brandName?: string | null;
  };
}

/**
 * Slide-in panel for drilling into a single submission's report without
 * navigating away from the batch detail page. Fetches the verification
 * record lazily on open and caches it in component state so re-opening
 * the same row doesn't re-fetch.
 *
 * Keeps the route stack intact — reviewers can click multiple rows in
 * sequence and the URL never changes, so a refresh always returns to the
 * batch view, not the last-opened report.
 */
export function BatchDrillDownPanel({ recordId, onClose }: Props) {
  const [data, setData] = useState<{
    report: VerificationReport;
    extractedLabel?: ExtractedLabel;
    fileName?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/verifications/${recordId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as RawDetailResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setData({
          report: json.record.reportJson,
          extractedLabel: json.record.extractedJson,
          fileName:
            json.record.productName ?? json.record.brandName ?? undefined,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load report.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  useEffect(() => {
    if (!recordId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recordId, onClose]);

  if (!recordId) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Submission report"
        data-testid="batch-drill-down-panel"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="text-sm font-semibold text-slate-900">
            {data?.fileName ?? "Submission report"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            aria-label="Close report"
          >
            Close ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <p className="text-sm text-slate-500">Loading report…</p>
          )}
          {error && (
            <p className="text-sm text-rose-700">{error}</p>
          )}
          {data && (
            <VerificationResults
              report={data.report}
              extractedLabel={data.extractedLabel}
            />
          )}
        </div>
      </aside>
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { OverallStatus } from "@/types/verification";

import { OverallStatusBadge } from "./OverallStatusBadge";
import { ProductTypeBadge } from "./ProductTypeBadge";
import type { SampleScenario } from "./sample-scenarios";

interface BatchItemError {
  code: string;
  message: string;
}

interface BatchItemResult {
  index: number;
  itemKey?: string;
  success: boolean;
  recordId?: string;
  status?: OverallStatus;
  durationMs: number;
  error?: BatchItemError;
}

interface BatchResponse {
  results: BatchItemResult[];
  counts: { total: number; success: number; failed: number };
  durationMs: number;
  concurrency: number;
}

export function BatchRunner({ samples }: { samples: SampleScenario[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(samples.map((s) => s.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<BatchResponse | null>(null);

  const samplesById = useMemo(
    () => Object.fromEntries(samples.map((s) => [s.id, s])),
    [samples],
  );

  const selectedSamples = samples.filter((s) => selectedIds.has(s.id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRun() {
    if (selectedSamples.length === 0) {
      setError("Select at least one sample scenario to include in the batch.");
      return;
    }
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/verify/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedSamples.map((s) => ({
            itemKey: s.id,
            clientName: s.clientName,
            applicantName: s.applicantName,
            productName: s.productName ?? s.label,
            application: s.application,
            images: s.images,
            mockScenario: s.mockScenario,
          })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          data.error ?? `Batch request failed with status ${res.status}.`,
        );
      }
      const data = (await res.json()) as BatchResponse;
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Sample scenarios</h2>
            <p className="text-sm text-slate-600">
              Pick which curated samples to include. Each one drives the mock
              extractor through a known case so the batch produces a mix of
              pass / needs-review / fail outcomes.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {selectedSamples.length} of {samples.length} selected
          </div>
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {samples.map((sample) => {
            const checked = selectedIds.has(sample.id);
            return (
              <li
                key={sample.id}
                className={`rounded-lg border p-3 transition ${
                  checked
                    ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_6%,white)]"
                    : "border-slate-200 bg-white"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-md focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:ring-offset-1">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={checked}
                    onChange={() => toggle(sample.id)}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{sample.label}</div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      {sample.description}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={busy || selectedSamples.length === 0}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {busy
              ? `Running ${selectedSamples.length} verification${
                  selectedSamples.length === 1 ? "" : "s"
                }…`
              : `Run batch (${selectedSamples.length})`}
          </button>
          <button
            type="button"
            onClick={() =>
              setSelectedIds(new Set(samples.map((s) => s.id)))
            }
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Clear
          </button>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {error}
          </div>
        ) : null}

        <p aria-live="polite" className="sr-only">
          {busy
            ? `Running batch of ${selectedSamples.length} verifications.`
            : response
              ? `Batch complete. ${response.counts.success} passed, ${response.counts.failed} failed.`
              : ""}
        </p>
      </section>

      {response ? (
        <BatchResults response={response} samplesById={samplesById} />
      ) : null}
    </div>
  );
}

function BatchResults({
  response,
  samplesById,
}: {
  response: BatchResponse;
  samplesById: Record<string, SampleScenario>;
}) {
  const { counts, durationMs, concurrency, results } = response;
  const avgMs =
    results.length === 0
      ? 0
      : Math.round(
          results.reduce((sum, r) => sum + r.durationMs, 0) / results.length,
        );

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Batch results</h2>
        <div className="text-xs text-slate-600 tabular-nums">
          {counts.success} passed · {counts.failed} failed · total{" "}
          {(durationMs / 1000).toFixed(2)}s · avg {(avgMs / 1000).toFixed(2)}s
          /item · concurrency {concurrency}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">#</th>
              <th scope="col" className="px-4 py-2">Scenario</th>
              <th scope="col" className="px-4 py-2">Product</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2">Duration</th>
              <th scope="col" className="px-4 py-2 text-right">Report</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const sample = r.itemKey ? samplesById[r.itemKey] : undefined;
              return (
                <tr key={r.index} className="border-t border-slate-100">
                  <td className="px-4 py-2 align-top text-xs text-slate-500">
                    {r.index + 1}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium">
                      {sample?.label ?? r.itemKey ?? `Item ${r.index + 1}`}
                    </div>
                    {r.error ? (
                      <div className="mt-0.5 text-xs text-rose-700">
                        {r.error.code}: {r.error.message}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 align-top">
                    {sample ? (
                      <ProductTypeBadge
                        productType={
                          sample.application.applicationTypeStep.productType
                        }
                      />
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top">
                    {r.status ? (
                      <OverallStatusBadge status={r.status} />
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-rose-800">
                        Error
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-slate-600 tabular-nums">
                    {(r.durationMs / 1000).toFixed(2)}s
                  </td>
                  <td className="px-4 py-2 align-top text-right">
                    {r.recordId ? (
                      <Link
                        href={`/verification/${r.recordId}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        View →
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

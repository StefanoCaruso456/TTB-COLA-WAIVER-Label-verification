interface Props {
  totalCount: number;
  completedCount: number;
  failedCount: number;
  processingCount: number;
  percentComplete: number;
  status: string;
}

/**
 * Live progress bar for the batch detail page. Pure presentational —
 * its parent (`BatchDetailPage`) re-renders every poll cycle via
 * `BatchProgressPoller` and passes fresh counts.
 */
export function BatchProgressBar(props: Props) {
  const {
    totalCount,
    completedCount,
    failedCount,
    processingCount,
    percentComplete,
    status,
  } = props;

  const terminal =
    status === "completed" ||
    status === "partially_failed" ||
    status === "canceled";

  // Two-segment bar: completed (emerald) + failed (rose) stacked left-to-right
  // so reviewers see "good vs bad" at a glance without needing to read the
  // numbers below. Remaining width is the still-processing fraction.
  const completedPct =
    totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
  const failedPct =
    totalCount === 0 ? 0 : Math.round((failedCount / totalCount) * 100);

  return (
    <div
      className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
      data-testid="batch-progress-bar"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {terminal ? "Batch complete" : "Processing remaining labels…"}
        </h2>
        <p className="text-xs text-slate-600">
          <span className="text-base font-semibold text-slate-900">
            {completedCount + failedCount}
          </span>
          <span className="text-slate-500"> / {totalCount} complete</span>
          {!terminal && processingCount > 0 ? (
            <span className="ml-2 text-slate-500">
              · {processingCount} in flight
            </span>
          ) : null}
        </p>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={percentComplete}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="absolute inset-y-0 left-0 bg-emerald-500 transition-[width] duration-500"
          style={{ width: `${completedPct}%` }}
        />
        <div
          className="absolute inset-y-0 bg-rose-500 transition-[width] duration-500"
          style={{
            left: `${completedPct}%`,
            width: `${failedPct}%`,
          }}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>
          <span className="font-semibold text-emerald-700">
            {completedCount}
          </span>{" "}
          verified
        </span>
        <span>
          <span className="font-semibold text-rose-700">{failedCount}</span>{" "}
          failed
        </span>
        <span>
          <span className="font-semibold text-slate-700">
            {processingCount}
          </span>{" "}
          {processingCount === 1 ? "row left" : "rows left"}
        </span>
        <span className="ml-auto text-slate-500">{percentComplete}%</span>
      </div>
    </div>
  );
}

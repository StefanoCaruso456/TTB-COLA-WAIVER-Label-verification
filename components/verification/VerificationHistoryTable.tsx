"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type { VerificationRecordSummary } from "@/types/verification-record";
import type { ReviewerStatus } from "@/lib/schemas/verification-record.schema";
import type { OverallStatus } from "@/types/verification";
import type { ProductType, SourceOfProduct } from "@/types/cola";

import { OverallStatusBadge } from "./OverallStatusBadge";
import { ProductTypeBadge } from "./ProductTypeBadge";
import {
  REVIEWER_STATUS_OPTIONS,
  ReviewerStatusBadge,
} from "./ReviewerStatusBadge";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

type StatusFilter = "all" | OverallStatus;
type ReviewerFilter = "all" | ReviewerStatus;
type ProductFilter = "all" | ProductType;
type SourceFilter = "all" | SourceOfProduct;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pass", label: "Pass" },
  { value: "needs_review", label: "Needs review" },
  { value: "fail", label: "Fail" },
];

const REVIEWER_FILTERS: { value: ReviewerFilter; label: string }[] = [
  { value: "all", label: "All reviewer states" },
  ...REVIEWER_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

const PRODUCT_FILTERS: { value: ProductFilter; label: string }[] = [
  { value: "all", label: "All product types" },
  { value: "wine", label: "Wine" },
  { value: "domestic_sake", label: "Domestic Sake" },
  { value: "distilled_spirits", label: "Distilled Spirits" },
  { value: "malt_beverage", label: "Malt Beverage" },
];

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "domestic", label: "Domestic" },
  { value: "imported", label: "Imported" },
];

export function VerificationHistoryTable({
  records: initialRecords,
}: {
  records: VerificationRecordSummary[];
}) {
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [reviewerFilter, setReviewerFilter] = useState<ReviewerFilter>("all");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (
        reviewerFilter !== "all" &&
        r.reviewerStatus !== reviewerFilter
      )
        return false;
      if (productFilter !== "all" && r.productType !== productFilter)
        return false;
      if (sourceFilter !== "all" && r.sourceOfProduct !== sourceFilter)
        return false;
      if (q.length > 0) {
        const haystack = [
          r.brandName,
          r.clientName,
          r.applicantName,
          r.productName,
          r.assignedReviewer,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    records,
    search,
    statusFilter,
    reviewerFilter,
    productFilter,
    sourceFilter,
  ]);

  const counts = useMemo(() => {
    return {
      total: records.length,
      pending: records.filter((r) => r.reviewerStatus === "pending").length,
      inReview: records.filter((r) => r.reviewerStatus === "in_review").length,
      approved: records.filter((r) => r.reviewerStatus === "approved").length,
      rejected: records.filter((r) => r.reviewerStatus === "rejected").length,
    };
  }, [records]);

  const updateRecord = (
    id: string,
    patch: Partial<Pick<VerificationRecordSummary, "reviewerStatus" | "assignedReviewer">>,
  ) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        <p>No submissions yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          Start a new verification to populate the pipeline.
        </p>
        <Link
          href="/new"
          className="mt-4 inline-block rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-foreground)]"
        >
          New verification
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <PipelineStat label="Total" value={counts.total} />
        <PipelineStat label="Pending" value={counts.pending} tone="slate" />
        <PipelineStat label="In review" value={counts.inReview} tone="sky" />
        <PipelineStat label="Approved" value={counts.approved} tone="emerald" />
        <PipelineStat label="Rejected" value={counts.rejected} tone="rose" />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brand, client, applicant, assignee…"
            className="min-w-[220px] flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100 outline-none"
          />
          <FilterSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={STATUS_FILTERS}
          />
          <FilterSelect
            value={reviewerFilter}
            onChange={(v) => setReviewerFilter(v as ReviewerFilter)}
            options={REVIEWER_FILTERS}
          />
          <FilterSelect
            value={productFilter}
            onChange={(v) => setProductFilter(v as ProductFilter)}
            options={PRODUCT_FILTERS}
          />
          <FilterSelect
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as SourceFilter)}
            options={SOURCE_FILTERS}
          />
          {(search ||
            statusFilter !== "all" ||
            reviewerFilter !== "all" ||
            productFilter !== "all" ||
            sourceFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setReviewerFilter("all");
                setProductFilter("all");
                setSourceFilter("all");
              }}
              className="text-xs text-slate-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Showing {filtered.length} of {records.length}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Client / Applicant</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Product type</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Auto status</th>
              <th className="px-4 py-3">Reviewer status</th>
              <th className="px-4 py-3">Assignee</th>
              <th className="px-4 py-3 text-right">Report</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-xs text-slate-500"
                >
                  No submissions match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <SubmissionRow
                  key={r.id}
                  record={r}
                  onUpdate={(patch) => updateRecord(r.id, patch)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubmissionRow({
  record,
  onUpdate,
}: {
  record: VerificationRecordSummary;
  onUpdate: (
    patch: Partial<
      Pick<VerificationRecordSummary, "reviewerStatus" | "assignedReviewer">
    >,
  ) => void;
}) {
  const [, startTransition] = useTransition();
  const [savingField, setSavingField] = useState<
    "reviewerStatus" | "assignedReviewer" | null
  >(null);
  const [assigneeDraft, setAssigneeDraft] = useState(
    record.assignedReviewer ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const persist = async (
    field: "reviewerStatus" | "assignedReviewer",
    body: Record<string, unknown>,
  ) => {
    setSavingField(field);
    setError(null);
    try {
      const res = await fetch(`/api/verifications/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Update failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSavingField(null);
    }
  };

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3 text-xs text-slate-600">
        {formatDate(record.createdAt)}
      </td>
      <td className="px-4 py-3">
        <div>{record.clientName ?? record.productName ?? "—"}</div>
        <div className="text-xs text-slate-500">
          {record.applicantName ?? ""}
        </div>
      </td>
      <td className="px-4 py-3">{record.brandName ?? "—"}</td>
      <td className="px-4 py-3">
        <ProductTypeBadge productType={record.productType} />
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 capitalize">
        {record.sourceOfProduct}
      </td>
      <td className="px-4 py-3">
        <OverallStatusBadge status={record.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ReviewerStatusBadge status={record.reviewerStatus} />
          <select
            aria-label="Change reviewer status"
            value={record.reviewerStatus}
            disabled={savingField === "reviewerStatus"}
            onChange={(e) => {
              const next = e.target.value as ReviewerStatus;
              onUpdate({ reviewerStatus: next });
              startTransition(() => {
                void persist("reviewerStatus", { reviewerStatus: next });
              });
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
          >
            {REVIEWER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div className="mt-1 text-[10px] text-rose-600">{error}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={assigneeDraft}
          placeholder="Unassigned"
          disabled={savingField === "assignedReviewer"}
          onChange={(e) => setAssigneeDraft(e.target.value)}
          onBlur={() => {
            const trimmed = assigneeDraft.trim();
            const next = trimmed.length === 0 ? null : trimmed;
            if (next === (record.assignedReviewer ?? null)) return;
            onUpdate({ assignedReviewer: next });
            startTransition(() => {
              void persist("assignedReviewer", { assignedReviewer: next });
            });
          }}
          className="w-32 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/verification/${record.id}`}
          className="text-[var(--accent)] text-sm hover:underline"
        >
          View →
        </Link>
      </td>
    </tr>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function PipelineStat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "sky" | "emerald" | "rose";
}) {
  const toneStyles: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneStyles[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

interface SubmissionResult {
  id: string;
  fileName: string;
  fileSize: number;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  verificationRecordId?: string | null;
}

interface BatchResponse {
  batchId: string;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  submissions: SubmissionResult[];
}

interface ManifestParseError {
  line: number;
  reason: string;
}

interface ManifestValidationReport {
  orphanRows?: Array<{ rowIndex: number; file_name: string }>;
  orphanFiles?: Array<{ fileIndex: number; fileName: string }>;
  duplicateRowFileNames?: string[];
  duplicateUploadedFileNames?: string[];
}

interface BatchError {
  error: string;
  code?: string;
  parseErrors?: ManifestParseError[];
  validationReport?: ManifestValidationReport;
}

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  processing: "bg-sky-50 text-sky-800",
  extracted: "bg-sky-50 text-sky-800",
  verified: "bg-emerald-50 text-emerald-800",
  failed: "bg-rose-50 text-rose-800",
  canceled: "bg-slate-100 text-slate-500",
};

const MAX_BATCH_FILES = 5;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function BatchVerificationFlow() {
  const [files, setFiles] = useState<File[]>([]);
  const [manifestText, setManifestText] = useState<string>("");
  const [manifestFileName, setManifestFileName] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<BatchError | string | null>(null);

  const totalSize = useMemo(
    () => files.reduce((acc, f) => acc + f.size, 0),
    [files],
  );

  const onFilesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? []);
      setFiles(list);
    },
    [],
  );

  const onManifestUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      setManifestText(text);
      setManifestFileName(file.name);
    },
    [],
  );

  const onSubmit = useCallback(async () => {
    setError(null);
    setResult(null);

    if (files.length === 0) {
      setError("Add at least one label image.");
      return;
    }
    if (files.length > MAX_BATCH_FILES) {
      setError(`Up to ${MAX_BATCH_FILES} files per batch in this phase.`);
      return;
    }
    if (!manifestText.trim()) {
      setError("Paste or upload a manifest (CSV or JSON).");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      for (const f of files) {
        fd.append("files", f, f.name);
      }
      const isJson = manifestText.trim().startsWith("{");
      const manifestBlob = new Blob([manifestText], {
        type: isJson ? "application/json" : "text/csv",
      });
      fd.append(
        "manifest",
        manifestBlob,
        manifestFileName || (isJson ? "manifest.json" : "manifest.csv"),
      );
      if (clientName || applicantName) {
        fd.append(
          "batchMetadata",
          JSON.stringify({
            clientName: clientName || undefined,
            applicantName: applicantName || undefined,
          }),
        );
      }

      const res = await fetch("/api/batches", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        setError(body as BatchError);
      } else {
        setResult(body as BatchResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [files, manifestText, manifestFileName, clientName, applicantName]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold mb-2">1. Batch metadata (optional)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-sm">
            Client name
            <input
              type="text"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Applicant name
            <input
              type="text"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold mb-2">2. Upload label images</h2>
        <p className="text-sm text-slate-600 mb-3">
          One image per label. Up to {MAX_BATCH_FILES} labels per batch. File
          names here must match <code className="text-xs bg-slate-100 px-1 rounded">file_name</code> values in your manifest
          (matching is case-insensitive).
        </p>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={onFilesChange}
          className="block w-full text-sm"
        />
        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.name} className="flex justify-between text-slate-700">
                <span className="truncate">{f.name}</span>
                <span className="text-slate-500">{formatBytes(f.size)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-slate-200 pt-1 font-medium">
              <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
              <span>{formatBytes(totalSize)}</span>
            </li>
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold mb-2">3. Manifest</h2>
        <p className="text-sm text-slate-600 mb-3">
          CSV (with <code className="text-xs bg-slate-100 px-1 rounded">file_name</code>,
          {" "}
          <code className="text-xs bg-slate-100 px-1 rounded">product_type</code>,
          {" "}
          <code className="text-xs bg-slate-100 px-1 rounded">brand_name</code>{" "}
          required) or JSON. Paste below, or upload a file.
        </p>
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          onChange={onManifestUpload}
          className="block w-full text-sm mb-2"
        />
        <textarea
          className="block w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          rows={8}
          placeholder={`file_name,product_type,brand_name\nwine-01.jpg,wine,Cypress Hills`}
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {submitting ? "Running batch…" : "Run batch verification"}
        </button>
        {(files.length > 0 || manifestText) && (
          <button
            type="button"
            onClick={() => {
              setFiles([]);
              setManifestText("");
              setManifestFileName("");
              setResult(null);
              setError(null);
            }}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Reset
          </button>
        )}
      </div>

      {error && (
        <BatchErrorPanel error={error} />
      )}

      {result && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold mb-2">
            Batch{" "}
            <Link
              href={`/batches/${result.batchId}`}
              className="text-indigo-700 underline"
            >
              {result.batchId}
            </Link>
          </h2>
          <p className="text-sm mb-4">
            <strong>Total:</strong> {result.totalCount} ·{" "}
            <strong>Completed:</strong> {result.completedCount} ·{" "}
            <strong>Failed:</strong> {result.failedCount}
          </p>
          <ul className="space-y-2">
            {result.submissions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <div className="flex-1 truncate">
                  <span className="font-medium">{s.fileName}</span>{" "}
                  <span className="text-slate-500">
                    ({formatBytes(s.fileSize)})
                  </span>
                  {s.errorMessage && (
                    <span className="ml-2 text-rose-700">
                      — {s.errorMessage}
                    </span>
                  )}
                </div>
                <span
                  className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status] ?? "bg-slate-100 text-slate-700"}`}
                >
                  {s.status}
                </span>
                {s.verificationRecordId && (
                  <Link
                    href={`/verifications/${s.verificationRecordId}`}
                    className="ml-3 text-indigo-700 text-xs underline"
                  >
                    View
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BatchErrorPanel({ error }: { error: BatchError | string }) {
  if (typeof error === "string") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {error}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 space-y-2">
      <p className="font-semibold">
        {error.error}
        {error.code && (
          <span className="ml-2 text-xs font-normal text-rose-700">
            [{error.code}]
          </span>
        )}
      </p>
      {error.parseErrors && error.parseErrors.length > 0 && (
        <div>
          <p className="font-medium">Manifest parse errors:</p>
          <ul className="list-disc pl-5">
            {error.parseErrors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error.validationReport && (
        <div>
          {(error.validationReport.orphanRows?.length ?? 0) > 0 && (
            <>
              <p className="font-medium">Manifest rows with no matching file:</p>
              <ul className="list-disc pl-5">
                {error.validationReport.orphanRows!.map((r) => (
                  <li key={`r${r.rowIndex}`}>
                    Row {r.rowIndex}: <code>{r.file_name}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(error.validationReport.orphanFiles?.length ?? 0) > 0 && (
            <>
              <p className="font-medium mt-2">Uploaded files with no manifest row:</p>
              <ul className="list-disc pl-5">
                {error.validationReport.orphanFiles!.map((f) => (
                  <li key={`f${f.fileIndex}`}>
                    <code>{f.fileName}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

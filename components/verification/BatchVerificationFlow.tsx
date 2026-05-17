"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** Phase 5: POST returns 202 with this shape; live progress lives on /batches/:id. */
interface BatchAcceptedResponse {
  batchId: string;
  status: string;
  totalCount: number;
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

// Phase 5: async worker, 200-file default cap.
const MAX_BATCH_FILES = 200;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function BatchVerificationFlow() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [manifestText, setManifestText] = useState<string>("");
  const [manifestFileName, setManifestFileName] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
        setSubmitting(false);
        return;
      }
      const accepted = body as BatchAcceptedResponse;
      router.push(`/batches/${accepted.batchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [files, manifestText, manifestFileName, clientName, applicantName, router]);

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
          One image per label. Up to {MAX_BATCH_FILES} labels per batch
          (processed asynchronously — you&apos;ll be redirected to the batch
          progress page after submission). File names here must match{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">file_name</code>{" "}
          values in your manifest (matching is case-insensitive).
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
              setError(null);
            }}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Reset
          </button>
        )}
      </div>

      {error && <BatchErrorPanel error={error} />}
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

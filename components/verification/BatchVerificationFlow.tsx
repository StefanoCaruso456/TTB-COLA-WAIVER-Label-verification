"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  previewValidateManifest,
  type PreviewValidationResult,
} from "@/lib/manifest/preview-validation";

/** Phase 6: POST returns 200 with the first row already verified. */
interface BatchAcceptedResponse {
  batchId: string;
  status: string;
  totalCount: number;
  // firstSubmission is also in the body but the page redirect to /batches/:id
  // re-loads it from the DB, so we don't read it client-side.
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
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
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

  // Pre-flight validator runs whenever files OR manifest change. Cheap (regex
  // + Set ops), no debounce needed at 200-row scale.
  const previewValidation: PreviewValidationResult | null = useMemo(() => {
    if (files.length === 0 && !manifestText) return null;
    return previewValidateManifest(
      manifestText,
      files.map((f) => f.name),
    );
  }, [files, manifestText]);

  // Build image previews via object URLs. Revoke on file-set change so memory
  // doesn't leak when reviewers swap one batch for another.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        next[f.name] = URL.createObjectURL(f);
      }
    }
    setFilePreviews(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [files]);

  const onFilesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? []);
      setFiles(list);
    },
    [],
  );

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      // Accept images only — anything else would be rejected by the server
      // upload anyway. Manifest CSV is handled by its own input below.
      f.type.startsWith("image/"),
    );
    if (dropped.length > 0) {
      // Merge with the existing selection so a reviewer can drop two batches
      // worth of files in sequence without losing the first.
      setFiles((prev) => {
        const byName = new Map(prev.map((f) => [f.name, f]));
        for (const f of dropped) byName.set(f.name, f);
        return Array.from(byName.values());
      });
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

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
          One image per label. Up to {MAX_BATCH_FILES} labels per batch. File
          names here must match{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">file_name</code>{" "}
          values in your manifest (matching is case-insensitive).
        </p>
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`relative rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            isDragging
              ? "border-[var(--accent)] bg-sky-50"
              : "border-slate-300 bg-slate-50"
          }`}
          data-testid="batch-dropzone"
        >
          <p className="text-sm text-slate-700">
            <strong>Drag &amp; drop label images here</strong>, or
          </p>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={onFilesChange}
            className="mt-2 block w-full text-sm"
          />
        </div>
        {files.length > 0 && (
          <>
            <ul
              className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              data-testid="batch-file-previews"
            >
              {files.map((f) => (
                <li
                  key={f.name}
                  className="flex flex-col rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700"
                >
                  {filePreviews[f.name] ? (
                    // Object URL — revoked on unmount; <img> width comes from
                    // the parent grid cell, no fixed dim needed.
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={filePreviews[f.name]}
                      alt={f.name}
                      className="mb-2 h-24 w-full rounded object-cover"
                    />
                  ) : (
                    <div className="mb-2 flex h-24 w-full items-center justify-center rounded bg-slate-100 text-slate-400">
                      no preview
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate" title={f.name}>
                      {f.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(f.name)}
                      className="shrink-0 text-rose-700 hover:underline"
                      aria-label={`Remove ${f.name}`}
                    >
                      ✕
                    </button>
                  </div>
                  <span className="text-slate-500">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm font-medium">
              <span>
                {files.length} file{files.length === 1 ? "" : "s"}
              </span>
              <span>{formatBytes(totalSize)}</span>
            </div>
          </>
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

      {previewValidation && (
        <PreviewValidationPanel result={previewValidation} />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={
            submitting ||
            (previewValidation !== null && !previewValidation.ok)
          }
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {submitting ? "Verifying first label…" : "Run batch verification"}
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

function PreviewValidationPanel({
  result,
}: {
  result: PreviewValidationResult;
}) {
  if (result.ok) {
    return (
      <div
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        data-testid="preview-validation-panel"
        data-valid="true"
      >
        <p className="font-medium">Ready to submit.</p>
        <p className="text-xs">
          {result.totalRows > 0
            ? `${result.totalRows} manifest row${result.totalRows === 1 ? "" : "s"} reconcile with your uploaded files.`
            : "JSON manifest — server will validate."}
        </p>
      </div>
    );
  }
  return (
    <div
      className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      data-testid="preview-validation-panel"
      data-valid="false"
    >
      <p className="font-medium">Fix these before submitting:</p>
      {result.requiredColumnsMissing.length > 0 && (
        <div>
          <p className="text-xs font-medium">Missing required columns:</p>
          <ul className="list-disc pl-5 text-xs">
            {result.requiredColumnsMissing.map((c) => (
              <li key={c}>
                <code className="rounded bg-amber-100 px-1">{c}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.orphanRows.length > 0 && (
        <div>
          <p className="text-xs font-medium">
            Manifest rows with no matching file uploaded:
          </p>
          <ul className="list-disc pl-5 text-xs">
            {result.orphanRows.slice(0, 10).map((r) => (
              <li key={`r${r.rowIndex}`}>
                Row {r.rowIndex}: <code>{r.file_name}</code>
              </li>
            ))}
            {result.orphanRows.length > 10 && (
              <li className="text-amber-700">
                …and {result.orphanRows.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}
      {result.orphanFiles.length > 0 && (
        <div>
          <p className="text-xs font-medium">
            Uploaded files with no manifest row:
          </p>
          <ul className="list-disc pl-5 text-xs">
            {result.orphanFiles.slice(0, 10).map((f) => (
              <li key={`f${f.fileName}`}>
                <code>{f.fileName}</code>
              </li>
            ))}
            {result.orphanFiles.length > 10 && (
              <li className="text-amber-700">
                …and {result.orphanFiles.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}
      {result.parseError && (
        <p className="text-xs">
          <span className="font-medium">Parse:</span> {result.parseError}
        </p>
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

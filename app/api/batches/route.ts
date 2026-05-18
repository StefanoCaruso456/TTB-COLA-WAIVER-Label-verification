import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  createBatchApplicationsSchema,
  createBatchMetadataSchema,
  MAX_BATCH_FILES,
  type CreateBatchAcceptedResponse,
} from "@/lib/schemas/batch-api.schema";
import {
  createBatch,
  createBatchSubmissions,
} from "@/lib/services/batch-service";
import { startBatchInBackground } from "@/lib/services/batch-worker";
import { runFirstSubmissionInline } from "@/lib/services/run-first-submission-inline";
import { prisma } from "@/lib/prisma";
import { getFileStorage } from "@/lib/services/file-storage-factory";
import {
  extractBatchMetadataFromJson,
  parseCsvManifest,
  parseJsonManifest,
} from "@/lib/services/manifest-parser";
import {
  reportIsClean,
  validateManifestAgainstFiles,
} from "@/lib/services/manifest-validator";
import type { ColaApplication } from "@/types/cola";
import type { ManifestRow } from "@/lib/schemas/manifest.schema";

const DEFAULT_QUEUE_DEPTH_LIMIT = 500;
function queueDepthLimit(): number {
  const fromEnv = process.env.BATCH_QUEUE_DEPTH_LIMIT;
  if (!fromEnv) return DEFAULT_QUEUE_DEPTH_LIMIT;
  const n = Number(fromEnv);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_QUEUE_DEPTH_LIMIT;
}

export const runtime = "nodejs";
export const maxDuration = 60;

// Phase 5: raised from 50 MB (Phase 3 sync) to 200 MB to accommodate
// 200-file batches at ~1 MB per label. Still env-overridable.
const DEFAULT_MAX_REQUEST_BYTES = 200 * 1024 * 1024;

function maxRequestBytes(): number {
  const fromEnv = process.env.BATCH_MAX_REQUEST_BYTES;
  if (!fromEnv) return DEFAULT_MAX_REQUEST_BYTES;
  const n = Number(fromEnv);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_REQUEST_BYTES;
}

export async function POST(request: Request) {
  // 1. Body-size guard (AD-012).
  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader) {
    return NextResponse.json(
      { error: "Content-Length header is required." },
      { status: 411 },
    );
  }
  const contentLength = Number(contentLengthHeader);
  const maxBytes = maxRequestBytes();
  if (!Number.isFinite(contentLength) || contentLength > maxBytes) {
    return NextResponse.json(
      {
        error: "Request body exceeds the batch endpoint limit.",
        code: "PAYLOAD_TOO_LARGE",
        maxBytes,
      },
      { status: 413 },
    );
  }

  // 1b. Backpressure guard (Phase 5). Reject when the global queue is
  //     already at capacity so the worker isn't pushed past its limits.
  const depthLimit = queueDepthLimit();
  const currentDepth = await prisma.batchSubmission.count({
    where: { status: { in: ["queued", "processing"] } },
  });
  if (currentDepth >= depthLimit) {
    return NextResponse.json(
      {
        error: "Batch queue is at capacity; try again shortly.",
        code: "QUEUE_FULL",
        depth: currentDepth,
        limit: depthLimit,
      },
      { status: 429 },
    );
  }

  // 2. Parse multipart.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "Could not parse multipart/form-data body.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // 3. Files.
  const filesRaw = formData.getAll("files");
  const files = filesRaw.filter((f): f is File => f instanceof File);
  if (files.length < 1) {
    return NextResponse.json(
      { error: "At least one file is required.", code: "NO_FILES" },
      { status: 400 },
    );
  }
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json(
      {
        error: `Up to ${MAX_BATCH_FILES} files supported per batch in this phase.`,
        code: "TOO_MANY_FILES",
        max: MAX_BATCH_FILES,
        received: files.length,
      },
      { status: 400 },
    );
  }

  // 4. Applications — supports two mutually exclusive branches (Phase 4):
  //    A) inline `applications` JSON array (original Phase 3 path)
  //    B) `manifest` file part (CSV or JSON) — pre-flight validated against
  //       the uploaded files BEFORE any Gemini call is made.
  //    Sending both → 400 manifest_and_inline_conflict (spec decision #6).
  const applicationsRaw = formData.get("applications");
  const manifestPart = formData.get("manifest");
  const hasInline = typeof applicationsRaw === "string" && applicationsRaw.length > 0;
  const hasManifest = manifestPart instanceof File;

  if (hasInline && hasManifest) {
    return NextResponse.json(
      {
        error:
          "Send either `applications` or `manifest`, not both — they are mutually exclusive.",
        code: "manifest_and_inline_conflict",
      },
      { status: 400 },
    );
  }
  if (!hasInline && !hasManifest) {
    return NextResponse.json(
      {
        error:
          "Either `applications` (JSON string) or `manifest` (file) is required.",
        code: "NO_APPLICATIONS",
      },
      { status: 400 },
    );
  }

  let applications: ColaApplication[];
  /** Matches `applications[i]` → `files[fileIndexForApp[i]]`. */
  let fileIndexForApp: number[];
  let batchMetadata: { clientName?: string; applicantName?: string } = {};

  // 5. Batch metadata (form field — applies to both branches; the manifest
  //    JSON body may also carry its own batchMetadata, which loses to the
  //    explicit form field if both are sent).
  const batchMetadataRaw = formData.get("batchMetadata");
  if (typeof batchMetadataRaw === "string" && batchMetadataRaw.length > 0) {
    let metadataParsed: unknown;
    try {
      metadataParsed = JSON.parse(batchMetadataRaw);
    } catch {
      return NextResponse.json(
        { error: "`batchMetadata` must be a JSON object." },
        { status: 400 },
      );
    }
    const metadataResult = createBatchMetadataSchema.safeParse(metadataParsed);
    if (!metadataResult.success) {
      return NextResponse.json(
        {
          error: "Invalid batchMetadata.",
          issues: metadataResult.error.issues,
        },
        { status: 400 },
      );
    }
    batchMetadata = metadataResult.data;
  }

  if (hasInline) {
    // ---- Branch A: original inline applications JSON array ----
    let applicationsParsed: unknown;
    try {
      applicationsParsed = JSON.parse(applicationsRaw as string);
    } catch {
      return NextResponse.json(
        { error: "`applications` must be a JSON array of ColaApplication objects." },
        { status: 400 },
      );
    }
    const applicationsResult = createBatchApplicationsSchema.safeParse(applicationsParsed);
    if (!applicationsResult.success) {
      return NextResponse.json(
        {
          error: "One or more applications failed schema validation.",
          code: "INVALID_APPLICATIONS",
          issues: applicationsResult.error.issues,
        },
        { status: 422 },
      );
    }
    applications = applicationsResult.data;
    if (applications.length !== files.length) {
      return NextResponse.json(
        {
          error:
            "`applications` array length must equal the number of uploaded files.",
          code: "COUNT_MISMATCH",
          filesCount: files.length,
          applicationsCount: applications.length,
        },
        { status: 400 },
      );
    }
    fileIndexForApp = applications.map((_, i) => i);
  } else {
    // ---- Branch B: manifest (CSV or JSON) ----
    const manifestFile = manifestPart as File;
    const manifestText = await manifestFile.text();
    const isJsonManifest =
      manifestFile.type === "application/json" ||
      /\.json$/i.test(manifestFile.name) ||
      manifestText.trim().startsWith("{");

    const parseResult = isJsonManifest
      ? (() => {
          try {
            return parseJsonManifest(JSON.parse(manifestText));
          } catch (err) {
            return {
              rows: [],
              parseErrors: [
                {
                  line: 1,
                  reason: `JSON manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
            };
          }
        })()
      : parseCsvManifest(manifestText);

    if (parseResult.parseErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Manifest failed to parse.",
          code: "manifest_parse_failed",
          parseErrors: parseResult.parseErrors,
        },
        { status: 400 },
      );
    }

    if (parseResult.rows.length > MAX_BATCH_FILES) {
      return NextResponse.json(
        {
          error: `Up to ${MAX_BATCH_FILES} manifest rows supported per batch in this phase.`,
          code: "TOO_MANY_FILES",
          max: MAX_BATCH_FILES,
          received: parseResult.rows.length,
        },
        { status: 400 },
      );
    }

    const validationReport = validateManifestAgainstFiles(
      parseResult.rows,
      files.map((f) => f.name),
    );
    if (!reportIsClean(validationReport)) {
      return NextResponse.json(
        {
          error:
            "Manifest does not reconcile with uploaded files.",
          code: "manifest_files_mismatch",
          validationReport,
        },
        { status: 400 },
      );
    }

    // Merge JSON-manifest batchMetadata only when the form field didn't
    // already provide one (form field is explicit; manifest is implicit).
    if (
      isJsonManifest &&
      !batchMetadata.clientName &&
      !batchMetadata.applicantName
    ) {
      try {
        const fromJson = extractBatchMetadataFromJson(JSON.parse(manifestText));
        batchMetadata = { ...fromJson, ...batchMetadata };
      } catch {
        // Already parsed cleanly above; ignore.
      }
    }

    // Drive `applications` and `fileIndexForApp` from the validator's
    // matched pairs, preserving manifest row order.
    const matched: Array<{ row: ManifestRow; fileIndex: number }> =
      validationReport.matched;
    applications = matched.map((m) => m.row.application);
    fileIndexForApp = matched.map((m) => m.fileIndex);
  }

  // applicationByFileIndex pairs an uploaded file index with the application
  // that should drive its verification. Inline branch: identity (i -> i).
  // Manifest branch: built from validator's matched pairs, so submission
  // order on disk follows the manifest row order, not upload order.
  const applicationByFileIndex = new Map<number, ColaApplication>();
  applications.forEach((app, i) => {
    applicationByFileIndex.set(fileIndexForApp[i], app);
  });

  // 6. Read each file into memory + hash. Detect duplicates BEFORE any storage write.
  const buffers: Buffer[] = [];
  const hashes: string[] = [];
  for (const file of files) {
    const arr = await file.arrayBuffer();
    const buf = Buffer.from(arr);
    buffers.push(buf);
    hashes.push(createHash("sha256").update(buf).digest("hex"));
  }
  const seen = new Map<string, number>();
  for (let i = 0; i < hashes.length; i++) {
    if (seen.has(hashes[i])) {
      return NextResponse.json(
        {
          error: "Two uploaded files have identical contents.",
          code: "DUPLICATE_FILE_IN_BATCH",
          duplicateIndices: [seen.get(hashes[i]), i],
        },
        { status: 400 },
      );
    }
    seen.set(hashes[i], i);
  }

  // 7. Store every file. Storage is content-addressed, so two batches with the
  //    same file share one stored copy automatically (per AD-001 design).
  const storage = getFileStorage();
  const storageKeys: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const meta = await storage.put({
      buffer: buffers[i],
      mimeType: files[i].type || "application/octet-stream",
    });
    storageKeys.push(meta.storageKey);
  }

  // 8. Create the batch + submissions.
  const batch = await createBatch({
    clientName: batchMetadata.clientName,
    applicantName: batchMetadata.applicantName,
    totalCount: files.length,
  });
  const submissions = await createBatchSubmissions({
    batchId: batch.id,
    submissions: files.map((file, i) => ({
      fileHash: hashes[i],
      fileName: file.name || `file-${i}`,
      fileSize: buffers[i].byteLength,
      fileMimeType: file.type || "application/octet-stream",
      fileStorageKey: storageKeys[i],
      applicationJson: applicationByFileIndex.get(i)!,
    })),
  });

  // 9. Phase 6 first-row fast path. Synchronously verify row 1 so the
  //    response can carry its report inline. Submission status is moved
  //    out of `queued` before the worker is kicked off, so the worker's
  //    `status: "queued"` selector skips it naturally — no flag needed.
  //    Failure here does NOT abort the batch: the failed row 1 is just
  //    surfaced as ok:false in the response and rows 2…N still process.
  const firstSubmission = submissions[0]
    ? await runFirstSubmissionInline({
        batchId: batch.id,
        submission: {
          id: submissions[0].id,
          fileName: submissions[0].fileName,
          fileMimeType: submissions[0].fileMimeType,
          fileSize: submissions[0].fileSize,
          fileStorageKey: submissions[0].fileStorageKey,
          applicationJson: submissions[0].applicationJson,
        },
      })
    : undefined;

  // 10. Phase 5: kick off async processing for the remaining rows.
  //     Worker drains anything still `queued` with bounded concurrency in
  //     the background; caller polls /api/batches/:id for live progress.
  startBatchInBackground(batch.id);

  const response: CreateBatchAcceptedResponse = {
    batchId: batch.id,
    status: batch.status as CreateBatchAcceptedResponse["status"],
    totalCount: batch.totalCount,
    firstSubmission: firstSubmission
      ? firstSubmission.ok
        ? {
            ok: true,
            submissionId: firstSubmission.submissionId,
            fileName: firstSubmission.fileName,
            verificationRecordId: firstSubmission.verificationRecordId,
            report: firstSubmission.report,
            extractedLabel: firstSubmission.extractedLabel,
          }
        : {
            ok: false,
            submissionId: firstSubmission.submissionId,
            fileName: firstSubmission.fileName,
            errorCode: firstSubmission.errorCode,
            errorMessage: firstSubmission.errorMessage,
          }
      : undefined,
  };
  // 200 now (not 202) — the response body carries a real verification
  // result, not just an "accepted for processing" acknowledgement.
  return NextResponse.json(response, { status: 200 });
}

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  createBatchApplicationsSchema,
  createBatchMetadataSchema,
  MAX_BATCH_FILES,
  type CreateBatchResponse,
} from "@/lib/schemas/batch-api.schema";
import {
  createBatch,
  createBatchSubmissions,
  finalizeBatch,
  getBatchById,
  recordSubmissionFailure,
  recordSubmissionVerification,
  transitionSubmissionStatus,
} from "@/lib/services/batch-service";
import { getFileStorage } from "@/lib/services/file-storage-factory";
import { runVerification } from "@/lib/services/verification-orchestrator";
import { classifyError } from "@/lib/services/error-taxonomy";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MAX_REQUEST_BYTES = 50 * 1024 * 1024; // 50 MB (AD-012)

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

  // 4. Applications.
  const applicationsRaw = formData.get("applications");
  if (typeof applicationsRaw !== "string") {
    return NextResponse.json(
      { error: "`applications` form field is required as a JSON string." },
      { status: 400 },
    );
  }
  let applicationsParsed: unknown;
  try {
    applicationsParsed = JSON.parse(applicationsRaw);
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
  const applications: ColaApplication[] = applicationsResult.data;
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

  // 5. Batch metadata (optional).
  const batchMetadataRaw = formData.get("batchMetadata");
  let batchMetadata: { clientName?: string; applicantName?: string } = {};
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
      applicationJson: applications[i],
    })),
  });

  // 9. Process each submission serially. Per-file try/catch keeps siblings alive.
  for (let i = 0; i < submissions.length; i++) {
    const submission = submissions[i];
    const application = applications[i];
    const buffer = buffers[i];
    const file = files[i];

    try {
      await transitionSubmissionStatus(submission.id, "processing");

      const imagePayload: LabelImagePayload = {
        id: `batch-${batch.id}-img-${i}`,
        fileName: submission.fileName,
        mimeType: submission.fileMimeType,
        size: submission.fileSize,
        labelImageType: "brand",
        base64: buffer.toString("base64"),
      };

      const result = await runVerification({
        clientName: batchMetadata.clientName,
        applicantName: batchMetadata.applicantName,
        productName: file.name,
        application,
        images: [imagePayload],
        batchSubmissionId: submission.id,
      });

      await transitionSubmissionStatus(submission.id, "extracted");
      await transitionSubmissionStatus(submission.id, "verified");
      if (result.record?.id) {
        await recordSubmissionVerification({
          submissionId: submission.id,
          batchId: batch.id,
          verificationRecordId: result.record.id,
        });
      }
    } catch (err) {
      const errorCode = classifyError(err);
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      try {
        // Transition out of `processing` into `failed`. If we never entered
        // `processing` (e.g., transition itself threw), the submission is
        // already in `queued`; the transition guard would block queued→failed
        // so we update the row directly via recordSubmissionFailure (which
        // only sets errorCode/errorMessage) and then attempt the transition.
        await transitionSubmissionStatus(submission.id, "failed");
      } catch {
        // Status transition itself failed; row stays where it is. Counters
        // still need updating so the operator sees the failure surfaced.
      }
      await recordSubmissionFailure({
        submissionId: submission.id,
        batchId: batch.id,
        errorCode,
        errorMessage,
      });
    }
  }

  // 10. Finalize.
  const finalBatch = await finalizeBatch(batch.id);

  // 11. Re-read with verificationRecord joined for the response.
  const fresh = await getBatchById(batch.id);
  const submissionsForResponse = fresh?.submissions ?? [];

  const response: CreateBatchResponse = {
    batchId: finalBatch.id,
    status: finalBatch.status as CreateBatchResponse["status"],
    totalCount: finalBatch.totalCount,
    completedCount: finalBatch.completedCount,
    failedCount: finalBatch.failedCount,
    submissions: submissionsForResponse.map((s) => ({
      id: s.id,
      fileName: s.fileName,
      fileSize: s.fileSize,
      status: s.status as CreateBatchResponse["submissions"][number]["status"],
      errorCode: s.errorCode,
      errorMessage: s.errorMessage,
      verificationRecordId: s.verificationRecordId,
      createdAt: s.createdAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
  };

  return NextResponse.json(response);
}

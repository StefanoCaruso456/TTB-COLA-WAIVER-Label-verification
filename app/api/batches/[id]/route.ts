import { NextResponse } from "next/server";

import { getBatchById } from "@/lib/services/batch-service";
import type { GetBatchResponse } from "@/lib/schemas/batch-api.schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await getBatchById(id);
  if (!result) {
    return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }
  const { batch, submissions } = result;
  // Derived progress fields (Phase 6). processingCount is whatever's left
  // after subtracting terminal states; percentComplete treats failed +
  // canceled rows as "done" because they will not move forward, which is
  // what a reviewer needs the progress bar to reflect.
  const terminalCount =
    batch.completedCount + batch.failedCount + batch.canceledCount;
  const processingCount = Math.max(0, batch.totalCount - terminalCount);
  const percentComplete =
    batch.totalCount === 0
      ? 0
      : Math.min(100, Math.round((terminalCount / batch.totalCount) * 100));

  const response: GetBatchResponse = {
    batch: {
      id: batch.id,
      status: batch.status as GetBatchResponse["batch"]["status"],
      createdAt: batch.createdAt.toISOString(),
      completedAt: batch.completedAt?.toISOString() ?? null,
      clientName: batch.clientName,
      applicantName: batch.applicantName,
      totalCount: batch.totalCount,
      completedCount: batch.completedCount,
      failedCount: batch.failedCount,
      canceledCount: batch.canceledCount,
      processingCount,
      percentComplete,
      firstSubmissionId: batch.firstSubmissionId ?? null,
    },
    submissions: submissions.map((s) => ({
      id: s.id,
      fileName: s.fileName,
      fileSize: s.fileSize,
      status: s.status as GetBatchResponse["submissions"][number]["status"],
      errorCode: s.errorCode,
      errorMessage: s.errorMessage,
      verificationRecordId: s.verificationRecordId,
      createdAt: s.createdAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
  };
  return NextResponse.json(response);
}

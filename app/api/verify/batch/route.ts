import { NextResponse } from "next/server";

import { verifyBatchRequestSchema } from "@/lib/schemas/verify-batch-request.schema";
import { runVerificationBatch } from "@/lib/services/verification-orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = verifyBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid batch request payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const items = parsed.data.items.map((item) => ({
      itemKey: item.itemKey,
      clientName: item.clientName,
      applicantName: item.applicantName,
      productName: item.productName,
      application: item.application,
      images: item.images,
      mockScenario: item.mockScenario,
    }));
    const batch = await runVerificationBatch(items, {
      concurrency: parsed.data.concurrency,
    });
    return NextResponse.json(batch);
  } catch (err) {
    console.error("[/api/verify/batch] unexpected error", err);
    return NextResponse.json(
      { error: "Unexpected server error while running batch verification." },
      { status: 500 },
    );
  }
}

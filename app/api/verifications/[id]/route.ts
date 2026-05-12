import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getVerificationRecordById,
  updateReviewerNotes,
} from "@/lib/services/verification-record.service";

export const runtime = "nodejs";

const patchSchema = z.object({
  reviewerNotes: z.string().max(5000),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const record = await getVerificationRecordById(id);
    if (!record) {
      return NextResponse.json(
        { error: "Verification record not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ record });
  } catch (err) {
    console.error(`[/api/verifications/${id}] failed`, err);
    return NextResponse.json(
      { error: "Failed to load verification record." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const updated = await updateReviewerNotes(id, parsed.data.reviewerNotes);
    if (!updated) {
      return NextResponse.json(
        { error: "Verification record not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ record: updated });
  } catch (err) {
    console.error(`[PATCH /api/verifications/${id}] failed`, err);
    return NextResponse.json(
      { error: "Failed to update reviewer notes." },
      { status: 500 },
    );
  }
}

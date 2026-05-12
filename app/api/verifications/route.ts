import { NextResponse } from "next/server";

import { listVerificationRecords } from "@/lib/services/verification-record.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const records = await listVerificationRecords();
    return NextResponse.json({ records });
  } catch (err) {
    console.error("[/api/verifications] failed to list records", err);
    return NextResponse.json(
      { error: "Failed to load verification history." },
      { status: 500 },
    );
  }
}

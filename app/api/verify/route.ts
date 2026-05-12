import { NextResponse } from "next/server";
import { z } from "zod";

import { labelImagePayloadSchema } from "@/lib/schemas/cola-application.schema";
import {
  runVerification,
  VerificationInputError,
} from "@/lib/services/verification-orchestrator";
import { GeminiExtractionError } from "@/lib/services/gemini-label-extraction.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const verifyRequestSchema = z.object({
  clientName: z.string().trim().optional(),
  applicantName: z.string().trim().optional(),
  productName: z.string().trim().optional(),
  application: z.unknown(),
  images: z.array(labelImagePayloadSchema).min(1).max(10),
  mockScenario: z.string().optional(),
});

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

  const parsed = verifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request payload.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await runVerification({
      clientName: parsed.data.clientName,
      applicantName: parsed.data.applicantName,
      productName: parsed.data.productName,
      application: parsed.data.application,
      images: parsed.data.images,
      mockScenario: parsed.data.mockScenario,
    });

    return NextResponse.json({
      recordId: result.record?.id ?? null,
      report: result.report,
      extractedLabel: result.extractedLabel,
    });
  } catch (err) {
    if (err instanceof VerificationInputError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues },
        { status: 422 },
      );
    }
    if (err instanceof GeminiExtractionError) {
      return NextResponse.json(
        {
          error:
            "Label extraction failed. Try again, or set USE_MOCK_EXTRACTION=true to demo with mock data.",
          detail: err.message,
        },
        { status: 502 },
      );
    }
    console.error("[/api/verify] unexpected error", err);
    return NextResponse.json(
      { error: "Unexpected server error while running verification." },
      { status: 500 },
    );
  }
}

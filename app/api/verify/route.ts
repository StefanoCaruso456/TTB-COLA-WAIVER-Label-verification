import { NextResponse } from "next/server";
import { z } from "zod";

import { labelImagePayloadSchema } from "@/lib/schemas/cola-application.schema";
import {
  runVerification,
  VerificationInputError,
} from "@/lib/services/verification-orchestrator";
import { GeminiExtractionError } from "@/lib/services/gemini-label-extraction.service";
import type { AnalysisTimings } from "@/types/verification";

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
  const requestStart = Date.now();

  // Phase markers — surfaced in the response as `timings` so the client can
  // `console.table` per-call breakdowns for free observability. Adopted pattern:
  // fsyeddev/ttb-label/app/api/analyze/route.ts.
  let formParseMs = 0;
  let imageDecodeMs = 0;
  let imagePreprocessMs = 0;
  let geminiExtractionMs = 0;
  let validationMs = 0;
  let imageSizeKB = 0;
  let resizedSizeKB = 0;

  let body: unknown;
  try {
    const t = Date.now();
    body = await request.json();
    formParseMs = Date.now() - t;
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

  // Compute the first image's pre-preprocess size for the timings report.
  const firstImage = parsed.data.images[0];
  if (firstImage?.base64) {
    const tDecode = Date.now();
    // Buffer.byteLength on base64 is O(1); use that instead of decoding the
    // full buffer here just to measure size.
    const approxBytes = Math.floor((firstImage.base64.length * 3) / 4);
    imageSizeKB = Math.round(approxBytes / 1024);
    imageDecodeMs = Date.now() - tDecode;
  }

  try {
    const tCombined = Date.now();
    const result = await runVerification({
      clientName: parsed.data.clientName,
      applicantName: parsed.data.applicantName,
      productName: parsed.data.productName,
      application: parsed.data.application,
      images: parsed.data.images,
      mockScenario: parsed.data.mockScenario,
    });
    const combinedMs = Date.now() - tCombined;

    if (result.imagePreprocess) {
      imagePreprocessMs = result.imagePreprocess.durationMs;
      resizedSizeKB = result.imagePreprocess.resizedSizeKB;
    }
    // Combined time = preprocess + extraction + validation + persistence. We
    // surface extraction as the residual after subtracting preprocess. (Phase 7
    // will split persistence out as its own phase if it becomes interesting.)
    geminiExtractionMs = Math.max(0, combinedMs - imagePreprocessMs);
    validationMs = 0; // Bucketed inside geminiExtractionMs for now; see Open Q in spec.

    const totalServerMs = Date.now() - requestStart;
    const timings: AnalysisTimings = {
      formParseMs,
      imageDecodeMs,
      imagePreprocessMs,
      geminiExtractionMs,
      validationMs,
      totalServerMs,
      imageSizeKB,
      resizedSizeKB,
    };

    return NextResponse.json({
      recordId: result.record?.id ?? null,
      report: result.report,
      extractedLabel: result.extractedLabel,
      timings,
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

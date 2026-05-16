import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { runVerification } from "@/lib/services/verification-orchestrator";
import type { LabelExtractionService } from "@/lib/services/label-extraction.service";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";

function wineApp(): ColaApplication {
  return {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: {
      brandName: "Preprocess Test",
      netContents: ["750 mL"],
    },
    uploadLabelsStep: {
      labelImages: [
        {
          id: "img-1",
          fileName: "front.png",
          mimeType: "image/png",
          size: 0,
          labelImageType: "brand",
        },
      ],
    },
  };
}

const STUB_EXTRACTION: ExtractedLabel = {
  rawText: "Preprocess Test wine label",
  inferredProductType: "wine",
  inferredProductTypeConfidence: 0.9,
  imagesAnalyzed: ["img-1"],
  imageQuality: {
    blurRisk: "low",
    glareRisk: "low",
    lowLightRisk: "low",
    orientationRisk: "low",
    overallReadability: "good",
  },
  normalizedFields: {
    brandName: {
      value: "Preprocess Test",
      normalizedValue: "Preprocess Test",
      confidence: 0.95,
      evidenceText: "Preprocess Test",
      imageId: "img-1",
      labelImageType: "brand",
    },
  },
} as unknown as ExtractedLabel;

class CapturingExtractor implements LabelExtractionService {
  receivedImage: LabelImagePayload | null = null;
  async extract(input: {
    application: ColaApplication;
    images: LabelImagePayload[];
  }): Promise<ExtractedLabel> {
    this.receivedImage = input.images[0] ?? null;
    return STUB_EXTRACTION;
  }
}

async function makeLargePng(): Promise<string> {
  const buf = await sharp({
    create: {
      width: 3200,
      height: 2400,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

describe("verification-orchestrator + image preprocessing", () => {
  it("orchestrator_preprocesses_before_extraction", async () => {
    const largeBase64 = await makeLargePng();
    const originalBytes = Buffer.from(largeBase64, "base64").byteLength;

    const extractor = new CapturingExtractor();
    const result = await runVerification({
      application: wineApp(),
      images: [
        {
          id: "img-1",
          fileName: "front.png",
          mimeType: "image/png",
          size: originalBytes,
          labelImageType: "brand",
          base64: largeBase64,
        },
      ],
      extractionService: extractor,
      persist: false,
    });

    expect(extractor.receivedImage).not.toBeNull();
    const received = extractor.receivedImage!;
    // The extractor must have received the preprocessed (smaller) image.
    expect(received.mimeType).toBe("image/jpeg");
    const receivedBytes = Buffer.from(received.base64!, "base64").byteLength;
    expect(receivedBytes).toBeLessThan(originalBytes);

    // Summary surfaces preprocessing metadata for the API route to use.
    expect(result.imagePreprocess).toBeDefined();
    expect(result.imagePreprocess!.originalSizeKB).toBeGreaterThan(0);
    expect(result.imagePreprocess!.resizedSizeKB).toBeGreaterThan(0);
    expect(result.imagePreprocess!.resizedSizeKB).toBeLessThan(
      result.imagePreprocess!.originalSizeKB,
    );
  });

  it("orchestrator_skips_preprocess_when_env_disabled", async () => {
    const largeBase64 = await makeLargePng();
    const originalBytes = Buffer.from(largeBase64, "base64").byteLength;

    const prev = process.env.IMAGE_PREPROCESS_ENABLED;
    process.env.IMAGE_PREPROCESS_ENABLED = "false";

    try {
      const extractor = new CapturingExtractor();
      const result = await runVerification({
        application: wineApp(),
        images: [
          {
            id: "img-1",
            fileName: "front.png",
            mimeType: "image/png",
            size: originalBytes,
            labelImageType: "brand",
            base64: largeBase64,
          },
        ],
        extractionService: extractor,
        persist: false,
      });

      const received = extractor.receivedImage!;
      // No preprocessing — extractor receives the original image untouched.
      expect(received.mimeType).toBe("image/png");
      const receivedBytes = Buffer.from(received.base64!, "base64").byteLength;
      expect(receivedBytes).toBe(originalBytes);
      expect(result.imagePreprocess).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.IMAGE_PREPROCESS_ENABLED;
      } else {
        process.env.IMAGE_PREPROCESS_ENABLED = prev;
      }
    }
  });

  it("orchestrator_skips_preprocess_in_mock_scenario", async () => {
    const largeBase64 = await makeLargePng();
    const originalBytes = Buffer.from(largeBase64, "base64").byteLength;
    const extractor = new CapturingExtractor();
    await runVerification({
      application: wineApp(),
      images: [
        {
          id: "img-1",
          fileName: "front.png",
          mimeType: "image/png",
          size: originalBytes,
          labelImageType: "brand",
          base64: largeBase64,
        },
      ],
      extractionService: extractor,
      mockScenario: "wine-valid",
      persist: false,
    });

    const received = extractor.receivedImage!;
    // Mock scenario set ⇒ preprocessing skipped.
    expect(received.mimeType).toBe("image/png");
    const receivedBytes = Buffer.from(received.base64!, "base64").byteLength;
    expect(receivedBytes).toBe(originalBytes);
  });
});

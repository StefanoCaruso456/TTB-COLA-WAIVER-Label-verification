import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ColaApplication, LabelImagePayload } from "@/types/cola";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}));

function wineApp(): ColaApplication {
  return {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: {
      brandName: "Cypress Hills",
      netContents: ["750 mL"],
      alcoholContent: "13.5%",
      wine: { vintageYear: 2021 },
    },
    uploadLabelsStep: {
      labelImages: [
        {
          id: "img-1",
          fileName: "front.jpg",
          mimeType: "image/jpeg",
          size: 1024,
          labelImageType: "brand",
        },
      ],
    },
  };
}

function stubImage(): LabelImagePayload {
  return {
    id: "img-1",
    fileName: "front.jpg",
    mimeType: "image/jpeg",
    size: 1024,
    labelImageType: "brand",
    base64: "AAAA",
  };
}

const CANNED_RESPONSE = JSON.stringify({
  rawText: "EDOUARD DELAUNAY",
  inferredProductType: "wine",
  inferredProductTypeConfidence: 0.9,
  imagesAnalyzed: ["img-1"],
  normalizedFields: {
    brandName: { value: "EDOUARD DELAUNAY", confidence: 0.95 },
  },
  imageQuality: {},
});

describe("GeminiLabelExtractionService — BUG-01 raw-response logging", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    generateContentMock.mockReset();
    generateContentMock.mockResolvedValue({ text: CANNED_RESPONSE });
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    delete process.env.EXTRACTION_DEBUG_LOG;
  });

  afterEach(() => {
    infoSpy.mockRestore();
    delete process.env.EXTRACTION_DEBUG_LOG;
  });

  it("logs the raw response truncated to 2 KB when EXTRACTION_DEBUG_LOG=true", async () => {
    process.env.EXTRACTION_DEBUG_LOG = "true";
    const { GeminiLabelExtractionService } = await import(
      "@/lib/services/gemini-label-extraction.service"
    );
    const svc = new GeminiLabelExtractionService({
      apiKey: "test",
      model: "gemini-2.5-flash",
    });

    await svc.extract({
      application: wineApp(),
      images: [stubImage()],
    });

    const calls = infoSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("[gemini] raw response"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(CANNED_RESPONSE.slice(0, 2000));
  });

  it("does not log the raw response when EXTRACTION_DEBUG_LOG is unset", async () => {
    const { GeminiLabelExtractionService } = await import(
      "@/lib/services/gemini-label-extraction.service"
    );
    const svc = new GeminiLabelExtractionService({
      apiKey: "test",
      model: "gemini-2.5-flash",
    });

    await svc.extract({
      application: wineApp(),
      images: [stubImage()],
    });

    const calls = infoSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("[gemini] raw response"),
    );
    expect(calls).toHaveLength(0);
  });

  it("does not log the raw response when EXTRACTION_DEBUG_LOG=false", async () => {
    process.env.EXTRACTION_DEBUG_LOG = "false";
    const { GeminiLabelExtractionService } = await import(
      "@/lib/services/gemini-label-extraction.service"
    );
    const svc = new GeminiLabelExtractionService({
      apiKey: "test",
      model: "gemini-2.5-flash",
    });

    await svc.extract({
      application: wineApp(),
      images: [stubImage()],
    });

    const calls = infoSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("[gemini] raw response"),
    );
    expect(calls).toHaveLength(0);
  });
});

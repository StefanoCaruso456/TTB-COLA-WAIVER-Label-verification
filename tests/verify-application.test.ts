import { describe, it, expect } from "vitest";

import { verifyApplication } from "@/lib/services/verification.service";
import { MockLabelExtractionService } from "@/lib/services/mock-label-extraction.service";
import { resolveCommodityIntent } from "@/lib/services/commodity-router";
import type { ColaApplication } from "@/types/cola";

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
      wine: {
        vintageYear: 2021,
        appellation: "Napa Valley",
        grapeVarietals: ["Cabernet Sauvignon"],
        sulfiteDeclarationExpected: true,
        containsSulfites: true,
      },
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

async function buildReport(app: ColaApplication, scenario?: string) {
  const mock = new MockLabelExtractionService();
  const extracted = await mock.extract({
    application: app,
    images: app.uploadLabelsStep.labelImages,
    mockScenario: scenario,
  });
  const intent = resolveCommodityIntent({
    selectedProductType: app.applicationTypeStep.productType,
    inferredProductType: extracted.inferredProductType,
    inferredConfidence: extracted.inferredProductTypeConfidence,
  });
  return verifyApplication({ application: app, extractedLabel: extracted, commodityIntent: intent });
}

describe("verifyApplication (integration with mock extractor)", () => {
  it("returns needs_review on the happy wine path (human-review checks are present)", async () => {
    const report = await buildReport(wineApp());
    // brand should match, government warning should match, but warning typeface +
    // commodity routing are needs_review/human_review_required by design.
    expect(report.overallStatus).toBe("needs_review");
    expect(report.checks.some((c) => c.fieldKey === "brandName" && c.status === "match")).toBe(true);
    expect(
      report.checks.some((c) => c.fieldKey === "governmentWarning" && c.status === "match"),
    ).toBe(true);
  });

  it("returns fail when the government warning is missing", async () => {
    const report = await buildReport(wineApp(), "missing-warning");
    expect(report.overallStatus).toBe("fail");
    expect(
      report.checks.find((c) => c.fieldKey === "governmentWarning")?.status,
    ).toBe("missing");
  });

  it("flags ABV mismatch", async () => {
    const report = await buildReport(wineApp(), "abv-mismatch");
    expect(
      report.checks.find((c) => c.fieldKey === "alcoholContent")?.status,
    ).toBe("mismatch");
  });

  it("flags commodity routing conflict but routes by user selection", async () => {
    const report = await buildReport(wineApp(), "commodity-conflict");
    expect(report.commodityIntent.routingDecision).toBe("wine");
    expect(report.commodityIntent.conflictDetected).toBe(true);
  });

  it("flags poor image quality", async () => {
    const report = await buildReport(wineApp(), "image-quality-poor");
    const imageCheck = report.checks.find((c) => c.fieldKey === "imageQuality");
    expect(imageCheck?.status).toBe("needs_review");
  });

  it("flags missing country of origin for imported product", async () => {
    const app = wineApp();
    app.applicationTypeStep.sourceOfProduct = "imported";
    app.colaInformationStep.countryOfOrigin = "France";
    const report = await buildReport(app, "imported-missing-origin");
    const country = report.checks.find((c) => c.fieldKey === "countryOfOrigin");
    expect(country?.status).toBe("missing");
  });
});

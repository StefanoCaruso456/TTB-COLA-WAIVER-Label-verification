import { describe, expect, it } from "vitest";

import {
  runVerificationBatch,
  type BatchVerificationItemInput,
} from "@/lib/services/verification-orchestrator";
import { MockLabelExtractionService } from "@/lib/services/mock-label-extraction.service";
import type {
  LabelExtractionInput,
  LabelExtractionService,
} from "@/lib/services/label-extraction.service";
import {
  verifyBatchRequestSchema,
  BATCH_MAX_ITEMS,
} from "@/lib/schemas/verify-batch-request.schema";
import type { ColaApplication } from "@/types/cola";
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

function makeItem(
  overrides: Partial<BatchVerificationItemInput> = {},
): BatchVerificationItemInput {
  const app = wineApp();
  return {
    itemKey: overrides.itemKey ?? "wine-pass",
    application: overrides.application ?? app,
    images: overrides.images ?? app.uploadLabelsStep.labelImages,
    mockScenario: overrides.mockScenario,
    extractionService:
      overrides.extractionService ?? new MockLabelExtractionService(),
    persist: false,
    ...overrides,
  };
}

describe("verifyBatchRequestSchema", () => {
  it("accepts a minimal batch request", () => {
    const result = verifyBatchRequestSchema.safeParse({
      items: [
        {
          application: wineApp(),
          images: wineApp().uploadLabelsStep.labelImages,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty items array", () => {
    const result = verifyBatchRequestSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than BATCH_MAX_ITEMS items", () => {
    const item = {
      application: wineApp(),
      images: wineApp().uploadLabelsStep.labelImages,
    };
    const result = verifyBatchRequestSchema.safeParse({
      items: new Array(BATCH_MAX_ITEMS + 1).fill(item),
    });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range concurrency", () => {
    const item = {
      application: wineApp(),
      images: wineApp().uploadLabelsStep.labelImages,
    };
    const result = verifyBatchRequestSchema.safeParse({
      items: [item],
      concurrency: 99,
    });
    expect(result.success).toBe(false);
  });
});

describe("runVerificationBatch", () => {
  it("returns one result per item on the all-success path", async () => {
    const items: BatchVerificationItemInput[] = [
      makeItem({ itemKey: "a" }),
      makeItem({ itemKey: "b" }),
      makeItem({ itemKey: "c" }),
    ];
    const batch = await runVerificationBatch(items, { concurrency: 2 });
    expect(batch.results).toHaveLength(3);
    expect(batch.counts).toEqual({ total: 3, success: 3, failed: 0 });
    expect(batch.results.map((r) => r.itemKey)).toEqual(["a", "b", "c"]);
    expect(batch.results.every((r) => r.success && r.status)).toBe(true);
  });

  it("isolates failures so good items still succeed", async () => {
    const goodItem = makeItem({ itemKey: "good" });
    const badItem: BatchVerificationItemInput = {
      itemKey: "bad",
      application: { applicationTypeStep: { productType: "wine" } } as unknown,
      images: wineApp().uploadLabelsStep.labelImages,
      extractionService: new MockLabelExtractionService(),
      persist: false,
    };
    const batch = await runVerificationBatch([goodItem, badItem], {
      concurrency: 2,
    });
    expect(batch.counts).toEqual({ total: 2, success: 1, failed: 1 });
    const good = batch.results.find((r) => r.itemKey === "good");
    const bad = batch.results.find((r) => r.itemKey === "bad");
    expect(good?.success).toBe(true);
    expect(bad?.success).toBe(false);
    expect(bad?.error?.code).toBe("schema_validation");
  });

  it("respects the concurrency cap", async () => {
    let inFlight = 0;
    let observedMax = 0;
    class InstrumentedService implements LabelExtractionService {
      private readonly inner = new MockLabelExtractionService();
      async extract(input: LabelExtractionInput): Promise<ExtractedLabel> {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 25));
        try {
          return await this.inner.extract(input);
        } finally {
          inFlight--;
        }
      }
    }
    const shared = new InstrumentedService();
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ itemKey: `item-${i}`, extractionService: shared }),
    );
    await runVerificationBatch(items, { concurrency: 3 });
    expect(observedMax).toBeLessThanOrEqual(3);
    expect(observedMax).toBeGreaterThan(1);
  });

  it("clamps concurrency to the number of items", async () => {
    const items = [makeItem({ itemKey: "solo" })];
    const batch = await runVerificationBatch(items, { concurrency: 8 });
    expect(batch.concurrency).toBe(1);
    expect(batch.results).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";

import { colaApplicationSchema } from "@/lib/schemas/cola-application.schema";

function base() {
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

describe("colaApplicationSchema", () => {
  it("accepts a minimal valid application", () => {
    const r = colaApplicationSchema.safeParse(base());
    expect(r.success).toBe(true);
  });

  it("requires stateOfSaleForExemption when applicationType is exemption", () => {
    const input = base();
    input.applicationTypeStep.applicationType = "certificate_of_exemption";
    const r = colaApplicationSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) =>
          i.path.includes("stateOfSaleForExemption"),
        ),
      ).toBe(true);
    }
  });

  it("requires priorTtbId when isResubmission is true", () => {
    const input = base();
    input.applicationTypeStep.isResubmission = true;
    const r = colaApplicationSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path.includes("priorTtbId")),
      ).toBe(true);
    }
  });

  it("requires appellation when wine vintage year is provided", () => {
    const input = base();
    (input.colaInformationStep as Record<string, unknown>).wine = {
      vintageYear: 2021,
    };
    const r = colaApplicationSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path.includes("appellation")),
      ).toBe(true);
    }
  });

  it("rejects more than 10 label images", () => {
    const input = base();
    input.uploadLabelsStep.labelImages = Array.from({ length: 11 }, (_, i) => ({
      id: `img-${i}`,
      fileName: `front-${i}.jpg`,
      mimeType: "image/jpeg",
      size: 1024,
      labelImageType: "brand",
    }));
    const r = colaApplicationSchema.safeParse(input);
    expect(r.success).toBe(false);
  });
});

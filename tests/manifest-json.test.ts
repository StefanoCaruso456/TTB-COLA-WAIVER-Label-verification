import { describe, it, expect } from "vitest";

import {
  extractBatchMetadataFromJson,
  parseJsonManifest,
} from "@/lib/services/manifest-parser";
import type { ColaApplication } from "@/types/cola";

function wineApp(brand: string): ColaApplication {
  return {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: {
      brandName: brand,
      netContents: ["750 mL"],
      alcoholContent: "13.5%",
    },
    uploadLabelsStep: {
      labelImages: [
        {
          id: "p",
          fileName: "p.jpg",
          mimeType: "image/jpeg",
          size: 0,
          labelImageType: "brand",
        },
      ],
    },
  };
}

describe("parseJsonManifest", () => {
  it("happy path: well-formed JSON returns N rows and zero errors", () => {
    const result = parseJsonManifest({
      batchMetadata: { clientName: "Acme", applicantName: "Stefano" },
      submissions: [
        { file_name: "wine-01.jpg", application: wineApp("Bayview") },
        { file_name: "wine-02.jpg", application: wineApp("Cypress") },
      ],
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].file_name).toBe("wine-01.jpg");
    expect(result.rows[0].rowIndex).toBe(1);
    expect(result.rows[1].rowIndex).toBe(2);
  });

  it("fails when submissions is missing", () => {
    const result = parseJsonManifest({ batchMetadata: { clientName: "x" } });
    expect(result.rows).toEqual([]);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].issues).toBeDefined();
  });

  it("fails when submissions is an empty array", () => {
    const result = parseJsonManifest({ submissions: [] });
    expect(result.rows).toEqual([]);
    expect(result.parseErrors).toHaveLength(1);
  });

  it("fails on a non-enum product_type", () => {
    const bad = wineApp("X");
    (bad.applicationTypeStep as { productType: string }).productType =
      "banana_juice";
    const result = parseJsonManifest({
      submissions: [{ file_name: "x.jpg", application: bad }],
    });
    expect(result.rows).toEqual([]);
    expect(result.parseErrors[0].issues).toBeDefined();
  });

  it("fails on a non-string file_name", () => {
    const result = parseJsonManifest({
      submissions: [{ file_name: 42, application: wineApp("X") }],
    });
    expect(result.rows).toEqual([]);
    expect(result.parseErrors[0].issues).toBeDefined();
  });

  it("propagates a nested ColaApplication Zod failure (empty brandName)", () => {
    const bad = wineApp("");
    const result = parseJsonManifest({
      submissions: [{ file_name: "wine-01.jpg", application: bad }],
    });
    expect(result.rows).toEqual([]);
    expect(result.parseErrors[0].issues).toBeDefined();
    expect(
      JSON.stringify(result.parseErrors[0].issues),
    ).toMatch(/brandName/i);
  });

  it("extractBatchMetadataFromJson returns the metadata when valid", () => {
    const md = extractBatchMetadataFromJson({
      batchMetadata: { clientName: "Acme", applicantName: "Stefano" },
      submissions: [
        { file_name: "wine-01.jpg", application: wineApp("Bayview") },
      ],
    });
    expect(md).toEqual({ clientName: "Acme", applicantName: "Stefano" });
  });

  it("extractBatchMetadataFromJson returns empty object when manifest is malformed", () => {
    expect(extractBatchMetadataFromJson({ submissions: [] })).toEqual({});
    expect(extractBatchMetadataFromJson(null)).toEqual({});
  });
});

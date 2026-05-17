import { describe, expect, it } from "vitest";

import {
  createBatchApplicationsSchema,
  createBatchMetadataSchema,
  createBatchResponseSchema,
  MAX_BATCH_FILES,
} from "@/lib/schemas/batch-api.schema";
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
      brandName: "Test Brand",
      netContents: ["750 mL"],
    },
    uploadLabelsStep: {
      labelImages: [
        {
          id: "img-1",
          fileName: "front.png",
          mimeType: "image/png",
          size: 1024,
          labelImageType: "brand",
        },
      ],
    },
  };
}

describe("createBatchApplicationsSchema", () => {
  it("applications_schema_rejects_empty_array", () => {
    expect(createBatchApplicationsSchema.safeParse([]).success).toBe(false);
  });

  it(`applications_schema_rejects_more_than_${MAX_BATCH_FILES}`, () => {
    const apps = Array.from({ length: MAX_BATCH_FILES + 1 }, () => wineApp());
    expect(createBatchApplicationsSchema.safeParse(apps).success).toBe(false);
  });

  it("applications_schema_accepts_3_valid_applications", () => {
    const apps = [wineApp(), wineApp(), wineApp()];
    expect(createBatchApplicationsSchema.safeParse(apps).success).toBe(true);
  });

  it("applications_schema_rejects_invalid_application", () => {
    const apps = [
      wineApp(),
      {
        // Missing required colaInformationStep.brandName
        applicationTypeStep: {
          productType: "wine",
          sourceOfProduct: "domestic",
          applicationType: "certificate_of_label_approval",
          isResubmission: false,
        },
        colaInformationStep: { brandName: "", netContents: ["750 mL"] },
        uploadLabelsStep: {
          labelImages: [
            {
              id: "img-1",
              fileName: "front.png",
              mimeType: "image/png",
              size: 1024,
              labelImageType: "brand",
            },
          ],
        },
      },
    ];
    expect(createBatchApplicationsSchema.safeParse(apps).success).toBe(false);
  });
});

describe("createBatchMetadataSchema", () => {
  it("metadata_schema_accepts_clientName_and_applicantName", () => {
    const r = createBatchMetadataSchema.safeParse({
      clientName: "Acme Wines",
      applicantName: "Stefano",
    });
    expect(r.success).toBe(true);
  });

  it("metadata_schema_accepts_empty_object", () => {
    expect(createBatchMetadataSchema.safeParse({}).success).toBe(true);
  });

  it("metadata_schema_rejects_unknown_fields", () => {
    const r = createBatchMetadataSchema.safeParse({
      clientName: "Acme",
      unexpected: "bad",
    });
    expect(r.success).toBe(false);
  });

  it("metadata_schema_rejects_empty_string_clientName", () => {
    const r = createBatchMetadataSchema.safeParse({ clientName: "  " });
    expect(r.success).toBe(false);
  });
});

describe("createBatchResponseSchema", () => {
  it("response_schema_round_trips_a_partial_failure", () => {
    const payload = {
      batchId: "cmp1",
      status: "partially_failed" as const,
      totalCount: 3,
      completedCount: 2,
      failedCount: 1,
      submissions: [
        {
          id: "cms1",
          fileName: "a.jpg",
          fileSize: 1024,
          status: "verified" as const,
          verificationRecordId: "cmr1",
          createdAt: "2026-05-16T00:00:00Z",
          completedAt: "2026-05-16T00:00:05Z",
        },
        {
          id: "cms2",
          fileName: "b.jpg",
          fileSize: 2048,
          status: "failed" as const,
          errorCode: "GEMINI_OTHER",
          errorMessage: "boom",
          createdAt: "2026-05-16T00:00:00Z",
          completedAt: "2026-05-16T00:00:06Z",
        },
        {
          id: "cms3",
          fileName: "c.jpg",
          fileSize: 4096,
          status: "verified" as const,
          verificationRecordId: "cmr3",
          createdAt: "2026-05-16T00:00:00Z",
          completedAt: "2026-05-16T00:00:07Z",
        },
      ],
    };
    expect(createBatchResponseSchema.safeParse(payload).success).toBe(true);
  });
});

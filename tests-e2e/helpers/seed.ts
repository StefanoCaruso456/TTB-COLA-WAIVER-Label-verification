import { prisma } from "@/lib/prisma";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

export interface SeedSample {
  brand: string;
  clientName: string;
  productType: "wine" | "distilled_spirits" | "malt_beverage" | "domestic_sake";
  scenario: string;
}

export const SAMPLE_SUBMISSIONS: SeedSample[] = [
  {
    brand: "Cypress Hills Cellars",
    clientName: "Cypress Hills Cellars",
    productType: "wine",
    scenario: "wine-clean-pass",
  },
  {
    brand: "Bayview Wines",
    clientName: "Bayview Wines",
    productType: "wine",
    scenario: "wine-abv-mismatch",
  },
  {
    brand: "Mountain Pine Distillers",
    clientName: "Mountain Pine Distillers",
    productType: "distilled_spirits",
    scenario: "spirits-missing-warning",
  },
];

export async function resetSubmissions(): Promise<void> {
  await prisma.verificationRecord.deleteMany({});
}

export async function seedSubmissions(
  baseURL: string,
  samples: SeedSample[] = SAMPLE_SUBMISSIONS,
): Promise<string[]> {
  const ids: string[] = [];
  for (const s of samples) {
    const body = {
      clientName: s.clientName,
      applicantName: s.clientName,
      productName: s.brand,
      application: {
        applicationTypeStep: {
          productType: s.productType,
          sourceOfProduct: "domestic" as const,
          applicationType: "certificate_of_label_approval" as const,
          isResubmission: false,
        },
        colaInformationStep: {
          brandName: s.brand,
          netContents: ["750 mL"],
        },
        uploadLabelsStep: {
          labelImages: [
            {
              id: "img-1",
              fileName: "front.png",
              mimeType: "image/png",
              size: 100,
              labelImageType: "brand" as const,
            },
          ],
        },
      },
      images: [
        {
          id: "img-1",
          fileName: "front.png",
          mimeType: "image/png",
          size: 100,
          labelImageType: "brand" as const,
          base64: PNG_1x1,
        },
      ],
      mockScenario: s.scenario,
    };
    const res = await fetch(`${baseURL}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Seed failed for ${s.brand}: ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { recordId?: string };
    if (json.recordId) ids.push(json.recordId);
  }
  return ids;
}

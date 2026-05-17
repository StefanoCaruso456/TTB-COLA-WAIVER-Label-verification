import { test, expect, type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";

// Phase 4 — manifest support E2E coverage. The same test file exercises BOTH
// the new manifest branch AND the existing inline-applications branch in the
// same run, so decision #8 ("backwards compat enforced by E2E suite, not
// unit tests alone") fails CI loudly if the Phase 3 path regresses.

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

function uniqueBase64(seed: number): string {
  const decoded = Buffer.from(PNG_1x1, "base64");
  const filler = Buffer.alloc(seed + 1, seed);
  return Buffer.concat([decoded, filler]).toString("base64");
}

function wineApp(brandName: string) {
  return {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: {
      brandName,
      netContents: ["750 mL"],
      alcoholContent: "13.5% Alc./Vol.",
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

interface BatchResponse {
  batchId: string;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  submissions: Array<{ id: string; fileName: string; status: string }>;
}

interface ErrorBody {
  error: string;
  code?: string;
  parseErrors?: Array<{ line: number; reason: string }>;
  validationReport?: {
    orphanRows: Array<{ rowIndex: number; file_name: string }>;
    orphanFiles: Array<{ fileIndex: number; fileName: string }>;
  };
}

async function postMultipart(
  page: Page,
  url: string,
  parts: Array<{
    name: string;
    value: string;
    fileName?: string;
    mimeType?: string;
    base64?: string;
  }>,
): Promise<{ status: number; body: BatchResponse | ErrorBody }> {
  await page.goto(`${url.replace(/\/api\/batches$/, "")}/`, {
    waitUntil: "domcontentloaded",
  });
  return await page.evaluate(
    async (args: {
      url: string;
      parts: Array<{
        name: string;
        value: string;
        fileName?: string;
        mimeType?: string;
        base64?: string;
      }>;
    }) => {
      const fd = new FormData();
      for (const p of args.parts) {
        if (p.fileName && p.base64) {
          const bin = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
          fd.append(
            p.name,
            new Blob([bin], { type: p.mimeType ?? "application/octet-stream" }),
            p.fileName,
          );
        } else if (p.fileName) {
          fd.append(
            p.name,
            new Blob([p.value], { type: p.mimeType ?? "text/plain" }),
            p.fileName,
          );
        } else {
          fd.append(p.name, p.value);
        }
      }
      const res = await fetch(args.url, { method: "POST", body: fd });
      const body = await res.json();
      return { status: res.status, body };
    },
    { url, parts },
  ) as { status: number; body: BatchResponse | ErrorBody };
}

test.describe("Phase 4 — manifest support", () => {
  test.beforeEach(async () => {
    await prisma.verificationRecord.deleteMany({});
    await prisma.batch.deleteMany({});
  });

  test.afterAll(async () => {
    await prisma.verificationRecord.deleteMany({});
    await prisma.batch.deleteMany({});
  });

  test("backwards compat: inline applications branch still works (Phase 3 regression check)", async ({
    page,
    baseURL,
  }) => {
    const { status, body } = await postMultipart(
      page,
      `${baseURL}/api/batches`,
      [
        {
          name: "files",
          value: "",
          fileName: "wine-01.png",
          mimeType: "image/png",
          base64: uniqueBase64(1),
        },
        {
          name: "files",
          value: "",
          fileName: "wine-02.png",
          mimeType: "image/png",
          base64: uniqueBase64(2),
        },
        {
          name: "applications",
          value: JSON.stringify([wineApp("Cypress"), wineApp("Bayview")]),
        },
      ],
    );
    // Phase 5: 202 with batchId; the worker drains the queue async.
    expect(status).toBe(202);
    expect((body as BatchResponse).totalCount).toBe(2);
    expect((body as BatchResponse).batchId).toBeTruthy();
  });

  test("CSV manifest with 2 rows + 2 matching files creates 2 submissions", async ({
    page,
    baseURL,
  }) => {
    const csv = `file_name,product_type,brand_name,abv,net_contents
wine-01.png,wine,Cypress,13.5%,750 mL
wine-02.png,wine,Bayview,14.0%,750 mL`;
    const { status, body } = await postMultipart(
      page,
      `${baseURL}/api/batches`,
      [
        {
          name: "files",
          value: "",
          fileName: "wine-01.png",
          mimeType: "image/png",
          base64: uniqueBase64(11),
        },
        {
          name: "files",
          value: "",
          fileName: "wine-02.png",
          mimeType: "image/png",
          base64: uniqueBase64(12),
        },
        {
          name: "manifest",
          value: csv,
          fileName: "batch.csv",
          mimeType: "text/csv",
        },
      ],
    );
    // Phase 5: 202 + batchId; per-file status is on the GET endpoint.
    expect(status).toBe(202);
    expect((body as BatchResponse).totalCount).toBe(2);
    expect((body as BatchResponse).batchId).toBeTruthy();
  });

  test("JSON manifest with 2 rows + 2 matching files creates 2 submissions", async ({
    page,
    baseURL,
  }) => {
    const manifest = {
      batchMetadata: { clientName: "Acme" },
      submissions: [
        { file_name: "wine-01.png", application: wineApp("Cypress") },
        { file_name: "wine-02.png", application: wineApp("Bayview") },
      ],
    };
    const { status, body } = await postMultipart(
      page,
      `${baseURL}/api/batches`,
      [
        {
          name: "files",
          value: "",
          fileName: "wine-01.png",
          mimeType: "image/png",
          base64: uniqueBase64(21),
        },
        {
          name: "files",
          value: "",
          fileName: "wine-02.png",
          mimeType: "image/png",
          base64: uniqueBase64(22),
        },
        {
          name: "manifest",
          value: JSON.stringify(manifest),
          fileName: "batch.json",
          mimeType: "application/json",
        },
      ],
    );
    expect(status).toBe(202);
    expect((body as BatchResponse).totalCount).toBe(2);
  });

  test("orphan row → 400 manifest_files_mismatch (decision #4: hard fail)", async ({
    page,
    baseURL,
  }) => {
    const csv = `file_name,product_type,brand_name
wine-01.png,wine,Cypress
wine-missing.png,wine,Bayview`;
    const { status, body } = await postMultipart(
      page,
      `${baseURL}/api/batches`,
      [
        {
          name: "files",
          value: "",
          fileName: "wine-01.png",
          mimeType: "image/png",
          base64: uniqueBase64(31),
        },
        {
          name: "manifest",
          value: csv,
          fileName: "batch.csv",
          mimeType: "text/csv",
        },
      ],
    );
    expect(status).toBe(400);
    expect((body as ErrorBody).code).toBe("manifest_files_mismatch");
    expect((body as ErrorBody).validationReport?.orphanRows).toEqual([
      { rowIndex: 3, file_name: "wine-missing.png" },
    ]);
  });

  test("orphan file → 400 with orphan file listed", async ({
    page,
    baseURL,
  }) => {
    const csv = `file_name,product_type,brand_name
wine-01.png,wine,Cypress`;
    const { status, body } = await postMultipart(
      page,
      `${baseURL}/api/batches`,
      [
        {
          name: "files",
          value: "",
          fileName: "wine-01.png",
          mimeType: "image/png",
          base64: uniqueBase64(41),
        },
        {
          name: "files",
          value: "",
          fileName: "wine-extra.png",
          mimeType: "image/png",
          base64: uniqueBase64(42),
        },
        {
          name: "manifest",
          value: csv,
          fileName: "batch.csv",
          mimeType: "text/csv",
        },
      ],
    );
    expect(status).toBe(400);
    expect((body as ErrorBody).code).toBe("manifest_files_mismatch");
    expect((body as ErrorBody).validationReport?.orphanFiles).toContainEqual({
      fileIndex: 1,
      fileName: "wine-extra.png",
    });
  });

  test("manifest + applications both sent → 400 manifest_and_inline_conflict (decision #6)", async ({
    page,
    baseURL,
  }) => {
    const { status, body } = await postMultipart(
      page,
      `${baseURL}/api/batches`,
      [
        {
          name: "files",
          value: "",
          fileName: "wine-01.png",
          mimeType: "image/png",
          base64: uniqueBase64(51),
        },
        {
          name: "applications",
          value: JSON.stringify([wineApp("Cypress")]),
        },
        {
          name: "manifest",
          value: `file_name,product_type,brand_name\nwine-01.png,wine,Cypress`,
          fileName: "batch.csv",
          mimeType: "text/csv",
        },
      ],
    );
    expect(status).toBe(400);
    expect((body as ErrorBody).code).toBe("manifest_and_inline_conflict");
  });
});

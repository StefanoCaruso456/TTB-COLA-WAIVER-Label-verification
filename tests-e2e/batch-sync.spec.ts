import { test, expect, type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

// Two distinct images so the dedup guard doesn't fire. We base both on the
// 1x1 PNG and append a unique byte after, then re-encode — but a simpler
// approach is to just inject distinguishing trailing comments which still
// produce valid PNGs the mock extractor doesn't look at anyway.
function uniqueBase64(seed: number): string {
  // Combine the 1x1 PNG with N filler bytes to make each upload distinct.
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

interface CreateBatchResponse {
  batchId: string;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  submissions: Array<{
    id: string;
    fileName: string;
    status: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    verificationRecordId?: string | null;
  }>;
}

async function postBatch(
  page: Page,
  baseURL: string,
  files: Array<{ name: string; base64: string }>,
  applications: object[],
): Promise<{ status: number; body: CreateBatchResponse }> {
  // Playwright 1.60's request.post `multipart` option doesn't accept native
  // FormData with multiple values under one field name. Easiest fix: run the
  // request from inside the browser, where FormData + fetch work natively.
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(
    async (args: {
      url: string;
      files: Array<{ name: string; base64: string }>;
      applications: object[];
      batchMetadata: object;
    }) => {
      const fd = new FormData();
      for (const f of args.files) {
        const bin = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        fd.append("files", new Blob([bin], { type: "image/png" }), f.name);
      }
      fd.append("applications", JSON.stringify(args.applications));
      fd.append("batchMetadata", JSON.stringify(args.batchMetadata));
      const res = await fetch(args.url, { method: "POST", body: fd });
      const body = await res.json();
      return { status: res.status, body };
    },
    {
      url: `${baseURL}/api/batches`,
      files,
      applications,
      batchMetadata: { clientName: "E2E Test Client" },
    },
  );
  return { status: result.status, body: result.body as CreateBatchResponse };
}

test.describe("Batch sync endpoint", () => {
  test.beforeEach(async () => {
    // Clean DB state. Cascade FK takes care of submissions when batches drop.
    await prisma.verificationRecord.deleteMany({});
    await prisma.batch.deleteMany({});
  });

  test.afterAll(async () => {
    await prisma.verificationRecord.deleteMany({});
    await prisma.batch.deleteMany({});
  });

  test("batch_with_3_files_processes_with_per_file_isolation", async ({
    page,
    baseURL,
  }) => {
    const files = [
      { name: "wine1.png", base64: uniqueBase64(1) },
      { name: "wine2.png", base64: uniqueBase64(2) },
      { name: "wine3.png", base64: uniqueBase64(3) },
    ];
    const applications = [
      wineApp("Cypress Hills"),
      wineApp("Old Tom Vineyards"),
      wineApp("Bayview Wines"),
    ];

    // Phase 5: POST returns 202 with batchId + totalCount only. The worker
    // drains the queue in the background; the test polls the GET endpoint
    // until the batch is terminal.
    const { status, body } = await postBatch(page, baseURL!, files, applications);
    expect(status).toBe(202);
    expect(body.totalCount).toBe(3);
    expect(body.batchId).toBeTruthy();

    // Poll until terminal (or timeout).
    const deadlineMs = Date.now() + 60_000;
    let getBody: {
      batch: { id: string; status: string; totalCount: number; completedCount: number; failedCount: number };
      submissions: Array<{ status: string; verificationRecordId: string | null }>;
    } | null = null;
    while (Date.now() < deadlineMs) {
      const getRes = await page.request.get(
        `${baseURL}/api/batches/${body.batchId}`,
      );
      expect(getRes.status()).toBe(200);
      getBody = await getRes.json();
      if (
        ["completed", "partially_failed", "canceled"].includes(getBody!.batch.status)
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(getBody).not.toBeNull();
    expect(getBody!.batch.id).toBe(body.batchId);
    expect(getBody!.batch.totalCount).toBe(3);
    expect(getBody!.batch.completedCount).toBe(3);
    expect(getBody!.batch.failedCount).toBe(0);
    expect(getBody!.batch.status).toBe("completed");
    expect(getBody!.submissions).toHaveLength(3);
    for (const s of getBody!.submissions) {
      expect(s.status).toBe("verified");
      expect(s.verificationRecordId).toBeTruthy();
    }

    // Render the batch detail page.
    await page.goto(`/batches/${body.batchId}`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText("Batch");
    await expect(page.locator("tbody tr")).toHaveCount(3);
    // Verified rows have "View report →" links.
    await expect(
      page.locator("tbody a:has-text('View report')"),
    ).toHaveCount(3);

    // Submissions tab filter by batchId.
    await page.goto(`/?batchId=${body.batchId}`, { waitUntil: "networkidle" });
    await expect(page.locator("text=/Showing submissions from batch/")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(3);
  });

  test("rejects_more_than_5_files", async ({ page, baseURL }) => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `f${i}.png`,
      base64: uniqueBase64(i + 10),
    }));
    const applications = files.map((_, i) => wineApp(`Brand-${i}`));
    const { status, body } = await postBatch(page, baseURL!, files, applications);
    expect(status).toBe(400);
    expect((body as unknown as { code: string }).code).toBe("TOO_MANY_FILES");
  });

  test("rejects_duplicate_file_in_batch", async ({ page, baseURL }) => {
    const dup = uniqueBase64(42);
    const files = [
      { name: "a.png", base64: dup },
      { name: "b.png", base64: dup },
    ];
    const applications = [wineApp("Brand A"), wineApp("Brand B")];
    const { status, body } = await postBatch(page, baseURL!, files, applications);
    expect(status).toBe(400);
    expect((body as unknown as { code: string }).code).toBe(
      "DUPLICATE_FILE_IN_BATCH",
    );
  });

  test("rejects_count_mismatch", async ({ page, baseURL }) => {
    const files = [
      { name: "a.png", base64: uniqueBase64(50) },
      { name: "b.png", base64: uniqueBase64(51) },
    ];
    const applications = [wineApp("Only One")]; // 1 app for 2 files
    const { status, body } = await postBatch(page, baseURL!, files, applications);
    expect(status).toBe(400);
    expect((body as unknown as { code: string }).code).toBe("COUNT_MISMATCH");
  });
});

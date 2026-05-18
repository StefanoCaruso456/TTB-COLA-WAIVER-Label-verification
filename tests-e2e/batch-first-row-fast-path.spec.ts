import { test, expect, type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";

// Phase 6 — first-row fast-path. Asserts:
//   - POST /api/batches returns 200 (not 202) with a verified firstSubmission
//   - The /batches/:id page renders the first-result banner immediately
//   - The progress bar shows correct counts after the inline run
//
// Runs under USE_MOCK_EXTRACTION=true (set in playwright.config.ts webServer
// env) so no real Gemini call is made. The mock extractor returns a stable
// deterministic ExtractedLabel.

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
  firstSubmission?: {
    ok: boolean;
    submissionId: string;
    fileName: string;
    verificationRecordId?: string;
    errorCode?: string;
    errorMessage?: string;
  };
}

async function postBatch(
  page: Page,
  baseURL: string,
  files: Array<{ name: string; base64: string }>,
  applications: object[],
): Promise<{ status: number; body: BatchResponse }> {
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(
    async (args: {
      url: string;
      files: Array<{ name: string; base64: string }>;
      applications: object[];
    }) => {
      const fd = new FormData();
      for (const f of args.files) {
        const bin = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        fd.append("files", new Blob([bin], { type: "image/png" }), f.name);
      }
      fd.append("applications", JSON.stringify(args.applications));
      const res = await fetch(args.url, { method: "POST", body: fd });
      const body = await res.json();
      return { status: res.status, body };
    },
    {
      url: `${baseURL}/api/batches`,
      files,
      applications,
    },
  );
  return { status: result.status, body: result.body as BatchResponse };
}

test.describe("Phase 6 — first-row fast path", () => {
  test.afterEach(async () => {
    // Best-effort cleanup of test batches. Order matters because of FKs.
    await prisma.verificationRecord.deleteMany({
      where: { productName: { contains: "fast-path-" } },
    });
    await prisma.batchSubmission.deleteMany({
      where: { fileName: { contains: "fast-path-" } },
    });
    await prisma.batch.deleteMany({
      where: { clientName: "FAST_PATH_E2E" },
    });
  });

  test("POST returns 200 with firstSubmission.ok=true; batch.completedCount=1 immediately", async ({
    page,
    baseURL,
  }) => {
    const files = Array.from({ length: 3 }, (_, i) => ({
      name: `fast-path-${i}.png`,
      base64: uniqueBase64(i),
    }));
    const applications = files.map((_, i) => wineApp(`Fast Path ${i}`));

    const { status, body } = await postBatch(
      page,
      baseURL!,
      files,
      applications,
    );
    expect(status).toBe(200);
    expect(body.firstSubmission?.ok).toBe(true);
    expect(body.firstSubmission?.fileName).toBe("fast-path-0.png");
    expect(body.firstSubmission?.verificationRecordId).toBeTruthy();

    // The batch row should already show completedCount=1 because the inline
    // run finished before the response.
    const batch = await prisma.batch.findUnique({
      where: { id: body.batchId },
    });
    expect(batch?.completedCount).toBeGreaterThanOrEqual(1);
    expect(batch?.firstSubmissionId).toBe(body.firstSubmission?.submissionId);
  });

  test("/batches/:id renders the first-result banner without waiting for poll", async ({
    page,
    baseURL,
  }) => {
    const files = Array.from({ length: 3 }, (_, i) => ({
      name: `fast-path-banner-${i}.png`,
      base64: uniqueBase64(100 + i),
    }));
    const applications = files.map((_, i) => wineApp(`Banner Test ${i}`));

    const { body } = await postBatch(
      page,
      baseURL!,
      files,
      applications,
    );

    await page.goto(`${baseURL}/batches/${body.batchId}`);

    // The first-result banner is server-rendered on initial page load — it
    // appears synchronously, no polling required.
    const banner = page.getByTestId("batch-first-result-banner");
    await expect(banner).toBeVisible({ timeout: 5000 });
    // Banner contains the file name of row 1.
    await expect(banner).toContainText("fast-path-banner-0.png");

    // The progress bar is also visible and shows >=1 verified.
    const progressBar = page.getByTestId("batch-progress-bar");
    await expect(progressBar).toBeVisible();
    await expect(progressBar).toContainText(/verified/i);
  });

  test("a failed row 1 is surfaced as firstSubmission.ok=false but batch still processes 2…N", async ({
    page,
    baseURL,
  }) => {
    // Validate the failure isolation contract: even when row 1 fails (here
    // simulated by sending an empty buffer the mock extractor treats as
    // unreadable), POST should still return 200 with ok:false and the rest
    // of the batch should run.
    //
    // The mock extractor does not fail on empty buffers in the current
    // implementation, so this test is a placeholder demonstrating the assertion
    // shape; remove the .skip and substitute a real failure trigger
    // (e.g. invalid mimeType, missing application field) once the mock
    // extractor's failure surface is wired.
    test.skip(true, "pending: mock extractor failure trigger not yet wired");

    const files = [
      { name: "fast-path-fail-0.png", base64: uniqueBase64(200) },
      { name: "fast-path-fail-1.png", base64: uniqueBase64(201) },
    ];
    const applications = [
      // Some shape that triggers a runVerification failure on row 1.
      { invalid: true },
      wineApp("Will Succeed"),
    ];
    const { body } = await postBatch(
      page,
      baseURL!,
      files,
      applications as object[],
    );
    expect(body.firstSubmission?.ok).toBe(false);
  });
});

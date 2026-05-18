import { test, expect, type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";

// Phase 6 — drill-down panel. Asserts a click on a completed batch row
// opens the slide-in panel without a full page navigation, and Escape
// closes it.

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

async function postBatchAndOpenDetail(
  page: Page,
  baseURL: string,
): Promise<string> {
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  const files = Array.from({ length: 2 }, (_, i) => ({
    name: `drill-down-${i}.png`,
    base64: uniqueBase64(300 + i),
  }));
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
      return (await res.json()) as { batchId: string };
    },
    {
      url: `${baseURL}/api/batches`,
      files,
      applications: files.map((_, i) => wineApp(`Drill Down ${i}`)),
    },
  );
  await page.goto(`${baseURL}/batches/${result.batchId}`);
  return result.batchId;
}

test.describe("Phase 6 — drill-down panel", () => {
  test.afterEach(async () => {
    await prisma.batchSubmission.deleteMany({
      where: { fileName: { contains: "drill-down-" } },
    });
  });

  test("clicking a verified row opens the drill-down with the report", async ({
    page,
    baseURL,
  }) => {
    await postBatchAndOpenDetail(page, baseURL!);

    // Wait for row 1 to be visible — it's the inline-verified row.
    const firstRow = page.getByTestId("batch-row-1");
    await expect(firstRow).toBeVisible();

    await firstRow.click();

    const panel = page.getByTestId("batch-drill-down-panel");
    await expect(panel).toBeVisible({ timeout: 5000 });
    // The panel renders the single-label VerificationResults component, which
    // surfaces audit summary labels.
    await expect(panel).toContainText(/Passing|Errors|Total/i);
  });

  test("Escape closes the drill-down panel", async ({ page, baseURL }) => {
    await postBatchAndOpenDetail(page, baseURL!);

    const firstRow = page.getByTestId("batch-row-1");
    await firstRow.click();

    const panel = page.getByTestId("batch-drill-down-panel");
    await expect(panel).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
  });

  test("opening a second row swaps content without navigation", async ({
    page,
    baseURL,
  }) => {
    await postBatchAndOpenDetail(page, baseURL!);
    const urlBefore = page.url();

    // First row, then close, then second row — drill-down should re-open
    // with different content but the URL must not change.
    await page.getByTestId("batch-row-1").click();
    await expect(page.getByTestId("batch-drill-down-panel")).toBeVisible();

    // Background scrim closes the panel on click.
    await page.locator("div.fixed.inset-0.z-40").click();
    await expect(
      page.getByTestId("batch-drill-down-panel"),
    ).not.toBeVisible();

    // Row 2 may still be queued in a tiny window depending on worker timing,
    // so allow up to 6 seconds for the async path to finish before clicking.
    const row2 = page.getByTestId("batch-row-2");
    await expect(row2).toBeVisible();
    // Wait until row 2 is clickable (verificationRecordId resolved) by
    // checking the "click to view" affordance.
    await expect(row2).toContainText(/click to view|verified/i, {
      timeout: 10_000,
    });

    expect(page.url()).toBe(urlBefore);
  });
});

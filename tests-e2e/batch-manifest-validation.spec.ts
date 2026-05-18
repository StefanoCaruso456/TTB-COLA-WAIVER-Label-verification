import { test, expect } from "@playwright/test";

// Phase 6 — pre-submit validation panel. Drops a manifest with an orphan
// row at the new-batch UI and asserts (1) the validation panel surfaces
// the orphan, (2) the Submit button is disabled, (3) fixing the manifest
// re-enables Submit.

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

function pngBytes(seed: number): Buffer {
  const decoded = Buffer.from(PNG_1x1, "base64");
  const filler = Buffer.alloc(seed + 1, seed);
  return Buffer.concat([decoded, filler]);
}

async function findBatchUploadPage(page: import("@playwright/test").Page) {
  // The new-batch flow lives behind the batch-mode toggle on the home page.
  // We open / and switch into batch mode.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const toggle = page.getByRole("button", { name: /batch/i }).first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
  }
}

test.describe("Phase 6 — pre-submit manifest validation", () => {
  test("orphan manifest row disables Submit and is named in the panel", async ({
    page,
  }) => {
    await findBatchUploadPage(page);

    // Upload one file but reference TWO file_name values in the manifest —
    // the second row has no matching upload.
    const dropzone = page.getByTestId("batch-dropzone");
    await expect(dropzone).toBeVisible();

    const fileInput = dropzone.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: "row-one.png",
        mimeType: "image/png",
        buffer: pngBytes(1),
      },
    ]);

    const manifestTextarea = page.locator(
      'textarea[placeholder*="file_name"]',
    );
    await manifestTextarea.fill(
      "file_name,product_type,brand_name\nrow-one.png,wine,Alpha\nrow-two.png,wine,Beta",
    );

    const panel = page.getByTestId("preview-validation-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-valid", "false");
    await expect(panel).toContainText("row-two.png");

    const submit = page.getByRole("button", {
      name: /run batch verification/i,
    });
    await expect(submit).toBeDisabled();
  });

  test("fixing the manifest re-enables Submit and turns the panel green", async ({
    page,
  }) => {
    await findBatchUploadPage(page);

    const dropzone = page.getByTestId("batch-dropzone");
    const fileInput = dropzone.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: "wine-01.png",
        mimeType: "image/png",
        buffer: pngBytes(2),
      },
    ]);

    const manifestTextarea = page.locator(
      'textarea[placeholder*="file_name"]',
    );
    await manifestTextarea.fill(
      "file_name,product_type,brand_name\nwine-01.png,wine,Alpha",
    );

    const panel = page.getByTestId("preview-validation-panel");
    await expect(panel).toHaveAttribute("data-valid", "true");

    const submit = page.getByRole("button", {
      name: /run batch verification/i,
    });
    await expect(submit).toBeEnabled();
  });

  test("missing required column flags the column name", async ({ page }) => {
    await findBatchUploadPage(page);

    const dropzone = page.getByTestId("batch-dropzone");
    const fileInput = dropzone.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: "wine-01.png",
        mimeType: "image/png",
        buffer: pngBytes(3),
      },
    ]);

    const manifestTextarea = page.locator(
      'textarea[placeholder*="file_name"]',
    );
    // Missing product_type.
    await manifestTextarea.fill(
      "file_name,brand_name\nwine-01.png,Alpha",
    );

    const panel = page.getByTestId("preview-validation-panel");
    await expect(panel).toHaveAttribute("data-valid", "false");
    await expect(panel).toContainText("product_type");
  });
});

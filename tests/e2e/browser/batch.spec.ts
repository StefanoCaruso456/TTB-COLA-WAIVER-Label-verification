import { expect, test } from "@playwright/test";

test.describe("Batch verification /batch", () => {
  test("runs all selected samples and renders the per-row results table", async ({
    page,
  }) => {
    await page.goto("/batch");
    await expect(
      page.getByRole("heading", { name: /Batch verification/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Sample scenarios/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Run batch \(\d+\)$/ }).click();

    await expect(
      page.getByRole("heading", { name: /Batch results/i }),
    ).toBeVisible({ timeout: 60_000 });

    const rows = page.locator("section:has-text('Batch results') tbody tr");
    await expect(rows).toHaveCount(6);

    await expect(page.getByText(/6 passed/i)).toBeVisible();

    await expect(page.getByRole("link", { name: "View →" }).first()).toBeVisible();
  });

  test("Clear button empties the selection and disables Run", async ({
    page,
  }) => {
    await page.goto("/batch");
    await page.getByRole("button", { name: /^Clear$/ }).click();
    await expect(
      page.getByRole("button", { name: /^Run batch \(0\)$/ }),
    ).toBeDisabled();
  });
});

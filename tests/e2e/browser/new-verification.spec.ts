import { expect, test } from "@playwright/test";

test.describe("New verification flow /new", () => {
  test("loads a sample scenario and produces a report", async ({ page }) => {
    await page.goto("/new");
    await expect(
      page.getByRole("heading", { name: /New verification/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Wine — clean pass/i }).click();

    await page.getByRole("button", { name: /Run verification/i }).click();

    await expect(page.getByText(/Overall status/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: /Verification results/i }),
    ).toBeVisible();
  });

  test("flags a fail when the warning is missing", async ({ page }) => {
    await page.goto("/new");
    await page
      .getByRole("button", { name: /Spirits — missing government warning/i })
      .click();
    await page.getByRole("button", { name: /Run verification/i }).click();
    await expect(page.getByText(/Fail/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

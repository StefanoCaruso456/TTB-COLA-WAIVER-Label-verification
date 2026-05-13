import { expect, test } from "@playwright/test";

test.describe("Dashboard /", () => {
  test("renders heading, nav, and entry CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Verification history/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Run batch/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /\+ New verification/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Batch$/ }),
    ).toBeVisible();
  });

  test("shows the empty-state when no records exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No verifications yet.")).toBeVisible();
  });
});

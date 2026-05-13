import { expect, test } from "@playwright/test";

test.describe("Verification detail /verification/[id]", () => {
  test("a saved record from /new is viewable on the detail page", async ({
    page,
  }) => {
    await page.goto("/new");
    await page.getByRole("button", { name: /Wine — clean pass/i }).click();
    await page.getByRole("button", { name: /Run verification/i }).click();

    const savedLine = page.getByText(/Saved as record\s+rec_/i);
    await expect(savedLine).toBeVisible({ timeout: 30_000 });

    const recordId = await savedLine.locator("span.font-mono").innerText();
    expect(recordId).toMatch(/^rec_/);

    await page.goto(`/verification/${recordId}`);
    await expect(
      page.getByRole("heading", { name: /Verification results/i }),
    ).toBeVisible();
  });

  test("unknown id surfaces a not-found response", async ({ page }) => {
    const response = await page.goto("/verification/does-not-exist");
    expect(response?.status()).toBeGreaterThanOrEqual(404);
  });
});

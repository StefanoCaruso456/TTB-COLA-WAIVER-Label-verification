import { test, expect, type Page } from "@playwright/test";

import { resetSubmissions, seedSubmissions } from "./helpers/seed";

async function gotoSubmissions(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  // Wait until the React client component has wired its handlers. We use the
  // "Showing N of N" footer, which only renders inside the client component
  // and is stable across SSR + hydration.
  await expect(page.locator('text=/Showing \\d+ of \\d+/')).toBeVisible();
}

test.describe("Submissions tab", () => {
  test.beforeEach(async ({ baseURL }) => {
    await resetSubmissions();
    await seedSubmissions(baseURL!);
  });

  test.afterAll(async () => {
    await resetSubmissions();
  });

  test("renders nav, heading, columns, and pipeline stats", async ({
    page,
  }) => {
    await gotoSubmissions(page);

    await expect(page.locator("header nav")).toContainText("Submissions");
    await expect(page.locator("h1").first()).toHaveText("Submissions");

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.locator("thead th")).toHaveText([
      "Date",
      "Client / Applicant",
      "Brand",
      "Product type",
      "Source",
      "Auto status",
      "Reviewer status",
      "Assignee",
      "Report",
    ]);
    await expect(table.locator("tbody tr")).toHaveCount(3);

    const totalCard = page
      .locator("div", { has: page.locator("text=Total") })
      .first();
    await expect(totalCard).toContainText("3");

    const pendingCard = page
      .locator("div", { has: page.locator("text=Pending") })
      .first();
    await expect(pendingCard).toContainText("3");
  });

  test("search narrows rows", async ({ page }) => {
    await gotoSubmissions(page);
    await page.locator('input[type="search"]').fill("Bayview");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("Bayview Wines");
  });

  test("reviewer-status filter narrows rows", async ({ page }) => {
    await gotoSubmissions(page);
    const reviewerFilter = page.locator("div.rounded-xl select").nth(1);
    await reviewerFilter.selectOption("approved");
    await expect(page.locator("tbody")).toContainText(
      "No submissions match the current filters.",
    );
  });

  test("inline edit of reviewer status and assignee persists across reload", async ({
    page,
  }) => {
    await gotoSubmissions(page);
    await expect(page.locator("tbody tr")).toHaveCount(3);

    const firstRow = page.locator("tbody tr").first();

    const statusPatch = page.waitForResponse(
      (res) =>
        /\/api\/verifications\/[^/]+$/.test(res.url()) &&
        res.request().method() === "PATCH",
    );
    await firstRow.locator("select").selectOption("approved");
    await statusPatch;

    const assigneePatch = page.waitForResponse(
      (res) =>
        /\/api\/verifications\/[^/]+$/.test(res.url()) &&
        res.request().method() === "PATCH",
    );
    await firstRow.locator('input[type="text"]').fill("alice@ttb");
    await firstRow.locator('input[type="text"]').blur();
    await assigneePatch;

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('text=/Showing \\d+ of \\d+/')).toBeVisible();

    const reloadedFirstRow = page.locator("tbody tr").first();
    await expect(reloadedFirstRow.locator("select")).toHaveValue("approved");
    await expect(reloadedFirstRow.locator('input[type="text"]')).toHaveValue(
      "alice@ttb",
    );
    await expect(reloadedFirstRow).toContainText("Approved");

    const approvedCard = page
      .locator("div", { has: page.locator("text=Approved") })
      .first();
    await expect(approvedCard).toContainText("1");

    const reviewerFilter = page.locator("div.rounded-xl select").nth(1);
    await reviewerFilter.selectOption("approved");
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });
});

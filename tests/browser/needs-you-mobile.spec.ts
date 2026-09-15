import { expect, test, type Page } from "@playwright/test";

/**
 * A phone is not a narrow desktop.
 *
 * The old bar's thirty-plus chips wrapped into a wall on a phone; the failure
 * mode worth testing for is the other one — a row that does not wrap and
 * silently makes the whole page scroll sideways. Horizontal overflow is the
 * single check that catches it, and it is checked on the page and on the open
 * Filters sheet, because the sheet is where the chips actually live now.
 */

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "phone viewport only");

  /** Loaded, hydrated and showing a queue — not merely "the network went quiet". */
  async function settled(page: Page) {
    await page.goto("/needs-you", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Needs You/ }).first()).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Needs You queue" })
        .or(page.getByText(/Nothing (needs you|matches)|no open work|holding nothing/)),
    ).toBeVisible();
  }

  async function overflows(page: Page) {
    return page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
  }

  test("the queue does not scroll sideways", async ({ page }) => {
    await settled(page);
    expect(await overflows(page)).toBeLessThanOrEqual(1);
  });

  test("the Filters sheet opens from the bottom and does not overflow", async ({ page }) => {
    await settled(page);

    const button = page.getByRole("button", { name: /^Filters/ });
    await button.scrollIntoViewIfNeeded();
    await button.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    // Full width, anchored to the bottom: the bottom-sheet shape.
    expect(box!.width).toBeGreaterThan(viewport.width - 4);
    expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 4);

    expect(await overflows(page)).toBeLessThanOrEqual(1);
  });

  test("opening every group still does not overflow", async ({ page }) => {
    await settled(page);
    await page.getByRole("button", { name: /^Filters/ }).click();

    const sheet = page.getByRole("dialog");
    for (const group of ["Responsibility", "Work type"]) {
      await sheet.getByRole("button", { name: group, exact: false }).first().click();
    }
    // Open a couple of work-type modules too, which is where the chip count is.
    const modules = sheet.locator('button[aria-expanded="false"]');
    const n = Math.min(await modules.count(), 4);
    for (let i = 0; i < n; i++) await modules.nth(0).click();

    expect(await overflows(page)).toBeLessThanOrEqual(1);
  });
});

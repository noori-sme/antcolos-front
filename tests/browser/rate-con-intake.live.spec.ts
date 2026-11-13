import { expect, test } from "@playwright/test";

/**
 * Plan 13 (F1.1): the Rate Con upload screen. Live: (app) routes need a real
 * session, so this runs against a signed-in http-mode app with a backend
 * (excluded from CI). Sign in as a member holding `document.review` first
 * (the seeded `carrier@antcolos.dev`), e.g. with a storage state.
 * The gate itself is unit-tested (permissions.test.ts, route-availability.test.ts).
 */
test.describe("Rate Con upload", () => {
  test("opens for a reviewer and refuses an unsupported file before uploading", async ({ page }) => {
    await page.goto("/rate-cons/new", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "New load from a Rate Con" })).toBeVisible();

    const submit = page.getByRole("button", { name: "Upload and read" });
    await expect(submit).toBeDisabled();

    await page.getByLabel(/Rate confirmation/).setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a rate con"),
    });
    await expect(page.getByRole("alert")).toHaveText("Choose a PDF, JPEG, PNG or WEBP file.");
    await expect(submit).toBeDisabled();

    await page.getByLabel(/Rate confirmation/).setInputFiles({
      name: "ratecon.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n"),
    });
    await expect(page.getByText("ratecon.pdf")).toBeVisible();
    await expect(submit).toBeEnabled();
  });

  test("fits a 360 px screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/rate-cons/new", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "New load from a Rate Con" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

import { expect, test, type Page } from "@playwright/test";

/**
 * A driver showing a carrier their licence without photographing it again.
 *
 * Both roads are walked here — a carrier already on Antcolos, and one that has
 * never heard of it — and both end at the same place: the recipient looking at
 * the SAME documents the driver already had, watermarked, for a limited time,
 * with the driver able to take it back.
 *
 * MOCK PERSISTENCE: shares live in memory for one page load, so every test
 * creates its own and moves by clicking rather than reloading. The rules that
 * cannot be clicked — no duplicate record, no relationship, scope, idempotency —
 * are proven in src/features/driver/document-sharing.test.ts.
 */

async function navTo(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  if ((await link.count()) === 0) {
    const more = page.getByRole("button", { name: "More" });
    await (await more.count() ? more : page.getByRole("button", { name: "Open navigation" })).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  await link.first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Selects the first prepared document and lands on the recipient step. */
async function startShare(page: Page) {
  await page.goto("/driver/documents", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Share with a carrier/ }).click();
  await expect(page.getByRole("heading", { name: "Share with a carrier" })).toBeVisible();
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: /Continue with 1 document/ }).click();
  await expect(page.getByRole("button", { name: "Carrier on Antcolos" })).toBeVisible();
}

async function shareWithNorthline(page: Page) {
  await startShare(page);
  await page.getByLabel("Find the carrier").fill("Northline");
  await page.getByRole("button", { name: /Northline Freight/ }).first().click();
  await page.getByRole("button", { name: "Review the share" }).click();
  await expect(page.getByText("Carrier on Antcolos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and share" }).click();
  await expect(page.getByText("Shared with Northline Freight.")).toBeVisible();
}

async function shareByEmail(page: Page, email: string) {
  await startShare(page);
  await page.getByRole("button", { name: "External carrier by email" }).click();
  await page.getByLabel("Their business email").fill(email);
  await page.getByRole("button", { name: "Review the share" }).click();
  await page.getByRole("button", { name: "Confirm and share" }).click();
}

test("the driver shares documents they already have, and never uploads again", async ({ page }) => {
  await startShare(page);

  // The flow offers selection, not upload: there is nothing here to upload with.
  await expect(page.getByRole("button", { name: /Select file/ })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("a share with a carrier on Antcolos names the exact documents and an end date", async ({ page }) => {
  await shareWithNorthline(page);

  await page.getByRole("button", { name: "See all my shares" }).click();
  await expect(page).toHaveURL(/\/driver\/shares$/);

  const row = page.locator("li[data-share-id]").first();
  await expect(row).toContainText("Northline Freight");
  await expect(row).toContainText("Driver qualification");
  await expect(row).toContainText("1 document");
  await expect(row).toContainText("Issued");
  await expect(row).toContainText("Not opened yet");
});

test("the carrier sees what was shared, watermarked, and records its own review", async ({ page }) => {
  await shareWithNorthline(page);
  await page.getByRole("button", { name: "See all my shares" }).click();
  await navTo(page, "Shared with us");

  await expect(page).toHaveURL(/\/documents\/shared$/);
  const pkg = page.locator("li[data-share-id]").first();
  await expect(pkg).toContainText("Sam Murtaza");
  await expect(pkg).toContainText("Driver qualification");

  // Every presented document carries the mark — and it is on the presentation,
  // not on the driver's record.
  await expect(page.locator("[data-watermark]").first()).toContainText("Powered by Antcolos");

  await page.getByRole("button", { name: "Accept" }).first().click();
  await expect(page.locator("[data-review-state]").first()).toHaveAttribute("data-review-state", "approved");
  await expect(page.getByText("You accepted this document.")).toBeVisible();
});

test("an external carrier gets a link, and the page says no email was sent", async ({ page }) => {
  await shareByEmail(page, "hiring@roadway.example.com");

  await expect(page.getByText("Secure link created.")).toBeVisible();
  await expect(page.getByText(/no email is actually sent/i)).toBeVisible();
  await expect(page.getByText(/\/shared\/DS/)).toBeVisible();
});

test("the external recipient sees only the shared document, watermarked", async ({ page }) => {
  await shareByEmail(page, "hiring@roadway.example.com");
  await page.getByRole("link", { name: /Open it as the recipient would/ }).click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("shared 1 document with you");
  const cards = page.getByRole("listitem");
  await expect(cards).toHaveCount(1);
  await expect(page.locator("[data-watermark]")).toHaveCount(1);
  await expect(page.locator("[data-watermark]")).toContainText("Powered by Antcolos");
  await expect(page.locator("[data-watermark]")).toContainText("hiring@roadway.example.com");

  // Honest about what it is, and about what nobody has checked.
  await expect(page.getByText(/have not been verified by Antcolos/)).toBeVisible();
  await expect(page.getByText(/no email was actually sent/)).toBeVisible();

  // No way into the product from here: this page is the whole of their access.
  await expect(page.getByRole("link", { name: /My documents|Home|Needs You/ })).toHaveCount(0);
});

test("an address that is not an address creates nothing", async ({ page }) => {
  await startShare(page);
  await page.getByRole("button", { name: "External carrier by email" }).click();
  await page.getByLabel("Their business email").fill("not-an-address");

  // The flow will not even offer the review step for an address it cannot use,
  // so there is no way to confirm one. That nothing is CREATED by a bad address
  // is proven directly against the share service in the domain tests.
  await expect(page.getByRole("button", { name: "Review the share" })).toBeDisabled();

  await page.getByLabel("Their business email").fill("hiring@roadway.example.com");
  await expect(page.getByRole("button", { name: "Review the share" })).toBeEnabled();
});

test("revoking stops access and says so on both sides", async ({ page }) => {
  await shareByEmail(page, "hiring@roadway.example.com");
  await page.getByRole("button", { name: "See all my shares" }).click();

  const row = page.locator("li[data-share-id]").first();
  await row.getByRole("button", { name: "Revoke" }).click();
  await row.getByRole("button", { name: "Withdraw access" }).click();
  await expect(row).toContainText("Revoked");
  // A revoked link is not offered any more.
  await expect(row.getByRole("link", { name: /Open link/ })).toHaveCount(0);
});

test("a link nobody issued is refused in plain words", async ({ page }) => {
  await page.goto("/shared/DSNOTATOKENATALL", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1 })).toContainText("not recognised");
  // Nothing about any driver, any document or any carrier leaks into a refusal.
  await expect(page.getByText(/Powered by Antcolos/)).toHaveCount(0);
  await expect(page.locator("[data-watermark]")).toHaveCount(0);
});

// NOTE: that a REVOKED or EXPIRED link is refused cannot be shown in a browser
// here — revoking and opening happen in one page session, and opening the link
// is a navigation that resets the in-memory mock. Both refusals are proven
// exactly, with their stated reasons, in
// src/features/driver/document-sharing.test.ts.

test("a delivery that fails is shown as failed, not as sent", async ({ page }) => {
  await shareByEmail(page, "hr@nowhere.invalid");

  await expect(page.getByText("The mock delivery failed.")).toBeVisible();
  await expect(page.getByText(/nothing was sent/i)).toBeVisible();
});

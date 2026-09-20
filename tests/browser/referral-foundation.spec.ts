import { expect, test, type Page } from "@playwright/test";

/**
 * The referral, end to end, in a browser.
 *
 * The service suite proves the rules. What only a rendered page can show is the
 * part this feature can most easily get wrong: whether a person is told, in
 * words, at every step, that an introduction is not a job — on the form, on the
 * confirmation, in the company's inbox and on the invitation screen the handoff
 * leads to.
 *
 * Everything here is one tab, because the mock stores are module-level: a full
 * page load starts the world again. Navigation is by clicking, which is also
 * the honest way to test a flow.
 *
 * The demo account owns Northline Freight, so one session can play both sides —
 * the person making the introduction, and the company deciding about it. That
 * is a fixture convenience and not a claim about who may refer: the service
 * suite covers a referrer who belongs to nothing.
 */


const CANDIDATE = {
  name: "Alex Rivera",
  email: "alex.rivera@example.com",
  phone: "(312) 555-0166",
  title: "Dispatcher",
};

async function fillTheForm(page: Page) {
  await page.getByRole("button", { name: "Antcolos username" }).click();
  await page.getByLabel("Antcolos username").fill("northline-freight");
  await page.getByRole("button", { name: "Find" }).click();
  // Resolved to ONE company, by hand, before anything else is accepted.
  await expect(page.getByText("Northline Freight LLC")).toBeVisible();

  await page.getByLabel("Full name").fill(CANDIDATE.name);
  await page.getByLabel("Email address").fill(CANDIDATE.email);
  await page.getByLabel("Phone number").fill(CANDIDATE.phone);
  await page.getByLabel("Proposed work").fill(CANDIDATE.title);
  await page.getByLabel("A note (optional)").fill("Worked nights with me for two years.");
}

test("a person refers somebody, and the company decides separately", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop only; the phone case is below.");
  /* -- 1. The referrer's own surface, which needs no permission ----------- */
  await page.goto("/account/referrals", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Your referrals" })).toBeVisible();

  await page.getByRole("link", { name: "Refer someone" }).first().click();
  await expect(page.getByRole("heading", { name: "Refer someone" })).toBeVisible();

  // The free-text title says what it is, beside the field.
  await expect(page.getByText(/never a role or a permission/i)).toBeVisible();

  await fillTheForm(page);

  /* -- 2. The confirmation shows EXACTLY what each side receives ---------- */
  await page.getByRole("button", { name: /Review what will be sent/i }).click();
  await expect(page.getByRole("heading", { name: "Before you send" })).toBeVisible();
  await expect(page.getByText("What Northline Freight will see")).toBeVisible();
  await expect(page.getByText(/What Alex Rivera will be emailed/)).toBeVisible();
  // And what it does NOT do, in the same breath.
  await expect(page.getByText(/does not share their documents/i)).toBeVisible();
  await expect(
    page.getByText(/does not tell the company whether this email address already has/i),
  ).toBeVisible();

  await page.getByRole("button", { name: /Send the introduction/i }).click();
  await expect(page.getByRole("heading", { name: "Introduction sent" })).toBeVisible();

  /* -- 3. The referrer's history: privacy-safe status, masked address ----- */
  await page.getByRole("link", { name: "See your referrals" }).click();
  const row = page.locator("li").filter({ hasText: CANDIDATE.name }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText(/Sent|Company reviewing/)).toBeVisible();
  // The address they typed is masked in the list rather than printed back.
  await expect(row.getByText(CANDIDATE.email, { exact: true })).toHaveCount(0);

  /* -- 4. The company inbox ---------------------------------------------- */
  await page.getByRole("link", { name: "Referrals", exact: true }).first().click();
  await expect(page).toHaveURL(/\/referrals$/);
  await expect(
    page.getByText(/It does not create a membership, a role, permissions/i).first(),
  ).toBeVisible();

  const card = page.locator("li").filter({ hasText: CANDIDATE.name }).first();
  await expect(card).toBeVisible();
  // The minimum privacy-safe level, and nothing more.
  await expect(card.getByText("Has not responded yet")).toBeVisible();

  await card.getByRole("button", { name: new RegExp(CANDIDATE.name) }).click();
  await expect(card.getByText(CANDIDATE.email)).toBeVisible();
  await expect(card.getByText(/has not been verified/i)).toBeVisible();

  /* -- 5. Accepting means interested, and says so ------------------------- */
  await card.getByRole("button", { name: /We are interested/i }).click();
  await expect(card.getByText("Interested is not invited")).toBeVisible();

  /* -- 6. The handoff into the EXISTING invitation flow ------------------- */
  await card.getByRole("link", { name: /Start the invitation/i }).click();
  await expect(page).toHaveURL(/\/settings\/invitations\/new\?referral=/);
  await expect(page.getByText(/From a referral by Sam Murtaza/)).toBeVisible();
  await expect(page.getByText(/it is not a role, it grants nothing/i)).toBeVisible();

  // Prefilled, and every real decision still to be made on this screen.
  await page.getByRole("button", { name: /Employee|Dispatcher|Driver/ }).first().click();
  await expect(page.getByLabel(/name/i).first()).toHaveValue(CANDIDATE.name);
});

/**
 * The claim page, for a link that does not resolve.
 *
 * The happy path is covered at the service layer, where the token can be
 * produced and aged. What a browser adds is the refusal: an unrecognised link
 * must be a SENTENCE and a way out, not a blank page — and the way to report
 * unwanted mail has to survive even when the link itself is dead, because an
 * expired link is exactly when somebody gets round to using it.
 */
test("an unrecognised claim link explains itself and still offers a way to report it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop only.");
  await page.goto("/referral/REF-NOTAREALTOKEN", { waitUntil: "networkidle" });

  await expect(
    page.getByRole("heading", { name: /can.t open this introduction/i }),
  ).toBeVisible();
  await expect(page.getByText(/don.t recognise this link/i)).toBeVisible();

  await page.getByRole("button", { name: /I did not expect this/i }).click();
  await expect(page.getByText(/You do not need an Antcolos account to do this/i))
    .toBeVisible();
});

/**
 * A phone.
 *
 * "Simple and mobile-friendly" is a claim about a rendered page at 412px, and
 * the only honest way to check it is to render one. Sideways scroll is the
 * failure that makes a form unusable on a phone without looking broken on a
 * laptop, so it is the thing measured.
 */
test.describe("on a phone", () => {
  test("the refer form fits without scrolling sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await page.goto("/account/referrals/new", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Refer someone" })).toBeVisible();

    await fillTheForm(page);
    await page.getByRole("button", { name: /Review what will be sent/i }).click();
    await expect(page.getByRole("heading", { name: "Before you send" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the claim page fits too", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await page.goto("/referral/REF-NOTAREALTOKEN", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /can.t open this introduction/i }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

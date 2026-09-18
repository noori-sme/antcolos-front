import { expect, test } from "@playwright/test";

/**
 * The role flows, in the browser, because the claim is about what an owner is
 * SHOWN before and after they change somebody's access.
 *
 * The service-layer suite already proves the rules
 * (`src/lib/api/mock/access-templates.test.ts`). What it cannot prove is that
 * the screen tells an owner an edit changed nobody, that the before/after is on
 * screen before the confirm button, and that a person's row says which version
 * they are on. Those are claims about a rendered page.
 */

const ROLES = "/settings/permissions";

test.describe("roles and permissions", () => {
  test("the catalog explains permissions in plain language, with scope and prerequisites", async ({ page }) => {
    await page.goto(ROLES);
    await page.getByRole("tab", { name: /what each permission allows/i }).click();

    await page.getByLabel("Search permissions").fill("precise");
    const entry = page.getByText("See precise locations", { exact: true });
    await expect(entry).toBeVisible();

    // The scope caveat is on the page, not in a comment in the code.
    await expect(
      page.getByText(/per-truck Dispatch delegation decides which trucks it reaches/i),
    ).toBeVisible();
    // And what it needs alongside it.
    await expect(page.getByText(/Needs.*Open ELD & Telematics/i)).toBeVisible();
  });

  test("a saved role is reusable, and editing it does not change anybody", async ({ page }) => {
    await page.goto(ROLES);

    // 1. Save a role once.
    await page.getByRole("button", { name: "New role" }).click();
    await page.getByLabel("Role name").fill("Limited Dispatcher");
    await page.getByLabel("Description").fill("Moves freight. Never sees a rate.");
    // Searching opens the groups that match, which is how the picker behaves
    // for a real person too — nobody scrolls twenty collapsed sections.
    await page.getByLabel("Search permissions").fill("loads");
    await page.locator("#perm-loads-view").check();
    await page.locator("#perm-loads-export").check();
    await page.getByLabel("Search permissions").fill("");
    await page.getByRole("button", { name: "Create role" }).click();

    const row = page.getByTestId("role-row").filter({ hasText: "Limited Dispatcher" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Version 1")).toBeVisible();

    // 2. Apply it to two different people, seeing the before/after each time.
    for (const nth of [0, 1]) {
      await row.getByRole("button", { name: "Apply to people" }).click();
      const candidate = page.getByTestId("apply-candidate").nth(nth);
      const who = await candidate.innerText();
      await candidate.click();

      // The preview is on screen BEFORE anything can be confirmed.
      await expect(page.getByTestId("apply-preview")).toBeVisible();
      await expect(page.getByText("Afterwards")).toBeVisible();
      await page.getByTestId("confirm-apply").click();
      await expect(page.getByText(/Applied to \d+ (person|people)/)).toBeVisible();
      expect(who).toBeTruthy();
      await page.getByRole("button", { name: "Done" }).click();
    }

    await expect(row.getByText(/2 people/)).toBeVisible();

    // 3. Edit it. The screen must say, in words, that nobody moved.
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByTestId("edit-safety-notice")).toContainText(
      /Saving does not change what any of them can do/i,
    );
    await page.getByLabel("Description").fill("Now edits drivers too.");
    await page.getByLabel("Search permissions").fill("drivers");
    await page.locator("#perm-drivers-view").check();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText(/Nobody's access changed/i)).toBeVisible();

    // 4. Both holders are now visibly behind, and that is stated as intended.
    const updated = page.getByTestId("role-row").filter({ hasText: "Limited Dispatcher" });
    await expect(updated.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(updated.getByTestId("behind-notice")).toContainText(
      /keep the access they were given/i,
    );
  });

  test("a person's row shows the role that produced it without replacing the real answer", async ({ page }) => {
    await page.goto("/settings/users");

    const row = page.getByTestId("person-row").filter({ hasText: "Paige" }).first();
    await expect(row).toBeVisible();

    // Provenance.
    await expect(row.getByTestId("applied-template")).toContainText(/Dispatcher.*version 1/i);
    // And the authoritative statement, which is the seat's own permissions.
    await expect(row.getByTestId("effective-permissions")).toContainText(/Can do \d+ things/);
  });
});

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Settings → People against the REAL API (plan 12): the member roster, your
 * own row without a remove button, and removing a member.
 *
 *   NEXT_PUBLIC_API_MODE=http npm run build && npx next start -p 3000
 *   LIVE_WEB_URL=http://localhost:3000 LIVE_API_URL=http://localhost:4000/api/v1 \
 *     npx playwright test tests/browser/members.live.spec.ts
 *
 * Needs the seeded backend (`prisma db seed`): the carrier admin invites the
 * seeded individual dispatcher through the API, who accepts, and the test then
 * removes them in the UI. Skipped unless LIVE_WEB_URL and LIVE_API_URL are set.
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const ADMIN = "carrier@antcolos.dev";
const MEMBER = "dispatcher@antcolos.dev";

test.skip(!WEB || !API, "needs the full stack (LIVE_WEB_URL and LIVE_API_URL); see the header");

async function token(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return (await res.json()).accessToken as string;
}

/** Make the seeded dispatcher a member of the admin's organization. */
async function addMember(request: APIRequestContext) {
  const admin = await token(request, ADMIN);
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const members = await (await request.get(`${API}/organizations/members`, { headers: auth(admin) })).json();
  if (members.data.some((m: { email: string }) => m.email === MEMBER)) return;

  const member = await token(request, MEMBER);
  let inbox = await (await request.get(`${API}/users/me/invitations`, { headers: auth(member) })).json();
  if (inbox.length === 0) {
    const created = await request.post(`${API}/organizations/invitations`, {
      headers: auth(admin),
      data: { email: MEMBER, firstName: "Jordan", lastName: "Lee", roleId: "DISPATCHER" },
    });
    expect(created.ok()).toBe(true);
    inbox = await (await request.get(`${API}/users/me/invitations`, { headers: auth(member) })).json();
  }
  const accepted = await request.post(`${API}/users/me/invitations/${inbox[0].id}/accept`, {
    headers: auth(member),
  });
  expect(accepted.ok()).toBe(true);
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(ADMIN);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => u.pathname === "/home");
}

test("lists members and removes one", async ({ page, request }) => {
  await addMember(request);
  await signIn(page);
  await page.goto(`${WEB}/settings/users`, { waitUntil: "networkidle" });
  const list = page.getByRole("list", { name: "Members" });

  // Your own row: marked, and no way to remove yourself.
  const self = list.getByRole("listitem").filter({ hasText: ADMIN });
  await expect(self.getByText("(you)")).toBeVisible();
  await expect(self.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

  const row = list.getByRole("listitem").filter({ hasText: MEMBER });
  await expect(row.getByText("Dispatcher", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: /^Remove/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(list.getByRole("listitem").filter({ hasText: MEMBER })).toHaveCount(0);

  // It came from the backend, not just the cache.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("list", { name: "Members" }).getByText(ADMIN)).toBeVisible();
  await expect(page.getByText(MEMBER)).toHaveCount(0);
});

test("has no sideways scroll on a phone", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/settings/users`, { waitUntil: "networkidle" });
  await expect(page.getByRole("list", { name: "Members" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

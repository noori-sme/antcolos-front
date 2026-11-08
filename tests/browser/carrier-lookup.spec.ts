import { expect, test, type Page } from "@playwright/test";

/**
 * The public carrier lookup page (plan 09): reachable signed out, driven by
 * the URL, and honest about every answer FMCSA can give.
 *
 * Runs in mock mode with no backend: `GET /api/v1/carriers/lookup` is stubbed
 * with `page.route`, using the shapes in
 * `../antcolos/docs/requirements/carrier-lookup.md` §8.2.
 */

const GREYHOUND = {
  dotNumber: "44110",
  mcNumber: "MC1515",
  legalName: "GREYHOUND LINES INC",
  dbaName: "BOLT BUS",
  phone: "2147776005",
  email: null,
  active: true,
  address: { street: "350 N SAINT PAUL ST", city: "DALLAS", state: "TX", zip: "75201", country: "US" },
  mailingAddress: { street: null, city: null, state: null, zip: null },
  sources: { identity: "qcmobile", email: "company-census", mailingAddress: "company-census" },
};

/** Stub only the API call; the page itself lives at the same path tail. */
async function stubLookup(page: Page, status: number, body: unknown) {
  const queries: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/carriers/lookup"),
    async (route) => {
      queries.push(new URL(route.request().url()).search);
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  return queries;
}

test("anyone can look up a carrier by MC number, signed out", async ({ page }) => {
  const queries = await stubLookup(page, 200, GREYHOUND);
  await page.goto("/carriers/lookup");
  await expect(page.getByRole("heading", { name: "Look up a carrier" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/carriers/lookup");

  await page.getByLabel("MC number").fill("mc1515");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("heading", { name: "GREYHOUND LINES INC" })).toBeVisible();
  await expect(page.getByText("Doing business as BOLT BUS")).toBeVisible();
  await expect(page.getByText("Authorized to operate")).toBeVisible();
  await expect(page.getByText("(214) 777-6005")).toBeVisible();
  await expect(page.getByText("350 N SAINT PAUL ST, DALLAS, TX 75201")).toBeVisible();
  // Email is null in the census: shown as not on file, never invented.
  await expect(page.getByText("Not on file").first()).toBeVisible();
  expect(new URL(page.url()).search).toBe("?mc=1515");
  expect(queries).toEqual(["?mc=1515"]);
});

test("a DOT link opens straight to the result", async ({ page }) => {
  const queries = await stubLookup(page, 200, GREYHOUND);
  await page.goto("/carriers/lookup?dot=44110");
  await expect(page.getByRole("heading", { name: "GREYHOUND LINES INC" })).toBeVisible();
  expect(queries).toEqual(["?dot=44110"]);
});

test("a partial profile says the census details are unavailable", async ({ page }) => {
  await stubLookup(page, 200, { ...GREYHOUND, sources: { ...GREYHOUND.sources, census: "unavailable" } });
  await page.goto("/carriers/lookup?dot=44110");
  await expect(page.getByText(/temporarily unavailable from FMCSA/)).toBeVisible();
  // The row is left out (the notice above mentions it in lowercase prose).
  await expect(page.getByText("Mailing address", { exact: true })).toHaveCount(0);
});

test.describe("answers FMCSA can give", () => {
  for (const [status, title] of [
    [404, "No carrier found"],
    [429, "Too many lookups"],
    [502, "FMCSA isn't answering"],
  ] as const) {
    test(`${status} → ${title}`, async ({ page }) => {
      await stubLookup(page, status, { statusCode: status });
      await page.goto("/carriers/lookup?mc=999");
      await expect(page.getByRole("alert").filter({ hasText: title })).toBeVisible();
    });
  }
});

test("an invalid number is caught before any request", async ({ page }) => {
  const queries = await stubLookup(page, 200, GREYHOUND);
  await page.goto("/carriers/lookup");
  await page.getByLabel("MC number").fill("MC-1515");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "up to 8 digits" })).toBeVisible();
  expect(queries).toEqual([]);
});

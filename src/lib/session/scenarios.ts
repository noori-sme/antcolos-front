/**
 * Which set of fixtures this browser session is running on.
 *
 * The demo account is deliberately busy: one person with seven memberships, a
 * driver profile and years of paperwork, which is what makes the product
 * reviewable. It is also the one thing that cannot demonstrate the case a
 * driver actually arrives in — nobody, from nowhere, belonging to nothing.
 *
 * `?fixture=newcomer` runs the app as a signed-in person with no membership, no
 * organization, no carrier relationship and no driver profile. It is a FIXTURE
 * SWITCH, not authentication and not a permission: it chooses which mock data
 * the app boots with, and it will disappear with the mocks when a real backend
 * arrives. It is remembered for the tab so that moving around the app keeps
 * answering as the same person.
 */

export type SessionScenario = "demo" | "newcomer";

const STORAGE_KEY = "antcolos.session-fixture";
const PARAM = "fixture";

function isScenario(value: string | null): value is SessionScenario {
  return value === "demo" || value === "newcomer";
}

/** Safe on the server, in a private window, and with storage blocked. */
export function readSessionScenario(): SessionScenario {
  if (typeof window === "undefined") return "demo";

  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get(PARAM);
  } catch {
    fromUrl = null;
  }

  if (isScenario(fromUrl)) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // A tab that cannot remember still runs the scenario it was asked for.
    }
    return fromUrl;
  }

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (isScenario(stored)) return stored;
  } catch {
    // Fall through to the demo fixtures.
  }
  return "demo";
}

export function isNewcomerSession(): boolean {
  return readSessionScenario() === "newcomer";
}

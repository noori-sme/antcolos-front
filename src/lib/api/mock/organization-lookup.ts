import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import type {
  OrganizationLookupKind, OrganizationResolution, OrganizationSearchResult,
} from "@/types";

/**
 * Finding a carrier that is already on Antcolos.
 *
 * This is a READ over the one organization registry — the same
 * `MOCK_ORGANIZATIONS` every other module resolves organizations from. It is
 * not a second directory, and it deliberately cannot become one: it returns
 * public identity only (the name a carrier trades under and its public
 * registration numbers), never members, never documents, never contact details,
 * and never an organization that is not a carrier.
 *
 * It answers a NARROW question on purpose. A driver looking for the carrier
 * that just interviewed them knows the company's name or its DOT number; they
 * do not need to browse every organization on the platform, and a search that
 * let them would be a directory of somebody else's business relationships. So
 * a query shorter than three characters returns nothing, and matching is by
 * whole name, name prefix, or exact DOT/MC digits.
 */

export interface CarrierLookupResult {
  organizationId: string;
  displayName: string;
  legalName: string;
  dotNumber?: string;
  mcNumber?: string;
}

const MIN_QUERY = 3;
const MAX_RESULTS = 8;

const digits = (value: string) => value.replace(/\D/g, "");

export function lookUpCarriers(rawQuery: string): CarrierLookupResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < MIN_QUERY) return [];
  const queryDigits = digits(query);

  return MOCK_ORGANIZATIONS.filter((org) => org.type === "CARRIER")
    .filter((org) => {
      const name = org.displayName.toLowerCase();
      const legal = org.legalName.toLowerCase();
      if (name.startsWith(query) || legal.startsWith(query)) return true;
      if (name.includes(query) || legal.includes(query)) return true;
      if (queryDigits.length >= 5) {
        if (digits(org.dotNumber ?? "") === queryDigits) return true;
        if (digits(org.mcNumber ?? "") === queryDigits) return true;
      }
      return false;
    })
    .slice(0, MAX_RESULTS)
    .map((org) => ({
      organizationId: org.id,
      displayName: org.displayName,
      legalName: org.legalName,
      dotNumber: org.dotNumber,
      mcNumber: org.mcNumber,
    }));
}

/* -------------------------------------------------------------------------- */
/* Resolving ONE organization, from whatever the person typed                  */
/* -------------------------------------------------------------------------- */

/**
 * The same READ, widened to every organization type and narrowed to one answer.
 *
 * `lookUpCarriers` above answers "which carrier did I just interview with" for
 * a driver, and is carrier-only because that is the only question it has. A
 * referral can be made to any company on Antcolos, and it needs the stricter
 * shape: exactly one organization, or an honest refusal.
 *
 * ★ IT NEVER GUESSES ★
 * Several matches come back as `ambiguous` with the candidates, and the person
 * picks. Nothing comes back as `unresolved`. A referral built on a guess
 * introduces somebody to a company that never heard of either of them, and the
 * candidate's email — which has already gone out — names that company.
 *
 * It returns PUBLIC IDENTITY ONLY. No members, no contacts, no documents, no
 * relationships: the same rule the carrier lookup keeps, for the same reason.
 */

const toResult = (org: (typeof MOCK_ORGANIZATIONS)[number]): OrganizationSearchResult => ({
  organizationId: org.id,
  displayName: org.displayName,
  legalName: org.legalName,
  username: org.username,
  dotNumber: org.dotNumber,
  mcNumber: org.mcNumber,
});

/** Handles are compared case-insensitively and without a leading `@`. */
const normalizeHandle = (value: string) =>
  value.trim().toLowerCase().replace(/^@/, "");

export function searchOrganizations(rawQuery: string): OrganizationSearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < MIN_QUERY) return [];
  return MOCK_ORGANIZATIONS.filter((org) =>
    org.displayName.toLowerCase().includes(query)
    || org.legalName.toLowerCase().includes(query)
    || (org.username ?? "").includes(normalizeHandle(query)))
    .slice(0, MAX_RESULTS)
    .map(toResult);
}

export function resolveOrganizationReference(
  kind: OrganizationLookupKind,
  submittedValue: string,
): OrganizationResolution {
  const value = submittedValue.trim();
  if (!value) return { status: "unresolved" };

  if (kind === "username") {
    const handle = normalizeHandle(value);
    // EXACT, always. A handle is an identifier: a prefix match on one would let
    // `north` reach `northline-freight`, and a typo would reach somebody else's
    // company rather than failing.
    const matches = MOCK_ORGANIZATIONS.filter((o) => o.username === handle);
    if (matches.length === 1) return resolved(matches[0]);
    return matches.length === 0
      ? { status: "unresolved" }
      // Two organizations with one handle is a broken invariant rather than an
      // ordinary ambiguity, and it is still not somewhere to guess.
      : { status: "ambiguous", candidates: matches.map(toResult) };
  }

  if (kind === "mc_number") {
    const wanted = digits(value);
    // Below six digits an MC number is a prefix, not a number, and matching on
    // one would resolve a partial entry to whichever company happens to sort
    // first. Too short is UNRESOLVED, never a best guess.
    if (wanted.length < 5) return { status: "unresolved" };
    const matches = MOCK_ORGANIZATIONS.filter((o) => digits(o.mcNumber ?? "") === wanted);
    if (matches.length === 1) return resolved(matches[0]);
    return matches.length === 0
      ? { status: "unresolved" }
      : { status: "ambiguous", candidates: matches.map(toResult) };
  }

  // A name search. The caller has normally already picked a result, in which
  // case `value` is an organization id and this is a confirmation rather than a
  // search — which is the only way a name ever becomes an identity.
  const byId = MOCK_ORGANIZATIONS.find((o) => o.id === value);
  if (byId) return resolved(byId);

  const results = searchOrganizations(value);
  if (results.length === 1) {
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === results[0].organizationId)!;
    return resolved(org);
  }
  return results.length === 0
    ? { status: "unresolved" }
    : { status: "ambiguous", candidates: results };
}

function resolved(org: (typeof MOCK_ORGANIZATIONS)[number]): OrganizationResolution {
  return {
    status: "resolved",
    organizationId: org.id,
    displayName: org.displayName,
    legalName: org.legalName,
    username: org.username,
    mcNumber: org.mcNumber,
  };
}

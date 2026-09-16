import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";

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

import type { Jurisdiction } from "@/types";

/**
 * IFTA member jurisdictions.
 *
 * Membership is what decides whether a purchase can be claimed, so it is
 * recorded as data rather than assumed from the address. Alaska, Hawaii and
 * the District of Columbia are US, and are NOT IFTA members — a truck can
 * legitimately buy fuel in one, and those gallons do not go on the return.
 */
interface JurisdictionMeta {
  code: Jurisdiction;
  name: string;
  country: "US" | "CA";
  member: boolean;
}

const US: [string, string, boolean][] = [
  ["AL", "Alabama", true], ["AK", "Alaska", false], ["AZ", "Arizona", true],
  ["AR", "Arkansas", true], ["CA", "California", true], ["CO", "Colorado", true],
  ["CT", "Connecticut", true], ["DE", "Delaware", true], ["DC", "District of Columbia", false],
  ["FL", "Florida", true], ["GA", "Georgia", true], ["HI", "Hawaii", false],
  ["ID", "Idaho", true], ["IL", "Illinois", true], ["IN", "Indiana", true],
  ["IA", "Iowa", true], ["KS", "Kansas", true], ["KY", "Kentucky", true],
  ["LA", "Louisiana", true], ["ME", "Maine", true], ["MD", "Maryland", true],
  ["MA", "Massachusetts", true], ["MI", "Michigan", true], ["MN", "Minnesota", true],
  ["MS", "Mississippi", true], ["MO", "Missouri", true], ["MT", "Montana", true],
  ["NE", "Nebraska", true], ["NV", "Nevada", true], ["NH", "New Hampshire", true],
  ["NJ", "New Jersey", true], ["NM", "New Mexico", true], ["NY", "New York", true],
  ["NC", "North Carolina", true], ["ND", "North Dakota", true], ["OH", "Ohio", true],
  ["OK", "Oklahoma", true], ["OR", "Oregon", true], ["PA", "Pennsylvania", true],
  ["RI", "Rhode Island", true], ["SC", "South Carolina", true], ["SD", "South Dakota", true],
  ["TN", "Tennessee", true], ["TX", "Texas", true], ["UT", "Utah", true],
  ["VT", "Vermont", true], ["VA", "Virginia", true], ["WA", "Washington", true],
  ["WV", "West Virginia", true], ["WI", "Wisconsin", true], ["WY", "Wyoming", true],
];

const CA: [string, string, boolean][] = [
  ["AB", "Alberta", true], ["BC", "British Columbia", true], ["MB", "Manitoba", true],
  ["NB", "New Brunswick", true], ["NL", "Newfoundland and Labrador", true],
  ["NS", "Nova Scotia", true], ["ON", "Ontario", true], ["PE", "Prince Edward Island", true],
  ["QC", "Quebec", true], ["SK", "Saskatchewan", true],
  ["NT", "Northwest Territories", false], ["NU", "Nunavut", false], ["YT", "Yukon", false],
];

export const JURISDICTIONS: readonly JurisdictionMeta[] = [
  ...US.map(([code, name, member]) => ({ code, name, country: "US" as const, member })),
  ...CA.map(([code, name, member]) => ({ code, name, country: "CA" as const, member })),
];

const BY_CODE = new Map(JURISDICTIONS.map((j) => [j.code, j]));

export function jurisdictionMeta(code: Jurisdiction): JurisdictionMeta | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function jurisdictionName(code: Jurisdiction): string {
  return BY_CODE.get(code.toUpperCase())?.name ?? code;
}

/** Whether the jurisdiction is in the agreement at all. */
export function isIftaMember(code: Jurisdiction): boolean {
  return BY_CODE.get(code.toUpperCase())?.member ?? false;
}

export function isKnownJurisdiction(code: Jurisdiction): boolean {
  return BY_CODE.has(code.toUpperCase());
}

/** Member jurisdictions, alphabetically by name, for pickers. */
export const MEMBER_JURISDICTIONS: readonly JurisdictionMeta[] = JURISDICTIONS
  .filter((j) => j.member)
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * One carrier from FMCSA, as `GET /api/v1/carriers/lookup` returns it
 * (`../antcolos/docs/requirements/carrier-lookup.md` §8.2). The public lookup
 * page shows all of it. Onboarding keeps its smaller `CarrierProfile`.
 */
export interface CarrierLookupAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface CarrierLookupResult {
  dotNumber: string;
  mcNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  /** Digits only. */
  phone: string | null;
  email: string | null;
  /** Allowed to operate and not out of service. */
  active: boolean;
  address: CarrierLookupAddress & { country: string | null };
  mailingAddress: CarrierLookupAddress;
  /** The day-old census call failed: email and mailing address are unknown, not empty. */
  censusUnavailable: boolean;
}

/** What the person typed: exactly one of MC or DOT. */
export type CarrierIdentifier = { kind: "mc"; value: string } | { kind: "dot"; value: string };

export type CarrierLookupErrorKind =
  | "invalid_identifier"
  | "not_found"
  | "rate_limited"
  | "not_configured"
  | "unavailable";

import type {
  CarrierIdentifier, CarrierLookupErrorKind, CarrierLookupResult,
} from "@/types/carrier-lookup";

/**
 * Pure rules for the public carrier lookup (plan 09), mirroring
 * `../antcolos/docs/requirements/carrier-lookup.md` §8.1 so the page never
 * sends what the server would refuse with `400 invalid_identifier`.
 */

const MC_PATTERN = /^(?:mc)?(\d{1,8})$/i;
const DOT_PATTERN = /^\d{1,8}$/;

/** A valid identifier, or null. MC accepts an optional `MC` prefix in any case. */
export function parseCarrierIdentifier(kind: "mc" | "dot", raw: string): CarrierIdentifier | null {
  const value = raw.trim();
  if (kind === "mc") {
    const match = MC_PATTERN.exec(value);
    return match ? { kind: "mc", value: match[1] } : null;
  }
  return DOT_PATTERN.test(value) ? { kind: "dot", value } : null;
}

/** What went wrong, from the HTTP status (and the error code where it matters). */
export function carrierLookupErrorKind(status: number | undefined): CarrierLookupErrorKind {
  if (status === 400) return "invalid_identifier";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 500) return "not_configured";
  return "unavailable";
}

export class CarrierLookupError extends Error {
  constructor(readonly kind: CarrierLookupErrorKind) {
    super(`Carrier lookup failed: ${kind}`);
    this.name = "CarrierLookupError";
  }
}

type AddressDto = {
  street?: string | null; city?: string | null; state?: string | null; zip?: string | null;
  country?: string | null;
};

export interface CarrierLookupDto {
  dotNumber: string;
  mcNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  address: AddressDto;
  mailingAddress: AddressDto;
  sources?: { census?: string };
}

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export function toCarrierLookupResult(dto: CarrierLookupDto): CarrierLookupResult {
  return {
    dotNumber: dto.dotNumber,
    mcNumber: blankToNull(dto.mcNumber),
    legalName: blankToNull(dto.legalName),
    dbaName: blankToNull(dto.dbaName),
    phone: blankToNull(dto.phone),
    email: blankToNull(dto.email),
    active: dto.active === true,
    address: {
      street: blankToNull(dto.address?.street),
      city: blankToNull(dto.address?.city),
      state: blankToNull(dto.address?.state),
      zip: blankToNull(dto.address?.zip),
      country: blankToNull(dto.address?.country),
    },
    mailingAddress: {
      street: blankToNull(dto.mailingAddress?.street),
      city: blankToNull(dto.mailingAddress?.city),
      state: blankToNull(dto.mailingAddress?.state),
      zip: blankToNull(dto.mailingAddress?.zip),
    },
    censusUnavailable: dto.sources?.census === "unavailable",
  };
}

/** `(214) 777-6005` for 10 US digits; anything else as returned. */
export function formatPhone(digits: string | null): string | null {
  if (!digits) return null;
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : digits;
}

/** One line for an address, or null when FMCSA has nothing on file. */
export function formatAddress(a: { street: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const line = [a.street, cityLine].filter(Boolean).join(", ");
  return line || null;
}

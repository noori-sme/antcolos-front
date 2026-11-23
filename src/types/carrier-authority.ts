/** The carrier's stored FMCSA authority (backend plan 41, carrier-authority-api-contract.md). */
export const CARRIER_AUTHORITY_STATUSES = ["AUTHORIZED", "NOT_AUTHORIZED", "OUT_OF_SERVICE"] as const;
export type CarrierAuthorityStatus = (typeof CARRIER_AUTHORITY_STATUSES)[number];

export interface CarrierAuthorityEntry {
  docketNumber: string;
  type: string;
  status: string;
}

export interface CarrierAuthorityRecord {
  id: string;
  dotNumber: string;
  mcNumber: string | null;
  /** An unknown status keeps its raw value. */
  status: CarrierAuthorityStatus | string;
  allowedToOperate: boolean;
  outOfService: boolean;
  authorities: CarrierAuthorityEntry[];
  authoritySince: string | null;
  authorityAgeDays: number | null;
  checkedAt: string;
}

/** Another carrier, from the directory search (membership-api-contract §6). */
export interface DirectoryCarrier {
  organizationId: string;
  name: string;
  handle: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
}

/** One organization the signed-in person belongs to. */
export interface MyOrganization {
  organizationId: string;
  name: string;
  type: "CARRIER" | "DISPATCHING_COMPANY" | string;
  roleId: string;
  joinedAt: string;
}

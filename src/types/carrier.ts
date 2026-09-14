import type { IsoDateTime } from "./common";
import type { DocumentLifecycleStatus } from "./asset";

/**
 * The carrier as a dispatcher needs to know it.
 *
 * Not the Organization record — that is Antcolos's account for the business,
 * and it holds an id, a name and a time zone because that is all the app shell
 * needs. This is the operating reality behind it: the authority it runs under,
 * the people who answer the phone, the rules it will not break, and the
 * paperwork that proves any of it.
 *
 * It is a PERMANENT record about the carrier, kept once. Which parts of it a
 * given workspace may read is decided by the relationship it holds, never by
 * copying a trimmed version of the record into each viewer's data.
 */
export interface CarrierProfile {
  /** The carrier's organization id. One profile per carrier, always. */
  organizationId: string;
  legalName: string;
  displayName: string;
  /** Motor Carrier number, as issued. Absent when the carrier has none. */
  mcNumber?: string;
  /** USDOT number. A carrier can hold a DOT number with no MC authority. */
  dotNumber?: string;
  authority: OperatingAuthority;
  contacts: CarrierContact[];
  /**
   * What this carrier will and will not accept.
   *
   * Kept as data rather than code so a carrier can add a rule without a
   * release, and so milestone 4 can evaluate them one at a time and say WHICH
   * rule an opportunity failed rather than just refusing it.
   */
  rules: CarrierRule[];
  documents: CarrierDocument[];
  /** Free text the carrier wants every dispatcher working for it to read. */
  dispatchNotes?: string;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Operating authority                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whether the carrier may legally haul right now.
 *
 * The single most consequential fact on this record: a carrier without active
 * authority cannot take a load, so every later milestone — matching, booking,
 * dispatching — has to be able to ask this question and get a straight answer.
 * "Not recorded" is deliberately its own state rather than a hopeful default:
 * not knowing is different from knowing it is fine.
 */
export interface OperatingAuthority {
  status: OperatingAuthorityStatus;
  /** Common, contract or broker authority. Absent when nothing is recorded. */
  kind?: "common" | "contract" | "broker";
  grantedAt?: IsoDateTime;
  /** When somebody last confirmed this against the source. */
  verifiedAt?: IsoDateTime;
  /** Why it is not active, when it is not. */
  note?: string;
}

export type OperatingAuthorityStatus =
  | "active"
  | "pending"
  | "inactive"
  | "revoked"
  /** Nobody has recorded it. Not a claim that it is fine. */
  | "not_recorded";

export const AUTHORITY_STATUS_LABEL: Record<OperatingAuthorityStatus, string> = {
  active: "Active",
  pending: "Pending",
  inactive: "Not active",
  revoked: "Revoked",
  not_recorded: "Not recorded",
};

/** True only for the one status that means freight can legally move. */
export const authorityAllowsDispatch = (a: OperatingAuthority) => a.status === "active";

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

export type CarrierContactRole =
  | "dispatch"
  | "owner"
  | "safety"
  | "accounting"
  | "after_hours";

export const CONTACT_ROLE_LABEL: Record<CarrierContactRole, string> = {
  dispatch: "Dispatch",
  owner: "Owner",
  safety: "Safety",
  accounting: "Accounting",
  after_hours: "After hours",
};

export interface CarrierContact {
  id: string;
  name: string;
  role: CarrierContactRole;
  phone?: string;
  email?: string;
  /** The one to call first. At most one per carrier. */
  isPrimary: boolean;
  /** When they actually answer, in the carrier's own words. */
  hours?: string;
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One thing a carrier requires or refuses.
 *
 * Every rule carries both a machine-readable `kind` plus value AND a sentence
 * a person can read. Milestone 4 will evaluate the first; a dispatcher reading
 * the carrier's page today needs the second, and neither is derivable from the
 * other well enough to drop one.
 */
export interface CarrierRule {
  id: string;
  kind: CarrierRuleKind;
  /** Short label for a chip or a list row. */
  label: string;
  /** The rule in a sentence, as the carrier would say it. */
  detail: string;
  /** A number for rate, mileage and weight rules. Cents where it is money. */
  numberValue?: number;
  /** State codes, equipment types or broker names, depending on the kind. */
  listValue?: string[];
  /** True for rules that stop a load outright rather than warn about it. */
  blocking: boolean;
}

export type CarrierRuleKind =
  /** Lowest rate per mile the carrier will run, in cents. */
  | "minimum_rate_per_mile"
  /** Furthest the carrier will run empty to a pickup. */
  | "max_deadhead_miles"
  /** Heaviest load the carrier will take. */
  | "max_weight_lbs"
  /** The driver must accept before the load is dispatched. */
  | "driver_consent_required"
  /** No hazardous materials, whatever the truck is rated for. */
  | "no_hazmat"
  /** States the carrier will not enter. */
  | "refused_states"
  /** Brokers the carrier will not work with, whatever the rate. */
  | "refused_brokers"
  /** The broker must clear a credit bar before the load is booked. */
  | "broker_credit_minimum"
  /** Anything the carrier wrote down that does not fit the list above. */
  | "other";

export const RULE_KIND_LABEL: Record<CarrierRuleKind, string> = {
  minimum_rate_per_mile: "Minimum rate",
  max_deadhead_miles: "Maximum deadhead",
  max_weight_lbs: "Maximum weight",
  driver_consent_required: "Driver must accept",
  no_hazmat: "No hazmat",
  refused_states: "States refused",
  refused_brokers: "Brokers refused",
  broker_credit_minimum: "Broker credit",
  other: "Carrier rule",
};

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export type CarrierDocumentKind =
  | "operating_authority"
  | "certificate_of_insurance"
  | "w9"
  | "carrier_packet"
  | "safety_rating"
  | "other";

export const CARRIER_DOCUMENT_LABEL: Record<CarrierDocumentKind, string> = {
  operating_authority: "Operating authority letter",
  certificate_of_insurance: "Certificate of insurance",
  w9: "W-9",
  carrier_packet: "Carrier packet",
  safety_rating: "Safety rating",
  other: "Document",
};

/**
 * The carrier's own paperwork.
 *
 * Shares its lifecycle vocabulary with truck, trailer and driver documents, so
 * "expiring soon" means the same thing everywhere and one rule can watch all of
 * them. Nothing is uploaded and nothing is verified — see the mock registry.
 */
export interface CarrierDocument {
  id: string;
  organizationId: string;
  kind: CarrierDocumentKind;
  status: DocumentLifecycleStatus;
  fileName?: string;
  expiresAt?: IsoDateTime;
  rejectionReason?: string;
  updatedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* The projection a dispatcher sees                                            */
/* -------------------------------------------------------------------------- */

/**
 * What ONE workspace may see of one carrier, right now.
 *
 * A projection, like FleetTruck: derived from the relationship the viewer
 * holds, never stored, and never the record itself. A dispatch workspace the
 * carrier granted access to sees the operating detail it needs to dispatch;
 * anybody else sees nothing at all, because there is no such thing as a
 * partially-public carrier record here.
 */
export interface CarrierView {
  organizationId: string;
  legalName: string;
  displayName: string;
  mcNumber?: string;
  dotNumber?: string;
  authority: OperatingAuthority;
  contacts: CarrierContact[];
  rules: CarrierRule[];
  documents: CarrierDocument[];
  dispatchNotes?: string;
  /** Why this viewer may see the carrier at all. */
  reason: CarrierAccessReason;
  /** Trucks of this carrier the viewer may dispatch. */
  truckCount: number;
  /** True when the carrier may legally haul right now. */
  canHaul: boolean;
}

export type CarrierAccessReason =
  /** The viewer IS the carrier. */
  | "own_organization"
  /** The carrier granted this workspace dispatch access to at least one truck. */
  | "dispatch_access";

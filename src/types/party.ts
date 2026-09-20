import type { Address, IsoDateTime, TimeZone } from "./common";
import type { ActorRef } from "./user";

/**
 * The permanent Broker, Shipper and Receiver.
 *
 * A rate confirmation names companies, places and people. Antcolos stores those
 * as three different kinds of record, because they change independently:
 *
 *   Party     The company. "TQL", "Blue Ridge Foods". Permanent, UUID-keyed,
 *             matched on identifiers the real world issues — an MC number for a
 *             broker, a name and address for a shipper.
 *   Facility  A place that company ships from or receives at. One company can
 *             have twenty docks in nine states, and a load is picked up at one
 *             of them, not at "the company".
 *   Contact   A person. A broker's agent, a shipping clerk at one dock. People
 *             move between companies and between facilities, so a contact is
 *             never a field on the company.
 *
 * Flattening any of these into the others is what produces a directory with
 * four hundred rows called "TQL" — one per load. See `PartyLoadLink` for how a
 * load points at all three without any of them owning the load.
 */

/**
 * What a company is doing on a given load — not what it "is". The same company
 * is a shipper on Monday and a receiver on Thursday, so roles accumulate on one
 * record rather than producing a second one.
 */
export type PartyRole = "broker" | "shipper" | "receiver";

/**
 * How much of the record a human has actually stood behind.
 *
 *   active        A person confirmed this company is this company.
 *   provisional   Created from an uncertain match. It works — you can book
 *                 against it — but it is flagged for review and never silently
 *                 merged into anything.
 *   merged        Superseded by another party. Kept forever so historical
 *                 links and snapshots still resolve; `mergedIntoPartyId` says
 *                 where to look now.
 *   archived      Deliberately retired. Not deleted: loads still reference it.
 */
export type PartyRecordStatus = "active" | "provisional" | "merged" | "archived";

/**
 * Where a fact came from, and how far it can be trusted.
 *
 * A rate confirmation is a document a broker sent us. It is evidence of what
 * the broker *said*, and nothing more: it is never external verification, no
 * matter how confident the extraction was. Only a check against an authority
 * that issued the identifier — FMCSA for an MC number — may ever produce
 * "externally_verified", and nothing in this module can write that value.
 */
export type PartyVerificationState =
  /** Nobody has checked it against anything. */
  | "unverified"
  /** A person in this organization typed or confirmed it by hand. */
  | "dispatcher_confirmed"
  /** Checked against the authority that issues the identifier. */
  | "externally_verified";

export type PartyProvenanceKind =
  /** A rate confirmation a person reviewed and confirmed. */
  | "rate_confirmation"
  /**
   * A rate confirmation nobody reviewed.
   *
   * Its own kind rather than a flag on the one above, because the difference is
   * not a detail of how a record was written — it is whether a human ever
   * looked at it. Every badge, every filter and every "who said so" question
   * turns on exactly this, and a boolean buried in a provenance object is a
   * thing screens forget to read.
   *
   * ONLY the broker auto-indexer writes this. See `src/lib/directory/auto-broker.ts`.
   */
  | "rate_confirmation_auto"
  | "manual_entry"
  | "import"
  | "carrier_packet"
  | "system";

/**
 * The trail back to whatever asserted a record. A rate-confirmation-sourced
 * party always keeps the document id, so a dispatcher looking at a profile can
 * open the paperwork the information came off.
 */
export interface PartyProvenance {
  kind: PartyProvenanceKind;
  /** The rate confirmation (or other document) this came off. */
  documentId?: string;
  /** The load being processed when this record was written, for context. */
  loadId?: string;
  recordedAt: IsoDateTime;
  recordedBy: ActorRef;
  /** The organization that supplied the information. */
  recordedByOrganizationId: string;
}

export interface PartyVerification {
  state: PartyVerificationState;
  /** Which authority confirmed it. Only ever set for externally_verified. */
  authority?: "FMCSA" | "SAFER" | "manual_document_review";
  checkedAt?: IsoDateTime;
  /** Why a dispatcher stood behind it, when they did. */
  confirmedBy?: ActorRef;
}

/* -------------------------------------------------------------------------- */
/* Claiming — a different question from verification                           */
/* -------------------------------------------------------------------------- */

/**
 * ★ VERIFICATION AND CLAIMING ARE NOT THE SAME QUESTION ★
 *
 * `PartyVerification` asks: has anybody checked that this DATA is right?
 * `PartyClaim` asks: does the company this record describes have an account on
 * Antcolos, and has it proved this record is theirs?
 *
 * They are independent, and every combination is real. A broker profile built
 * from an FMCSA lookup is `externally_verified` and still `unclaimed` — the
 * data is right and nobody from that brokerage has ever logged in. A brokerage
 * that claimed its record the day it signed up is `claimed` with an address
 * nobody has checked.
 *
 * Collapsing them into one "verified" flag is what produces a badge that
 * means two things at once and therefore nothing.
 */
export type PartyClaimState =
  /**
   * Nobody from this company has an Antcolos account tied to this record.
   *
   * The state every auto-indexed broker is born in, and the honest one: the
   * platform has indexed their operational activity from paperwork other
   * people sent it. They have not agreed to anything, supplied anything, or
   * been told the record exists.
   */
  | "unclaimed"
  /** Somebody asserted ownership. Not proved yet, and it grants nothing. */
  | "claim_pending"
  /** Proved. An Antcolos organization stands behind this record as its own. */
  | "claimed";

/**
 * How ownership was proved.
 *
 * Never "they said so". Each of these is a check against something the
 * claimant could not have arranged on their own.
 */
export type PartyClaimMethod =
  /** A code sent to the address FMCSA holds for that MC number. */
  | "fmcsa_email"
  /** A code sent at the company's own mail domain. */
  | "domain_email"
  /** A person at Antcolos read documents and decided. */
  | "manual_review";

export interface PartyClaim {
  state: PartyClaimState;
  /**
   * The Antcolos organization that proved this record is theirs.
   *
   * ★ IT CONFERS NO ACCESS OVER OTHER CARRIERS' DATA ★
   * Claiming a broker record does not let that brokerage read any carrier's
   * loads, rates, notes or standing. Everything carrier-private lives on
   * `CarrierPartyRelationship`, partitioned by carrier, and nothing in the
   * read path takes a parameter that would let a claimant reach it.
   */
  claimedByOrganizationId?: string;
  claimedAt?: IsoDateTime;
  method?: PartyClaimMethod;
  /** Set while a claim is pending, so a person can see who is asking. */
  claimRequestedByOrganizationId?: string;
  claimRequestedAt?: IsoDateTime;
}

/** What a record with nobody behind it starts as. */
export const UNCLAIMED: PartyClaim = { state: "unclaimed" };

/**
 * Identifiers the outside world issues. These are what matching runs on, so
 * each one is stored exactly as normalization produced it — never as it was
 * printed on the document, which varies ("MC-1142908", "mc 1142908", "1142908").
 * The printed form is kept in `asPrinted` for display next to the paperwork.
 */
export interface PartyIdentifiers {
  /** Digits only, no "MC" prefix. THE broker identifier. */
  mcNumber?: string;
  /** Digits only, no "USDOT" prefix. */
  dotNumber?: string;
  /** Four-letter SCAC, uppercased. */
  scac?: string;
  /** Federal tax id, digits only. Never rendered in full in the UI. */
  ein?: string;
  /** Exactly what the document printed, for each of the above. */
  asPrinted?: { mcNumber?: string; dotNumber?: string; scac?: string };
}

export interface Party {
  /** Immutable UUID. Never an MC number, a name, a row id or an org code. */
  partyId: string;
  /**
   * Every role this company has ever played for the carrier reading it. A
   * company that both ships and receives is ONE party with two roles, not two
   * parties — which is the whole reason this is a set and not a field.
   */
  roles: PartyRole[];
  legalName: string;
  /** The name on the rate confirmation, when it differs from the legal name. */
  dbaName?: string;
  identifiers: PartyIdentifiers;
  /** Corporate or billing address. Where freight moves is a Facility. */
  primaryAddress?: Address;
  phone?: string;
  email?: string;
  website?: string;
  status: PartyRecordStatus;
  /** Set only when status is "merged". Points at the surviving party. */
  mergedIntoPartyId?: string;
  /** Why this record still needs a human, when it is provisional. */
  reviewReason?: string;
  verification: PartyVerification;
  /**
   * Whether the company behind this record has an account here and has proved
   * the record is theirs. Independent of `verification` — see `PartyClaim`.
   */
  claim: PartyClaim;
  provenance: PartyProvenance;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /**
   * Audit provenance only. It confers no access: which carriers can see this
   * party is derived from their relationships with it, never from who typed it.
   */
  createdByOrganizationId: string;
}

/**
 * True when this record was indexed from paperwork with nobody in the loop and
 * the company has still never claimed it.
 *
 * The one place the "Auto-generated via rate con — unclaimed" badge is decided,
 * so a screen cannot invent its own definition of the same words.
 */
export function isAutoIndexedUnclaimed(party: Party): boolean {
  return party.provenance.kind === "rate_confirmation_auto"
    && party.claim.state === "unclaimed";
}

/* -------------------------------------------------------------------------- */
/* Facilities                                                                  */
/* -------------------------------------------------------------------------- */

/** What actually happens at a dock. A facility may do both. */
export type FacilityFunction = "pickup" | "delivery";

/**
 * A physical place freight is picked up from or delivered to.
 *
 * Separate from the Party because one company has many, and a stop happens at
 * exactly one of them. Separate from the Load's `Stop` because a stop is one
 * visit on one day, and a facility is the permanent place that visit happened
 * at — the place keeps its hours, its dock notes and its contacts between loads.
 */
export interface Facility {
  /** Immutable UUID. */
  facilityId: string;
  /** The company that operates this location. */
  partyId: string;
  /** The name on the rate confirmation, e.g. "Blue Ridge DC #4". */
  name: string;
  address: Address;
  /** The facility's own zone. A dock's hours are local to the dock. */
  timeZone?: TimeZone;
  /** Pickup, delivery, or both. Grows as loads prove what happens here. */
  functions: FacilityFunction[];
  /** Free text as printed: "Mon-Fri 0700-1500". Not parsed into a schedule. */
  hoursText?: string;
  appointmentRequired?: boolean;
  /** Dock, door or warehouse notes carried between loads. */
  instructions?: string;
  status: PartyRecordStatus;
  mergedIntoFacilityId?: string;
  reviewReason?: string;
  provenance: PartyProvenance;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdByOrganizationId: string;
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What this person does, which decides where they belong. A broker agent hangs
 * off the company; a shipping clerk hangs off one dock.
 */
export type PartyContactKind =
  | "broker_agent"
  | "facility_contact"
  | "accounting"
  | "after_hours"
  | "other";

export interface PartyContact {
  /** Immutable UUID. */
  contactId: string;
  /** The company this person works for. Always set. */
  partyId: string;
  /** The one location they work at, for facility contacts. */
  facilityId?: string;
  kind: PartyContactKind;
  fullName: string;
  title?: string;
  phone?: string;
  /** Extension, kept apart from the number so matching can ignore it. */
  phoneExtension?: string;
  mobile?: string;
  email?: string;
  status: PartyRecordStatus;
  mergedIntoContactId?: string;
  reviewReason?: string;
  provenance: PartyProvenance;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdByOrganizationId: string;
}

/* -------------------------------------------------------------------------- */
/* The carrier-private layer                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How this carrier feels about this company.
 *
 * Everything above is a fact about the world and is shared: an MC number is
 * the same number for everyone. Everything in this section is one carrier's
 * private opinion — what they were paid, whether they were treated well,
 * whether they will ever haul for them again — and it is partitioned by
 * carrier organization at the store, not filtered in a screen. Northline can
 * never read Baxter's rating of a broker, and nothing in the read path takes a
 * parameter that would let it try.
 */
export type PartyStanding = "preferred" | "standard" | "watch" | "blocked";

export interface PaymentExperience {
  /** Agreed terms in days, as the carrier understands them. */
  termsDays?: number;
  /** Observed, from this carrier's own history. Never an industry figure. */
  averageDaysToPay?: number;
  lastPaidAt?: IsoDateTime;
  /** Invoices this carrier has open with them. */
  openInvoiceCount?: number;
  disputeCount?: number;
  /** Whether this carrier uses a factoring company for them. */
  factored?: boolean;
  notes?: string;
}

export interface CarrierPartyRelationship {
  id: string;
  /** The carrier whose private view this is. The partition key. */
  carrierOrganizationId: string;
  partyId: string;
  standing: PartyStanding;
  /** Why they are blocked or preferred, in the words of whoever set it. */
  standingReason?: string;
  /** 1–5, this carrier's own. Never aggregated across carriers. */
  rating?: number;
  creditLimitCents?: number;
  paymentExperience?: PaymentExperience;
  /** This carrier's own reference for them, e.g. a customer code in their TMS. */
  internalReference?: string;
  firstLoadAt?: IsoDateTime;
  lastLoadAt?: IsoDateTime;
  loadCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** A private note. Belongs to one carrier and is never shown to another. */
export interface PartyNote {
  id: string;
  carrierOrganizationId: string;
  /** Exactly one of these is set. */
  partyId?: string;
  facilityId?: string;
  contactId?: string;
  body: string;
  pinned: boolean;
  author: ActorRef;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Load linkage and snapshots                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the paperwork said, frozen.
 *
 * A load that ran in March must keep showing the address, the phone number and
 * the agent that were on its rate confirmation, even after somebody corrects
 * the profile in September. So the link carries a copy of the fields as they
 * were used, and the profile carries the current truth. Neither overwrites the
 * other, and the load record itself is untouched by any profile edit.
 */
export interface PartySnapshot {
  legalName: string;
  dbaName?: string;
  mcNumber?: string;
  dotNumber?: string;
  address?: Address;
  phone?: string;
  email?: string;
  /** The facility as printed on that rate confirmation. */
  facilityName?: string;
  facilityAddress?: Address;
  facilityHoursText?: string;
  /** The person named on that rate confirmation. */
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

/**
 * The join between a load and the parties on it.
 *
 * The directory does not store loads and a load does not store directory
 * records: this row is the only thing that knows they are related. A party
 * profile lists its loads by reading these links and then asking the loads
 * service for each one, so the load stays owned by the loads module and a
 * deleted link never takes a load with it.
 */
export interface PartyLoadLink {
  id: string;
  /** Which carrier's load this is. Private, like everything load-shaped. */
  carrierOrganizationId: string;
  /** The load's own immutable UUID. */
  loadId: string;
  /** What this party was doing on this load. */
  role: PartyRole;
  partyId: string;
  facilityId?: string;
  contactId?: string;
  /** The rate confirmation the information came off. Preserved as the source. */
  rateConfirmationDocumentId?: string;
  /** Frozen at link time. Never rewritten by a later profile edit. */
  snapshot: PartySnapshot;
  linkedAt: IsoDateTime;
  linkedBy: ActorRef;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Directory history is append-only, for the same reason load execution is: the
 * interesting question is never "what does it say now" but "who changed it, and
 * what did it say when we booked that load".
 */
export type DirectoryEventKind =
  | "party.created"
  | "party.updated"
  | "party.role_added"
  | "party.promoted_from_provisional"
  /** Indexed automatically from a rate confirmation. Nobody confirmed it. */
  | "party.auto_indexed"
  | "party.claim_requested"
  | "party.claimed"
  | "party.flagged_for_review"
  | "party.merged"
  | "party.archived"
  | "facility.created"
  | "facility.updated"
  | "facility.flagged_for_review"
  | "contact.created"
  | "contact.updated"
  | "contact.flagged_for_review"
  | "load.linked"
  | "resolution.proposed"
  | "resolution.confirmed_existing"
  | "resolution.created_new"
  | "private.standing_changed"
  | "private.rating_changed"
  | "private.note_added"
  | "private.payment_experience_updated";

export interface DirectoryEvent {
  id: string;
  /**
   * The carrier that performed the action. Events about shared records are
   * visible to anyone who can see the record; events about private records are
   * readable only by the carrier that owns them.
   */
  carrierOrganizationId: string;
  /** Private events are never served to another organization. */
  private: boolean;
  kind: DirectoryEventKind;
  partyId?: string;
  facilityId?: string;
  contactId?: string;
  loadId?: string;
  occurredAt: IsoDateTime;
  actor: ActorRef;
  /** What changed, in plain language, for the history list. */
  summary: string;
  /** Field-level detail, when there is any. */
  changes?: { field: string; from?: string; to?: string }[];
}

/* -------------------------------------------------------------------------- */
/* Read models                                                                 */
/* -------------------------------------------------------------------------- */

/** One row in the directory list. Assembled by the registry, never by a screen. */
export interface DirectoryListing {
  partyId: string;
  legalName: string;
  dbaName?: string;
  roles: PartyRole[];
  mcNumber?: string;
  dotNumber?: string;
  status: PartyRecordStatus;
  verificationState: PartyVerificationState;
  claimState: PartyClaimState;
  /** True for a record no person has ever confirmed. Drives the list badge. */
  autoIndexed: boolean;
  city?: string;
  state?: string;
  facilityCount: number;
  contactCount: number;
  /** This carrier's own numbers. Another carrier sees its own. */
  loadCount: number;
  lastLoadAt?: IsoDateTime;
  standing: PartyStanding;
  rating?: number;
}

/** Everything one party profile needs, in one read. */
export interface PartyProfileView {
  party: Party;
  facilities: Facility[];
  contacts: PartyContact[];
  /** This carrier's private view. Always present; defaults are not opinions. */
  relationship: CarrierPartyRelationship;
  notes: PartyNote[];
  /** Newest first. Loads themselves are read from the loads service. */
  loadLinks: PartyLoadLink[];
  history: DirectoryEvent[];
}

export interface FacilityProfileView {
  facility: Facility;
  party: Party;
  contacts: PartyContact[];
  notes: PartyNote[];
  loadLinks: PartyLoadLink[];
  history: DirectoryEvent[];
}

export interface ContactProfileView {
  contact: PartyContact;
  party: Party;
  facility?: Facility;
  notes: PartyNote[];
  loadLinks: PartyLoadLink[];
  history: DirectoryEvent[];
}

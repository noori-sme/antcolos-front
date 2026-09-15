import type { Cents, IsoDateTime, Money } from "./common";
import type { DocumentTypeKey } from "./document-center";
import type { ActorRef } from "./user";

/**
 * A Contract records the TERMS of a business relationship. It is not the
 * relationship.
 *
 * This distinction is the whole design, and everything below exists to keep it
 * true. Antcolos already has four separate systems that decide what somebody
 * can actually do:
 *
 *   Invitation                  proposes access to an organization
 *   Membership                  controls a user's access inside it
 *   CarrierRelationship         controls a driver's business scope with a carrier
 *   TruckCarrierRelationship /  controls which carrier may operate an asset
 *   TrailerCarrierRelationship
 *   TruckOperatingLease /       controls which authority it legally runs under
 *   TrailerOperatingLease
 *   TruckDispatchAccess         controls a dispatch organization's access to it
 *
 * A contract points AT those records and never becomes one. Signing a contract
 * may ASK the canonical service for a transition — recorded here as a
 * {@link RelationshipTransitionRequest} — but it never creates, alters or ends
 * access by itself, because a paper agreement and a permission grant failing
 * apart silently is how somebody ends up dispatching under an authority nobody
 * approved.
 *
 * Six identities, six jobs, none interchangeable:
 *
 *   contractId       Antcolos's permanent identity for the agreement. Immutable.
 *                    Amendments and replacements never change it.
 *   contractVersionId  One immutable statement of terms. A signed version is
 *                    frozen forever; changing terms means a NEW version.
 *   partyId          One side of the agreement, per contract.
 *   signerId         One person authorised to sign for one party.
 *   signatureId      One signature, by one signer, on one version.
 *   requirementId    One thing the agreement asks for, per contract.
 */

/* -------------------------------------------------------------------------- */
/* Agreement types                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which business relationship the paperwork is about.
 *
 * Deliberately narrower than "any two parties can sign anything": each type
 * declares in {@link AGREEMENT_TYPE_CATALOG} which party roles it needs, which
 * canonical relationship it may reference, and what it is allowed to ask for.
 * A carrier–driver agreement that could reference an Operating Authority lease
 * would be an agreement that could quietly authorise a truck.
 */
export type AgreementType =
  /** A carrier engaging a company driver. */
  | "carrier_driver"
  /** A carrier engaging an owner-operator, who brings their own equipment. */
  | "carrier_owner_operator"
  /** A carrier retaining a dispatch organization to book its freight. */
  | "carrier_dispatch_organization"
  /** A carrier retaining one self-employed dispatcher, with no company behind them. */
  | "carrier_individual_dispatcher"
  /**
   * An equipment owner leasing a truck or trailer to a carrier.
   *
   * The terms of the lease only. The permanent equipment record, its UUID and
   * its ownership history are the equipment registry's and are never touched.
   */
  | "equipment_lease"
  /**
   * The terms behind running an asset under another carrier's authority.
   *
   * Records what the two carriers agreed. Whether the asset may legally run is
   * the Operating Authority lease's answer, never this record's.
   */
  | "operating_authority_lease"
  /** Any other supported business relationship, named by the parties. */
  | "other_business_relationship";

/** What one side of an agreement is, in the relationship being papered. */
export type ContractPartyRole =
  | "carrier"
  | "driver"
  | "owner_operator"
  | "dispatch_organization"
  | "individual_dispatcher"
  | "equipment_owner"
  | "other";

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where the agreement has got to.
 *
 * Nine states, and the three at the end are not the same thing: `terminated`
 * means somebody ended it, `cancelled` means it never took effect, and
 * `superseded` means a newer version of the same agreement replaced it. A
 * product that collapses those cannot answer "what were we operating under in
 * March", which is the question a contract module exists to answer.
 *
 * `expiring` and `expired` are DERIVED from the effective dates on every read —
 * see `deriveContractStatus`. They are never written by hand, so a contract
 * cannot sit at "active" a month after it ran out because nobody ran a job.
 */
export type ContractStatus =
  /** Being written. Terms may still change in place. */
  | "draft"
  /** Sent for internal review before it goes to the other side. */
  | "pending_review"
  /** Reviewed, and waiting for one or more signatures. */
  | "awaiting_signature"
  /** Fully signed and inside its effective dates. */
  | "active"
  /** Active, and its end date is inside the renewal window. */
  | "expiring"
  /** Its end date has passed and nothing renewed or replaced it. */
  | "expired"
  /** Ended early by one of the parties, with a termination record. */
  | "terminated"
  /** Abandoned before it ever took effect. No signed version exists. */
  | "cancelled"
  /** Replaced by a newer contract. The record stays, read-only. */
  | "superseded";

/** Contracts nobody has to act on any more. */
export const CONTRACT_TERMINAL_STATUSES: readonly ContractStatus[] = [
  "expired", "terminated", "cancelled", "superseded",
] as const;

/** Contracts that are in force right now. */
export const CONTRACT_IN_FORCE_STATUSES: readonly ContractStatus[] = [
  "active", "expiring",
] as const;

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  awaiting_signature: "Awaiting signature",
  active: "Active",
  expiring: "Expiring",
  expired: "Expired",
  terminated: "Terminated",
  cancelled: "Cancelled",
  superseded: "Superseded",
};

/* -------------------------------------------------------------------------- */
/* Versions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Why this version exists.
 *
 * An amendment changes part of the terms and cites what it changed; a
 * replacement restates the whole agreement. Both are new versions, never edits.
 */
export type ContractVersionKind = "original" | "amendment" | "replacement";

export type ContractVersionStatus =
  /** Terms may still be edited in place. Exactly one draft version at a time. */
  | "draft"
  /** Out for signature. Terms are locked; only signatures may be added. */
  | "issued"
  /** Every required signature is in. Frozen forever. */
  | "signed"
  /** A later version replaced this one. Frozen, and kept. */
  | "superseded"
  /** Withdrawn before it was signed. Frozen, and kept. */
  | "void";

export const CONTRACT_VERSION_STATUS_LABEL: Record<ContractVersionStatus, string> = {
  draft: "Draft",
  issued: "Out for signature",
  signed: "Signed",
  superseded: "Superseded",
  void: "Withdrawn",
};

/**
 * One immutable statement of terms.
 *
 * `frozen` is not a convenience flag. It is the one field the service layer
 * checks before every write, and it is set the moment a version is signed,
 * superseded or voided. Nothing in the product can clear it — see
 * `assertVersionMutable`.
 */
export interface ContractVersion {
  contractVersionId: string;
  contractId: string;
  /** 1-based, gapless, and never reused. */
  versionNumber: number;
  kind: ContractVersionKind;
  status: ContractVersionStatus;
  /** Set on amendments and replacements: the version this one came from. */
  supersedesVersionId?: string;
  /** Set once something replaced it. The old version is kept in full. */
  supersededByVersionId?: string;
  /** Required on an amendment or replacement: why the terms changed. */
  changeReason?: string;
  /** Which term groups this amendment touched. Empty on an original. */
  changedTermGroups: ContractTermGroup[];
  terms: ContractTerms;
  /**
   * True once the version may never change again. Set on sign, supersede and
   * void, and never cleared.
   */
  frozen: boolean;
  issuedAt?: IsoDateTime;
  signedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  createdByMembershipId: string;
  createdByName: string;
}

/** The term groups an amendment can say it changed. */
export type ContractTermGroup =
  | "effective_dates"
  | "renewal"
  | "termination"
  | "compensation"
  | "responsibilities"
  | "required_documents";

export const CONTRACT_TERM_GROUP_LABEL: Record<ContractTermGroup, string> = {
  effective_dates: "Effective dates",
  renewal: "Renewal",
  termination: "Termination",
  compensation: "Compensation",
  responsibilities: "Responsibilities",
  required_documents: "Required documents",
};

/* -------------------------------------------------------------------------- */
/* Terms                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything the parties agreed, as of one version.
 *
 * Held on the VERSION rather than the contract, which is what makes "what were
 * we operating under in March" answerable: the March version still says so,
 * whatever this month's says.
 */
export interface ContractTerms {
  /** Plain-language summary the parties can read before the detail. */
  summary: string;
  effective: EffectiveDates;
  renewal: RenewalTerms;
  termination: TerminationTerms;
  /**
   * How money is worked out under this agreement.
   *
   * Terms only. Settlements price work under the agreement that was in force
   * when the work was performed and freeze their arithmetic on approval, so a
   * new version never rewrites a settled period.
   */
  compensation: CompensationRule[];
  responsibilities: Responsibility[];
  requiredDocuments: RequiredDocumentTerm[];
  /** Anything the parties wrote that has no field of its own. */
  additionalTerms?: string;
}

export interface EffectiveDates {
  /** When the agreement starts. Required before a version can be issued. */
  from: IsoDateTime;
  /** Absent means open-ended, which is a real and different thing from unknown. */
  to?: IsoDateTime;
  /** Set when the parties agreed a trial period. */
  probationEndsAt?: IsoDateTime;
}

export type RenewalKind =
  /** Runs to its end date and stops. */
  | "none"
  /** Rolls over for another term unless somebody gives notice. */
  | "automatic"
  /** Rolls over only if both sides say so. */
  | "mutual_consent";

export const RENEWAL_KIND_LABEL: Record<RenewalKind, string> = {
  none: "Does not renew",
  automatic: "Renews automatically",
  mutual_consent: "Renews by mutual consent",
};

export interface RenewalTerms {
  kind: RenewalKind;
  /** Length of each renewal term, in days. Absent on `none`. */
  termDays?: number;
  /** How much notice stops an automatic renewal. */
  noticeDays?: number;
  /**
   * How far before the end date Antcolos starts saying so.
   *
   * Drives the derived `expiring` status and the Needs You item, so it is a
   * term rather than a global constant: a 30-day notice period needs more
   * warning than a 7-day one.
   */
  reminderDays: number;
}

export type TerminationGround =
  /** Either side may end it by giving notice. */
  | "for_convenience"
  /** One side broke the agreement. */
  | "for_cause"
  /** Both sides agreed to stop. */
  | "mutual"
  /** Ended by something outside either party's control. */
  | "operation_of_law";

export const TERMINATION_GROUND_LABEL: Record<TerminationGround, string> = {
  for_convenience: "For convenience",
  for_cause: "For cause",
  mutual: "By mutual agreement",
  operation_of_law: "By operation of law",
};

export interface TerminationTerms {
  /** Which grounds the agreement allows. Never empty. */
  grounds: TerminationGround[];
  /** Notice required for a convenience termination, in days. */
  noticeDays: number;
  /** Notice required for cause. Often zero. */
  forCauseNoticeDays: number;
  /**
   * What has to happen before the relationship is really finished — equipment
   * returned, final settlement paid, access revoked.
   *
   * Contract-side checklist ONLY. Revoking access is the membership and
   * relationship services' job; this records that the parties agreed it must
   * happen and whether somebody has confirmed it did.
   */
  closeoutSteps: TerminationStepTerm[];
  /** What survives the end of the agreement — confidentiality, indemnity. */
  survivingObligations?: string[];
}

export type TerminationStepKey =
  | "final_settlement"
  | "return_equipment"
  | "return_documents"
  | "revoke_access"
  | "end_relationship"
  | "release_operating_authority"
  | "other";

export const TERMINATION_STEP_TERM_LABEL: Record<TerminationStepKey, string> = {
  final_settlement: "Final settlement issued",
  return_equipment: "Equipment returned",
  return_documents: "Documents returned or closed",
  revoke_access: "Access revoked",
  end_relationship: "Relationship ended in the canonical service",
  release_operating_authority: "Operating Authority lease released",
  other: "Other agreed step",
};

export interface TerminationStepTerm {
  key: TerminationStepKey;
  label: string;
  /** Days after the effective end date this step is owed. */
  dueWithinDays?: number;
  /** Which party owes it. */
  owedByRole: ContractPartyRole;
}

/* -------------------------------------------------------------------------- */
/* Compensation                                                                */
/* -------------------------------------------------------------------------- */

export type CompensationKind =
  /** A share of the load's revenue. */
  | "percentage_of_revenue"
  /** Cents per loaded mile. */
  | "rate_per_loaded_mile"
  /** Cents per mile including empty miles. */
  | "rate_per_all_mile"
  /** A flat amount per period. */
  | "flat_per_period"
  /** A flat amount per load. */
  | "flat_per_load"
  /** Cents per hour. */
  | "hourly"
  /** A deduction taken from what is otherwise owed. */
  | "deduction"
  /** An addition — detention, layover, fuel surcharge. */
  | "accessorial"
  /** Anything else, described in words. */
  | "other";

export const COMPENSATION_KIND_LABEL: Record<CompensationKind, string> = {
  percentage_of_revenue: "Percentage of revenue",
  rate_per_loaded_mile: "Per loaded mile",
  rate_per_all_mile: "Per mile, loaded and empty",
  flat_per_period: "Flat per period",
  flat_per_load: "Flat per load",
  hourly: "Hourly",
  deduction: "Deduction",
  accessorial: "Accessorial",
  other: "Other",
};

/**
 * One compensation rule, as agreed.
 *
 * A rule is a TERM, not a calculation. Settlements own the arithmetic and the
 * snapshot; this says what the parties agreed and when it applied. That is why
 * rules carry their own effective window: a percentage that changed in June
 * does not make May's pay wrong.
 */
export interface CompensationRule {
  id: string;
  kind: CompensationKind;
  label: string;
  /** The rule in a sentence, as the parties would say it. */
  detail: string;
  /** Basis points for percentages — 6250 is 62.5%. Absent otherwise. */
  percentageBasisPoints?: number;
  /** Cents for every money-shaped kind. Never a float. */
  amountCents?: Cents;
  /** Cents per mile or per hour, for the rate kinds. */
  rateCents?: Cents;
  /** "week", "month", "load" — what `flat_per_period` is per. */
  per?: string;
  /** Which party is paid, or charged, under this rule. */
  payeeRole: ContractPartyRole;
  /** When this rule started applying. Defaults to the version's effective date. */
  appliesFrom?: IsoDateTime;
  /** When it stopped. Absent while it still applies. */
  appliesTo?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Responsibilities                                                            */
/* -------------------------------------------------------------------------- */

export type ResponsibilityArea =
  | "fuel"
  | "maintenance"
  | "insurance"
  | "tolls"
  | "permits"
  | "trailer"
  | "compliance"
  | "dispatch"
  | "paperwork"
  | "claims"
  | "taxes"
  | "other";

export const RESPONSIBILITY_AREA_LABEL: Record<ResponsibilityArea, string> = {
  fuel: "Fuel",
  maintenance: "Maintenance",
  insurance: "Insurance",
  tolls: "Tolls and scales",
  permits: "Permits",
  trailer: "Trailer",
  compliance: "Compliance",
  dispatch: "Dispatch",
  paperwork: "Paperwork",
  claims: "Claims",
  taxes: "Taxes",
  other: "Other",
};

export interface Responsibility {
  id: string;
  area: ResponsibilityArea;
  /** Who carries it. */
  owedByRole: ContractPartyRole;
  /** What exactly they carry, in the parties' own words. */
  detail: string;
  /** True when failing it is a `for_cause` termination ground. */
  material: boolean;
}

/* -------------------------------------------------------------------------- */
/* Required documents                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A document the agreement asks one party for.
 *
 * Reuses `DocumentTypeKey` from the Document Center on purpose: there is ONE
 * document system, and a contract requirement is a reason a document is needed,
 * never a second place to keep one. Nothing here holds a file.
 */
export interface RequiredDocumentTerm {
  id: string;
  documentTypeKey: DocumentTypeKey;
  /** Which party owes it. */
  owedByRole: ContractPartyRole;
  /** Why the agreement asks for it. */
  reason: string;
  /** True when the agreement cannot go active without it. */
  blocking: boolean;
  /** Days after the effective date it is owed by. */
  dueWithinDays?: number;
}

/* -------------------------------------------------------------------------- */
/* Parties and signers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One side of the agreement.
 *
 * `organizationRef` and the rest are REFERENCES to canonical records. The party
 * row snapshots the legal name as it read when the contract was drawn, so a
 * later rename cannot rewrite a signed agreement, and it never becomes the
 * organization, driver profile or membership it points at.
 */
export interface ContractParty {
  partyId: string;
  contractId: string;
  role: ContractPartyRole;
  /** Legal name as it read when the party was added. Never re-derived. */
  legalNameSnapshot: string;
  /** Set when this party is an Antcolos organization. */
  organizationRef?: string;
  /** Set when this party is a person with a driver profile. */
  driverProfileRef?: string;
  /**
   * Set when the party is represented inside the owning organization by a
   * membership — an individual dispatcher, say. A reference, never a grant.
   */
  membershipRef?: string;
  /** Free text when the party is not in Antcolos at all. */
  externalIdentifier?: string;
  /** True for the party whose organization owns this contract record. */
  isOwningParty: boolean;
  addedAt: IsoDateTime;
}

/** On what basis somebody may sign for a party. */
export type SignerAuthority =
  /** An owner of the party's organization. */
  | "owner"
  /** Given signing authority by an owner, for this contract. */
  | "delegated"
  /** Signing for themselves — a driver, an individual dispatcher. */
  | "self";

export const SIGNER_AUTHORITY_LABEL: Record<SignerAuthority, string> = {
  owner: "Organization owner",
  delegated: "Delegated authority",
  self: "Signing for themselves",
};

/**
 * One person who may sign for one party.
 *
 * The rule the service layer enforces: a signer may sign ONLY for their own
 * party, and only while their authority is live. No party may sign, approve,
 * amend or terminate for another, whatever permissions they hold — a carrier
 * owner with every permission in the catalog still cannot sign the driver's
 * side.
 */
export interface AuthorizedSigner {
  signerId: string;
  contractId: string;
  partyId: string;
  /** The membership this signer acts through, when they have one here. */
  membershipId?: string;
  /** Name as it read when authority was granted. Snapshotted. */
  nameSnapshot: string;
  /** Job title, display only. Never an authority source. */
  titleSnapshot?: string;
  authority: SignerAuthority;
  /** Who granted a `delegated` authority. Absent on `owner` and `self`. */
  grantedByMembershipId?: string;
  grantedAt: IsoDateTime;
  /** Set once the authority was withdrawn. Past signatures are unaffected. */
  revokedAt?: IsoDateTime;
  revokedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Signatures                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How a signature was taken.
 *
 * Exactly one value, and it says what it is. There is no e-signature provider
 * behind this build, no identity check and no legal claim: a signature here is
 * a typed name recorded against a version, and every screen showing one says
 * so. The e-signature seam is declared in `contracts/extension-points.ts` and
 * throws.
 */
export type SignatureMethod = "mock_typed_name";

export const SIGNATURE_METHOD_LABEL: Record<SignatureMethod, string> = {
  mock_typed_name: "Typed name (mock)",
};

/**
 * One signature, by one signer, on one version.
 *
 * Immutable. A signature is never edited or removed — a party that changes its
 * mind gets a new version, and both stay on the record.
 */
export interface ContractSignature {
  signatureId: string;
  contractId: string;
  contractVersionId: string;
  partyId: string;
  signerId: string;
  /** What the signer typed. Kept verbatim. */
  typedName: string;
  /** Name and title as they read at the moment of signing. */
  signerNameSnapshot: string;
  signerTitleSnapshot?: string;
  method: SignatureMethod;
  /** What the signer was shown above the signature box. Kept verbatim. */
  statement: string;
  signedAt: IsoDateTime;
  /**
   * Always true, and not removable.
   *
   * This build has no e-signature integration, no identity verification and no
   * legal effect. The flag exists so no screen, export or later milestone can
   * present one of these as a real signature by forgetting to mention it.
   */
  mock: true;
}

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

export type ContractRequirementKind =
  /** A document the Document Center must hold. */
  | "document"
  /** Insurance coverage the insurance module must show. */
  | "insurance"
  /** Active Operating Authority, per the carrier profile. */
  | "operating_authority"
  /** A signature from a named party. */
  | "signature"
  /** Something a person has to confirm by hand. */
  | "attestation"
  /** A step in a termination closeout. */
  | "closeout";

export const CONTRACT_REQUIREMENT_KIND_LABEL: Record<ContractRequirementKind, string> = {
  document: "Document",
  insurance: "Insurance",
  operating_authority: "Operating Authority",
  signature: "Signature",
  attestation: "Attestation",
  closeout: "Closeout step",
};

export type ContractRequirementStatus =
  /** Nothing satisfies it. */
  | "unmet"
  /** Satisfied right now. */
  | "met"
  /** Deliberately set aside, by somebody with the authority to do it. */
  | "waived"
  /** Was met, and what satisfied it has run out. */
  | "expired"
  /** Does not apply to this agreement. */
  | "not_applicable";

export const CONTRACT_REQUIREMENT_STATUS_LABEL: Record<ContractRequirementStatus, string> = {
  unmet: "Not met",
  met: "Met",
  waived: "Waived",
  expired: "Expired",
  not_applicable: "Not applicable",
};

/**
 * One thing the agreement asks for.
 *
 * A requirement is NOT the thing it asks for, the same way a document
 * requirement is not a document. It carries a reference to whatever satisfies
 * it and is evaluated on every read, so fixing the underlying document, policy
 * or authority clears the requirement without anybody ticking it off.
 *
 * Requirements belong to the CONTRACT, not to a version: the same medical card
 * is owed across an amendment, and a requirement somebody satisfied should not
 * reappear as unmet because the terms were restated.
 */
export interface ContractRequirement {
  requirementId: string;
  contractId: string;
  kind: ContractRequirementKind;
  label: string;
  /** Why the agreement asks for it. */
  reason: string;
  /** Which party owes it. */
  owedByPartyId: string;
  /** True when the contract may not go active while it is unmet. */
  blocking: boolean;
  /** Set on `document` requirements: which type the Document Center must hold. */
  documentTypeKey?: DocumentTypeKey;
  /** The term this requirement came from, when it came from one. */
  requiredDocumentTermId?: string;
  /** When it is owed by. */
  dueAt?: IsoDateTime;
  /** What satisfies it now, as a reference. Never a copy of the record. */
  satisfiedBy?: ContractLinkRef;
  /** Derived on read, except for `waived`, which is stored. */
  status: ContractRequirementStatus;
  waivedByMembershipId?: string;
  waivedAt?: IsoDateTime;
  waivedReason?: string;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Relationship references                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which canonical relationship system a reference points at.
 *
 * Each value names a record owned somewhere else. The contract module reads
 * these and writes none of them.
 */
export type RelationshipRefKind =
  /** `Invitation` — proposed access to an organization. */
  | "invitation"
  /** `Membership` — a user's access inside an organization. */
  | "membership"
  /** `CarrierRelationship` — a driver's engagement with a carrier. */
  | "driver_carrier_relationship"
  /** `TruckCarrierRelationship` — which carrier may operate a truck. */
  | "truck_carrier_relationship"
  /** `TrailerCarrierRelationship` — the same, for a trailer. */
  | "trailer_carrier_relationship"
  /** `TruckDispatchAccess` — a dispatch organization's access to a truck. */
  | "truck_dispatch_access"
  /** `TruckOperatingLease` — which authority a truck legally runs under. */
  | "truck_operating_lease"
  /** `TrailerOperatingLease` — the same, for a trailer. */
  | "trailer_operating_lease";

export const RELATIONSHIP_REF_LABEL: Record<RelationshipRefKind, string> = {
  invitation: "Invitation",
  membership: "Membership",
  driver_carrier_relationship: "Driver–carrier relationship",
  truck_carrier_relationship: "Truck carrier relationship",
  trailer_carrier_relationship: "Trailer carrier relationship",
  truck_dispatch_access: "Dispatch access",
  truck_operating_lease: "Truck Operating Authority lease",
  trailer_operating_lease: "Trailer Operating Authority lease",
};

/**
 * Which canonical service owns a relationship kind.
 *
 * Written down so a transition request names the service that has to perform
 * it, rather than leaving the reader to guess that a contract might do it
 * itself.
 */
export const RELATIONSHIP_OWNER_SERVICE: Record<RelationshipRefKind, string> = {
  invitation: "Access service (invitations)",
  membership: "Access service (memberships)",
  driver_carrier_relationship: "Driver relationship service",
  truck_carrier_relationship: "Truck registry",
  trailer_carrier_relationship: "Trailer registry",
  truck_dispatch_access: "Truck registry",
  truck_operating_lease: "Truck registry (Operating Authority leases)",
  trailer_operating_lease: "Trailer registry (Operating Authority leases)",
};

/**
 * A pointer at a relationship this agreement papers.
 *
 * Read-only by construction: there is no field here that could change the
 * record it names, and the contract service has no write path into any of the
 * owning services.
 */
export interface ContractRelationshipRef {
  id: string;
  contractId: string;
  kind: RelationshipRefKind;
  /** The canonical record's own id. Never rewritten. */
  externalId: string;
  /** Label as it read when the reference was made. */
  labelSnapshot: string;
  /** Route to the record, when a screen for it exists. */
  href?: string;
  /** Which party the relationship is with. */
  partyId?: string;
  linkedAt: IsoDateTime;
  /** Set when the reference was detached. The canonical record is untouched. */
  detachedAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Transition requests                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What signing or activating a contract ASKS a canonical service to do.
 *
 * The most important type in the file. A contract that could flip a membership
 * to active, or start an Operating Authority lease, would be a contract that
 * silently grants access — so it cannot. Signing records a REQUEST: what is
 * being asked, of which service, about which record, and by whom. Nothing is
 * applied.
 *
 * `applied` is permanently false in this build and the type says so, because a
 * boolean that could be true is a boolean somebody will set.
 */
export type RelationshipTransitionKind =
  /** Ask that a proposed access be reviewed. Never accepts it. */
  | "review_invitation"
  /** Ask that a membership be activated by whoever controls access. */
  | "activate_membership"
  /** Ask that a membership's access be revoked. */
  | "revoke_membership"
  /** Ask that a driver–carrier relationship be started. */
  | "start_driver_relationship"
  /** Ask that a driver–carrier relationship be ended. */
  | "end_driver_relationship"
  /** Ask that an asset's carrier relationship be approved. */
  | "approve_asset_relationship"
  /** Ask that an asset's carrier relationship be ended. */
  | "end_asset_relationship"
  /** Ask that dispatch access be granted. */
  | "grant_dispatch_access"
  /** Ask that dispatch access be ended. */
  | "end_dispatch_access"
  /** Ask that an Operating Authority lease be released. */
  | "release_operating_authority";

export const TRANSITION_KIND_LABEL: Record<RelationshipTransitionKind, string> = {
  review_invitation: "Review the invitation",
  activate_membership: "Activate the membership",
  revoke_membership: "Revoke the membership",
  start_driver_relationship: "Start the driver relationship",
  end_driver_relationship: "End the driver relationship",
  approve_asset_relationship: "Approve the equipment relationship",
  end_asset_relationship: "End the equipment relationship",
  grant_dispatch_access: "Grant dispatch access",
  end_dispatch_access: "End dispatch access",
  release_operating_authority: "Release the Operating Authority lease",
};

export interface RelationshipTransitionRequest {
  id: string;
  contractId: string;
  /** The version whose signing or termination raised it. */
  contractVersionId?: string;
  kind: RelationshipTransitionKind;
  /** Which canonical relationship it is about. */
  target: {
    kind: RelationshipRefKind;
    externalId?: string;
    labelSnapshot: string;
  };
  /** Which service has to perform it. Never this one. */
  ownerService: string;
  /** Why the contract is asking. */
  reason: string;
  requestedAt: IsoDateTime;
  requestedByMembershipId: string;
  requestedByName: string;
  /**
   * Always false. The contract module has no write path into any relationship
   * service, and the literal type keeps it that way.
   */
  applied: false;
  /** What a person has to do about it, in their own language. */
  nextStep: string;
}

/* -------------------------------------------------------------------------- */
/* Termination records                                                         */
/* -------------------------------------------------------------------------- */

export type ContractTerminationStatus =
  /** Notice given, effective date in the future. */
  | "notice_given"
  /** Effective, with closeout steps still outstanding. */
  | "in_closeout"
  /** Every closeout step confirmed. */
  | "completed"
  /** Withdrawn before it took effect, by agreement. */
  | "withdrawn";

export const CONTRACT_TERMINATION_STATUS_LABEL: Record<ContractTerminationStatus, string> = {
  notice_given: "Notice given",
  in_closeout: "In closeout",
  completed: "Completed",
  withdrawn: "Withdrawn",
};

/**
 * A record that somebody ended the agreement.
 *
 * Its own record rather than a status on the contract, because a termination
 * has its own dates, its own grounds, its own checklist and its own audit — and
 * because an unresolved one is something a person has to finish, which a status
 * cannot express.
 */
export interface ContractTermination {
  terminationId: string;
  contractId: string;
  /** The version in force when notice was given. */
  contractVersionId: string;
  initiatedByPartyId: string;
  initiatedByMembershipId: string;
  initiatedByName: string;
  ground: TerminationGround;
  reason: string;
  noticeGivenAt: IsoDateTime;
  /** When the agreement stops. Derived from the notice period, then stored. */
  effectiveAt: IsoDateTime;
  status: ContractTerminationStatus;
  steps: TerminationStepRecord[];
  /** Access changes the termination asks the canonical services for. */
  transitionRequestIds: string[];
  completedAt?: IsoDateTime;
  withdrawnAt?: IsoDateTime;
  withdrawnReason?: string;
}

export interface TerminationStepRecord {
  key: TerminationStepKey;
  label: string;
  owedByRole: ContractPartyRole;
  dueAt?: IsoDateTime;
  confirmedAt?: IsoDateTime;
  confirmedByMembershipId?: string;
  confirmedByName?: string;
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* Links to the rest of the product                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a contract can point at, beyond the relationship it papers.
 *
 * Every one of these is a reference. The contract module creates no
 * organizations, memberships, drivers, equipment, leases, documents, loads,
 * invoices or settlements, and can delete none of them.
 */
export type ContractLinkKind =
  | "organization"
  | "membership"
  | "driver"
  | "truck"
  | "trailer"
  | "operating_authority_lease"
  | "document"
  | "load"
  | "invoice"
  | "settlement"
  | "insurance_policy"
  | "compliance_requirement";

export const CONTRACT_LINK_LABEL: Record<ContractLinkKind, string> = {
  organization: "Organization",
  membership: "Membership",
  driver: "Driver",
  truck: "Truck",
  trailer: "Trailer",
  operating_authority_lease: "Operating Authority lease",
  document: "Document",
  load: "Load",
  invoice: "Invoice",
  settlement: "Settlement",
  insurance_policy: "Insurance policy",
  compliance_requirement: "Compliance requirement",
};

export interface ContractLinkRef {
  kind: ContractLinkKind;
  /** The record's own permanent id. For documents, the LINEAGE id. */
  id: string;
  /** Label as it read when the link was made. Never re-derived. */
  labelSnapshot: string;
  href?: string;
  /**
   * Set when the link points at a specific version of something — a document
   * version, say. The lineage stays in `id`.
   */
  versionId?: string;
}

export interface ContractLink {
  id: string;
  contractId: string;
  ref: ContractLinkRef;
  /** Why the two are connected, in a person's words. */
  note?: string;
  linkedAt: IsoDateTime;
  linkedByMembershipId: string;
}

/* -------------------------------------------------------------------------- */
/* Audit timeline                                                              */
/* -------------------------------------------------------------------------- */

export type ContractEventKind =
  | "created"
  | "party_added"
  | "signer_authorized"
  | "signer_revoked"
  | "version_created"
  | "version_edited"
  | "sent_for_review"
  | "review_returned"
  | "issued_for_signature"
  | "signed"
  | "fully_signed"
  | "activated"
  | "amended"
  | "replaced"
  | "renewed"
  | "expired"
  | "termination_notice"
  | "termination_step_confirmed"
  | "termination_completed"
  | "termination_withdrawn"
  | "cancelled"
  | "superseded"
  | "requirement_waived"
  | "relationship_linked"
  | "relationship_detached"
  | "transition_requested"
  | "link_added"
  | "note";

export const CONTRACT_EVENT_LABEL: Record<ContractEventKind, string> = {
  created: "Contract created",
  party_added: "Party added",
  signer_authorized: "Signer authorised",
  signer_revoked: "Signer authority withdrawn",
  version_created: "Version created",
  version_edited: "Draft terms edited",
  sent_for_review: "Sent for review",
  review_returned: "Returned from review",
  issued_for_signature: "Issued for signature",
  signed: "Signed by a party",
  fully_signed: "Fully signed",
  activated: "Activated",
  amended: "Amended",
  replaced: "Replaced",
  renewed: "Renewed",
  expired: "Expired",
  termination_notice: "Termination notice given",
  termination_step_confirmed: "Closeout step confirmed",
  termination_completed: "Termination completed",
  termination_withdrawn: "Termination withdrawn",
  cancelled: "Cancelled",
  superseded: "Superseded",
  requirement_waived: "Requirement waived",
  relationship_linked: "Relationship linked",
  relationship_detached: "Relationship reference detached",
  transition_requested: "Access change requested",
  link_added: "Record linked",
  note: "Note",
};

/** Append-only. Events are never edited or removed. */
export interface ContractEvent {
  id: string;
  contractId: string;
  /** Set when the event is about one version rather than the contract. */
  contractVersionId?: string;
  at: IsoDateTime;
  kind: ContractEventKind;
  summary: string;
  detail?: string;
  actor: ActorRef;
  /** Whose action it was. */
  organizationId: string;
}

/* -------------------------------------------------------------------------- */
/* The contract itself                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The permanent agreement record.
 *
 * Holds identity, parties and where the paperwork has got to. It holds NO
 * terms: those live on versions, so that history cannot be rewritten by an
 * edit. `currentVersionId` is a pointer, and every version it ever pointed at
 * is still there.
 */
export interface Contract {
  contractId: string;
  /**
   * The organization whose Contracts dashboard this appears on.
   *
   * Contracts are organization-scoped. The counterparty sees its own record of
   * the same agreement through its own organization; there is no cross-
   * organization read here, and the service layer refuses one.
   */
  organizationId: string;
  agreementType: AgreementType;
  /** Short human reference, unique within the organization. */
  reference: string;
  title: string;
  status: ContractStatus;
  /** The version whose terms are in force, or being worked on. */
  currentVersionId: string;
  /** Set when a newer CONTRACT replaced this one. Different from a new version. */
  supersededByContractId?: string;
  supersedesContractId?: string;
  /** Set once terminated. The termination record has the detail. */
  terminationId?: string;
  createdAt: IsoDateTime;
  createdByMembershipId: string;
  createdByName: string;
  updatedAt: IsoDateTime;
  /** Set when the contract was abandoned before taking effect. */
  cancelledAt?: IsoDateTime;
  cancelledReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Read projections                                                            */
/* -------------------------------------------------------------------------- */

/** One row on the dashboard list. */
export interface ContractSummary {
  contractId: string;
  reference: string;
  title: string;
  agreementType: AgreementType;
  status: ContractStatus;
  /** The version in force, or the draft being worked on. */
  versionNumber: number;
  counterpartyName: string;
  counterpartyRole: ContractPartyRole;
  effectiveFrom: IsoDateTime;
  effectiveTo?: IsoDateTime;
  /** Negative once past. Absent on an open-ended agreement. */
  daysUntilEnd?: number;
  /** How many signatures the current version still needs. */
  signaturesOutstanding: number;
  /** How many blocking requirements are unmet or expired. */
  blockingRequirementsOpen: number;
  /** True when a termination is recorded and not finished. */
  terminationOutstanding: boolean;
  /**
   * False when the caller may not see compensation terms. The figures are
   * omitted from the payload entirely rather than blanked in the UI.
   */
  compensationVisible: boolean;
  updatedAt: IsoDateTime;
}

/**
 * Everything one membership may see about one contract.
 *
 * A projection, never stored: what it contains depends on the caller's
 * permissions, their party, and whether the organization owns the record. Two
 * memberships reading the same contract legitimately get different payloads.
 */
export interface ContractView {
  contract: Contract;
  currentVersion: ContractVersion;
  /** Every version, newest first. Signed ones are frozen and kept forever. */
  versions: ContractVersion[];
  parties: ContractParty[];
  signers: AuthorizedSigner[];
  signatures: ContractSignature[];
  requirements: ContractRequirement[];
  relationships: ContractRelationshipRef[];
  transitionRequests: RelationshipTransitionRequest[];
  links: ContractLink[];
  termination?: ContractTermination;
  timeline: ContractEvent[];
  /** What this caller may do, worked out in the service layer. */
  capabilities: ContractCapabilities;
  /**
   * True when compensation terms are present in `currentVersion.terms`. When
   * false the rules array is empty because the caller may not see them, not
   * because the parties agreed none.
   */
  compensationVisible: boolean;
}

/**
 * What one caller may do to one contract.
 *
 * Computed in the service layer from permissions, signer authority, party and
 * status, and sent to the UI so that a button is never shown for an action the
 * seam would refuse. The seam refuses it anyway.
 */
export interface ContractCapabilities {
  canEditDraft: boolean;
  canSendForReview: boolean;
  canIssueForSignature: boolean;
  /** True only when the caller personally holds live authority for a party. */
  canSign: boolean;
  /** Which parties this caller may sign for. Usually one, often none. */
  signableForPartyIds: string[];
  canAmend: boolean;
  canTerminate: boolean;
  canCancel: boolean;
  canWaiveRequirement: boolean;
  canManageSigners: boolean;
  canLinkRecords: boolean;
  canViewCompensation: boolean;
  /** Why an action is unavailable, for the screens to explain rather than hide. */
  blockedReasons: string[];
}

/** The dashboard's own payload. */
export interface ContractsDashboard {
  organizationId: string;
  counts: Record<ContractStatus, number>;
  /** Agreements in force right now, by type. */
  inForceByType: Array<{ agreementType: AgreementType; count: number }>;
  /** Contracts inside their renewal reminder window, soonest first. */
  expiringSoon: ContractSummary[];
  /** Versions waiting on a signature this caller can give. */
  awaitingMySignature: ContractSummary[];
  /** Contracts with an unmet blocking requirement. */
  withOpenRequirements: ContractSummary[];
  /** Terminations that have been noticed and not finished. */
  unresolvedTerminations: ContractSummary[];
  /** Access changes the contracts have asked other services for. */
  openTransitionRequests: RelationshipTransitionRequest[];
  /** True when this caller may see compensation figures anywhere. */
  compensationVisible: boolean;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

export interface ContractFilters {
  status?: ContractStatus[];
  agreementType?: AgreementType[];
  /** Matches reference, title and counterparty name. */
  search?: string;
  /** Only contracts whose end date falls within this many days. */
  endingWithinDays?: number;
  /** Only contracts the caller can sign right now. */
  awaitingMySignature?: boolean;
  /** Only contracts with an unmet blocking requirement. */
  withOpenRequirements?: boolean;
  /** Terminal statuses are included only when this is true. */
  includeClosed?: boolean;
}

export type ContractSortKey = "updated" | "effective_from" | "ending_soonest" | "reference";

/* -------------------------------------------------------------------------- */
/* Money helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Basis points to a display percentage. 6250 -> 62.5. */
export function basisPointsToPercent(basisPoints: number): number {
  return basisPoints / 100;
}

export const usd = (amount: Cents): Money => ({ amount, currency: "USD" });

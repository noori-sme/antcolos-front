import type { DocumentLifecycleStatus } from "./asset";
import type { IsoDateTime, Money } from "./common";
import type { ActorRef } from "./user";

/**
 * Insurance and claims.
 *
 * The shape of this module follows one rule, and every decision below is a
 * consequence of it:
 *
 *   ► COVERAGE IS A QUESTION ABOUT A MOMENT IN TIME, NEVER ABOUT TODAY.
 *
 * "Was this truck covered when it hit the bridge on 3 March?" must keep the
 * same answer forever — after the policy renews, after the truck is sold, after
 * the driver leaves, after the operating authority moves to another carrier.
 * So nothing here is mutated in place to reflect a change:
 *
 *   - A renewal or replacement writes a NEW policy version and marks the old
 *     one superseded. The old policy, its coverage, its certificates and its
 *     history all survive intact and still answer for their own dates.
 *   - Which trucks, trailers and drivers a policy covers is a dated list of
 *     PolicySubject rows. Taking a truck off a policy closes its row; it never
 *     deletes it, so last year's accident still resolves.
 *   - A claim freezes a CoverageAttribution at the instant it is recorded. That
 *     snapshot is never recomputed, so later policy or fleet changes cannot
 *     rewrite what a claim was attributed to.
 *
 * Four record types, deliberately kept separate rather than collapsed into one
 * "insurance" row: a Policy is the contract, a Coverage is one line of cover
 * inside it with its own limits and dates, a Certificate of Insurance is
 * evidence issued to a third party, and a Claim is an event against cover.
 * They expire, renew, are issued and are argued over on completely different
 * schedules.
 *
 * NOTHING in this module is verified with a real insurer. Nothing is submitted,
 * paid, scanned or reported to anybody. See `src/lib/insurance/extension-points.ts`
 * for where those integrations will attach.
 */

/* -------------------------------------------------------------------------- */
/* Insurer and agent                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Whether anybody has actually checked this insurer or policy with the carrier
 * of record.
 *
 * `unverified` is the only state this build ever produces, and the UI says so
 * in those words. It exists as a field rather than as an assumption so the day
 * a verification adapter is connected there is a place to put its answer, and
 * so no screen can quietly imply a check that never happened.
 */
export type InsurerVerificationState =
  | "unverified"
  | "verification_requested"
  | "verified"
  | "verification_failed";

export interface InsurerVerification {
  state: InsurerVerificationState;
  checkedAt?: IsoDateTime;
  /** Which adapter answered. Absent while nothing is connected. */
  source?: string;
  note?: string;
}

/** The insurance company carrying the risk. */
export interface Insurer {
  id: string;
  name: string;
  /** NAIC company code, when the carrier recorded one. Not validated. */
  naicCode?: string;
  phone?: string;
  email?: string;
  claimsPhone?: string;
  verification: InsurerVerification;
}

/** The broker or agent who placed the policy. A person, not the underwriter. */
export interface InsuranceAgent {
  id: string;
  name: string;
  agencyName?: string;
  phone?: string;
  email?: string;
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a human or an insurer DECLARED about the policy.
 *
 * Deliberately smaller than the state the product shows. "Expiring" and
 * "expired" are facts about a date and today; recording them would mean a row
 * that silently goes stale and two sources of truth for the same question.
 * They are derived instead — see `policyStateAt`.
 */
export type PolicyRecordedStatus = "pending" | "active" | "cancelled" | "superseded";

/**
 * The policy state as read AT A GIVEN INSTANT. Derived from the recorded status
 * and the policy's own dates, never stored.
 */
export type InsurancePolicyStatus =
  | "active"
  | "pending"
  | "expiring"
  | "expired"
  | "cancelled"
  | "superseded";

export type PremiumInterval = "monthly" | "quarterly" | "semiannual" | "annual";

/**
 * One insurance policy, at one version.
 *
 * `policyId` is permanent and belongs to this version alone. `policyChainId`
 * is what survives renewal: every version of the same policy line shares it, so
 * "show me this policy's history" is a query and not a guess. A renewal never
 * edits the previous version — it writes a new row pointing back at it.
 */
export interface InsurancePolicy {
  /** Immutable UUID for THIS version. Never a policy number. */
  policyId: string;
  /** Stable across every renewal and replacement of the same line of cover. */
  policyChainId: string;
  /** 1-based. Version 1 is the original placement. */
  versionNumber: number;
  supersedesPolicyId?: string;
  supersededByPolicyId?: string;

  /** The organization that holds the policy. Visibility starts here. */
  carrierOrganizationId: string;
  /** Snapshot: a renamed organization must not rewrite an old policy. */
  carrierName: string;

  /** The insurer's own number for the policy. Not an Antcolos identifier. */
  policyNumber: string;
  insurer: Insurer;
  agent?: InsuranceAgent;

  recordedStatus: PolicyRecordedStatus;
  effectiveFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  cancelledAt?: IsoDateTime;
  cancellationReason?: string;
  supersededAt?: IsoDateTime;
  /** Why this version replaced the last one: renewal, rewrite, insurer change. */
  replacementReason?: PolicyReplacementReason;

  /**
   * A private policy detail. Never travels to a dispatch organization and never
   * leaves the service layer without `insurance:sensitive:view`.
   */
  premium?: Money;
  premiumInterval?: PremiumInterval;
  /** Also private. Free text an operator wrote for their own team. */
  notes?: string;

  createdAt: IsoDateTime;
  createdByMembershipId: string;
  createdByName: string;
}

export type PolicyReplacementReason =
  | "renewal"
  | "rewrite"
  | "insurer_change"
  | "coverage_change"
  | "correction";

/* -------------------------------------------------------------------------- */
/* What a policy covers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The kinds of thing a policy can be written over.
 *
 * `carrier` means the policy covers the operation as a whole rather than a
 * scheduled unit — which is how general liability and workers' compensation
 * actually work, and why a per-truck-only model would misfile them.
 */
export type PolicySubjectKind = "carrier" | "truck" | "trailer" | "driver";

/**
 * One dated entry on a policy's schedule.
 *
 * Adding a truck opens a row; taking it off closes it with `removedAt`. Rows
 * are never deleted, because the question "was it on the schedule in March?"
 * has to stay answerable in December.
 */
export interface PolicySubject {
  id: string;
  policyId: string;
  subjectKind: PolicySubjectKind;
  /** A permanent entity id: truckId, trailerId, driverProfileId, organizationId. */
  subjectId: string;
  /** Snapshot label, so a renamed or sold unit still reads correctly. */
  subjectLabel: string;
  addedAt: IsoDateTime;
  removedAt?: IsoDateTime;
  removalReason?: string;
  /** The insurer's schedule line reference, when there is one. */
  scheduleReference?: string;
}

export type CoverageType =
  | "auto_liability"
  | "general_liability"
  | "cargo"
  | "physical_damage"
  | "trailer_interchange"
  | "non_trucking_liability"
  | "workers_compensation"
  | "occupational_accident"
  | "reefer_breakdown"
  | "umbrella"
  | "other";

/** Same reasoning as the policy: recorded, not derived from today's date. */
export type CoverageRecordedStatus = "pending" | "active" | "cancelled" | "superseded";

export type CoverageStatus =
  | "active"
  | "pending"
  | "expiring"
  | "expired"
  | "cancelled"
  | "superseded";

/**
 * One line of cover inside a policy.
 *
 * Separate from the policy because limits, deductibles and dates genuinely
 * differ per line: cargo can be endorsed mid-term without touching auto
 * liability, and a reefer breakdown line can lapse while the rest runs on.
 */
export interface InsuranceCoverage {
  coverageId: string;
  policyId: string;
  coverageType: CoverageType;
  limitPerOccurrence: Money;
  /** The most the line pays across the term, when the policy sets one. */
  aggregateLimit?: Money;
  deductible: Money;
  effectiveFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  recordedStatus: CoverageRecordedStatus;
  cancelledAt?: IsoDateTime;
  /**
   * When a renewal replaced this line. Dated for the same reason the policy's
   * is: a line superseded in June still answered for a loss in March.
   */
  supersededAt?: IsoDateTime;
  /** Endorsement or form number as printed. Never parsed. */
  endorsement?: string;
  /**
   * Narrows the line to some of the policy's schedule. Absent means the line
   * answers for every subject the policy covers.
   */
  appliesToSubjectKinds?: PolicySubjectKind[];
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/* Certificate of insurance                                                    */
/* -------------------------------------------------------------------------- */

export type CertificateStatus =
  | "draft"
  | "issued"
  | "expired"
  | "revoked"
  | "superseded";

export type CertificateHolderKind =
  | "broker"
  | "shipper"
  | "facility"
  | "carrier"
  | "dispatch_organization"
  | "other";

/**
 * Evidence of insurance issued TO SOMEBODY ELSE.
 *
 * A certificate is not the policy and is not coverage: it is a document a
 * broker or facility holds, it expires on its own schedule, it can be revoked
 * without the policy changing, and it survives the policy being renewed. That
 * is why it has its own record rather than a flag on the policy.
 *
 * Nothing here is generated, signed, sent or verified by Antcolos.
 */
export interface CertificateOfInsurance {
  certificateId: string;
  /** The policy VERSION the certificate was issued against. Never re-pointed. */
  policyId: string;
  /** Snapshot of the number as printed on the certificate. */
  policyNumberSnapshot: string;
  certificateNumber: string;
  holderName: string;
  holderKind: CertificateHolderKind;
  /** Set when the holder is an organization that exists in Antcolos. */
  holderOrganizationId?: string;
  /** The coverage lines the certificate evidences, snapshotted by id. */
  coverageIds: string[];
  issuedAt: IsoDateTime;
  effectiveFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  status: CertificateStatus;
  revokedAt?: IsoDateTime;
  revocationReason?: string;
  supersededByCertificateId?: string;
  /** Whether the holder is named as an additional insured on the policy. */
  additionalInsured: boolean;
  /** The file, honestly: a name and a size. Nothing is uploaded or read. */
  file?: InsuranceFileSnapshot;
  requestedByOrganizationId?: string;
  requestedByName?: string;
  issuedByAgentName?: string;
  notes?: string;
}

/**
 * What this build actually knows about a file: the browser told us a name, a
 * type and a size. Nothing was uploaded, stored, scanned or verified.
 */
export interface InsuranceFileSnapshot {
  fileName: string;
  fileType?: string;
  sizeBytes?: number;
  capturedAt: IsoDateTime;
  status: DocumentLifecycleStatus;
  /** Set when the file is an existing Document rather than a new upload. */
  documentId?: string;
}

/* -------------------------------------------------------------------------- */
/* Sharing insurance outside the carrier                                       */
/* -------------------------------------------------------------------------- */

export type PolicyShareScope = "coverage_summary" | "certificate_only";

/**
 * An explicit, revocable grant letting another organization see some of a
 * policy.
 *
 * A dispatch organization gets NOTHING by default, not even the existence of a
 * policy on a truck it dispatches. It sees what a carrier has deliberately
 * shared, at the scope the carrier chose, for the reason the carrier wrote
 * down — and never premiums, private notes or claim money.
 */
export interface PolicyShare {
  id: string;
  policyId: string;
  sharedWithOrganizationId: string;
  sharedWithName: string;
  scope: PolicyShareScope;
  /** Why this organization needs it. Required: a share with no reason is a leak. */
  purpose: string;
  sharedAt: IsoDateTime;
  expiresAt?: IsoDateTime;
  revokedAt?: IsoDateTime;
  sharedByMembershipId: string;
  sharedByName: string;
}

/**
 * An explicit grant letting another organization follow ONE claim.
 *
 * Separate from `PolicyShare` on purpose. Seeing that a carrier holds cargo
 * cover and seeing that one of its loads was in a wreck are different
 * disclosures, wanted at different moments and revoked independently. A
 * dispatch organization that needs to answer a broker about a damaged load
 * should not have to be shown the carrier's whole insurance position to do it.
 *
 * A claim share NEVER carries money: costs, reserves and deductibles stay
 * inside the owning carrier whatever is shared.
 */
export interface ClaimShare {
  id: string;
  claimId: string;
  sharedWithOrganizationId: string;
  sharedWithName: string;
  purpose: string;
  sharedAt: IsoDateTime;
  expiresAt?: IsoDateTime;
  revokedAt?: IsoDateTime;
  sharedByMembershipId: string;
  sharedByName: string;
}

/** How much of a record a particular viewer is entitled to. */
export type InsuranceDisclosureLevel = "full" | "shared_summary" | "none";

/* -------------------------------------------------------------------------- */
/* Claims                                                                      */
/* -------------------------------------------------------------------------- */

export type ClaimType =
  | "accident"
  | "cargo_damage"
  | "property_damage"
  | "bodily_injury"
  | "theft"
  | "vandalism"
  | "weather"
  | "equipment_damage"
  | "other";

export type ClaimStatus =
  | "reported"
  | "under_review"
  | "submitted"
  | "investigating"
  | "approved"
  | "denied"
  | "paid"
  | "closed";

export type ClaimResponsibilityKind =
  | "our_driver"
  | "third_party"
  | "shared"
  | "no_fault"
  | "undetermined";

/**
 * Who is answerable for the event.
 *
 * Snapshotted by name as well as by id: a driver who leaves the carrier next
 * month must still be readable on the claim, and ending their relationship must
 * not blank out the attribution.
 */
export interface ClaimResponsibleParty {
  kind: ClaimResponsibilityKind;
  /** The permanent driver profile, when the responsible person is our driver. */
  driverProfileId?: string;
  name?: string;
  /** Why this determination was reached. Not a legal finding. */
  note?: string;
  determinedAt?: IsoDateTime;
  determinedBy?: ActorRef;
}

export type ClaimThirdPartyRole =
  | "other_driver"
  | "other_carrier"
  | "property_owner"
  | "cargo_owner"
  | "witness"
  | "police"
  | "adjuster"
  | "repair_shop"
  | "attorney"
  | "other";

export interface ClaimThirdParty {
  id: string;
  claimId: string;
  role: ClaimThirdPartyRole;
  name: string;
  organization?: string;
  phone?: string;
  email?: string;
  /** Their insurer and policy number as reported to us. Never verified. */
  insurerName?: string;
  policyNumber?: string;
  note?: string;
  recordedAt: IsoDateTime;
}

export type ClaimCostKind =
  | "reserve"
  | "repair"
  | "towing"
  | "cargo_loss"
  | "property_damage"
  | "medical"
  | "legal"
  | "adjuster"
  | "rental"
  | "salvage_credit"
  | "other";

/**
 * One money line on a claim.
 *
 * Append-only like everything else on a claim: a wrong figure is corrected by
 * recording a reversing line, never by editing the original. `paidAt` is what
 * the carrier recorded, not a payment Antcolos made — no money moves here.
 */
export interface ClaimCostEntry {
  id: string;
  claimId: string;
  kind: ClaimCostKind;
  amount: Money;
  incurredAt: IsoDateTime;
  /** Set when the carrier recorded that this line has actually been paid. */
  paidAt?: IsoDateTime;
  /** Who bore it. Drives whether it counts against the deductible. */
  bearer: "carrier" | "insurer" | "third_party" | "driver";
  description: string;
  recordedAt: IsoDateTime;
  recordedBy: ActorRef;
  /** Set when this line reverses an earlier one. The original stays. */
  reversesCostId?: string;
}

/**
 * The money view of a claim. Derived from the cost lines, never stored, and
 * withheld entirely from anyone without claim financial access.
 */
export interface ClaimFinancials {
  /** Everything recorded against the claim, reversals applied. */
  totalIncurred: Money;
  /** The part the carrier has recorded as paid. */
  totalPaid: Money;
  /** Reserve lines still outstanding. */
  outstandingReserve: Money;
  /** The deductible frozen on the claim's coverage attribution. */
  deductible: Money;
  /** Carrier-borne cost up to the deductible. */
  deductibleApplied: Money;
  /** Insurer-borne cost recorded so far. */
  insurerPaid: Money;
  /** Recovered from a third party or salvage. */
  recovered: Money;
}

export type ClaimEvidenceKind =
  | "photo"
  | "police_report"
  | "repair_estimate"
  | "bill_of_lading"
  | "proof_of_delivery"
  | "dashcam"
  | "telematics_export"
  | "witness_statement"
  | "medical_report"
  | "other";

/**
 * A piece of evidence a claim needs.
 *
 * Evidence points at a Document when one already exists — Antcolos does not
 * keep a second copy of a BOL because a claim mentions it. A row with no
 * document and `required: true` is exactly what a Needs You item is made of.
 */
export interface ClaimEvidence {
  id: string;
  claimId: string;
  kind: ClaimEvidenceKind;
  label: string;
  required: boolean;
  /** The existing Document this satisfies. Never a duplicate of one. */
  documentId?: string;
  file?: InsuranceFileSnapshot;
  status: DocumentLifecycleStatus;
  requestedAt?: IsoDateTime;
  receivedAt?: IsoDateTime;
  note?: string;
}

/** Notes are additive and attributed. There is no edit and no delete. */
export interface ClaimNote {
  id: string;
  claimId: string;
  at: IsoDateTime;
  actor: ActorRef;
  body: string;
  /**
   * `internal` never leaves the carrier. `operational` may be shown to a
   * dispatch organization that is entitled to the claim's operational view.
   */
  visibility: "internal" | "operational";
}

export type ClaimEventKind =
  | "reported"
  | "status_changed"
  | "coverage_attributed"
  | "evidence_requested"
  | "evidence_received"
  | "cost_recorded"
  | "cost_reversed"
  | "responsibility_determined"
  | "third_party_added"
  | "note_added"
  | "link_added"
  | "shared_with_organization"
  | "share_revoked"
  | "reopened";

/**
 * The claim timeline. Append-only: entries are never edited or removed, and a
 * mistake is corrected by appending a correcting entry.
 */
export interface ClaimEvent {
  id: string;
  claimId: string;
  at: IsoDateTime;
  kind: ClaimEventKind;
  actor: ActorRef;
  summary: string;
  detail?: string;
  previousValue?: string;
  newValue?: string;
  /** True for entries that name money. Redacted from operational viewers. */
  financial?: boolean;
}

/**
 * Everything the claim is attached to, by permanent id.
 *
 * All optional and all snapshot-labelled, because a claim can arise from a
 * bobtail move with no load, a yard incident with no driver, or a trailer sat
 * on a customer's lot with no truck.
 */
export interface ClaimLinks {
  loadId?: string;
  loadReference?: string;
  driverProfileId?: string;
  driverName?: string;
  truckId?: string;
  truckLabel?: string;
  trailerId?: string;
  trailerLabel?: string;
  /** The operating-authority lease that was live when the event happened. */
  operatingLeaseId?: string;
  /** Existing Documents. Claims never create a second copy of a document. */
  documentIds?: string[];
}

/**
 * What the claim was attributed to, frozen at the moment it was recorded.
 *
 * This is the single most important record in the module. It is written once
 * and never recomputed, so renewing the policy, selling the truck, moving the
 * operating authority or ending the driver's relationship cannot change what a
 * past claim says it was covered by.
 */
export interface CoverageAttribution {
  /** The instant the claim is about — not when it was keyed in. */
  eventAt: IsoDateTime;
  /** When this attribution was computed. Never recomputed after. */
  attributedAt: IsoDateTime;
  /** Absent when no coverage answered for the event. That is a real outcome. */
  policyId?: string;
  policyNumber?: string;
  policyVersionNumber?: number;
  insurerName?: string;
  coverageId?: string;
  coverageType?: CoverageType;
  limitPerOccurrence?: Money;
  deductible?: Money;
  /** The carrier that held the policy at the time, by id and by name. */
  carrierOrganizationId: string;
  carrierName: string;
  subjectKind?: PolicySubjectKind;
  subjectId?: string;
  subjectLabel?: string;
  /** Why coverage did or did not answer, in the operator's language. */
  reason: string;
  outcome: CoverageEvaluationOutcome;
}

/**
 * One claim.
 *
 * `carrierOrganizationId` is the carrier the claim belongs to and is decided
 * when the claim is recorded, from the operating authority in force at the time
 * of the event — never from whoever happens to run the truck today.
 */
export interface InsuranceClaim {
  claimId: string;
  /** The carrier that owns the claim. Frozen at creation. */
  carrierOrganizationId: string;
  carrierName: string;
  /** Human reference, e.g. "CLM-2026-0114". Not an identifier. */
  claimReference: string;
  /** The insurer's own claim number, once they give us one. */
  insurerClaimNumber?: string;

  claimType: ClaimType;
  status: ClaimStatus;
  severity: ClaimSeverity;
  title: string;
  description: string;

  /** When the event happened in the real world. Coverage is read at this time. */
  eventAt: IsoDateTime;
  /** When Antcolos learned of it. Differs for events reported days later. */
  reportedAt: IsoDateTime;
  reportedBy: ActorRef;
  eventLocation?: ClaimLocation;

  attribution: CoverageAttribution;
  links: ClaimLinks;
  responsibleParty: ClaimResponsibleParty;

  closedAt?: IsoDateTime;
  closureReason?: string;
  deniedAt?: IsoDateTime;
  denialReason?: string;

  createdAt: IsoDateTime;
}

export type ClaimSeverity = "minor" | "moderate" | "major" | "catastrophic";

export interface ClaimLocation {
  city?: string;
  state?: string;
  /** Free text: mile marker, facility name, yard. Never geocoded here. */
  description?: string;
}

/* -------------------------------------------------------------------------- */
/* Evaluating coverage for a moment in time                                    */
/* -------------------------------------------------------------------------- */

export type CoverageEvaluationOutcome =
  | "covered"
  | "no_policy"
  | "not_scheduled"
  | "outside_policy_term"
  | "outside_coverage_term"
  | "policy_cancelled"
  | "coverage_type_absent";

/** The question. Always carries the instant it is asked about. */
export interface CoverageEvaluationInput {
  /** The moment the event happened. Never "now" unless the caller means now. */
  at: IsoDateTime;
  carrierOrganizationId: string;
  subjectKind: PolicySubjectKind;
  subjectId: string;
  coverageType: CoverageType;
}

/** The answer, with the reasoning, so a screen never has to re-derive it. */
export interface CoverageEvaluation {
  input: CoverageEvaluationInput;
  outcome: CoverageEvaluationOutcome;
  covered: boolean;
  reason: string;
  policyId?: string;
  policyNumber?: string;
  policyVersionNumber?: number;
  insurerName?: string;
  coverageId?: string;
  limitPerOccurrence?: Money;
  deductible?: Money;
  subjectLabel?: string;
  /** Policies that matched the subject but failed on dates or status. */
  nearMisses: CoverageNearMiss[];
}

export interface CoverageNearMiss {
  policyId: string;
  policyNumber: string;
  outcome: CoverageEvaluationOutcome;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Gaps                                                                        */
/* -------------------------------------------------------------------------- */

export type CoverageGapSeverity = "critical" | "high" | "medium";

/**
 * A unit the carrier is running with no answering coverage right now.
 *
 * Computed against the live fleet and the live policy schedule; it is a
 * statement about today, and never rewrites what was true in the past.
 */
export interface CoverageGap {
  id: string;
  subjectKind: PolicySubjectKind;
  subjectId: string;
  subjectLabel: string;
  coverageType: CoverageType;
  severity: CoverageGapSeverity;
  outcome: CoverageEvaluationOutcome;
  reason: string;
  /** Route to the thing that is uncovered, when a screen for it exists. */
  href?: string;
}

/* -------------------------------------------------------------------------- */
/* Projections — what one viewer sees of one record                            */
/* -------------------------------------------------------------------------- */

/**
 * One organization's view of one policy.
 *
 * A projection, never the policy. A carrier that holds the policy sees all of
 * it; an organization it has been shared with sees a summary with the money and
 * the private notes removed; everybody else does not see it at all and cannot
 * tell it exists.
 */
export interface PolicyView {
  policyId: string;
  policyChainId: string;
  versionNumber: number;
  policyNumber: string;
  insurerName: string;
  insurerVerification: InsurerVerificationState;
  agentName?: string;
  carrierOrganizationId: string;
  carrierName: string;
  status: InsurancePolicyStatus;
  effectiveFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  /** Negative once expired. Whole days. */
  daysUntilExpiry: number;
  coverage: CoverageView[];
  subjectCount: number;
  certificateCount: number;
  /**
   * Absent on a shared view. How much a carrier is claiming is not something a
   * dispatch organization learns by counting, so the field is missing rather
   * than zeroed.
   */
  openClaimCount?: number;
  supersedesPolicyId?: string;
  supersededByPolicyId?: string;
  disclosure: InsuranceDisclosureLevel;
  /** Full disclosure only. Absent for everybody else, not zeroed. */
  premium?: Money;
  premiumInterval?: PremiumInterval;
  notes?: string;
  /** Set on a shared view: why this organization was given it. */
  sharePurpose?: string;
}

export interface CoverageView {
  coverageId: string;
  coverageType: CoverageType;
  status: CoverageStatus;
  limitPerOccurrence: Money;
  aggregateLimit?: Money;
  /** Withheld from shared views: what the carrier pays first is its business. */
  deductible?: Money;
  effectiveFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  endorsement?: string;
  appliesToSubjectKinds?: PolicySubjectKind[];
}

export interface CertificateView {
  certificateId: string;
  certificateNumber: string;
  policyId: string;
  policyNumberSnapshot: string;
  insurerName: string;
  holderName: string;
  holderKind: CertificateHolderKind;
  status: CertificateStatus;
  issuedAt: IsoDateTime;
  effectiveFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  daysUntilExpiry: number;
  additionalInsured: boolean;
  coverageTypes: CoverageType[];
  file?: InsuranceFileSnapshot;
}

/**
 * One organization's view of one claim.
 *
 * `financials` is absent — not zeroed, not redacted to nulls — for anyone
 * without claim financial access, and for every viewer outside the carrier that
 * owns the claim. An absent field cannot be accidentally rendered.
 */
export interface ClaimView {
  claimId: string;
  claimReference: string;
  insurerClaimNumber?: string;
  carrierOrganizationId: string;
  carrierName: string;
  claimType: ClaimType;
  status: ClaimStatus;
  severity: ClaimSeverity;
  title: string;
  description: string;
  eventAt: IsoDateTime;
  reportedAt: IsoDateTime;
  eventLocation?: ClaimLocation;
  links: ClaimLinks;
  /** The frozen attribution, with money stripped for operational viewers. */
  attribution: CoverageAttribution;
  responsibleParty?: ClaimResponsibleParty;
  evidence: ClaimEvidence[];
  missingRequiredEvidence: number;
  thirdParties: ClaimThirdParty[];
  notes: ClaimNote[];
  history: ClaimEvent[];
  disclosure: InsuranceDisclosureLevel;
  /** Present only with full disclosure AND claims:financials:view. */
  financials?: ClaimFinancials;
  costs?: ClaimCostEntry[];
  closedAt?: IsoDateTime;
  closureReason?: string;
  denialReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export interface PolicyStatusCounts {
  active: number;
  pending: number;
  expiring: number;
  expired: number;
  cancelled: number;
  superseded: number;
}

export interface ExpiringPolicySummary {
  policyId: string;
  policyNumber: string;
  insurerName: string;
  coverageTypes: CoverageType[];
  expiresAt: IsoDateTime;
  daysUntilExpiry: number;
  status: InsurancePolicyStatus;
}

export interface ClaimSummaryRow {
  claimId: string;
  claimReference: string;
  title: string;
  claimType: ClaimType;
  status: ClaimStatus;
  severity: ClaimSeverity;
  eventAt: IsoDateTime;
  missingRequiredEvidence: number;
}

/**
 * The organization-scoped Insurance & Claims dashboard.
 *
 * Assembled in the service layer from records the caller may actually see, so
 * a count can never hint at a policy or a claim the viewer is not entitled to.
 */
export interface InsuranceDashboard {
  organizationId: string;
  organizationName: string;
  generatedAt: IsoDateTime;
  /** What this viewer is entitled to, so the screen can say so plainly. */
  disclosure: InsuranceDisclosureLevel;
  policies: PolicyStatusCounts;
  expiringSoon: ExpiringPolicySummary[];
  coverageGaps: CoverageGap[];
  claimsByStatus: Record<ClaimStatus, number>;
  openClaims: ClaimSummaryRow[];
  claimsMissingEvidence: number;
  certificates: { issued: number; expiringSoon: number; expired: number; revoked: number };
  /** Present only with claims:financials:view inside the owning carrier. */
  claimFinancials?: ClaimFinancials;
  /** Insurance items in the Needs You queue this viewer can see. */
  needsAttention: number;
}

/* -------------------------------------------------------------------------- */
/* Policy timeline                                                             */
/* -------------------------------------------------------------------------- */

export type PolicyEventKind =
  | "created"
  | "activated"
  | "subject_added"
  | "subject_removed"
  | "coverage_added"
  | "coverage_changed"
  | "certificate_issued"
  | "certificate_revoked"
  | "shared"
  | "share_revoked"
  | "renewed"
  | "replaced"
  | "superseded"
  | "cancelled";

/** Append-only, exactly like the truck and trailer timelines. */
export interface PolicyEvent {
  id: string;
  policyId: string;
  at: IsoDateTime;
  kind: PolicyEventKind;
  summary: string;
  detail?: string;
  organizationId?: string;
  actorName?: string;
  /** True for entries that name money. Withheld from shared viewers. */
  financial?: boolean;
}

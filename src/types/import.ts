import type { IsoDateTime } from "./common";
import type { ActorRef } from "./user";
import type { MatchConfidence, MatchConflict, MatchSignal } from "./rate-confirmation";
import type { FactSourceKind, FactVerification } from "./propagation";
import type { Provenance } from "./integration";
import type { WorkforceClassification } from "./workforce";

/**
 * ███ IMPORTING A CARRIER THAT ALREADY EXISTS ███
 *
 * A carrier arriving with fifty trucks and fifty drivers is not creating fifty
 * people. Most of them already exist — to their state licensing authority, to
 * their previous carrier, and often to Antcolos. The whole problem of this
 * module is telling "this is Maria Santos, who already has a profile" from
 * "this is a different Maria Santos" from "I cannot tell, ask somebody".
 *
 * ★ THREE THINGS, HELD APART ★
 *
 *   ImportClaim       what the carrier's file SAID. Written once, never
 *                     rewritten. Evidence.
 *   ClaimResolution   which canonical record we think it means. Re-derived
 *                     every time the import is planned, because the registries
 *                     move underneath it. A judgment.
 *   ImportCommit      which canonical record it actually reached. Written by
 *                     the commit, one per claim per run. An outcome.
 *
 * They were one object in the draft this replaces, rewritten in place as a row
 * moved from parsed to matched to decided to committed. That conflation is the
 * defect: it makes "what they told us" unrecoverable once we have concluded
 * something, and it makes a claim carrying a canonical id one field away from
 * being read AS the canonical record. An import candidate must never become a
 * second registry of people, trucks or organizations.
 *
 * ███ NOTHING HERE IS A CANONICAL RECORD ███
 * Delete this whole module and you lose the paperwork of an import in progress
 * and not one person, truck, relationship or document. That is the property
 * that keeps it honest.
 */

/* -------------------------------------------------------------------------- */
/* What a carrier asserts                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A historical claim the carrier makes, before anybody knows who it is about.
 *
 * ★ WHY THIS IS NOT `CanonicalFact<T>` ★
 * `CanonicalFact` requires `entityId` — "the canonical entity UUID the fact is
 * about. Never a display code." An unresolved claim has no entity: that is the
 * entire reason it is unresolved. Supplying one would mean minting an id for
 * somebody who may turn out to be a person we already know, which is the
 * duplicate this module exists to prevent.
 *
 * So the field names are `CanonicalFact`'s deliberately — `value`,
 * `occurredAt`, `receivedAt`, `verification`, `source`, `provenance` all mean
 * exactly what they mean there — and promotion to a `CanonicalFact` once the
 * claim resolves is a WIDENING rather than a translation.
 *
 * ★ AND WHY NOT THE `AssertedFact<T>` THIS REPLACES ★
 * That draft invented `assertedByOrganizationId`, `assertedAt`, `verified:
 * false` and a free-text `basis`. Every one of those already existed and said
 * more: `provenance` carries who and which adapter, `receivedAt` is when we
 * learned it, and `verification` distinguishes "nobody has looked" from "a
 * person looked and accepted it" from "a person looked and changed it" — which
 * a boolean `verified` cannot. A second vocabulary for provenance is how two
 * parts of a product come to disagree about what "unverified" means.
 */
export interface ImportedAssertion<T> {
  value: T;
  /**
   * WHEN IT WAS TRUE IN THE WORLD, as the carrier states it.
   *
   * A driver who started in March 2019 has `occurredAt` in March 2019. This is
   * the field a timeline is ordered by, and it is never today.
   */
  occurredAt: IsoDateTime;
  /**
   * WHEN ANTCOLOS LEARNED IT — the import moment. Never the same field as
   * `occurredAt`, and never shown as though it were.
   *
   * Collapsing the two is how a migrated workforce comes to look as though it
   * was all hired the afternoon somebody uploaded a spreadsheet.
   */
  receivedAt: IsoDateTime;
  /**
   * `pending` for everything this module produces: a person has not looked.
   *
   * Nothing in this build can raise it to `confirmed` — no source here checks
   * an assertion against anything — and the type does not pretend otherwise by
   * offering a `verified` flag somebody could set.
   */
  verification: Extract<FactVerification, "pending" | "confirmed" | "corrected" | "rejected">;
  source: FactSourceKind;
  provenance: Provenance;
  /** Set when a person changed it. The original stays readable, as above. */
  originalValue?: T;
  /** Who changed it, and why. A correction with no reason cannot be reviewed. */
  correction?: { at: IsoDateTime; by: ActorRef; reason: string };
}

/* -------------------------------------------------------------------------- */
/* 1. The claim                                                                */
/* -------------------------------------------------------------------------- */

export type ImportSubjectKind = "person" | "truck";

/** What the carrier's file says about one person. Their words, not ours. */
export interface PersonClaim {
  kind: "person";
  fullName: string;
  email?: string;
  phone?: string;
  cdlNumber?: string;
  cdlState?: string;
  cdlExpiresAt?: string;
  /** The carrier's claim about when this person started with them. */
  startedWithCarrier?: ImportedAssertion<IsoDateTime>;
  positionTitle?: string;
  /**
   * Employee, contractor or owner-operator.
   *
   * ★ NOT GUESSED, EVER ★
   * It decides somebody's paperwork, their pay and their tax treatment, and it
   * is the carrier's to state — exactly as an invitation's engagement type is.
   * A row without it is blocked with that sentence rather than defaulted to
   * "employee", because a default here is a legal assertion nobody made.
   */
  classification?: WorkforceClassification;
  /**
   * Whether the carrier says this person also dispatches, or owns the company.
   *
   * A solo owner who drives is ONE person with one profile and several
   * responsibilities, not one row per hat. See `SOLO_OWNER_NOTE`.
   */
  alsoDispatches?: boolean;
  isOwner?: boolean;
}

/** What the carrier's file says about one truck. */
export interface TruckClaim {
  kind: "truck";
  vin?: string;
  /**
   * DELIBERATELY NOT AN IDENTITY SIGNAL.
   *
   * Carriers reuse unit numbers constantly — "101" is the newest tractor at
   * half the fleets in America, and the same carrier renumbers when it sells.
   * It identifies a truck within ONE carrier's list at ONE moment, which is
   * exactly what a permanent record must not be keyed on. Carried because the
   * carrier will want to see it, and never matched on.
   */
  unitNumber?: string;
  make?: string;
  model?: string;
  year?: number;
  plateNumber?: string;
  plateState?: string;
  /** The carrier's claim about when this truck joined their fleet. */
  joinedFleet?: ImportedAssertion<IsoDateTime>;
  /** The name the carrier gives for who drives it. Matched as a soft signal only. */
  assignedDriverName?: string;
}

export type ClaimSubject = PersonClaim | TruckClaim;

/** A problem with the row itself, found before anybody tries to match it. */
export interface ClaimProblem {
  field: string;
  /** Plain language. "Licence state is not a US state" beats "invalid enum". */
  message: string;
  /** `blocking` rows cannot be committed at all; `warning` rows can. */
  severity: "blocking" | "warning";
}

/**
 * One line of what a carrier gave us. **Immutable once written.**
 *
 * Re-importing the same file produces the same `contentKey` and resolves to
 * this same claim rather than a second one, which is what makes a repeated
 * upload — or a retry after a half-finished commit — add nothing.
 */
export interface ImportClaim {
  id: string;
  /** The organization that asserted it. Attribution, never a grant. */
  organizationId: string;
  batchId: string;
  /** 1-based, as the person sees it in their own file. */
  rowNumber: number;
  subject: ClaimSubject;
  problems: ClaimProblem[];
  /**
   * A stable hash of the row's identifying content.
   *
   * Two uploads of the same file produce the same key for the same row, so the
   * second is recognised rather than re-claimed. It covers the identifying
   * fields only: correcting a phone number should not make a new person.
   */
  contentKey: string;
  receivedAt: IsoDateTime;
  source: FactSourceKind;
  provenance: Provenance;
}

/* -------------------------------------------------------------------------- */
/* 2. The resolution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A canonical record this claim might mean, with why we think so.
 *
 * `entityId` is the id in the module that OWNS the record — a driver profile
 * id from the driver registry, a truck id from the truck registry. This module
 * never mints one.
 */
export interface ClaimCandidate {
  entityId: string;
  entityKind: ImportSubjectKind;
  /** Denormalized so a review screen renders without a second read. */
  label: string;
  detail?: string;
  score: number;
  confidence: MatchConfidence;
  signals: MatchSignal[];
  conflicts: MatchConflict[];
}

export type ClaimOutcome =
  /** One candidate matched on an identifier issued to be unique. Link it. */
  | "matched"
  /** Nothing plausible. A new canonical record is the honest answer. */
  | "new"
  /**
   * Plausible, and not certain. **Stops for a person.**
   *
   * The whole point of the module: a similar name, or a shared family email,
   * is not proof of identity, and guessing creates either a duplicate person
   * or a carrier attached to a stranger's licence.
   */
  | "needs_decision"
  /** The row cannot be committed as it stands. See `ClaimProblem`. */
  | "blocked";

export const CLAIM_OUTCOME_LABEL: Record<ClaimOutcome, string> = {
  matched: "Matches an existing record",
  new: "New to Antcolos",
  needs_decision: "Needs somebody to decide",
  blocked: "Cannot be imported yet",
};

/** What an authorized person decided about a claim that stopped. */
export interface ClaimDecision {
  choice: "link" | "create" | "skip";
  /** Required for `link`. The canonical id they chose. */
  entityId?: string;
  decidedAt: IsoDateTime;
  decidedBy: ActorRef;
  note?: string;
}

/**
 * What we think this claim means, right now.
 *
 * **Re-derived on every plan**, because the registries move underneath it: a
 * person who had no profile on Tuesday may have one on Wednesday, and a
 * ranking stored on the claim would go stale silently. Keyed to the claim
 * rather than stored on it, so re-planning never rewrites the evidence.
 */
export interface ClaimResolution {
  claimId: string;
  outcome: ClaimOutcome;
  candidates: ClaimCandidate[];
  /** Why the outcome is what it is, in the words the reviewer reads. */
  rationale: string;
  plannedAt: IsoDateTime;
  /**
   * A person's decision, which OUTRANKS the ranking above.
   *
   * The commit acts on exactly this when it is present — never on the scores
   * that preceded it, which may have been re-derived since.
   */
  decision?: ClaimDecision;
}

/* -------------------------------------------------------------------------- */
/* 3. The commit                                                               */
/* -------------------------------------------------------------------------- */

export type CommitOutcome =
  /** A canonical record was created by its owning module. */
  | "created"
  /** An existing canonical record was linked. Nothing was created. */
  | "linked"
  /** Already done by an earlier run. Nothing happened. */
  | "already_done"
  /** Not attempted: the claim is unresolved or blocked. */
  | "skipped"
  /** Attempted and refused. Kept, with the reason, and retryable. */
  | "failed";

export interface ImportCommitResult {
  claimId: string;
  outcome: CommitOutcome;
  /** The canonical record reached, when one was. Owned by another module. */
  entity?: { kind: ImportSubjectKind; id: string; label: string };
  detail: string;
  /** Set on `failed`. Plain language, never a stack trace. */
  failureReason?: string;
}

/**
 * ★ "COMPLETE" MEANS EVERY ROW LANDED ★
 *
 * A run that wrote forty-eight of fifty and left two waiting on a person is
 * `incomplete`, and stays that way until somebody finishes it. Calling it
 * complete because the loop reached the end is how fifty trucks are reported
 * operational in ten minutes when two of them are nobody's yet.
 */
export type ImportRunState =
  | "planning" | "planned" | "committing"
  /** Every claim reached a canonical record, or a person deliberately skipped it. */
  | "complete"
  /** Rows are still waiting: a failure to retry, or a decision nobody has made. */
  | "incomplete";

/**
 * One attempt to bring a batch of claims into the canonical registries.
 *
 * The same shape as an acceptance run, for the same reason: several modules
 * are asked for several things one at a time, there is no transaction across
 * them, and the person must be able to come back and finish. Keyed by batch,
 * resumable, and idempotent per claim.
 */
export interface ImportRun {
  id: string;
  batchId: string;
  organizationId: string;
  state: ImportRunState;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  results: ImportCommitResult[];
}

export interface ImportBatch {
  id: string;
  organizationId: string;
  label: string;
  kind: ImportSubjectKind;
  createdAt: IsoDateTime;
  createdBy: ActorRef;
  /** Same file twice is the same batch. See `ImportClaim.contentKey`. */
  contentKey: string;
}

/* -------------------------------------------------------------------------- */
/* What this build does not do                                                 */
/* -------------------------------------------------------------------------- */

export const IMPORT_LIMITATION =
  "Every record is created through the module that owns it, one at a time. "
  + "There is no transaction across them: a claim that failed left the ones "
  + "before it in place, and importing again finishes what is missing rather "
  + "than repeating what is done. Nothing here is persisted beyond this browser "
  + "tab, no document is stored or verified, and no compliance decision is made "
  + "or implied by importing a row.";

export const IMPORT_ASSERTION_BASIS =
  "Imported from a file this carrier supplied. Antcolos has not checked it "
  + "against anything, and it stays labelled as their claim.";

export const SOLO_OWNER_NOTE =
  "An owner who also drives and dispatches is one person: one account, one "
  + "driver profile, one seat carrying every permission those jobs need. "
  + "Importing them once is correct — a second row for the same person is the "
  + "same person, and is matched, not created.";

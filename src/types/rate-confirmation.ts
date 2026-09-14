import type { Address, IsoDateTime } from "./common";
import type { ActorRef } from "./user";
import type {
  Facility, Party, PartyContact, PartyRole, PartySnapshot,
} from "./party";

/**
 * What a reviewed rate confirmation hands the directory.
 *
 * This module deliberately starts *after* OCR. Extraction, confidence scoring
 * and the dispatcher's field-by-field correction of the document are the rate
 * confirmation workflow's job and are not built here. What is built here is the
 * thing that workflow will call once a human has said "yes, this is what the
 * document says": take these companies, places and people, and work out which
 * permanent records they are.
 *
 * So every value below is already reviewed. That is why there is no per-field
 * OCR confidence on it — a reviewed field is a reviewed field. The uncertainty
 * this module reasons about is a different one: not "did we read it right" but
 * "is this the same company we hauled for in March".
 */

export interface ExtractedParty {
  /** As printed. Never pre-normalized — normalization belongs to matching. */
  name: string;
  dbaName?: string;
  mcNumber?: string;
  dotNumber?: string;
  address?: Address;
  phone?: string;
  email?: string;
}

export interface ExtractedFacility {
  name?: string;
  address: Address;
  hoursText?: string;
  appointmentRequired?: boolean;
  instructions?: string;
}

export interface ExtractedContact {
  fullName: string;
  title?: string;
  phone?: string;
  phoneExtension?: string;
  email?: string;
}

/** One company on the document, in the role it plays on this load. */
export interface ExtractedPartyBlock {
  role: PartyRole;
  party: ExtractedParty;
  /** Absent for a broker, which has an office rather than a dock. */
  facility?: ExtractedFacility;
  contacts: ExtractedContact[];
}

export interface RateConfirmationExtraction {
  /** The document this came off. Preserved on every record it produces. */
  documentId: string;
  /** The broker's own load number, as printed. */
  customerReference?: string;
  /** The load this rate confirmation is for, once one exists. */
  loadId?: string;
  /** Exactly one broker block, plus the shipper and receiver blocks. */
  blocks: ExtractedPartyBlock[];
  /** Who reviewed the extraction, and when. Never the machine. */
  reviewedBy: ActorRef;
  reviewedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How sure the matcher is, in four steps rather than a raw score, because the
 * decision it feeds is itself four-valued.
 *
 *   exact       An identifier the outside world issues matched. For a broker
 *               that means the MC number, which is the only broker signal
 *               strong enough to stand alone.
 *   strong      Several independent soft signals agreed — name and address, or
 *               name and phone. Convincing, still a guess.
 *   possible    One soft signal agreed. Worth showing a dispatcher, never worth
 *               acting on.
 *   none        Nothing agreed.
 *
 * Note what is missing: there is no tier that means "confident enough to merge
 * without asking". Every tier above `none` produces a proposal a dispatcher
 * confirms, which is why the enum stops here.
 */
export type MatchConfidence = "exact" | "strong" | "possible" | "none";

/** A signal that fired, and what it was worth. Rendered to explain a match. */
export interface MatchSignal {
  /** mc_number, dot_number, normalized_name, address, phone, email_domain… */
  code: string;
  /** Plain language, for the dispatcher: "MC number 1142908 matches exactly". */
  label: string;
  weight: number;
  /** True when this signal alone is decisive, e.g. a broker's MC number. */
  decisive?: boolean;
}

/** A signal that actively argues against a match, e.g. a different MC number. */
export interface MatchConflict {
  code: string;
  label: string;
}

export interface PartyMatchCandidate {
  partyId: string;
  /** Denormalized so a proposal renders without a second read. */
  legalName: string;
  mcNumber?: string;
  city?: string;
  state?: string;
  status: Party["status"];
  score: number;
  confidence: MatchConfidence;
  signals: MatchSignal[];
  conflicts: MatchConflict[];
  /** This carrier's own load count with them, for the dispatcher's judgement. */
  loadCount: number;
  lastLoadAt?: IsoDateTime;
}

export interface FacilityMatchCandidate {
  facilityId: string;
  name: string;
  city?: string;
  state?: string;
  score: number;
  confidence: MatchConfidence;
  signals: MatchSignal[];
  conflicts: MatchConflict[];
}

export interface ContactMatchCandidate {
  contactId: string;
  fullName: string;
  email?: string;
  phone?: string;
  score: number;
  confidence: MatchConfidence;
  signals: MatchSignal[];
  conflicts: MatchConflict[];
}

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the resolver recommends. A recommendation is not an action: nothing in
 * this module applies one without a dispatcher's confirmation, and the commit
 * path takes the dispatcher's decision rather than this field.
 *
 *   link_existing       One candidate is convincing. Proposed for confirmation.
 *   choose_between      Several plausible candidates. The dispatcher picks.
 *   create_new          Nothing resembled it. Proposed as a clean new profile.
 *   create_provisional  Something resembled it but not convincingly, or the
 *                       document is too thin to create a solid record. Made,
 *                       but flagged, so it never quietly becomes canon.
 */
export type ResolutionRecommendation =
  | "link_existing"
  | "choose_between"
  | "create_new"
  | "create_provisional";

/** One company on the document, and what the resolver thinks it is. */
export interface PartyResolutionProposal {
  role: PartyRole;
  extracted: ExtractedPartyBlock;
  candidates: PartyMatchCandidate[];
  recommendation: ResolutionRecommendation;
  /** The candidate being proposed, when one is. */
  recommendedPartyId?: string;
  /** Why, in the words a dispatcher needs to agree or disagree. */
  rationale: string;
  /** Why this would be provisional rather than active, when it would be. */
  reviewReason?: string;
  /**
   * Always true. It is a field rather than an assumption so that a caller
   * reading the proposal cannot miss it, and so a future automatic path has to
   * change this type — visibly — rather than quietly skip a step.
   */
  requiresDispatcherConfirmation: true;
  /** Facility and contact resolution, scoped to the chosen party. */
  facility?: {
    extracted: ExtractedFacility;
    candidates: FacilityMatchCandidate[];
    recommendation: ResolutionRecommendation;
    recommendedFacilityId?: string;
    rationale: string;
  };
  contacts: {
    extracted: ExtractedContact;
    candidates: ContactMatchCandidate[];
    recommendation: ResolutionRecommendation;
    recommendedContactId?: string;
    rationale: string;
  }[];
}

/** The whole document's worth of proposals. */
export interface ResolutionPlan {
  planId: string;
  documentId: string;
  loadId?: string;
  customerReference?: string;
  proposals: PartyResolutionProposal[];
  plannedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Confirmation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the dispatcher decided for one block. `link` carries the party they
 * confirmed; `create` means they accepted a new profile. There is no "auto"
 * value, because the caller cannot express one.
 */
export type ResolutionChoice = "link" | "create";

export interface PartyResolutionDecision {
  role: PartyRole;
  choice: ResolutionChoice;
  /** Required when choice is "link". Ignored otherwise. */
  partyId?: string;
  /** For "link", the facility within that party, or a new one when absent. */
  facilityId?: string;
  contactIds?: string[];
  /**
   * Set by the dispatcher when they accept a match but want it flagged anyway.
   * Creation of an uncertain profile sets it automatically.
   */
  markProvisional?: boolean;
  /** Whether the fields on the document should update the existing profile. */
  applyExtractedUpdates?: boolean;
}

export interface ConfirmedResolution {
  planId: string;
  documentId: string;
  loadId?: string;
  decisions: PartyResolutionDecision[];
  confirmedBy: ActorRef;
  confirmedAt: IsoDateTime;
}

/** What one confirmed block actually did. Returned so the UI can report it. */
export interface ResolutionOutcome {
  role: PartyRole;
  partyId: string;
  /** True when this run created the party rather than linking an existing one. */
  createdParty: boolean;
  partyStatus: Party["status"];
  facilityId?: string;
  createdFacility: boolean;
  contactIds: string[];
  createdContactIds: string[];
  /** The immutable link written for this load, when the plan carried one. */
  loadLinkId?: string;
  snapshot: PartySnapshot;
  /** What a dispatcher should be told happened, in one line. */
  summary: string;
}

export interface CommitResult {
  documentId: string;
  loadId?: string;
  outcomes: ResolutionOutcome[];
  /** Records left flagged for a human. Surfaced rather than buried. */
  needsReview: {
    partyId?: string;
    facilityId?: string;
    contactId?: string;
    reason: string;
  }[];
}

/** Convenience shapes the resolver returns for rendering a proposal. */
export type ResolvedParty = Party;
export type ResolvedFacility = Facility;
export type ResolvedContact = PartyContact;

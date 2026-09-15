import type {
  AgreementType, Contract, ContractParty, ContractRequirement, ContractSignature,
  ContractTerms, ContractVersion, IsoDateTime, Money,
} from "@/types";

/**
 * ███ NOTHING HERE IS CONNECTED ███
 *
 * The typed seams later Contracts milestones attach to. Every adapter is
 * declared, none is implemented, and the only implementations shipped throw.
 *
 * Declaring them is the opposite of speculation. Each one marks a place this
 * foundation would otherwise be tempted to fake an answer — a signature that
 * looks legally binding because a status was set, a contract that looks
 * reviewed because a checkbox was ticked, a payment that looks made because a
 * date was filled in. With the seam present and visibly throwing, the honest
 * state is the only state the product can reach.
 *
 * The rule for whoever implements one: the adapter returns what the outside
 * system actually said, and the service layer records it as an event. No adapter
 * writes into the contract registry, and no adapter may mark a version signed —
 * that is a party's act, recorded against a party.
 */

export type ContractIntegrationKind =
  | "templates"
  | "negotiation"
  | "legal_review"
  | "e_signature"
  | "insurance_verification"
  | "payments";

export class ContractIntegrationNotConnectedError extends Error {
  constructor(
    readonly integration: ContractIntegrationKind,
    readonly operation: string,
  ) {
    super(
      `${integration}.${operation} is not connected. Antcolos has no live link to this system, and this build never pretends otherwise.`,
    );
    this.name = "ContractIntegrationNotConnectedError";
  }
}

const unavailable =
  (integration: ContractIntegrationKind, operation: string) => (): never => {
    throw new ContractIntegrationNotConnectedError(integration, operation);
  };

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface ContractTemplateSummary {
  templateId: string;
  name: string;
  agreementType: AgreementType;
  /** Where the wording came from. Never "Antcolos" — this is not our wording. */
  provider: string;
  jurisdiction?: string;
  updatedAt: IsoDateTime;
}

/**
 * A library of pre-written agreements.
 *
 * `render` returns TERMS, not a signed document, and `fields` says what it still
 * needs from a person. A template that returned finished terms would be a
 * template that had made legal choices on the user's behalf.
 */
export interface ContractTemplateAdapter {
  list(agreementType: AgreementType): Promise<ContractTemplateSummary[]>;
  render(input: {
    templateId: string;
    values: Record<string, string>;
  }): Promise<{ terms: ContractTerms; unresolvedFields: string[] }>;
  /** What the template needs before it can be rendered. */
  fields(templateId: string): Promise<Array<{ key: string; label: string; required: boolean }>>;
}

/* -------------------------------------------------------------------------- */
/* Negotiation                                                                 */
/* -------------------------------------------------------------------------- */

export type NegotiationRoundOutcome = "open" | "accepted" | "rejected" | "countered";

export interface ContractNegotiationRound {
  roundId: string;
  contractId: string;
  contractVersionId: string;
  byPartyId: string;
  proposedTerms: ContractTerms;
  message?: string;
  outcome: NegotiationRoundOutcome;
  at: IsoDateTime;
}

/**
 * Going back and forth on terms before anybody signs.
 *
 * Out of scope for this foundation, and the seam says why it must stay a seam: a
 * counter-proposal is a set of terms one party has NOT agreed to, and storing
 * one on the contract as though it were the terms is how a party ends up bound
 * to wording it rejected. When this is built, each round produces its own draft
 * version.
 */
export interface ContractNegotiationAdapter {
  rounds(contractId: string): Promise<ContractNegotiationRound[]>;
  propose(input: {
    contractId: string;
    contractVersionId: string;
    byPartyId: string;
    terms: ContractTerms;
    message?: string;
  }): Promise<ContractNegotiationRound>;
  respond(input: {
    roundId: string;
    outcome: Exclude<NegotiationRoundOutcome, "open">;
    message?: string;
  }): Promise<ContractNegotiationRound>;
}

/* -------------------------------------------------------------------------- */
/* Legal review                                                                */
/* -------------------------------------------------------------------------- */

export interface LegalReviewRequest {
  reviewId: string;
  contractId: string;
  contractVersionId: string;
  requestedAt: IsoDateTime;
  /** Who is reviewing. A named firm or reviewer, never "Antcolos". */
  reviewer: string;
}

export interface LegalReviewOutcome {
  reviewId: string;
  /** What the reviewer said. Recorded verbatim, never summarised by us. */
  notes: string;
  /** The reviewer's own classification. Antcolos does not compute this. */
  verdict: "approved" | "changes_requested" | "declined";
  at: IsoDateTime;
}

/**
 * Having a lawyer look at it.
 *
 * The highest-consequence seam in the file. Antcolos gives no legal advice,
 * makes no legal judgement and has had nothing here reviewed by anybody. The
 * `pending_review` contract status means "somebody on your team is reading it",
 * and the review screen says exactly that. An unconnected adapter that quietly
 * returned "approved" would let a carrier believe an agreement had been cleared
 * by a lawyer.
 */
export interface LegalReviewAdapter {
  request(input: { contractId: string; contractVersionId: string }): Promise<LegalReviewRequest>;
  outcome(reviewId: string): Promise<LegalReviewOutcome>;
}

/* -------------------------------------------------------------------------- */
/* E-signature                                                                 */
/* -------------------------------------------------------------------------- */

export interface ESignatureEnvelope {
  envelopeId: string;
  contractVersionId: string;
  /** What the provider says, not what we hope. */
  state: "not_sent" | "sent" | "delivered" | "completed" | "declined" | "voided";
  recipients: Array<{ partyId: string; email: string; state: string }>;
  sentAt?: IsoDateTime;
  completedAt?: IsoDateTime;
}

export interface ESignatureCertificate {
  envelopeId: string;
  /** The provider's own audit certificate. Antcolos never generates one. */
  certificateReference: string;
  /** What the provider actually verified about each signer. */
  verifiedIdentities: Array<{ partyId: string; method: string; verifiedAt: IsoDateTime }>;
}

/**
 * Real signatures, from a real provider.
 *
 * Until this is connected, every signature in Antcolos is a typed name with
 * `mock: true` on it and a statement saying so. No identity has been verified,
 * no certificate exists, nothing has been delivered to anybody and nothing here
 * is legally binding.
 *
 * Note what is missing: there is no `markSigned`. Only a party signs, and only
 * the provider can say that a party did.
 */
export interface ESignatureAdapter {
  send(input: {
    contract: Contract;
    version: ContractVersion;
    parties: ContractParty[];
  }): Promise<ESignatureEnvelope>;
  status(envelopeId: string): Promise<ESignatureEnvelope>;
  void(envelopeId: string, reason: string): Promise<ESignatureEnvelope>;
  /** The provider's audit trail for a completed envelope. */
  certificate(envelopeId: string): Promise<ESignatureCertificate>;
  /** What the provider recorded, so it can be stored beside the mock record. */
  signatures(envelopeId: string): Promise<ContractSignature[]>;
}

/* -------------------------------------------------------------------------- */
/* Insurance verification                                                      */
/* -------------------------------------------------------------------------- */

export interface ContractInsuranceCheck {
  requirementId: string;
  /** Whether the coverage the agreement asks for is in force. */
  satisfied: boolean;
  /** What was checked, and against whom. */
  detail: string;
  expiresAt?: IsoDateTime;
  checkedAt: IsoDateTime;
}

/**
 * Confirming that the insurance an agreement requires actually exists.
 *
 * Today an insurance requirement is satisfied by a certificate somebody typed
 * into the insurance module, and the requirement says so. This seam is where
 * "the insurer confirms it" would come from — which is a different claim, and
 * has to look different on screen.
 */
export interface ContractInsuranceAdapter {
  verify(input: {
    requirement: ContractRequirement;
    partyOrganizationId?: string;
  }): Promise<ContractInsuranceCheck>;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export interface ContractPaymentInstruction {
  instructionId: string;
  contractId: string;
  amount: Money;
  /** What the money is for, per the agreement. */
  reason: string;
  scheduledFor: IsoDateTime;
}

/**
 * Money actually moving under an agreement.
 *
 * Firmly out of scope, twice over: Antcolos processes no payments, and a
 * contract does not enforce one. Settlements record what is owed and what
 * somebody says was paid; this seam is where a real transfer would be
 * instructed, if there were ever one. Nothing here schedules, holds, releases or
 * enforces a payment.
 */
export interface ContractPaymentsAdapter {
  instruct(input: {
    contractId: string;
    amount: Money;
    reason: string;
  }): Promise<ContractPaymentInstruction>;
  status(instructionId: string): Promise<{ state: string; at: IsoDateTime }>;
}

/* -------------------------------------------------------------------------- */
/* The registry the UI reads                                                   */
/* -------------------------------------------------------------------------- */

export const notConnectedTemplates: ContractTemplateAdapter = {
  list: unavailable("templates", "list"),
  render: unavailable("templates", "render"),
  fields: unavailable("templates", "fields"),
};

export const notConnectedNegotiation: ContractNegotiationAdapter = {
  rounds: unavailable("negotiation", "rounds"),
  propose: unavailable("negotiation", "propose"),
  respond: unavailable("negotiation", "respond"),
};

export const notConnectedLegalReview: LegalReviewAdapter = {
  request: unavailable("legal_review", "request"),
  outcome: unavailable("legal_review", "outcome"),
};

export const notConnectedESignature: ESignatureAdapter = {
  send: unavailable("e_signature", "send"),
  status: unavailable("e_signature", "status"),
  void: unavailable("e_signature", "void"),
  certificate: unavailable("e_signature", "certificate"),
  signatures: unavailable("e_signature", "signatures"),
};

export const notConnectedContractInsurance: ContractInsuranceAdapter = {
  verify: unavailable("insurance_verification", "verify"),
};

export const notConnectedContractPayments: ContractPaymentsAdapter = {
  instruct: unavailable("payments", "instruct"),
  status: unavailable("payments", "status"),
};

export interface ContractAdapters {
  templates: ContractTemplateAdapter;
  negotiation: ContractNegotiationAdapter;
  legalReview: LegalReviewAdapter;
  eSignature: ESignatureAdapter;
  insurance: ContractInsuranceAdapter;
  payments: ContractPaymentsAdapter;
}

/** The only wiring that exists. Replacing an entry is how one gets connected. */
export const contractAdapters: ContractAdapters = {
  templates: notConnectedTemplates,
  negotiation: notConnectedNegotiation,
  legalReview: notConnectedLegalReview,
  eSignature: notConnectedESignature,
  insurance: notConnectedContractInsurance,
  payments: notConnectedContractPayments,
};

/**
 * What the Contracts screens tell the operator about each seam.
 *
 * Read by the dashboard, so the honest "not connected" message is data rather
 * than a sentence typed into a component that somebody later forgets to change.
 */
export interface ContractIntegrationStatus {
  kind: ContractIntegrationKind;
  label: string;
  /** What it will do, once something is behind it. */
  description: string;
  connected: false;
  /** What Antcolos does instead, today. */
  today: string;
}

export const CONTRACT_INTEGRATIONS: readonly ContractIntegrationStatus[] = [
  {
    kind: "templates", label: "Agreement templates", connected: false,
    description: "Start from a pre-written agreement for the relationship you are papering.",
    today: "Every agreement is written by your team, in your own words. Antcolos supplies no wording.",
  },
  {
    kind: "negotiation", label: "Negotiation", connected: false,
    description: "Exchange counter-proposals with the other party before anybody signs.",
    today: "Terms are agreed however you already agree them. Each change you record here is a new draft version.",
  },
  {
    kind: "legal_review", label: "Legal review", connected: false,
    description: "Send an agreement to a lawyer and record what they said.",
    today: "\"Pending review\" means somebody on your team is reading it. No lawyer has seen anything, and Antcolos gives no legal advice.",
  },
  {
    kind: "e_signature", label: "E-signature", connected: false,
    description: "Collect legally binding signatures through a signature provider.",
    today: "Signatures here are typed names recorded against a version. No identity is verified, nothing is delivered to anybody, and none of it is legally binding.",
  },
  {
    kind: "insurance_verification", label: "Insurance verification", connected: false,
    description: "Confirm with the insurer that the coverage an agreement requires is in force.",
    today: "An insurance requirement is satisfied by a certificate somebody recorded in the insurance module. No insurer has confirmed it.",
  },
  {
    kind: "payments", label: "Payments", connected: false,
    description: "Instruct a payment under the agreement and follow what happens to it.",
    today: "No money moves through Antcolos. Compensation here is terms; what was actually paid lives in Settlements, from what your team recorded.",
  },
] as const;

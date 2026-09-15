import type {
  AgreementType, CompensationRule, Contract, ContractCapabilities,
  ContractEvent, ContractFilters, ContractLinkRef, ContractPartyRole,
  ContractRequirement, ContractSortKey, ContractSummary, ContractTermination,
  ContractTerms, ContractVersion, ContractView, ContractsDashboard,
  IsoDateTime, Page, PageRequest, RelationshipRefKind,
  RelationshipTransitionRequest, RequiredDocumentTerm, Responsibility,
  SignerAuthority, TerminationGround, TerminationStepKey,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * The Contracts & Relationships seam.
 *
 * Named `AgreementsService` rather than `ContractsService` because in this
 * repository "contract" already means "the typed service interface the backend
 * implements" — this folder. One word, two meanings, and the confusing one is
 * avoided at the call site rather than in a comment.
 *
 * What is NOT here is the design. There is no method that creates a membership,
 * accepts an invitation, starts or ends a driver relationship, approves an asset
 * relationship, grants dispatch access or touches an Operating Authority lease.
 * Those belong to the services that own them, and the only thing this seam can
 * do about them is `requestRelationshipTransition`, which records that a change
 * was asked for and applies nothing.
 *
 * Every method takes a `ServiceContext`: a call is always made as a membership,
 * inside an organization. There is no cross-organization read — the counterparty
 * sees its own record of the same agreement in its own workspace.
 */
export interface AgreementsService {
  /* ---- Reading ---------------------------------------------------------- */

  dashboard(ctx: ServiceContext): Promise<ContractsDashboard>;

  list(
    ctx: ServiceContext,
    filters?: ContractFilters,
    sort?: ContractSortKey,
    page?: PageRequest,
  ): Promise<Page<ContractSummary>>;

  get(ctx: ServiceContext, contractId: string): Promise<ContractView>;

  /**
   * One version, exactly as it stands.
   *
   * Signed versions are frozen, so this is the method that answers "what were we
   * operating under in March": read the version that was in force then, not the
   * contract as it is now.
   */
  getVersion(
    ctx: ServiceContext,
    contractId: string,
    contractVersionId: string,
  ): Promise<ContractVersion>;

  /** The compensation rules in force on a date. Needs `contracts:financials:view`. */
  compensationAt(
    ctx: ServiceContext,
    contractId: string,
    at: IsoDateTime,
  ): Promise<{ contractVersionId: string; versionNumber: number; rules: CompensationRule[] }>;

  timeline(ctx: ServiceContext, contractId: string): Promise<ContractEvent[]>;

  /* ---- Drafting -------------------------------------------------------- */

  create(ctx: ServiceContext, input: CreateContractInput): Promise<ContractView>;

  /** Edits the draft version in place. Refuses on anything frozen. */
  updateDraftTerms(
    ctx: ServiceContext,
    contractId: string,
    terms: Partial<ContractTerms>,
  ): Promise<ContractView>;

  sendForReview(ctx: ServiceContext, contractId: string, note?: string): Promise<ContractView>;

  returnFromReview(ctx: ServiceContext, contractId: string, note: string): Promise<ContractView>;

  /** Locks the draft's terms and opens it for signature. */
  issueForSignature(ctx: ServiceContext, contractId: string): Promise<ContractView>;

  cancel(ctx: ServiceContext, contractId: string, reason: string): Promise<ContractView>;

  /* ---- Signers and signatures ------------------------------------------ */

  /**
   * Says who may sign for a party.
   *
   * Needs `contracts:signers:manage`, and can only authorise a signer for a
   * party of the caller's OWN organization. Nobody authorises the other side's
   * signatories.
   */
  authorizeSigner(ctx: ServiceContext, input: AuthorizeSignerInput): Promise<ContractView>;

  revokeSigner(
    ctx: ServiceContext,
    contractId: string,
    signerId: string,
    reason: string,
  ): Promise<ContractView>;

  /**
   * Records a signature.
   *
   * Two gates, both enforced: `contracts:sign`, and live signer authority for
   * that specific party. A signature is a mock typed name with `mock: true` and
   * a statement saying so — nothing is verified, delivered or legally binding.
   *
   * The last signature fully signs the version, freezes it, and takes the
   * contract active if nothing blocks it. It raises transition REQUESTS for the
   * relationships the contract references and changes none of them.
   */
  sign(ctx: ServiceContext, input: SignContractInput): Promise<ContractView>;

  /* ---- Amendments and replacement -------------------------------------- */

  /**
   * Creates a new draft version from a signed one.
   *
   * The signed version, its terms, its signatures and its history are untouched
   * and stay readable forever. Which term groups changed is computed from the
   * terms, not taken from the caller.
   */
  amend(ctx: ServiceContext, input: AmendContractInput): Promise<ContractView>;

  /** Records that a renewal is being taken up, as a new version. */
  renew(ctx: ServiceContext, contractId: string, terms?: Partial<ContractTerms>): Promise<ContractView>;

  /* ---- Termination ----------------------------------------------------- */

  /**
   * Gives notice that the agreement is ending.
   *
   * Creates a termination record with the closeout checklist the terms asked
   * for, and raises transition requests so somebody revokes access in the
   * services that control it. It revokes nothing itself, and deletes nothing at
   * all — not the user, the organization, the equipment record, this contract's
   * history, documents, completed loads, invoices or settlements.
   */
  giveTerminationNotice(
    ctx: ServiceContext,
    input: TerminationNoticeInput,
  ): Promise<ContractView>;

  confirmTerminationStep(
    ctx: ServiceContext,
    contractId: string,
    step: TerminationStepKey,
    note?: string,
  ): Promise<ContractView>;

  withdrawTermination(
    ctx: ServiceContext,
    contractId: string,
    reason: string,
  ): Promise<ContractView>;

  /* ---- Requirements ---------------------------------------------------- */

  /** Requirements as they stand, evaluated against the owning modules. */
  requirements(ctx: ServiceContext, contractId: string): Promise<ContractRequirement[]>;

  waiveRequirement(
    ctx: ServiceContext,
    contractId: string,
    requirementId: string,
    reason: string,
  ): Promise<ContractView>;

  /* ---- References ------------------------------------------------------ */

  /**
   * Points the contract at a canonical relationship.
   *
   * Refused when the agreement type may not reference that kind. Attaching a
   * reference reads the record and changes nothing about it.
   */
  linkRelationship(ctx: ServiceContext, input: LinkRelationshipInput): Promise<ContractView>;

  /** Detaches the reference. The canonical record is untouched. */
  detachRelationship(
    ctx: ServiceContext,
    contractId: string,
    relationshipRefId: string,
    reason: string,
  ): Promise<ContractView>;

  /** Links a document, load, invoice, settlement or other record. */
  linkRecord(
    ctx: ServiceContext,
    contractId: string,
    ref: ContractLinkRef,
    note?: string,
  ): Promise<ContractView>;

  /**
   * Records that the contract has ASKED a canonical service for a change.
   *
   * The whole method, in one sentence: it writes a note. `applied` on the result
   * is the literal `false`, and there is no method anywhere on this seam that
   * could make it true.
   */
  requestRelationshipTransition(
    ctx: ServiceContext,
    input: RequestTransitionInput,
  ): Promise<RelationshipTransitionRequest>;

  /** Every outstanding request this organization's contracts have raised. */
  transitionRequests(ctx: ServiceContext): Promise<RelationshipTransitionRequest[]>;

  /* ---- Capabilities ---------------------------------------------------- */

  /**
   * What this caller may do to this contract.
   *
   * Sent so the UI need not guess, and recomputed on the server for every write
   * regardless of what the UI believed.
   */
  capabilities(ctx: ServiceContext, contractId: string): Promise<ContractCapabilities>;
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateContractInput {
  agreementType: AgreementType;
  title: string;
  /** The other side. The owning party is always the caller's organization. */
  counterparty: {
    role: ContractPartyRole;
    legalName: string;
    organizationRef?: string;
    driverProfileRef?: string;
    membershipRef?: string;
    externalIdentifier?: string;
  };
  /** Starting terms. Anything omitted gets the catalog's default for the type. */
  terms?: Partial<ContractTerms>;
  /** Relationships to reference straight away. Each is checked against the type. */
  relationships?: Array<Omit<LinkRelationshipInput, "contractId">>;
}

export interface AuthorizeSignerInput {
  contractId: string;
  partyId: string;
  /** The membership that will sign. Authority is per membership, never per user. */
  membershipId: string;
  name: string;
  title?: string;
  authority: SignerAuthority;
}

export interface SignContractInput {
  contractId: string;
  contractVersionId: string;
  partyId: string;
  /** What the signer typed. Stored verbatim. */
  typedName: string;
}

export interface AmendContractInput {
  contractId: string;
  /** Why the terms are changing. Required — an amendment with no reason is an edit. */
  changeReason: string;
  /** A whole statement of the new terms, started from a clone of the signed ones. */
  terms: Partial<ContractTerms>;
  /** `replacement` restates the agreement; `amendment` changes part of it. */
  kind?: "amendment" | "replacement";
}

export interface TerminationNoticeInput {
  contractId: string;
  ground: TerminationGround;
  reason: string;
  /** Overrides the date the notice period computes, when the parties agreed one. */
  effectiveAt?: IsoDateTime;
}

export interface LinkRelationshipInput {
  contractId: string;
  kind: RelationshipRefKind;
  /** The canonical record's own id. */
  externalId: string;
  label: string;
  href?: string;
  partyId?: string;
}

export interface RequestTransitionInput {
  contractId: string;
  contractVersionId?: string;
  kind: RelationshipTransitionRequest["kind"];
  target: { kind: RelationshipRefKind; externalId?: string; label: string };
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Re-exported for the mock and the screens                                   */
/* -------------------------------------------------------------------------- */

export type {
  Contract, ContractRequirement, ContractSummary, ContractTermination,
  ContractTerms, ContractVersion, ContractView, ContractsDashboard,
  RequiredDocumentTerm, Responsibility,
};

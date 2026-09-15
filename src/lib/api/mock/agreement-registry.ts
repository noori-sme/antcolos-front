import {
  CONTRACT_LINK_LABEL, RELATIONSHIP_REF_LABEL,
  type AgreementType, type AuthorizedSigner, type CompensationRule,
  type Contract, type ContractCapabilities, type ContractEvent,
  type ContractEventKind, type ContractFilters, type ContractLink,
  type ContractLinkRef, type ContractParty, type ContractPartyRole,
  type ContractRelationshipRef, type ContractRequirement,
  type ContractRequirementKind, type ContractSignature, type ContractSortKey,
  type ContractStatus, type ContractSummary, type ContractTermination,
  type ContractTerms, type ContractVersion, type ContractView,
  type ContractsDashboard, type DocumentTypeKey, type IsoDateTime,
  type PermissionKey, type RelationshipTransitionRequest,
  type TerminationGround, type TerminationStepKey, type TerminationStepRecord,
  type WorkspaceKind,
} from "@/types";
import {
  agreementTypeMeta, activationBlockers, assertAmendable, assertGroundAllowed,
  assertMaySignFor, assertRelationshipAllowed, assertTransition,
  assertVersionMutable, acceptsSignatures, buildTransitionRequest,
  changedTermGroups, cloneTerms, compensationRulesAt, counterpartyRole,
  deriveContractStatus, daysUntilEnd, evaluateRequirement, freeze,
  isFullySigned, isRequirementOpen, isSignerLive, nextTermDates,
  nextVersionNumber, openBlockingRequirements, signablePartyIds,
  signatureStatement, signaturesOutstanding, terminationEffectiveDate,
  transitionsOnActivation, transitionsOnTermination, validateTermsForIssue,
  type RequirementEvidence,
} from "@/lib/contracts";
import { TERMINATION_STEP_TERM_LABEL } from "@/types";
import {
  NotFoundError, OrganizationScopeError, PermissionDeniedError,
  type ServiceContext,
} from "../contracts/context";
import type {
  AmendContractInput, AuthorizeSignerInput, CreateContractInput,
  LinkRelationshipInput, RequestTransitionInput, SignContractInput,
  TerminationNoticeInput,
} from "../contracts/agreements";
// The Document Center's own labels, so one document type is never called two
// different things in two places.
import { documentTypeLabel } from "@/lib/documents/catalog";
import { carrierProfile } from "./carrier-registry";
import { driverDocumentRowsUnscoped } from "./driver-registry";
import { deterministicUuid, documentUuid, documentsForSubject, documentsOwnedBy } from "./document-store";
import { seedAgreements } from "./agreement-seed";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The Contracts & Relationships registry.
 *
 * Every rule that matters is enforced HERE rather than in a screen, because a UI
 * check is user experience and this is the boundary a bad caller actually hits:
 *
 *   permissions            every write declares the key it needs
 *   signer authority       no party signs for another, whatever it holds
 *   organization isolation a contract is only ever read through its own org
 *   version immutability   a signed version can never be written to
 *   financial visibility   compensation is OMITTED from the payload, not blanked
 *   relationship boundary  nothing here writes to a relationship service
 *
 * The last one is worth saying twice. This file imports the truck registry and
 * the carrier registry to READ them — a label, an authority status — and imports
 * no function from either that could change one. Signing a contract produces a
 * `RelationshipTransitionRequest`, which is a note.
 */

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export interface AgreementDb {
  contracts: Contract[];
  versions: ContractVersion[];
  parties: ContractParty[];
  signers: AuthorizedSigner[];
  signatures: ContractSignature[];
  requirements: ContractRequirement[];
  relationships: ContractRelationshipRef[];
  transitionRequests: RelationshipTransitionRequest[];
  links: ContractLink[];
  terminations: ContractTermination[];
  events: ContractEvent[];
}

let state: AgreementDb | null = null;

function db(): AgreementDb {
  if (!state) state = seedAgreements();
  return state;
}

/** Test/debug helper. Not used by the UI. */
export function resetAgreementRegistry() {
  state = seedAgreements();
}

let seq = 0;
const localId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a contracts call acts as.
 *
 * Built from the ServiceContext and nothing else, so the organization a call
 * happens in comes from the active membership rather than from a route param, a
 * prop or a form field.
 */
export interface AgreementContext {
  organizationId: string;
  organizationName: string;
  workspaceKind: WorkspaceKind;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  actorName: string;
  actor: ServiceContext["actor"];
}

export function agreementContextFrom(ctx: ServiceContext): AgreementContext {
  return {
    organizationId: ctx.organizationId,
    organizationName: ctx.organizationName,
    workspaceKind: ctx.workspaceKind,
    membershipId: ctx.membershipId,
    permissions: ctx.permissions,
    actorName: ctx.actor.displayNameSnapshot,
    actor: ctx.actor,
  };
}

function requirePermissions(ctx: AgreementContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/* -------------------------------------------------------------------------- */
/* Lookup, with isolation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One contract, or a refusal.
 *
 * Isolation is checked here and only here, so there is no read path that could
 * forget it. A contract from another organization raises
 * `OrganizationScopeError` rather than `NotFoundError`, because the two are
 * different facts and conflating them hides a genuine bug behind a plausible
 * one.
 */
function findContract(ctx: AgreementContext, contractId: string): Contract {
  const contract = db().contracts.find((c) => c.contractId === contractId);
  if (!contract) throw new NotFoundError("Contract");
  if (contract.organizationId !== ctx.organizationId) {
    throw new OrganizationScopeError(contract.organizationId, ctx.organizationId);
  }
  return contract;
}

const versionsOf = (contractId: string) =>
  db().versions
    .filter((v) => v.contractId === contractId)
    .sort((a, b) => b.versionNumber - a.versionNumber);

const partiesOf = (contractId: string) =>
  db().parties.filter((p) => p.contractId === contractId);

const signersOf = (contractId: string) =>
  db().signers.filter((s) => s.contractId === contractId);

const signaturesOf = (contractId: string) =>
  db().signatures.filter((s) => s.contractId === contractId);

const relationshipsOf = (contractId: string) =>
  db().relationships.filter((r) => r.contractId === contractId);

const linksOf = (contractId: string) =>
  db().links.filter((l) => l.contractId === contractId);

const requestsOf = (contractId: string) =>
  db().transitionRequests.filter((r) => r.contractId === contractId);

function versionOf(contractId: string, contractVersionId: string): ContractVersion {
  const version = db().versions.find(
    (v) => v.contractId === contractId && v.contractVersionId === contractVersionId,
  );
  if (!version) throw new NotFoundError("Contract version");
  return version;
}

const currentVersionOf = (contract: Contract) =>
  versionOf(contract.contractId, contract.currentVersionId);

function terminationOf(contractId: string): ContractTermination | undefined {
  return db().terminations
    .filter((t) => t.contractId === contractId && t.status !== "withdrawn")
    .at(-1);
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

function recordEvent(
  ctx: AgreementContext,
  input: {
    contractId: string;
    contractVersionId?: string;
    kind: ContractEventKind;
    summary: string;
    detail?: string;
  },
): ContractEvent {
  const event: ContractEvent = {
    id: localId("cte"),
    contractId: input.contractId,
    contractVersionId: input.contractVersionId,
    at: nowIso(),
    kind: input.kind,
    summary: input.summary,
    detail: input.detail,
    actor: ctx.actor,
    organizationId: ctx.organizationId,
  };
  db().events.push(event);
  return event;
}

/**
 * Append-only, newest first for display. Nothing here is ever removed.
 *
 * Insertion order breaks ties, because several events are written inside one
 * millisecond — signing the last party freezes the version, activates the
 * contract and raises its transition requests — and a timestamp alone would
 * shuffle them into an order that reads as though the effects preceded the
 * cause.
 */
export function timelineOf(contractId: string): ContractEvent[] {
  return db().events
    .map((event, index) => ({ event, index }))
    .filter((row) => row.event.contractId === contractId)
    .sort((a, b) => b.event.at.localeCompare(a.event.at) || b.index - a.index)
    .map((row) => row.event);
}

function touch(contract: Contract): Contract {
  const next = { ...contract, updatedAt: nowIso() };
  db().contracts = db().contracts.map((c) => (c.contractId === next.contractId ? next : c));
  return next;
}

/* -------------------------------------------------------------------------- */
/* Requirement evaluation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether the Document Center holds what a requirement asks for.
 *
 * Reads the ONE document store. The contract module keeps no files, no versions
 * and no review state of its own: a document requirement is a reason a document
 * is needed, evaluated against the store every time somebody looks.
 *
 * Which subject to look at comes from the party: an organization party is asked
 * about its own organization documents, a driver party about their driver
 * documents. A party with neither — somebody outside Antcolos — cannot have a
 * document requirement satisfied here, and it reads as unmet rather than as met
 * by default.
 */
function documentEvidence(
  requirement: ContractRequirement,
  party: ContractParty | undefined,
  owningOrganizationId: string,
): RequirementEvidence {
  const base = { requirementId: requirement.requirementId, present: false };
  if (!requirement.documentTypeKey || !party) return base;

  const records = party.organizationRef
    ? [
      ...documentsOwnedBy(party.organizationRef),
      ...documentsForSubject("organization", party.organizationRef),
    ]
    : party.driverProfileRef
      ? documentsForSubject("driver", party.driverProfileRef)
      : [];

  const matching = records.filter(
    (r) => r.typeKey === requirement.documentTypeKey && r.status !== "superseded",
  );

  // A driver's paperwork as the carrier holds it lives in the driver registry,
  // keyed by its own requirement keys. Read it too rather than reporting a
  // medical card missing because it is filed under `medical_front`. Either
  // source satisfies the requirement; neither is copied here.
  if (matching.length === 0 && party.driverProfileRef) {
    return driverRegistryEvidence(requirement, party.driverProfileRef, owningOrganizationId);
  }

  if (matching.length === 0) return base;

  // Prefer whichever version lapses last: a renewed certificate satisfies the
  // requirement even while an older one is still on file.
  const best = matching.reduce((a, b) => {
    if (!a.expiresAt) return a;
    if (!b.expiresAt) return b;
    return a.expiresAt >= b.expiresAt ? a : b;
  });
  return {
    requirementId: requirement.requirementId,
    present: true,
    expiresAt: best.expiresAt,
  };
}

/**
 * The Document Center's type keys, mapped onto the driver registry's own keys.
 *
 * One mapping, in one place. A key with no entry has no driver-side equivalent,
 * which reads as unmet rather than as satisfied by default — a requirement
 * nobody can answer must not look answered.
 */
const DRIVER_DOCUMENT_KEYS: Partial<Record<DocumentTypeKey, string[]>> = {
  cdl: ["cdl_front", "cdl_back"],
  medical_card: ["medical_front", "medical_back"],
  w9: ["w9"],
  certificate_of_insurance: ["coi"],
  vehicle_registration: ["vehicle_registration"],
  vehicle_title: ["vehicle_title"],
  mvr: ["mvr"],
  employment_application: ["employment_application"],
  signed_handbook: ["signed_handbook"],
};

function driverRegistryEvidence(
  requirement: ContractRequirement,
  driverProfileId: string,
  organizationId: string,
): RequirementEvidence {
  const base = { requirementId: requirement.requirementId, present: false };
  const keys = DRIVER_DOCUMENT_KEYS[requirement.documentTypeKey!];
  if (!keys) return base;

  const rows = driverDocumentRowsUnscoped(driverProfileId, organizationId)
    .filter((row) => keys.includes(row.requirementKey))
    // "missing" is the registry's word for a checklist row with nothing behind
    // it, and a rejected document does not satisfy anything.
    .filter((row) => row.status !== "missing" && row.status !== "rejected");
  if (rows.length === 0) return base;

  // Whichever lapses first decides: a CDL that is current and a medical card
  // that has run out is not a satisfied pair.
  const soonest = rows.reduce((a, b) => {
    if (!a.expiresAt) return b.expiresAt ? b : a;
    if (!b.expiresAt) return a;
    return a.expiresAt <= b.expiresAt ? a : b;
  });
  return {
    requirementId: requirement.requirementId,
    present: true,
    expiresAt: soonest.expiresAt,
  };
}

/**
 * Whether the carrier party's Operating Authority is active.
 *
 * Read from the carrier profile — the canonical record — and never stored on the
 * contract. "Not recorded" is not satisfied: not knowing is different from
 * knowing it is fine, and a contract requirement must not launder the one into
 * the other.
 */
function authorityEvidence(
  requirement: ContractRequirement,
  party: ContractParty | undefined,
): RequirementEvidence {
  if (!party?.organizationRef) return { requirementId: requirement.requirementId, present: false };
  const profile = carrierProfile(party.organizationRef);
  return {
    requirementId: requirement.requirementId,
    present: profile?.authority.status === "active",
  };
}

function signatureEvidence(
  requirement: ContractRequirement,
  contract: Contract,
): RequirementEvidence {
  const version = currentVersionOf(contract);
  const signed = signaturesOf(contract.contractId).some(
    (s) => s.contractVersionId === version.contractVersionId
      && s.partyId === requirement.owedByPartyId,
  );
  return { requirementId: requirement.requirementId, present: signed };
}

/**
 * Requirements as they stand, right now.
 *
 * The stored rows carry identity, the reason and any waiver. Their STATUS is
 * recomputed here on every read, which is what makes "fix the document and the
 * item disappears" true rather than aspirational.
 */
export function requirementsOf(contract: Contract, now = nowIso()): ContractRequirement[] {
  const parties = partiesOf(contract.contractId);
  return db().requirements
    .filter((r) => r.contractId === contract.contractId)
    .map((requirement) => {
      const party = parties.find((p) => p.partyId === requirement.owedByPartyId);
      const evidence = evidenceFor(requirement, party, contract);
      return { ...requirement, status: evaluateRequirement(requirement, evidence, now) };
    });
}

function evidenceFor(
  requirement: ContractRequirement,
  party: ContractParty | undefined,
  contract: Contract,
): RequirementEvidence | undefined {
  switch (requirement.kind) {
    case "document": return documentEvidence(requirement, party, contract.organizationId);
    case "operating_authority": return authorityEvidence(requirement, party);
    case "signature": return signatureEvidence(requirement, contract);
    case "insurance":
      // Satisfied today by a certificate somebody recorded — which is a
      // document — because no insurer has confirmed anything. The seam that
      // would ask an insurer is declared and throws.
      return documentEvidence(requirement, party, contract.organizationId);
    case "attestation":
    case "closeout":
      // Nothing computes these: somebody either confirmed them or did not, and
      // that confirmation is the closeout record or a waiver.
      return closeoutEvidence(requirement, contract);
  }
}

function closeoutEvidence(
  requirement: ContractRequirement,
  contract: Contract,
): RequirementEvidence {
  const termination = terminationOf(contract.contractId);
  if (!termination) return { requirementId: requirement.requirementId, notApplicable: true, present: false };
  const step = termination.steps.find((s) => s.label === requirement.label);
  return { requirementId: requirement.requirementId, present: Boolean(step?.confirmedAt) };
}

/* -------------------------------------------------------------------------- */
/* Financial visibility                                                        */
/* -------------------------------------------------------------------------- */

const maySeeCompensation = (ctx: AgreementContext) =>
  ctx.permissions.has("contracts:financials:view");

/**
 * Terms with the compensation rules stripped out when the caller may not see
 * them.
 *
 * OMITTED, not blanked: a payload that carried the figures and relied on a
 * component to hide them is one screen, one export or one devtools panel away
 * from leaking them. `compensationVisible` on the view is how the UI knows the
 * empty array means "not for you" rather than "none agreed".
 */
function disclose(ctx: AgreementContext, version: ContractVersion): ContractVersion {
  if (maySeeCompensation(ctx)) return version;
  return { ...version, terms: { ...version.terms, compensation: [] } };
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What this caller may do to this contract.
 *
 * Computed from permissions, signer authority, the contract's status and the
 * version's status together — never from any one of them. It is sent so a button
 * is not offered for an action the seam would refuse, and `blockedReasons` says
 * why, because a greyed-out button with no explanation is how a person concludes
 * the product is broken.
 */
export function capabilitiesOf(
  ctx: AgreementContext,
  contract: Contract,
  now = nowIso(),
): ContractCapabilities {
  const version = currentVersionOf(contract);
  const status = deriveContractStatus(contract, version, now);
  const parties = partiesOf(contract.contractId);
  const requirements = requirementsOf(contract, now);
  const signable = signablePartyIds(signersOf(contract.contractId), ctx.membershipId, now);
  const outstanding = signaturesOutstanding(
    parties, signaturesOf(contract.contractId), version.contractVersionId,
  );
  const blockers = openBlockingRequirements(requirements);
  const reasons: string[] = [];

  const isDraft = version.status === "draft";
  const terminal = status === "terminated" || status === "cancelled" || status === "superseded";
  if (terminal) reasons.push(`This contract is ${status}. It is kept, and read-only.`);

  const unsignedByMe = signable.filter(
    (partyId) => !signaturesOf(contract.contractId).some(
      (s) => s.contractVersionId === version.contractVersionId && s.partyId === partyId,
    ),
  );

  if (!signable.length && ctx.permissions.has("contracts:sign")) {
    reasons.push(
      "You are not an authorised signer on this contract, so you cannot sign any part of it. No party may sign for another.",
    );
  }
  if (blockers.length > 0) {
    reasons.push(
      `${blockers.length} required item${blockers.length === 1 ? "" : "s"} still outstanding: ${blockers.map((b) => b.label).join(", ")}.`,
    );
  }

  const termination = terminationOf(contract.contractId);

  return {
    canEditDraft: !terminal && isDraft && ctx.permissions.has("contracts:edit"),
    canSendForReview:
      !terminal && isDraft && status === "draft" && ctx.permissions.has("contracts:review"),
    canIssueForSignature:
      !terminal && isDraft && ctx.permissions.has("contracts:review")
      && (status === "draft" || status === "pending_review"),
    canSign:
      !terminal && acceptsSignatures(version) && ctx.permissions.has("contracts:sign")
      && unsignedByMe.length > 0,
    signableForPartyIds: unsignedByMe,
    canAmend:
      !terminal && version.status === "signed" && ctx.permissions.has("contracts:amend"),
    canTerminate:
      !terminal && (status === "active" || status === "expiring")
      && !termination && ctx.permissions.has("contracts:terminate"),
    canCancel:
      !terminal && status !== "active" && status !== "expiring" && status !== "expired"
      && ctx.permissions.has("contracts:cancel"),
    canWaiveRequirement: !terminal && ctx.permissions.has("contracts:requirements:waive"),
    canManageSigners: !terminal && ctx.permissions.has("contracts:signers:manage"),
    canLinkRecords: !terminal && ctx.permissions.has("contracts:links:manage"),
    canViewCompensation: maySeeCompensation(ctx),
    blockedReasons: [
      ...reasons,
      ...(outstanding > 0 && status === "awaiting_signature"
        ? [`Waiting on ${outstanding} signature${outstanding === 1 ? "" : "s"}.`]
        : []),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                 */
/* -------------------------------------------------------------------------- */

export function viewOf(
  ctx: AgreementContext,
  contract: Contract,
  now = nowIso(),
): ContractView {
  const version = currentVersionOf(contract);
  const status = deriveContractStatus(contract, version, now);
  const parties = partiesOf(contract.contractId);

  return {
    contract: { ...contract, status },
    currentVersion: disclose(ctx, version),
    versions: versionsOf(contract.contractId).map((v) => disclose(ctx, v)),
    parties,
    signers: signersOf(contract.contractId),
    signatures: signaturesOf(contract.contractId),
    requirements: requirementsOf(contract, now),
    relationships: relationshipsOf(contract.contractId),
    transitionRequests: requestsOf(contract.contractId),
    links: linksOf(contract.contractId),
    termination: terminationOf(contract.contractId),
    timeline: timelineOf(contract.contractId),
    capabilities: capabilitiesOf(ctx, contract, now),
    compensationVisible: maySeeCompensation(ctx),
  };
}

export function summaryOf(
  ctx: AgreementContext,
  contract: Contract,
  now = nowIso(),
): ContractSummary {
  const version = currentVersionOf(contract);
  const status = deriveContractStatus(contract, version, now);
  const parties = partiesOf(contract.contractId);
  const counterparty = parties.find((p) => !p.isOwningParty) ?? parties[0];
  const requirements = requirementsOf(contract, now);
  const termination = terminationOf(contract.contractId);

  return {
    contractId: contract.contractId,
    reference: contract.reference,
    title: contract.title,
    agreementType: contract.agreementType,
    status,
    versionNumber: version.versionNumber,
    counterpartyName: counterparty?.legalNameSnapshot ?? "—",
    counterpartyRole: counterparty?.role ?? counterpartyRole(contract.agreementType),
    effectiveFrom: version.terms.effective.from,
    effectiveTo: version.terms.effective.to,
    daysUntilEnd: daysUntilEnd(version.terms, now),
    signaturesOutstanding: signaturesOutstanding(
      parties, signaturesOf(contract.contractId), version.contractVersionId,
    ),
    blockingRequirementsOpen: openBlockingRequirements(requirements).length,
    terminationOutstanding: Boolean(
      termination && termination.status !== "completed",
    ),
    compensationVisible: maySeeCompensation(ctx),
    updatedAt: contract.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function listSync(
  ctx: AgreementContext,
  filters: ContractFilters = {},
  sort: ContractSortKey = "updated",
  now = nowIso(),
): ContractSummary[] {
  requirePermissions(ctx, "contracts:view");

  const rows = db().contracts
    .filter((c) => c.organizationId === ctx.organizationId)
    .map((c) => summaryOf(ctx, c, now))
    .filter((row) => matches(ctx, row, filters, now));

  return sortRows(rows, sort);
}

function matches(
  ctx: AgreementContext,
  row: ContractSummary,
  f: ContractFilters,
  now: IsoDateTime,
): boolean {
  const closed = row.status === "expired" || row.status === "terminated"
    || row.status === "cancelled" || row.status === "superseded";
  // Closed contracts are HIDDEN by default, never deleted. An explicit status
  // filter overrides the default, so asking for expired contracts finds them.
  if (closed && !f.includeClosed && !f.status?.includes(row.status)) return false;

  if (f.status?.length && !f.status.includes(row.status)) return false;
  if (f.agreementType?.length && !f.agreementType.includes(row.agreementType)) return false;
  if (f.endingWithinDays != null) {
    if (row.daysUntilEnd == null) return false;
    if (row.daysUntilEnd > f.endingWithinDays) return false;
  }
  if (f.withOpenRequirements && row.blockingRequirementsOpen === 0) return false;
  if (f.awaitingMySignature) {
    const contract = db().contracts.find((c) => c.contractId === row.contractId)!;
    if (!capabilitiesOf(ctx, contract, now).canSign) return false;
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${row.reference} ${row.title} ${row.counterpartyName}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function sortRows(rows: ContractSummary[], sort: ContractSortKey): ContractSummary[] {
  const copy = [...rows];
  switch (sort) {
    case "reference":
      return copy.sort((a, b) => a.reference.localeCompare(b.reference));
    case "effective_from":
      return copy.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    case "ending_soonest":
      return copy.sort((a, b) => {
        // Open-ended agreements sort last: there is nothing to be soon about.
        if (a.daysUntilEnd == null) return b.daysUntilEnd == null ? 0 : 1;
        if (b.daysUntilEnd == null) return -1;
        return a.daysUntilEnd - b.daysUntilEnd;
      });
    case "updated":
    default:
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export function getSync(
  ctx: AgreementContext,
  contractId: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:view");
  return viewOf(ctx, findContract(ctx, contractId), now);
}

export function getVersionSync(
  ctx: AgreementContext,
  contractId: string,
  contractVersionId: string,
): ContractVersion {
  requirePermissions(ctx, "contracts:view");
  const contract = findContract(ctx, contractId);
  return disclose(ctx, versionOf(contract.contractId, contractVersionId));
}

/**
 * The compensation rules in force on a date.
 *
 * Reads the version that was in force THEN, not the current one. That is the
 * whole point: a percentage that changed in June must not make May's terms read
 * differently, and Settlements needs an answer it can rely on for a period that
 * has already been paid.
 */
export function compensationAtSync(
  ctx: AgreementContext,
  contractId: string,
  at: IsoDateTime,
): { contractVersionId: string; versionNumber: number; rules: CompensationRule[] } {
  requirePermissions(ctx, "contracts:view", "contracts:financials:view");
  const contract = findContract(ctx, contractId);

  // The version in force THEN, chosen by when it was signed rather than by its
  // effective date: an amendment that restates the same start date must not
  // retroactively become the version that governed last quarter.
  const candidates = versionsOf(contract.contractId)
    .filter((v) => v.status === "signed" || v.status === "superseded")
    .filter((v) => {
      const inForceFrom = v.signedAt ?? v.terms.effective.from;
      return new Date(inForceFrom).getTime() <= new Date(at).getTime();
    })
    .sort((a, b) => b.versionNumber - a.versionNumber);

  const version = candidates[0] ?? currentVersionOf(contract);
  return {
    contractVersionId: version.contractVersionId,
    versionNumber: version.versionNumber,
    rules: compensationRulesAt(version.terms, at),
  };
}

export function dashboardSync(
  ctx: AgreementContext,
  now = nowIso(),
): ContractsDashboard {
  requirePermissions(ctx, "contracts:view");

  const all = db().contracts.filter((c) => c.organizationId === ctx.organizationId);
  const rows = all.map((c) => summaryOf(ctx, c, now));

  const counts = Object.fromEntries(
    ([
      "draft", "pending_review", "awaiting_signature", "active", "expiring",
      "expired", "terminated", "cancelled", "superseded",
    ] as ContractStatus[]).map((s) => [s, rows.filter((r) => r.status === s).length]),
  ) as Record<ContractStatus, number>;

  const inForce = rows.filter((r) => r.status === "active" || r.status === "expiring");
  const byType = new Map<AgreementType, number>();
  for (const row of inForce) byType.set(row.agreementType, (byType.get(row.agreementType) ?? 0) + 1);

  return {
    organizationId: ctx.organizationId,
    counts,
    inForceByType: [...byType].map(([agreementType, count]) => ({ agreementType, count })),
    expiringSoon: sortRows(rows.filter((r) => r.status === "expiring"), "ending_soonest"),
    awaitingMySignature: rows.filter((r) => {
      const contract = all.find((c) => c.contractId === r.contractId)!;
      return capabilitiesOf(ctx, contract, now).canSign;
    }),
    withOpenRequirements: rows.filter(
      (r) => r.blockingRequirementsOpen > 0 && r.status !== "cancelled",
    ),
    unresolvedTerminations: rows.filter((r) => r.terminationOutstanding),
    openTransitionRequests: db().transitionRequests.filter((request) => {
      const contract = all.find((c) => c.contractId === request.contractId);
      return Boolean(contract);
    }),
    compensationVisible: maySeeCompensation(ctx),
  };
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/** A gapless, readable reference per organization. Never parsed. */
function nextReference(organizationId: string, agreementType: AgreementType): string {
  const prefix = agreementType.split("_").map((w) => w[0].toUpperCase()).join("");
  const count = db().contracts.filter((c) => c.organizationId === organizationId).length + 1;
  return `${prefix}-${String(count).padStart(4, "0")}`;
}

/**
 * Default terms for an agreement type.
 *
 * Deliberately conservative, and deliberately incomplete: the closeout steps and
 * required documents come from the catalog, but the dates, the compensation and
 * the responsibilities are for the parties to write. Defaults that filled in a
 * percentage would be Antcolos deciding what somebody gets paid.
 */
export function defaultTermsFor(agreementType: AgreementType, now = nowIso()): ContractTerms {
  const meta = agreementTypeMeta(agreementType);
  return {
    summary: "",
    effective: { from: now },
    renewal: { kind: "none", reminderDays: 30 },
    termination: {
      grounds: ["for_convenience", "for_cause"],
      noticeDays: 30,
      forCauseNoticeDays: 0,
      closeoutSteps: meta.closeoutSteps.map((s) => ({
        key: s.key,
        label: TERMINATION_STEP_TERM_LABEL[s.key],
        owedByRole: s.owedByRole,
      })),
    },
    compensation: [],
    responsibilities: [],
    requiredDocuments: meta.documentTerms.map((d, i) => ({
      id: `rd_${agreementType}_${i}`,
      documentTypeKey: d.documentTypeKey,
      owedByRole: d.owedByRole,
      reason: d.reason,
      blocking: d.blocking,
    })),
  };
}

export function createSync(
  ctx: AgreementContext,
  input: CreateContractInput,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:create");

  const meta = agreementTypeMeta(input.agreementType);
  const contractId = documentUuid();
  const versionId = documentUuid();

  const owningParty: ContractParty = {
    partyId: documentUuid(),
    contractId,
    role: meta.partyRoles[0],
    legalNameSnapshot: ctx.organizationName,
    organizationRef: ctx.organizationId,
    isOwningParty: true,
    addedAt: now,
  };
  const other: ContractParty = {
    partyId: documentUuid(),
    contractId,
    role: input.counterparty.role,
    legalNameSnapshot: input.counterparty.legalName.trim(),
    organizationRef: input.counterparty.organizationRef,
    driverProfileRef: input.counterparty.driverProfileRef,
    membershipRef: input.counterparty.membershipRef,
    externalIdentifier: input.counterparty.externalIdentifier,
    isOwningParty: false,
    addedAt: now,
  };

  const terms: ContractTerms = {
    ...defaultTermsFor(input.agreementType, now),
    ...input.terms,
  };

  const version: ContractVersion = {
    contractVersionId: versionId,
    contractId,
    versionNumber: 1,
    kind: "original",
    status: "draft",
    changedTermGroups: [],
    terms,
    frozen: false,
    createdAt: now,
    createdByMembershipId: ctx.membershipId,
    createdByName: ctx.actorName,
  };

  const contract: Contract = {
    contractId,
    organizationId: ctx.organizationId,
    agreementType: input.agreementType,
    reference: nextReference(ctx.organizationId, input.agreementType),
    title: input.title.trim(),
    status: "draft",
    currentVersionId: versionId,
    createdAt: now,
    createdByMembershipId: ctx.membershipId,
    createdByName: ctx.actorName,
    updatedAt: now,
  };

  db().contracts.push(contract);
  db().versions.push(version);
  db().parties.push(owningParty, other);
  db().requirements.push(...seedRequirements(contract, [owningParty, other], now));

  recordEvent(ctx, {
    contractId, contractVersionId: versionId, kind: "created",
    summary: `${meta.label} created with ${other.legalNameSnapshot}.`,
    detail: "Draft. Nothing has been signed, sent or agreed.",
  });

  for (const relationship of input.relationships ?? []) {
    linkRelationshipSync(ctx, { ...relationship, contractId }, now);
  }

  return viewOf(ctx, findContract(ctx, contractId), now);
}

/**
 * The requirements a new contract starts with.
 *
 * Built from the version's required-document terms plus one signature
 * requirement per party. Note what is NOT created: no documents. A requirement
 * with nothing against it is "missing", and the Document Center is where the
 * document itself would live.
 */
function seedRequirements(
  contract: Contract,
  parties: ContractParty[],
  now: IsoDateTime,
): ContractRequirement[] {
  const version = db().versions.find((v) => v.contractVersionId === contract.currentVersionId)!;
  const partyFor = (role: ContractPartyRole) =>
    parties.find((p) => p.role === role) ?? parties[0];

  const documents = version.terms.requiredDocuments.map((term) => requirement({
    contract, now,
    kind: "document",
    label: documentTypeLabel(term.documentTypeKey),
    reason: term.reason,
    owedByPartyId: partyFor(term.owedByRole).partyId,
    blocking: term.blocking,
    documentTypeKey: term.documentTypeKey,
    requiredDocumentTermId: term.id,
  }));

  const signatures = parties.map((party) => requirement({
    contract, now,
    kind: "signature",
    label: `Signature from ${party.legalNameSnapshot}`,
    reason: "Every party signs the version that is being agreed.",
    owedByPartyId: party.partyId,
    blocking: true,
  }));

  // A carrier agreement turns on the carrier being allowed to haul. It is a
  // requirement rather than a check inside the contract, because the answer
  // lives on the carrier profile and changes without anybody touching the paper.
  const carrier = parties.find((p) => p.role === "carrier");
  const authority = carrier
    ? [requirement({
      contract, now,
      kind: "operating_authority",
      label: `Active Operating Authority for ${carrier.legalNameSnapshot}`,
      reason: "A carrier without active authority cannot legally haul, whatever the agreement says.",
      owedByPartyId: carrier.partyId,
      blocking: true,
    })]
    : [];

  return [...documents, ...signatures, ...authority];
}

function requirement(input: {
  contract: Contract;
  now: IsoDateTime;
  kind: ContractRequirementKind;
  label: string;
  reason: string;
  owedByPartyId: string;
  blocking: boolean;
  documentTypeKey?: DocumentTypeKey;
  requiredDocumentTermId?: string;
  dueAt?: IsoDateTime;
}): ContractRequirement {
  return {
    requirementId: deterministicUuid(
      `ctr_req:${input.contract.contractId}:${input.kind}:${input.label}`,
    ),
    contractId: input.contract.contractId,
    kind: input.kind,
    label: input.label,
    reason: input.reason,
    owedByPartyId: input.owedByPartyId,
    blocking: input.blocking,
    documentTypeKey: input.documentTypeKey,
    requiredDocumentTermId: input.requiredDocumentTermId,
    dueAt: input.dueAt,
    status: "unmet",
    createdAt: input.now,
  };
}



/* -------------------------------------------------------------------------- */
/* Drafting                                                                    */
/* -------------------------------------------------------------------------- */

export function updateDraftTermsSync(
  ctx: AgreementContext,
  contractId: string,
  patch: Partial<ContractTerms>,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:edit");
  const contract = findContract(ctx, contractId);
  const version = currentVersionOf(contract);
  // The one check that matters: a signed version can never be written to.
  assertVersionMutable(version);

  const next: ContractVersion = { ...version, terms: { ...version.terms, ...patch } };
  db().versions = db().versions.map(
    (v) => (v.contractVersionId === next.contractVersionId ? next : v),
  );
  recordEvent(ctx, {
    contractId, contractVersionId: version.contractVersionId, kind: "version_edited",
    summary: `Draft terms edited (version ${version.versionNumber}).`,
  });
  return viewOf(ctx, touch(contract), now);
}

export function sendForReviewSync(
  ctx: AgreementContext,
  contractId: string,
  note?: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:review");
  const contract = findContract(ctx, contractId);
  assertTransition(deriveContractStatus(contract, currentVersionOf(contract), now), "pending_review");

  recordEvent(ctx, {
    contractId, kind: "sent_for_review",
    summary: "Sent for review.",
    // The note is the author's; the disclosure is not theirs to drop.
    detail: [
      note,
      "Somebody on your team is reading it. No lawyer has seen it — Antcolos has no legal review integration and gives no legal advice.",
    ].filter(Boolean).join(" "),
  });
  return viewOf(ctx, touch({ ...contract, status: "pending_review" }), now);
}

export function returnFromReviewSync(
  ctx: AgreementContext,
  contractId: string,
  note: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:review");
  const contract = findContract(ctx, contractId);
  assertTransition(deriveContractStatus(contract, currentVersionOf(contract), now), "draft");

  recordEvent(ctx, {
    contractId, kind: "review_returned", summary: "Returned from review.", detail: note,
  });
  return viewOf(ctx, touch({ ...contract, status: "draft" }), now);
}

export class ContractIssueError extends Error {
  constructor(readonly problems: string[]) {
    super(`This version cannot be issued yet: ${problems.join(" ")}`);
    this.name = "ContractIssueError";
  }
}

/**
 * Locks the draft's terms and opens it for signature.
 *
 * Freezing happens here, not at signing. Once a version is out for signature its
 * terms may not change — a party that signed page one must not find page two
 * rewritten while they read it.
 */
export function issueForSignatureSync(
  ctx: AgreementContext,
  contractId: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:review");
  const contract = findContract(ctx, contractId);
  const version = currentVersionOf(contract);
  assertVersionMutable(version);

  const problems = validateTermsForIssue(version.terms);
  const parties = partiesOf(contractId);
  if (parties.length < 2) problems.push("Both parties have to be on the contract.");
  for (const party of parties) {
    const live = signersOf(contractId).filter(
      (s) => s.partyId === party.partyId && isSignerLive(s, now),
    );
    if (live.length === 0) {
      problems.push(`${party.legalNameSnapshot} has no authorised signer yet.`);
    }
  }
  if (problems.length > 0) throw new ContractIssueError(problems);

  assertTransition(
    deriveContractStatus(contract, version, now), "awaiting_signature",
  );

  const issued: ContractVersion = { ...version, status: "issued", issuedAt: now, frozen: true };
  db().versions = db().versions.map(
    (v) => (v.contractVersionId === issued.contractVersionId ? issued : v),
  );
  recordEvent(ctx, {
    contractId, contractVersionId: issued.contractVersionId, kind: "issued_for_signature",
    summary: `Version ${issued.versionNumber} issued for signature.`,
    detail: "Terms are locked. Nothing has been sent to anybody — Antcolos has no e-signature or delivery integration.",
  });
  return viewOf(ctx, touch({ ...contract, status: "awaiting_signature" }), now);
}

export function cancelSync(
  ctx: AgreementContext,
  contractId: string,
  reason: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:cancel");
  const contract = findContract(ctx, contractId);
  const version = currentVersionOf(contract);
  assertTransition(deriveContractStatus(contract, version, now), "cancelled");

  // The version is voided and kept, never removed. A cancelled agreement still
  // has to be able to show what it said and who had signed it.
  const voided: ContractVersion = { ...freeze(version), status: "void" };
  db().versions = db().versions.map(
    (v) => (v.contractVersionId === voided.contractVersionId ? voided : v),
  );
  recordEvent(ctx, {
    contractId, contractVersionId: version.contractVersionId, kind: "cancelled",
    summary: "Cancelled before it took effect.", detail: reason,
  });
  return viewOf(
    ctx,
    touch({ ...contract, status: "cancelled", cancelledAt: now, cancelledReason: reason }),
    now,
  );
}

/* -------------------------------------------------------------------------- */
/* Signers                                                                     */
/* -------------------------------------------------------------------------- */

export class SignerScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerScopeError";
  }
}

/**
 * Says who may sign for a party.
 *
 * This record belongs to the caller's organization — the counterparty keeps its
 * own — so recording who signs for either party is administration of the
 * caller's own paperwork. What that must never become is a way to sign both
 * sides, so two rules are enforced here and the signing gate stays untouched:
 *
 *   one membership, one party    a membership may be an authorised signer for at
 *                               most one party on a contract, so nobody can be
 *                               appointed to both sides of it
 *   not yourself, for them      you cannot name your own membership as the
 *                               counterparty's signatory
 *
 * Together with `assertMaySignFor`, which matches on membership alone, that
 * makes signing for another party unreachable rather than merely discouraged.
 */
export function authorizeSignerSync(
  ctx: AgreementContext,
  input: AuthorizeSignerInput,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:signers:manage");
  const contract = findContract(ctx, input.contractId);
  const party = partiesOf(contract.contractId).find((p) => p.partyId === input.partyId);
  if (!party) throw new NotFoundError("Contract party");

  const isOwnParty = party.organizationRef === ctx.organizationId;

  if (!isOwnParty && input.membershipId === ctx.membershipId) {
    throw new SignerScopeError(
      `You cannot name yourself as the signatory for ${party.legalNameSnapshot}. No party may sign an agreement for another.`,
    );
  }

  const clash = signersOf(contract.contractId).find(
    (s) => s.membershipId === input.membershipId
      && s.partyId !== party.partyId
      && isSignerLive(s, now),
  );
  if (clash) {
    const other = partiesOf(contract.contractId).find((p) => p.partyId === clash.partyId);
    throw new SignerScopeError(
      `${input.name} already signs for ${other?.legalNameSnapshot ?? "another party"} on this contract. One person cannot sign both sides of an agreement.`,
    );
  }

  const signer: AuthorizedSigner = {
    signerId: documentUuid(),
    contractId: contract.contractId,
    partyId: party.partyId,
    membershipId: input.membershipId,
    nameSnapshot: input.name.trim(),
    titleSnapshot: input.title?.trim(),
    authority: input.authority,
    grantedByMembershipId: input.authority === "delegated" ? ctx.membershipId : undefined,
    grantedAt: now,
  };
  db().signers.push(signer);
  recordEvent(ctx, {
    contractId: contract.contractId, kind: "signer_authorized",
    summary: `${signer.nameSnapshot} may sign for ${party.legalNameSnapshot}.`,
    detail: `Authority: ${input.authority}.`,
  });
  return viewOf(ctx, touch(contract), now);
}

export function revokeSignerSync(
  ctx: AgreementContext,
  contractId: string,
  signerId: string,
  reason: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:signers:manage");
  const contract = findContract(ctx, contractId);
  const signer = signersOf(contractId).find((s) => s.signerId === signerId);
  if (!signer) throw new NotFoundError("Authorized signer");

  // Forward-looking only: signatures already given stay exactly as they are.
  const revoked: AuthorizedSigner = { ...signer, revokedAt: now, revokedReason: reason };
  db().signers = db().signers.map((s) => (s.signerId === signerId ? revoked : s));
  recordEvent(ctx, {
    contractId, kind: "signer_revoked",
    summary: `${signer.nameSnapshot} may no longer sign.`,
    detail: `${reason} Signatures already given are unaffected.`,
  });
  return viewOf(ctx, touch(contract), now);
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                     */
/* -------------------------------------------------------------------------- */

export class SignatureRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureRefusedError";
  }
}

/**
 * Records a signature, and only ever a signature.
 *
 * Both gates, in order: the permission, then the authority. Then the honest
 * part — what is stored is a typed name, a statement saying it means nothing
 * legally, and `mock: true`.
 *
 * The last signature does three things and not a fourth: it freezes the version,
 * takes the contract active if nothing blocks it, and RAISES REQUESTS for the
 * relationships the contract references. It does not create, alter or end any
 * access. A driver whose agreement was just fully signed has exactly the
 * permissions they had a moment before.
 */
export function signSync(
  ctx: AgreementContext,
  input: SignContractInput,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:sign");
  const contract = findContract(ctx, input.contractId);
  const version = versionOf(contract.contractId, input.contractVersionId);

  if (!acceptsSignatures(version)) {
    throw new SignatureRefusedError(
      `Version ${version.versionNumber} is ${version.status} and cannot take a signature. Only a version that has been issued for signature can.`,
    );
  }

  const parties = partiesOf(contract.contractId);
  // Refuses when this membership is not authorised for THIS party, with a
  // message that says which party they can sign for instead.
  const signer = assertMaySignFor(signersOf(contract.contractId), parties, {
    membershipId: ctx.membershipId, partyId: input.partyId, now,
  });

  const already = signaturesOf(contract.contractId).some(
    (s) => s.contractVersionId === version.contractVersionId && s.partyId === input.partyId,
  );
  if (already) {
    throw new SignatureRefusedError(
      "That party has already signed this version. Changing your mind means a new version, not a second signature.",
    );
  }

  const party = parties.find((p) => p.partyId === input.partyId)!;
  const signature: ContractSignature = {
    signatureId: documentUuid(),
    contractId: contract.contractId,
    contractVersionId: version.contractVersionId,
    partyId: party.partyId,
    signerId: signer.signerId,
    typedName: input.typedName,
    signerNameSnapshot: signer.nameSnapshot,
    signerTitleSnapshot: signer.titleSnapshot,
    method: "mock_typed_name",
    statement: signatureStatement({
      partyName: party.legalNameSnapshot,
      signerName: signer.nameSnapshot,
      versionNumber: version.versionNumber,
      contractTitle: contract.title,
    }),
    signedAt: now,
    mock: true,
  };
  db().signatures.push(signature);
  recordEvent(ctx, {
    contractId: contract.contractId, contractVersionId: version.contractVersionId,
    kind: "signed",
    summary: `${party.legalNameSnapshot} signed version ${version.versionNumber}.`,
    detail: "Mock signature: a typed name recorded against a version. Nothing verified, delivered or legally binding.",
  });

  let updated = contract;
  if (isFullySigned(parties, signaturesOf(contract.contractId), version.contractVersionId)) {
    updated = completeSigning(ctx, contract, version, now);
  }
  return viewOf(ctx, touch(updated), now);
}

/**
 * What happens once every party has signed.
 *
 * Freeze, supersede the version this one amended, and then — only if nothing is
 * blocking — go active. A fully-signed agreement whose blocking requirements are
 * unmet stays at `awaiting_signature` with the reasons on the view, which is
 * more honest than an "active" agreement that is missing the licence of the
 * person it is about.
 */
function completeSigning(
  ctx: AgreementContext,
  contract: Contract,
  version: ContractVersion,
  now: IsoDateTime,
): Contract {
  const signed: ContractVersion = { ...freeze(version), status: "signed", signedAt: now };
  db().versions = db().versions.map(
    (v) => (v.contractVersionId === signed.contractVersionId ? signed : v),
  );
  recordEvent(ctx, {
    contractId: contract.contractId, contractVersionId: signed.contractVersionId,
    kind: "fully_signed",
    summary: `Version ${signed.versionNumber} is fully signed and can never be edited.`,
    detail: "Changing these terms from here means an amendment, which is a new version.",
  });

  if (signed.supersedesVersionId) {
    const previous = db().versions.find(
      (v) => v.contractVersionId === signed.supersedesVersionId,
    );
    if (previous) {
      // Superseded, not replaced: the old version keeps its terms, its
      // signatures and its dates, and stays readable forever.
      const superseded: ContractVersion = {
        ...freeze(previous), status: "superseded",
        supersededByVersionId: signed.contractVersionId,
      };
      db().versions = db().versions.map(
        (v) => (v.contractVersionId === superseded.contractVersionId ? superseded : v),
      );
    }
  }

  const blockers = activationBlockers({
    version: signed,
    signaturesOutstanding: 0,
    blockingRequirementsOpen: openBlockingRequirements(
      requirementsOf({ ...contract, currentVersionId: signed.contractVersionId }, now),
    ).length,
    now,
  });

  if (blockers.length > 0) {
    recordEvent(ctx, {
      contractId: contract.contractId, kind: "note",
      summary: "Fully signed, and not yet active.",
      detail: blockers.join(" "),
    });
    return { ...contract, currentVersionId: signed.contractVersionId };
  }

  recordEvent(ctx, {
    contractId: contract.contractId, contractVersionId: signed.contractVersionId,
    kind: "activated",
    summary: "The agreement is active.",
    detail: "Access is unchanged. Any relationship change this agreement needs has been REQUESTED of the service that owns it — see the requests below.",
  });

  raiseActivationRequests(ctx, contract, signed, now);
  return { ...contract, status: "active", currentVersionId: signed.contractVersionId };
}

/**
 * Asks the canonical services for the transitions this agreement implies.
 *
 * Every one is a note. Nothing here calls the truck registry, the driver
 * relationship service or the access service, and the `applied: false` on each
 * request is a literal type rather than a default.
 */
function raiseActivationRequests(
  ctx: AgreementContext,
  contract: Contract,
  version: ContractVersion,
  now: IsoDateTime,
): void {
  for (const { kind, ref } of transitionsOnActivation(relationshipsOf(contract.contractId))) {
    const request = buildTransitionRequest({
      contractId: contract.contractId,
      contractVersionId: version.contractVersionId,
      agreementType: contract.agreementType,
      kind,
      target: { kind: ref.kind, externalId: ref.externalId, labelSnapshot: ref.labelSnapshot },
      reason: `${contract.reference} is fully signed and active.`,
      requestedByMembershipId: ctx.membershipId,
      requestedByName: ctx.actorName,
      now,
    });
    db().transitionRequests.push(request);
    recordEvent(ctx, {
      contractId: contract.contractId, kind: "transition_requested",
      summary: `Asked the ${request.ownerService} to ${request.kind.replace(/_/g, " ")}.`,
      detail: `Nothing has changed. ${request.nextStep}`,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Amendments                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A new draft version from a signed one.
 *
 * Every word of this matters: the signed version is NOT touched. Its terms are
 * cloned (deeply, so editing the draft cannot reach it), its signatures stay
 * where they are, and it keeps its own dates and compensation rules. Which term
 * groups changed is computed from the two sets of terms, not taken from the
 * caller, so an amendment cannot claim it only moved the renewal clause.
 */
export function amendSync(
  ctx: AgreementContext,
  input: AmendContractInput,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:amend");
  const contract = findContract(ctx, input.contractId);
  const signedVersion = currentVersionOf(contract);
  assertAmendable(signedVersion);

  if (!input.changeReason.trim()) {
    throw new ContractIssueError(["An amendment has to say why the terms are changing."]);
  }

  const base = cloneTerms(signedVersion.terms);
  const terms: ContractTerms = { ...base, ...input.terms };

  const amendment: ContractVersion = {
    contractVersionId: documentUuid(),
    contractId: contract.contractId,
    versionNumber: nextVersionNumber(versionsOf(contract.contractId)),
    kind: input.kind ?? "amendment",
    status: "draft",
    supersedesVersionId: signedVersion.contractVersionId,
    changeReason: input.changeReason.trim(),
    changedTermGroups: changedTermGroups(signedVersion.terms, terms),
    terms,
    frozen: false,
    createdAt: now,
    createdByMembershipId: ctx.membershipId,
    createdByName: ctx.actorName,
  };
  db().versions.push(amendment);

  recordEvent(ctx, {
    contractId: contract.contractId, contractVersionId: amendment.contractVersionId,
    kind: amendment.kind === "replacement" ? "replaced" : "amended",
    summary: `Version ${amendment.versionNumber} drafted, amending version ${signedVersion.versionNumber}.`,
    detail: `${amendment.changeReason} Changed: ${amendment.changedTermGroups.join(", ") || "nothing yet"}. Version ${signedVersion.versionNumber} and its signatures are unchanged.`,
  });

  // The contract points at the new draft; the signed version stays signed until
  // the amendment is itself fully signed.
  return viewOf(ctx, touch({ ...contract, currentVersionId: amendment.contractVersionId }), now);
}

/** Taking up a renewal, as a new version with the next term's dates. */
export function renewSync(
  ctx: AgreementContext,
  contractId: string,
  patch: Partial<ContractTerms> = {},
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:amend");
  const contract = findContract(ctx, contractId);
  const signedVersion = currentVersionOf(contract);
  assertAmendable(signedVersion);

  const next = nextTermDates(signedVersion.terms)
    ?? { from: signedVersion.terms.effective.from, to: signedVersion.terms.effective.to };
  const view = amendSync(ctx, {
    contractId,
    changeReason: "Renewal taken up for the next term.",
    kind: "replacement",
    terms: {
      ...patch,
      effective: {
        ...signedVersion.terms.effective,
        ...next,
        ...(patch.effective ?? {}),
      },
    },
  }, now);

  recordEvent(ctx, {
    contractId, kind: "renewed",
    summary: "Renewal drafted as a new version.",
    detail: "The previous term keeps its own dates and compensation rules.",
  });
  return view;
}

/* -------------------------------------------------------------------------- */
/* Termination                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Gives notice that the agreement is ending.
 *
 * What it creates: a termination record, the closeout checklist the terms asked
 * for, and one transition request per relationship the contract references, so
 * somebody revokes access in the service that controls it.
 *
 * What it does NOT do, ever: revoke access, end a relationship, release an
 * authority lease, or delete anything. Not the user, not the organization, not
 * the permanent equipment record, not this contract's history, not documents,
 * not completed loads, invoices or settlements.
 */
export function giveTerminationNoticeSync(
  ctx: AgreementContext,
  input: TerminationNoticeInput,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:terminate");
  const contract = findContract(ctx, input.contractId);
  const version = currentVersionOf(contract);
  // Checked before the status transition, so a second notice is told what is
  // actually in the way rather than "cannot move from terminated to terminated".
  if (terminationOf(contract.contractId)) {
    throw new ContractIssueError([
      "A termination has already been recorded for this contract. Withdraw it first, or finish its closeout.",
    ]);
  }

  assertTransition(deriveContractStatus(contract, version, now), "terminated");
  assertGroundAllowed(version.terms, input.ground);

  // The party giving notice is the caller's own. Nobody terminates on behalf of
  // the other side.
  const initiating = partiesOf(contract.contractId).find(
    (p) => p.organizationRef === ctx.organizationId,
  ) ?? partiesOf(contract.contractId).find((p) => p.isOwningParty)!;

  const effectiveAt = input.effectiveAt
    ?? terminationEffectiveDate(version.terms, input.ground, now);

  const steps: TerminationStepRecord[] = version.terms.termination.closeoutSteps.map((step) => ({
    key: step.key,
    label: step.label,
    owedByRole: step.owedByRole,
    dueAt: step.dueWithinDays != null
      ? new Date(new Date(effectiveAt).getTime() + step.dueWithinDays * 86_400_000).toISOString()
      : undefined,
  }));

  const requests = transitionsOnTermination(relationshipsOf(contract.contractId))
    .map(({ kind, ref }) => buildTransitionRequest({
      contractId: contract.contractId,
      contractVersionId: version.contractVersionId,
      agreementType: contract.agreementType,
      kind,
      target: { kind: ref.kind, externalId: ref.externalId, labelSnapshot: ref.labelSnapshot },
      reason: `${contract.reference} is being terminated (${input.ground}).`,
      requestedByMembershipId: ctx.membershipId,
      requestedByName: ctx.actorName,
      now,
    }));
  db().transitionRequests.push(...requests);

  const termination: ContractTermination = {
    terminationId: documentUuid(),
    contractId: contract.contractId,
    contractVersionId: version.contractVersionId,
    initiatedByPartyId: initiating.partyId,
    initiatedByMembershipId: ctx.membershipId,
    initiatedByName: ctx.actorName,
    ground: input.ground,
    reason: input.reason,
    noticeGivenAt: now,
    effectiveAt,
    status: new Date(effectiveAt).getTime() > new Date(now).getTime()
      ? "notice_given"
      : "in_closeout",
    steps,
    transitionRequestIds: requests.map((r) => r.id),
  };
  db().terminations.push(termination);

  // Closeout steps become requirements too, so an unfinished termination shows
  // up in Needs You rather than being something only this screen knows about.
  db().requirements.push(...steps.map((step) => requirement({
    contract, now, kind: "closeout", label: step.label,
    reason: "Agreed closeout step for the end of this agreement.",
    owedByPartyId: initiating.partyId, blocking: false, dueAt: step.dueAt,
  })));

  recordEvent(ctx, {
    contractId: contract.contractId, contractVersionId: version.contractVersionId,
    kind: "termination_notice",
    summary: `Termination notice given (${input.ground}), effective ${effectiveAt.slice(0, 10)}.`,
    detail: `${input.reason} Access is unchanged: ${requests.length} change${requests.length === 1 ? " has" : "s have"} been requested of the services that control it. Nothing has been deleted.`,
  });

  for (const request of requests) {
    recordEvent(ctx, {
      contractId: contract.contractId, kind: "transition_requested",
      summary: `Asked the ${request.ownerService} to ${request.kind.replace(/_/g, " ")}.`,
      detail: `Nothing has changed. ${request.nextStep}`,
    });
  }

  return viewOf(
    ctx,
    touch({ ...contract, status: "terminated", terminationId: termination.terminationId }),
    now,
  );
}

export function confirmTerminationStepSync(
  ctx: AgreementContext,
  contractId: string,
  step: TerminationStepKey,
  note: string | undefined,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:terminate");
  const contract = findContract(ctx, contractId);
  const termination = terminationOf(contractId);
  if (!termination) throw new NotFoundError("Termination record");

  const steps = termination.steps.map((s) => (
    s.key === step && !s.confirmedAt
      ? {
        ...s, confirmedAt: now, confirmedByMembershipId: ctx.membershipId,
        confirmedByName: ctx.actorName, note,
      }
      : s
  ));
  const complete = steps.every((s) => s.confirmedAt);
  const next: ContractTermination = {
    ...termination,
    steps,
    status: complete ? "completed" : "in_closeout",
    completedAt: complete ? now : undefined,
  };
  db().terminations = db().terminations.map(
    (t) => (t.terminationId === next.terminationId ? next : t),
  );

  recordEvent(ctx, {
    contractId, kind: "termination_step_confirmed",
    summary: `Closeout step confirmed: ${TERMINATION_STEP_TERM_LABEL[step]}.`,
    detail: note,
  });
  if (complete) {
    recordEvent(ctx, {
      contractId, kind: "termination_completed",
      summary: "Every closeout step is confirmed.",
      detail: "The contract, its versions, its signatures and its whole history are kept.",
    });
  }
  return viewOf(ctx, touch(contract), now);
}

export function withdrawTerminationSync(
  ctx: AgreementContext,
  contractId: string,
  reason: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:terminate");
  const contract = findContract(ctx, contractId);
  const termination = terminationOf(contractId);
  if (!termination) throw new NotFoundError("Termination record");
  if (termination.status === "completed") {
    throw new ContractIssueError([
      "That termination is finished. An agreement that has ended is restarted as a new contract, not by undoing the old one.",
    ]);
  }

  const next: ContractTermination = {
    ...termination, status: "withdrawn", withdrawnAt: now, withdrawnReason: reason,
  };
  db().terminations = db().terminations.map(
    (t) => (t.terminationId === next.terminationId ? next : t),
  );
  recordEvent(ctx, {
    contractId, kind: "termination_withdrawn",
    summary: "Termination withdrawn by agreement.", detail: reason,
  });
  return viewOf(
    ctx,
    touch({ ...contract, status: "active", terminationId: undefined }),
    now,
  );
}

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

export function waiveRequirementSync(
  ctx: AgreementContext,
  contractId: string,
  requirementId: string,
  reason: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:requirements:waive");
  const contract = findContract(ctx, contractId);
  const row = db().requirements.find(
    (r) => r.contractId === contractId && r.requirementId === requirementId,
  );
  if (!row) throw new NotFoundError("Contract requirement");

  // A signature can never be waived. Waiving one would mean an agreement that
  // nobody agreed to, presented as agreed.
  if (row.kind === "signature") {
    throw new ContractIssueError([
      "A signature cannot be waived. A party either signed or did not.",
    ]);
  }

  const waived: ContractRequirement = {
    ...row, status: "waived", waivedAt: now,
    waivedByMembershipId: ctx.membershipId, waivedReason: reason,
  };
  db().requirements = db().requirements.map(
    (r) => (r.requirementId === requirementId ? waived : r),
  );
  recordEvent(ctx, {
    contractId, kind: "requirement_waived",
    summary: `Waived: ${row.label}.`, detail: reason,
  });
  return viewOf(ctx, touch(contract), now);
}

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

export function linkRelationshipSync(
  ctx: AgreementContext,
  input: LinkRelationshipInput,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:links:manage");
  const contract = findContract(ctx, input.contractId);
  // The catalog decides, not the caller.
  assertRelationshipAllowed(contract.agreementType, input.kind);

  const ref: ContractRelationshipRef = {
    id: localId("crr"),
    contractId: contract.contractId,
    kind: input.kind,
    externalId: input.externalId,
    labelSnapshot: input.label,
    href: input.href,
    partyId: input.partyId,
    linkedAt: now,
  };
  db().relationships.push(ref);
  recordEvent(ctx, {
    contractId: contract.contractId, kind: "relationship_linked",
    summary: `Referenced ${RELATIONSHIP_REF_LABEL[input.kind]}: ${input.label}.`,
    detail: "A reference only. The relationship itself is unchanged, and this contract cannot change it.",
  });
  return viewOf(ctx, touch(contract), now);
}

export function detachRelationshipSync(
  ctx: AgreementContext,
  contractId: string,
  relationshipRefId: string,
  reason: string,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:links:manage");
  const contract = findContract(ctx, contractId);
  const ref = relationshipsOf(contractId).find((r) => r.id === relationshipRefId);
  if (!ref) throw new NotFoundError("Relationship reference");

  db().relationships = db().relationships.map(
    (r) => (r.id === relationshipRefId ? { ...r, detachedAt: now } : r),
  );
  recordEvent(ctx, {
    contractId, kind: "relationship_detached",
    summary: `Detached the reference to ${ref.labelSnapshot}.`,
    detail: `${reason} The relationship itself still exists and is untouched.`,
  });
  return viewOf(ctx, touch(contract), now);
}

export function linkRecordSync(
  ctx: AgreementContext,
  contractId: string,
  ref: ContractLinkRef,
  note: string | undefined,
  now = nowIso(),
): ContractView {
  requirePermissions(ctx, "contracts:links:manage");
  const contract = findContract(ctx, contractId);

  const link: ContractLink = {
    id: localId("ctl"),
    contractId: contract.contractId,
    ref: { ...ref },
    note,
    linkedAt: now,
    linkedByMembershipId: ctx.membershipId,
  };
  db().links.push(link);
  recordEvent(ctx, {
    contractId: contract.contractId, kind: "link_added",
    summary: `Linked ${CONTRACT_LINK_LABEL[ref.kind]}: ${ref.labelSnapshot}.`,
    detail: "A reference. Linking reads the record and never changes it.",
  });
  return viewOf(ctx, touch(contract), now);
}

/**
 * Records that the contract has asked a canonical service for a change.
 *
 * The entire body writes one note. There is no branch in here that calls a
 * relationship service, and there is nothing a caller can pass that would make
 * one happen.
 */
export function requestTransitionSync(
  ctx: AgreementContext,
  input: RequestTransitionInput,
  now = nowIso(),
): RelationshipTransitionRequest {
  requirePermissions(ctx, "contracts:links:manage");
  const contract = findContract(ctx, input.contractId);

  const request = buildTransitionRequest({
    contractId: contract.contractId,
    contractVersionId: input.contractVersionId,
    agreementType: contract.agreementType,
    kind: input.kind,
    target: {
      kind: input.target.kind,
      externalId: input.target.externalId,
      labelSnapshot: input.target.label,
    },
    reason: input.reason,
    requestedByMembershipId: ctx.membershipId,
    requestedByName: ctx.actorName,
    now,
  });
  db().transitionRequests.push(request);
  recordEvent(ctx, {
    contractId: contract.contractId, kind: "transition_requested",
    summary: `Asked the ${request.ownerService} to ${request.kind.replace(/_/g, " ")}.`,
    detail: `Nothing has changed. ${request.nextStep}`,
  });
  return request;
}

export function transitionRequestsSync(
  ctx: AgreementContext,
): RelationshipTransitionRequest[] {
  requirePermissions(ctx, "contracts:view");
  const mine = new Set(
    db().contracts.filter((c) => c.organizationId === ctx.organizationId)
      .map((c) => c.contractId),
  );
  return db().transitionRequests.filter((r) => mine.has(r.contractId));
}

/* -------------------------------------------------------------------------- */
/* Cross-module reads                                                          */
/* -------------------------------------------------------------------------- */

/** Every contract of one organization, for the Needs You bridge. */
export function contractsForOrganization(organizationId: string): Contract[] {
  return db().contracts.filter((c) => c.organizationId === organizationId);
}

export function contractPartiesFor(contractId: string): ContractParty[] {
  return partiesOf(contractId);
}

export function contractSignersFor(contractId: string): AuthorizedSigner[] {
  return signersOf(contractId);
}

export function contractSignaturesFor(contractId: string): ContractSignature[] {
  return signaturesOf(contractId);
}

export function contractVersion(contract: Contract): ContractVersion {
  return currentVersionOf(contract);
}

export function contractTermination(contractId: string): ContractTermination | undefined {
  return terminationOf(contractId);
}

export function contractRequirements(contract: Contract, now = nowIso()): ContractRequirement[] {
  return requirementsOf(contract, now);
}

export { isRequirementOpen };

export type { TerminationGround };

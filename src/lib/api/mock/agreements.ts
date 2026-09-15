import type {
  ContractFilters, ContractLinkRef, ContractSortKey, ContractSummary,
  ContractTerms, IsoDateTime, Page, PageRequest, TerminationStepKey,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import type {
  AgreementsService, AmendContractInput, AuthorizeSignerInput,
  CreateContractInput, LinkRelationshipInput, RequestTransitionInput,
  SignContractInput, TerminationNoticeInput,
} from "../contracts/agreements";
import {
  agreementContextFrom, amendSync, authorizeSignerSync, cancelSync,
  capabilitiesOf, compensationAtSync, confirmTerminationStepSync, createSync,
  dashboardSync, detachRelationshipSync, getSync, getVersionSync,
  giveTerminationNoticeSync, issueForSignatureSync, linkRecordSync,
  linkRelationshipSync, listSync, renewSync, requestTransitionSync,
  returnFromReviewSync, revokeSignerSync, sendForReviewSync, signSync,
  timelineOf, transitionRequestsSync, updateDraftTermsSync, waiveRequirementSync,
  withdrawTerminationSync, contractRequirements,
} from "./agreement-registry";
import { contractsForOrganization } from "./agreement-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The AgreementsService, over the registry.
 *
 * A thin shell on purpose: it adds the latency that makes the UI behave like a
 * real system and nothing else. Every permission check, authority check,
 * isolation check and immutability check is in the registry, so a caller that
 * bypasses this file and calls the registry directly — as the tests do — hits
 * exactly the same boundary.
 */

const LATENCY_MS = 180;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

async function delayed<T>(produce: () => T): Promise<T> {
  await wait();
  return produce();
}

/** Paginates a sorted list. Cursor is an offset; the shape is what matters here. */
function paginate(rows: ContractSummary[], page?: PageRequest): Page<ContractSummary> {
  const limit = page?.limit ?? 50;
  const start = page?.cursor ? Number(page.cursor) : 0;
  const items = rows.slice(start, start + limit);
  const next = start + limit;
  return {
    items,
    nextCursor: next < rows.length ? String(next) : undefined,
    totalCount: rows.length,
  };
}

export const mockAgreementsService: AgreementsService = {
  dashboard: (ctx: ServiceContext) =>
    delayed(() => dashboardSync(agreementContextFrom(ctx))),

  list: (
    ctx: ServiceContext,
    filters?: ContractFilters,
    sort?: ContractSortKey,
    page?: PageRequest,
  ) => delayed(() => paginate(
    listSync(agreementContextFrom(ctx), filters ?? {}, sort ?? "updated"),
    page,
  )),

  get: (ctx: ServiceContext, contractId: string) =>
    delayed(() => getSync(agreementContextFrom(ctx), contractId)),

  getVersion: (ctx: ServiceContext, contractId: string, contractVersionId: string) =>
    delayed(() => getVersionSync(agreementContextFrom(ctx), contractId, contractVersionId)),

  compensationAt: (ctx: ServiceContext, contractId: string, at: IsoDateTime) =>
    delayed(() => compensationAtSync(agreementContextFrom(ctx), contractId, at)),

  timeline: (ctx: ServiceContext, contractId: string) =>
    delayed(() => {
      // Read through `get` first, so isolation and the view permission are
      // applied before any event is returned.
      getSync(agreementContextFrom(ctx), contractId);
      return timelineOf(contractId);
    }),

  create: (ctx: ServiceContext, input: CreateContractInput) =>
    delayed(() => createSync(agreementContextFrom(ctx), input)),

  updateDraftTerms: (ctx: ServiceContext, contractId: string, terms: Partial<ContractTerms>) =>
    delayed(() => updateDraftTermsSync(agreementContextFrom(ctx), contractId, terms)),

  sendForReview: (ctx: ServiceContext, contractId: string, note?: string) =>
    delayed(() => sendForReviewSync(agreementContextFrom(ctx), contractId, note)),

  returnFromReview: (ctx: ServiceContext, contractId: string, note: string) =>
    delayed(() => returnFromReviewSync(agreementContextFrom(ctx), contractId, note)),

  issueForSignature: (ctx: ServiceContext, contractId: string) =>
    delayed(() => issueForSignatureSync(agreementContextFrom(ctx), contractId)),

  cancel: (ctx: ServiceContext, contractId: string, reason: string) =>
    delayed(() => cancelSync(agreementContextFrom(ctx), contractId, reason)),

  authorizeSigner: (ctx: ServiceContext, input: AuthorizeSignerInput) =>
    delayed(() => authorizeSignerSync(agreementContextFrom(ctx), input)),

  revokeSigner: (ctx: ServiceContext, contractId: string, signerId: string, reason: string) =>
    delayed(() => revokeSignerSync(agreementContextFrom(ctx), contractId, signerId, reason)),

  sign: (ctx: ServiceContext, input: SignContractInput) =>
    delayed(() => signSync(agreementContextFrom(ctx), input)),

  amend: (ctx: ServiceContext, input: AmendContractInput) =>
    delayed(() => amendSync(agreementContextFrom(ctx), input)),

  renew: (ctx: ServiceContext, contractId: string, terms?: Partial<ContractTerms>) =>
    delayed(() => renewSync(agreementContextFrom(ctx), contractId, terms)),

  giveTerminationNotice: (ctx: ServiceContext, input: TerminationNoticeInput) =>
    delayed(() => giveTerminationNoticeSync(agreementContextFrom(ctx), input)),

  confirmTerminationStep: (
    ctx: ServiceContext,
    contractId: string,
    step: TerminationStepKey,
    note?: string,
  ) => delayed(() => confirmTerminationStepSync(agreementContextFrom(ctx), contractId, step, note)),

  withdrawTermination: (ctx: ServiceContext, contractId: string, reason: string) =>
    delayed(() => withdrawTerminationSync(agreementContextFrom(ctx), contractId, reason)),

  requirements: (ctx: ServiceContext, contractId: string) =>
    delayed(() => {
      const view = getSync(agreementContextFrom(ctx), contractId);
      return contractRequirements(view.contract);
    }),

  waiveRequirement: (
    ctx: ServiceContext,
    contractId: string,
    requirementId: string,
    reason: string,
  ) => delayed(() => waiveRequirementSync(agreementContextFrom(ctx), contractId, requirementId, reason)),

  linkRelationship: (ctx: ServiceContext, input: LinkRelationshipInput) =>
    delayed(() => linkRelationshipSync(agreementContextFrom(ctx), input)),

  detachRelationship: (
    ctx: ServiceContext,
    contractId: string,
    relationshipRefId: string,
    reason: string,
  ) => delayed(() => detachRelationshipSync(agreementContextFrom(ctx), contractId, relationshipRefId, reason)),

  linkRecord: (
    ctx: ServiceContext,
    contractId: string,
    ref: ContractLinkRef,
    note?: string,
  ) => delayed(() => linkRecordSync(agreementContextFrom(ctx), contractId, ref, note)),

  requestRelationshipTransition: (ctx: ServiceContext, input: RequestTransitionInput) =>
    delayed(() => requestTransitionSync(agreementContextFrom(ctx), input)),

  transitionRequests: (ctx: ServiceContext) =>
    delayed(() => transitionRequestsSync(agreementContextFrom(ctx))),

  capabilities: (ctx: ServiceContext, contractId: string) =>
    delayed(() => {
      const actor = agreementContextFrom(ctx);
      const view = getSync(actor, contractId);
      return capabilitiesOf(actor, view.contract);
    }),
};

export { contractsForOrganization };

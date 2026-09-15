import {
  type Contract, type ContractRequirement, type ContractTermination,
  type ContractVersion, type NeedsYouItem, type NeedsYouSeverity,
  type PermissionKey,
} from "@/types";
import {
  capabilitiesOf, contractPartiesFor, contractRequirements, contractSignaturesFor,
  contractTermination, contractVersion, contractsForOrganization,
  type AgreementContext,
} from "./agreement-registry";
import {
  agreementTypeLabel, daysBetween, deriveContractStatus, isRequirementOpen,
  partiesOutstanding,
} from "@/lib/contracts";
import { nowIso } from "./time";

/**
 * Contracts in the Needs You queue.
 *
 * Every item is DERIVED from live contract state on every read, the same way
 * documents, insurance and maintenance are. Sign the version and the signature
 * item stops existing; produce the certificate and the requirement item stops
 * existing; renew the agreement and the expiry item stops existing. Nothing is
 * seeded, and nothing is closed by somebody ticking it off, because hiding the
 * row would not fix the thing it is about.
 *
 * Four conditions, exactly as the brief names them, plus two the module cannot
 * honestly leave out:
 *
 *   missing signature       a version is out for signature and waiting
 *   expiring contract       inside the agreement's own reminder window
 *   unmet requirement       something the agreement asks for is not there
 *   unresolved termination  notice given, closeout steps outstanding
 *   expired contract        it ran out and nobody renewed or replaced it
 *   waiting for review      a draft somebody sent for review and nobody read
 *
 * Ids are stable and derived from the record, so an item somebody snoozed is the
 * same item after a reload rather than a fresh one.
 */

const PREFIX = "ny_contract_";

export function isAgreementNeedsYouId(id: string): boolean {
  return id.startsWith(PREFIX);
}

const itemId = (parts: string[]) => `${PREFIX}${parts.join("_")}`;

/** The permission needed to see a contract item at all. */
const VIEW: PermissionKey[] = ["contracts:view"];

function severityForDays(days: number): NeedsYouSeverity {
  if (days < 0) return "critical";
  if (days <= 7) return "high";
  if (days <= 21) return "medium";
  return "low";
}

function contractEntity(contract: Contract) {
  return {
    kind: "contract" as const,
    id: contract.contractId,
    label: `${contract.reference} · ${contract.title}`,
    href: `/contracts/${contract.contractId}`,
  };
}

/**
 * Every contract item this membership should see, right now.
 *
 * Permission-gated per item, and signature items are gated by AUTHORITY too: a
 * carrier owner is not asked to chase their own signature line when the
 * signature that is missing is the driver's to give — they are told the driver
 * has not signed, which is a different item with a different action.
 */
export function agreementNeedsYouItems(
  ctx: AgreementContext,
  now = nowIso(),
): NeedsYouItem[] {
  if (!ctx.permissions.has("contracts:view")) return [];

  const items: NeedsYouItem[] = [];

  for (const contract of contractsForOrganization(ctx.organizationId)) {
    const version = contractVersion(contract);
    const status = deriveContractStatus(contract, version, now);
    const requirements = contractRequirements(contract, now);
    const termination = contractTermination(contract.contractId);

    items.push(
      ...signatureItems(ctx, contract, version, now),
      ...expiryItems(ctx, contract, version, status, now),
      ...requirementItems(ctx, contract, requirements, status, now),
      ...terminationItems(ctx, contract, termination, now),
      ...reviewItems(ctx, contract, status, now),
    );
  }

  return items;
}

/* -------------------------------------------------------------------------- */
/* Missing signatures                                                          */
/* -------------------------------------------------------------------------- */

function signatureItems(
  ctx: AgreementContext,
  contract: Contract,
  version: ContractVersion,
  now: string,
): NeedsYouItem[] {
  if (version.status !== "issued") return [];

  const parties = contractPartiesFor(contract.contractId);
  const outstanding = partiesOutstanding(
    parties, contractSignaturesFor(contract.contractId), version.contractVersionId,
  );
  if (outstanding.length === 0) return [];

  const capabilities = capabilitiesOf(ctx, contract, now);
  const mine = new Set(capabilities.signableForPartyIds);

  return outstanding.map((party) => {
    const isMine = mine.has(party.partyId);
    return {
      id: itemId(["sign", contract.contractId, party.partyId, String(version.versionNumber)]),
      organizationId: contract.organizationId,
      category: "contract_signature_missing" as const,
      // Their own signature is theirs to give now; somebody else's is a chase.
      severity: isMine ? "high" as const : "medium" as const,
      status: "open" as const,
      title: isMine
        ? `Sign ${contract.reference} for ${party.legalNameSnapshot}`
        : `${party.legalNameSnapshot} has not signed ${contract.reference}`,
      reason: isMine
        ? `Version ${version.versionNumber} is out for signature and you are authorised to sign for ${party.legalNameSnapshot}.`
        : `Version ${version.versionNumber} is out for signature and ${party.legalNameSnapshot} has still to sign. You cannot sign for them — no party may sign for another.`,
      detail: `${agreementTypeLabel(contract.agreementType)}. Signatures in Antcolos are typed names recorded against a version: nothing is verified, delivered or legally binding.`,
      entity: contractEntity(contract),
      recommendedAction: {
        kind: isMine ? "sign_contract" as const : "chase_signature" as const,
        label: isMine ? "Open and sign" : "Chase the signature",
        requires: isMine ? (["contracts:sign"] as PermissionKey[]) : VIEW,
      },
      source: "system" as const,
      requires: VIEW,
      derived: true,
      createdAt: version.issuedAt ?? contract.createdAt,
      history: [],
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Expiring and expired                                                        */
/* -------------------------------------------------------------------------- */

function expiryItems(
  ctx: AgreementContext,
  contract: Contract,
  version: ContractVersion,
  status: string,
  now: string,
): NeedsYouItem[] {
  if (status !== "expiring" && status !== "expired") return [];
  const to = version.terms.effective.to;
  if (!to) return [];

  const days = daysBetween(now, to);
  const expired = status === "expired";
  const renewal = version.terms.renewal;

  return [{
    id: itemId([expired ? "expired" : "expiring", contract.contractId]),
    organizationId: contract.organizationId,
    category: expired ? "contract_expired" as const : "contract_expiring" as const,
    severity: expired ? "high" as const : severityForDays(days),
    status: "open" as const,
    title: expired
      ? `${contract.reference} has run out`
      : `${contract.reference} ends in ${days} day${days === 1 ? "" : "s"}`,
    reason: expired
      ? `The agreement ended on ${to.slice(0, 10)} and nothing has renewed or replaced it. Work is still being done under terms that have lapsed.`
      : renewal.kind === "automatic"
        ? `It renews automatically for another ${renewal.termDays ?? 0} days unless somebody gives ${renewal.noticeDays ?? 0} days' notice.`
        : `It ends on ${to.slice(0, 10)} and does not renew by itself.`,
    detail: `${agreementTypeLabel(contract.agreementType)}. Renewing means a new version — the current terms keep their own dates and compensation rules.`,
    entity: contractEntity(contract),
    recommendedAction: {
      kind: "renew_contract" as const,
      label: expired ? "Replace or close it out" : "Renew or give notice",
      requires: ["contracts:amend"] as PermissionKey[],
    },
    dueAt: to,
    source: "system" as const,
    requires: VIEW,
    derived: true,
    createdAt: contract.updatedAt,
    history: [],
  }];
}

/* -------------------------------------------------------------------------- */
/* Unmet requirements                                                          */
/* -------------------------------------------------------------------------- */

function requirementItems(
  ctx: AgreementContext,
  contract: Contract,
  requirements: ContractRequirement[],
  status: string,
  now: string,
): NeedsYouItem[] {
  // A cancelled agreement asks for nothing: it never took effect.
  if (status === "cancelled") return [];

  const parties = contractPartiesFor(contract.contractId);

  return requirements
    // Signatures have their own item, with the authority nuance. Closeout steps
    // belong to the termination item.
    .filter((r) => r.kind !== "signature" && r.kind !== "closeout")
    .filter((r) => isRequirementOpen(r.status))
    .map((requirement) => {
      const party = parties.find((p) => p.partyId === requirement.owedByPartyId);
      const overdue = requirement.dueAt != null
        && new Date(requirement.dueAt).getTime() < new Date(now).getTime();
      return {
        id: itemId(["req", contract.contractId, requirement.requirementId]),
        organizationId: contract.organizationId,
        category: "contract_requirement_unmet" as const,
        severity: requirement.blocking
          ? (overdue ? "critical" as const : "high" as const)
          : "low" as const,
        status: "open" as const,
        title: `${requirement.label} outstanding on ${contract.reference}`,
        reason: requirement.status === "expired"
          ? `${party?.legalNameSnapshot ?? "A party"} produced this and it has run out.`
          : `${contract.reference} asks ${party?.legalNameSnapshot ?? "a party"} for this and there is nothing against it.`,
        detail: requirement.blocking
          ? `${requirement.reason} The agreement cannot go active while this is outstanding.`
          : requirement.reason,
        entity: contractEntity(contract),
        relatedEntities: requirement.kind === "document"
          ? [{ kind: "document" as const, id: requirement.requirementId, label: requirement.label, href: "/documents" }]
          : undefined,
        recommendedAction: {
          kind: requirement.kind === "document"
            ? "request_document" as const
            : "satisfy_requirement" as const,
          label: requirement.kind === "document"
            ? "Open the Document Center"
            : "Open the contract",
          requires: VIEW,
        },
        dueAt: requirement.dueAt,
        source: "system" as const,
        requires: VIEW,
        derived: true,
        createdAt: requirement.createdAt,
        history: [],
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Unresolved terminations                                                     */
/* -------------------------------------------------------------------------- */

function terminationItems(
  ctx: AgreementContext,
  contract: Contract,
  termination: ContractTermination | undefined,
  now: string,
): NeedsYouItem[] {
  if (!termination) return [];
  if (termination.status === "completed" || termination.status === "withdrawn") return [];

  const outstanding = termination.steps.filter((s) => !s.confirmedAt);
  if (outstanding.length === 0) return [];

  const past = new Date(termination.effectiveAt).getTime() < new Date(now).getTime();

  return [{
    id: itemId(["termination", contract.contractId, termination.terminationId]),
    organizationId: contract.organizationId,
    category: "contract_termination_unresolved" as const,
    // Once the end date has passed, an unfinished closeout means somebody still
    // holds access, equipment or money they should not.
    severity: past ? "high" as const : "medium" as const,
    status: "open" as const,
    title: `${contract.reference} termination is not finished`,
    reason: past
      ? `The agreement ended on ${termination.effectiveAt.slice(0, 10)} and ${outstanding.length} closeout step${outstanding.length === 1 ? " is" : "s are"} still outstanding: ${outstanding.map((s) => s.label).join(", ")}.`
      : `Notice has been given, effective ${termination.effectiveAt.slice(0, 10)}. ${outstanding.length} closeout step${outstanding.length === 1 ? "" : "s"} to work through.`,
    detail: "Access is revoked in the modules that control it, not here. Nothing is deleted: the person, the organization, the equipment record, this contract's history, the documents, the completed loads, invoices and settlements all survive.",
    entity: contractEntity(contract),
    recommendedAction: {
      kind: "complete_termination" as const,
      label: "Work through the closeout",
      requires: ["contracts:terminate"] as PermissionKey[],
    },
    dueAt: termination.effectiveAt,
    source: "system" as const,
    requires: VIEW,
    derived: true,
    createdAt: termination.noticeGivenAt,
    history: [],
  }];
}

/* -------------------------------------------------------------------------- */
/* Drafts waiting to be read                                                   */
/* -------------------------------------------------------------------------- */

function reviewItems(
  ctx: AgreementContext,
  contract: Contract,
  status: string,
  now: string,
): NeedsYouItem[] {
  if (status !== "pending_review") return [];
  if (!ctx.permissions.has("contracts:review")) return [];

  const waitingDays = Math.max(0, daysBetween(contract.updatedAt, now));
  return [{
    id: itemId(["review", contract.contractId]),
    organizationId: contract.organizationId,
    category: "contract_review_waiting" as const,
    severity: waitingDays >= 5 ? "medium" as const : "low" as const,
    status: "open" as const,
    title: `${contract.reference} is waiting to be read`,
    reason: `It was sent for review ${waitingDays === 0 ? "today" : `${waitingDays} day${waitingDays === 1 ? "" : "s"} ago`} and nobody has returned it or issued it for signature.`,
    detail: "\"Pending review\" means somebody on your team is reading it. No lawyer has seen it — Antcolos has no legal review integration and gives no legal advice.",
    entity: contractEntity(contract),
    recommendedAction: {
      kind: "review_contract" as const,
      label: "Read and decide",
      requires: ["contracts:review"] as PermissionKey[],
    },
    source: "system" as const,
    requires: ["contracts:view", "contracts:review"] as PermissionKey[],
    derived: true,
    createdAt: contract.updatedAt,
    history: [],
  }];
}

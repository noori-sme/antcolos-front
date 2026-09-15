import {
  type ContractRequirement, type ContractRequirementStatus, type IsoDateTime,
} from "@/types";

/**
 * Requirements are evaluated, not stored.
 *
 * The same rule the Document Center follows: a checklist item with nothing
 * against it is "missing", which is a fact about the checklist rather than a
 * record in its own right. So a requirement's status is worked out on every
 * read from whatever is supposed to satisfy it — and fixing the document,
 * policy or authority clears the requirement without anybody ticking it off.
 *
 * One exception, and it is stored because it is a decision somebody made:
 * `waived`. A waiver is a person with authority saying "not for this agreement",
 * and it has to survive a reload and appear in the audit timeline.
 */

/**
 * What satisfies one requirement, as the service layer found it.
 *
 * The service builds these by asking the OWNING module — the Document Center
 * for documents, the insurance registry for coverage, the carrier profile for
 * Operating Authority — and never by looking at a field on the contract.
 */
export interface RequirementEvidence {
  requirementId: string;
  /** True when the owning module currently has something that satisfies it. */
  present: boolean;
  /** When what satisfies it runs out, if it does. */
  expiresAt?: IsoDateTime;
  /** True when the requirement cannot apply here at all. */
  notApplicable?: boolean;
}

/**
 * The requirement's status right now.
 *
 * Order matters and is the whole logic:
 *   1. a waiver is a decision and outranks the evidence
 *   2. not-applicable is not the same as met, and never counts as satisfied
 *   3. present-but-expired is `expired`, which is different from `unmet`:
 *      somebody did produce the document, and it has run out
 */
export function evaluateRequirement(
  requirement: Pick<ContractRequirement, "waivedAt">,
  evidence: RequirementEvidence | undefined,
  now: IsoDateTime,
): ContractRequirementStatus {
  if (requirement.waivedAt) return "waived";
  if (!evidence) return "unmet";
  if (evidence.notApplicable) return "not_applicable";
  if (!evidence.present) return "unmet";
  if (evidence.expiresAt && new Date(evidence.expiresAt).getTime() < new Date(now).getTime()) {
    return "expired";
  }
  return "met";
}

/** Statuses that leave a requirement outstanding. */
export function isRequirementOpen(status: ContractRequirementStatus): boolean {
  return status === "unmet" || status === "expired";
}

/**
 * Blocking requirements that are still outstanding.
 *
 * Only these stop a contract going active. A non-blocking requirement is real —
 * it appears on the screen and raises a Needs You item — but it does not hold up
 * an agreement the parties are ready to sign.
 */
export function openBlockingRequirements(
  requirements: readonly ContractRequirement[],
): ContractRequirement[] {
  return requirements.filter((r) => r.blocking && isRequirementOpen(r.status));
}

export function openRequirements(
  requirements: readonly ContractRequirement[],
): ContractRequirement[] {
  return requirements.filter((r) => isRequirementOpen(r.status));
}

/** Requirements past their due date and still open. */
export function overdueRequirements(
  requirements: readonly ContractRequirement[],
  now: IsoDateTime,
): ContractRequirement[] {
  return openRequirements(requirements).filter(
    (r) => r.dueAt != null && new Date(r.dueAt).getTime() < new Date(now).getTime(),
  );
}

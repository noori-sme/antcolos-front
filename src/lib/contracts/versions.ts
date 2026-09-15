import type {
  ContractTermGroup, ContractTerms, ContractVersion, ContractVersionKind,
} from "@/types";

/**
 * Version immutability — the rule the rest of the module is built to keep.
 *
 * A signed version is a statement of what two parties agreed at a moment. It is
 * never edited, never re-signed and never deleted. Changing terms means a NEW
 * version that cites the old one, and both stay on the record forever, with
 * their signatures, their compensation rules and their dates.
 *
 * Everything here is pure. The service layer calls `assertVersionMutable`
 * before every write to a version, and `freeze` when one stops being editable.
 */

export class ContractVersionFrozenError extends Error {
  constructor(readonly contractVersionId: string, readonly versionNumber: number) {
    super(
      `Version ${versionNumber} is signed or closed and can never be edited. Create an amendment instead — the signed terms, signatures and history stay exactly as they are.`,
    );
    this.name = "ContractVersionFrozenError";
  }
}

/** Versions whose terms may still change in place. Exactly one status. */
export function isVersionMutable(version: Pick<ContractVersion, "status" | "frozen">): boolean {
  return version.status === "draft" && !version.frozen;
}

export function assertVersionMutable(
  version: Pick<ContractVersion, "contractVersionId" | "versionNumber" | "status" | "frozen">,
): void {
  if (!isVersionMutable(version)) {
    throw new ContractVersionFrozenError(version.contractVersionId, version.versionNumber);
  }
}

/**
 * Marks a version permanently unchangeable.
 *
 * There is deliberately no `unfreeze`. A version that could be unfrozen is a
 * version whose signed terms could be rewritten, which is the single thing this
 * module exists to prevent.
 */
export function freeze<T extends ContractVersion>(version: T): T {
  return { ...version, frozen: true };
}

/** The next version number for a contract. Gapless, 1-based, never reused. */
export function nextVersionNumber(existing: readonly Pick<ContractVersion, "versionNumber">[]): number {
  return existing.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
}

export class ContractAmendmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractAmendmentError";
  }
}

/**
 * Which term groups differ between two sets of terms.
 *
 * Computed rather than asked for, so an amendment cannot claim it only touched
 * the renewal clause while quietly rewriting the pay. The service layer stores
 * the computed answer on the new version and the UI shows it.
 */
export function changedTermGroups(
  before: ContractTerms,
  after: ContractTerms,
): ContractTermGroup[] {
  const groups: ContractTermGroup[] = [];
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

  if (differs(before.effective, after.effective)) groups.push("effective_dates");
  if (differs(before.renewal, after.renewal)) groups.push("renewal");
  if (differs(before.termination, after.termination)) groups.push("termination");
  if (differs(before.compensation, after.compensation)) groups.push("compensation");
  if (differs(before.responsibilities, after.responsibilities)) groups.push("responsibilities");
  if (differs(before.requiredDocuments, after.requiredDocuments)) groups.push("required_documents");
  return groups;
}

/**
 * Whether a version may be amended at all.
 *
 * Only a signed version can be amended: amending a draft is just editing it,
 * and amending a voided or superseded version would create a second live branch
 * of the same agreement.
 */
export function canAmend(version: Pick<ContractVersion, "status">): boolean {
  return version.status === "signed";
}

export function assertAmendable(
  version: Pick<ContractVersion, "status" | "versionNumber">,
): void {
  if (!canAmend(version)) {
    throw new ContractAmendmentError(
      `Version ${version.versionNumber} is ${version.status}. Only a signed version can be amended — a draft is edited, and a superseded or withdrawn version stays as it is.`,
    );
  }
}

/**
 * The terms an amendment starts from.
 *
 * A copy of the signed terms, so the amendment is written as a whole statement
 * and the diff against its predecessor is computable. Deep-cloned: sharing the
 * arrays would let editing an amendment mutate the signed version it came from,
 * which is exactly the failure this file exists to make impossible.
 */
export function cloneTerms(terms: ContractTerms): ContractTerms {
  return {
    summary: terms.summary,
    effective: { ...terms.effective },
    renewal: { ...terms.renewal },
    termination: {
      ...terms.termination,
      grounds: [...terms.termination.grounds],
      closeoutSteps: terms.termination.closeoutSteps.map((s) => ({ ...s })),
      survivingObligations: terms.termination.survivingObligations
        ? [...terms.termination.survivingObligations]
        : undefined,
    },
    compensation: terms.compensation.map((r) => ({ ...r })),
    responsibilities: terms.responsibilities.map((r) => ({ ...r })),
    requiredDocuments: terms.requiredDocuments.map((r) => ({ ...r })),
    additionalTerms: terms.additionalTerms,
  };
}

/** What an amendment or replacement is called on the timeline. */
export const VERSION_KIND_LABEL: Record<ContractVersionKind, string> = {
  original: "Original",
  amendment: "Amendment",
  replacement: "Restated agreement",
};

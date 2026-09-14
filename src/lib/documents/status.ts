import type {
  DocumentChecklistItem, DocumentRecord, DocumentRequirement, DocumentStatus,
} from "@/types";

/**
 * How long before an expiry a document starts asking for attention.
 *
 * One number, in one place. Home, the Document Center, the checklists and the
 * Needs You queue all read it, so they can never disagree about what "expiring
 * soon" means.
 */
export const EXPIRING_SOON_DAYS = 45;

const DAY_MS = 86_400_000;

export function daysUntil(isoDate: string, now: Date = new Date()): number {
  return Math.ceil((new Date(isoDate).getTime() - now.getTime()) / DAY_MS);
}

/**
 * The status a document actually has right now.
 *
 * Expiry is applied on READ, never written into the record, because time moves
 * and a stored "expiring_soon" would be a lie the moment it went stale. A
 * superseded or rejected document is left alone: a replaced document does not
 * become "expired" just because the clock passed its date.
 */
export function effectiveStatus(
  document: Pick<DocumentRecord, "status" | "expiresAt">,
  now: Date = new Date(),
): DocumentStatus {
  if (document.status === "superseded") return "superseded";
  if (document.status === "rejected") return "rejected";
  if (!document.expiresAt) return document.status;
  // Only a document that has been accepted, or is waiting to be, can lapse.
  if (document.status !== "approved" && document.status !== "pending_review") {
    return document.status;
  }
  const days = daysUntil(document.expiresAt, now);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return document.status;
}

/** Statuses that mean somebody has to do something. */
export const ATTENTION_STATUSES: readonly DocumentStatus[] = [
  "missing", "rejected", "expired", "expiring_soon",
];

/** Statuses that mean the requirement is genuinely satisfied for now. */
export const SATISFIED_STATUSES: readonly DocumentStatus[] = [
  "approved", "expiring_soon", "pending_review",
];

export function needsAttention(status: DocumentStatus): boolean {
  return ATTENTION_STATUSES.includes(status);
}

/**
 * Join a checklist to the documents that fill it.
 *
 * The requirement list and the document list stay separate inputs — this
 * function is the only place they meet, and it produces a view rather than a
 * stored record.
 */
export function buildChecklist(
  requirements: readonly DocumentRequirement[],
  documents: readonly DocumentRecord[],
  now: Date = new Date(),
): DocumentChecklistItem[] {
  const live = documents.filter((d) => d.status !== "superseded");
  return requirements.map((requirement) => {
    const document = live.find((d) =>
      d.links.some((l) => !l.unlinkedAt && l.requirementKey === requirement.key),
    );
    const versionCount = document
      ? documents.filter((d) => d.lineageId === document.lineageId).length
      : 0;
    const primaryHere = document?.links.find(
      (l) => l.requirementKey === requirement.key,
    )?.primary;
    return {
      requirement,
      document,
      status: document ? effectiveStatus(document, now) : "missing",
      versionCount,
      linkedFromOtherContext: document ? primaryHere === false : undefined,
    };
  });
}

export interface ChecklistCompletion {
  required: number;
  satisfied: number;
  percent: number;
  outstanding: DocumentChecklistItem[];
}

/** Optional requirements never count against completion. */
export function checklistCompletion(
  items: readonly DocumentChecklistItem[],
): ChecklistCompletion {
  const required = items.filter((i) => i.requirement.applicability === "required");
  const outstanding = required.filter((i) => !SATISFIED_STATUSES.includes(i.status));
  const satisfied = required.length - outstanding.length;
  return {
    required: required.length,
    satisfied,
    percent: required.length === 0 ? 100 : Math.round((satisfied / required.length) * 100),
    outstanding,
  };
}

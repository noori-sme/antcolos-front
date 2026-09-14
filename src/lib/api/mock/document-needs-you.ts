import { daysUntil } from "@/lib/documents/status";
import { documentTypeLabel } from "@/lib/documents/catalog";
import type {
  NeedsYouHistoryEntry, NeedsYouItem, NeedsYouSeverity,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import { documentAttentionRows } from "./documents";

/**
 * Needs You items that are REAL.
 *
 * They are not seeded rows that happen to mention a document. Every item below
 * is computed from live document state each time it is asked for: resolve the
 * underlying document and the item stops existing; let an expiry pass and one
 * appears without anybody writing a fixture. That is the difference between a
 * queue and a screenshot.
 *
 * Because the items are derived, their ids have to be derived too — the same
 * missing W-9 must be the same item on every read, or snoozing it would be
 * pointless. The id is built from the organization, the subject and the
 * requirement, and an overlay here holds what a person has DONE to the item
 * (assigned, snoozed, escalated, resolved), which is the only part of an item
 * that is not a function of the documents.
 */

/** What a person did to a derived item. Keyed by the item's derived id. */
interface ItemOverlay {
  status?: NeedsYouItem["status"];
  assigneeMembershipId?: string;
  snoozedUntil?: string;
  snoozeReason?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  history: NeedsYouHistoryEntry[];
}

let overlays: Record<string, ItemOverlay> = {};

/** Test hook. Never called by the UI. */
export function resetDocumentNeedsYou() {
  overlays = {};
}

export const DOCUMENT_ITEM_PREFIX = "nydoc_";

export function isDocumentNeedsYouId(id: string): boolean {
  return id.startsWith(DOCUMENT_ITEM_PREFIX);
}

function itemId(organizationId: string, subjectId: string, requirementKey: string): string {
  return `${DOCUMENT_ITEM_PREFIX}${organizationId}_${subjectId}_${requirementKey}`;
}

const SYSTEM = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system" as const,
};

/**
 * How loudly to ask.
 *
 * An expired document is a compliance failure that already happened; a
 * rejection is somebody waiting on a person; an expiry approaching is planning.
 * Optional requirements never raise anything above "low" — asking loudly for
 * something that is not required is how a queue teaches people to ignore it.
 */
function severityFor(status: string, required: boolean, days: number | null): NeedsYouSeverity {
  if (!required) return "low";
  if (status === "expired") return "critical";
  if (status === "rejected") return "high";
  if (status === "missing") return "high";
  if (status === "expiring_soon") return days != null && days <= 14 ? "high" : "medium";
  return "low";
}

export function documentNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const row of documentAttentionRows(ctx)) {
    const required = row.requirement.applicability === "required";
    const status = row.status;
    // Missing, rejected and expiring are the three the Document Center owes the
    // queue. Approved, pending and locally selected are not somebody's problem.
    if (status !== "missing" && status !== "rejected" && status !== "expiring_soon" && status !== "expired") {
      continue;
    }
    // An optional requirement that nobody has supplied is not an exception.
    if (!required && status === "missing") continue;

    const days = row.document?.expiresAt ? daysUntil(row.document.expiresAt) : null;
    const id = itemId(ctx.organizationId, row.subject.id, row.requirement.key);
    const label = row.requirement.label || documentTypeLabel(row.requirement.typeKey);
    const overlay = overlays[id];

    const { title, reason, category, action } = describe(status, label, row.subject.label, days, row.document?.links);

    const createdAt = row.document?.updatedAt ?? row.document?.createdAt ?? new Date().toISOString();
    const item: NeedsYouItem = {
      id,
      organizationId: ctx.organizationId,
      category,
      severity: severityFor(status, required, days),
      status: overlay?.status ?? "open",
      title,
      reason,
      detail: row.requirement.reason,
      entity: {
        kind: "document",
        id: row.document?.documentId ?? row.requirement.key,
        label: `${label} · ${row.subject.label}`,
        href: row.document ? `/documents/${row.document.documentId}` : "/documents",
      },
      relatedEntities: row.subject.href
        ? [{ kind: entityKindFor(row.subject.kind), id: row.subject.id, label: row.subject.label, href: row.subject.href }]
        : undefined,
      recommendedAction: action,
      dueAt: row.document?.expiresAt,
      assigneeMembershipId: overlay?.assigneeMembershipId,
      source: "system",
      requires: ["documents:view"],
      createdAt,
      snoozedUntil: overlay?.snoozedUntil,
      snoozeReason: overlay?.snoozeReason,
      resolvedAt: overlay?.resolvedAt,
      resolutionNote: overlay?.resolutionNote,
      history: overlay?.history ?? [
        { id: `${id}_created`, at: createdAt, actor: SYSTEM, action: "created", note: reason },
      ],
    };
    items.push(item);
  }

  return items;
}

function entityKindFor(kind: string): NeedsYouItem["entity"]["kind"] {
  if (kind === "truck" || kind === "driver" || kind === "load") return kind;
  // Trailers and organizations have no Needs You entity kind of their own; the
  // document is the entity, and the related link carries the rest.
  return "document";
}

function describe(
  status: string,
  label: string,
  subjectLabel: string,
  days: number | null,
  links?: unknown,
): {
  title: string;
  reason: string;
  category: NeedsYouItem["category"];
  action: NeedsYouItem["recommendedAction"];
} {
  void links;
  switch (status) {
    case "missing":
      return {
        title: `${label} missing`,
        reason: `Nothing has been supplied for ${subjectLabel}.`,
        category: "missing_document",
        action: {
          kind: "request_document",
          label: "Add the document",
          requires: ["documents:upload"],
        },
      };
    case "rejected":
      return {
        title: `${label} was rejected`,
        reason: `The version on file for ${subjectLabel} was sent back and has not been replaced.`,
        category: "missing_document",
        action: {
          kind: "request_document",
          label: "Replace it",
          requires: ["documents:upload"],
        },
      };
    case "expired":
      return {
        title: `${label} has expired`,
        reason: days != null
          ? `It expired ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago and no longer covers ${subjectLabel}.`
          : `It no longer covers ${subjectLabel}.`,
        category: "expiring_document",
        action: {
          kind: "request_document",
          label: "Upload a current one",
          requires: ["documents:upload"],
        },
      };
    default:
      return {
        title: `${label} expires soon`,
        reason: days != null
          ? `${days} ${days === 1 ? "day" : "days"} left on the version covering ${subjectLabel}.`
          : `The version covering ${subjectLabel} is close to its expiry date.`,
        category: "expiring_document",
        action: {
          kind: "request_document",
          label: "Renew it",
          requires: ["documents:upload"],
        },
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Acting on a derived item                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Records what a person did to a derived item.
 *
 * The document itself is untouched: snoozing a missing insurance certificate
 * does not make it less missing, and resolving one is a statement about the
 * queue, not about the paperwork. The moment the document is genuinely fixed,
 * the item stops being produced at all and the overlay becomes irrelevant.
 */
export function applyDocumentItemAction(
  item: NeedsYouItem,
  change: Partial<Omit<ItemOverlay, "history">> & { historyEntry: NeedsYouHistoryEntry },
): NeedsYouItem {
  const existing = overlays[item.id] ?? { history: item.history };
  const next: ItemOverlay = {
    ...existing,
    ...change,
    history: [...existing.history, change.historyEntry],
  };
  delete (next as Partial<ItemOverlay> & { historyEntry?: unknown }).historyEntry;
  overlays[item.id] = next;

  return {
    ...item,
    status: next.status ?? item.status,
    assigneeMembershipId: next.assigneeMembershipId,
    snoozedUntil: next.snoozedUntil,
    snoozeReason: next.snoozeReason,
    resolvedAt: next.resolvedAt,
    resolutionNote: next.resolutionNote,
    history: next.history,
  };
}

export function findDocumentNeedsYouItem(
  ctx: ServiceContext,
  itemId: string,
): NeedsYouItem | undefined {
  return documentNeedsYouItems(ctx).find((i) => i.id === itemId);
}

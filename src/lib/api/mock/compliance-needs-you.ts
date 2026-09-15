import { isOpen } from "@/lib/compliance";
import type {
  ActorRef, ComplianceRequirement, NeedsYouCategory, NeedsYouEntityRef,
  NeedsYouHistoryEntry, NeedsYouItem, NeedsYouSeverity, PermissionKey,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import { accessReasonFor } from "./compliance";
import { allRequirements, syncOrganization } from "./compliance-registry";

/**
 * Compliance in Needs You.
 *
 * Safety & Compliance does NOT get its own alert system. It feeds the one that
 * already exists, through this bridge: one Needs You item per open compliance
 * requirement, carrying the requirement's own severity, deadline, permissions
 * and links.
 *
 * The items are real — they can be assigned, snoozed, escalated and resolved
 * like any other, and their state survives the requirement being recomputed.
 * What they cannot do is drift: the title, reason, severity, deadline and
 * permissions are derived from the requirement on every read, and an item whose
 * requirement stops being open resolves itself.
 */

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

/** Compliance items carry this prefix, so the Needs You service can route them. */
export const COMPLIANCE_ITEM_PREFIX = "nyc_";

export function isComplianceItemId(id: string): boolean {
  return id.startsWith(COMPLIANCE_ITEM_PREFIX);
}

/** Mutable half: whatever a person did to the item. Survives recomputation. */
interface ItemState {
  status: NeedsYouItem["status"];
  assigneeMembershipId?: string;
  snoozedUntil?: string;
  snoozeReason?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  history: NeedsYouHistoryEntry[];
}

const itemStates = new Map<string, ItemState>();

/** Test hook. Never called by the UI. */
export function resetComplianceNeedsYou() {
  itemStates.clear();
}

/**
 * Which bucket this belongs in.
 *
 * Critical wins outright: an owner scanning the queue needs the critical items
 * to read as critical rather than as five different flavours of paperwork.
 */
function categoryFor(requirement: ComplianceRequirement): NeedsYouCategory {
  if (requirement.severity === "critical") return "compliance_critical";
  if (requirement.evidence?.state === "rejected") return "compliance_rejected";
  if (requirement.status === "expired") return "compliance_expired";
  if (requirement.status === "expiring") return "compliance_expiring";
  return "compliance_missing";
}

const BUMP: Record<NeedsYouSeverity, NeedsYouSeverity> = {
  critical: "critical", high: "critical", medium: "high", low: "medium",
};

/** An expired requirement is worse than the same requirement merely due. */
function severityFor(requirement: ComplianceRequirement): NeedsYouSeverity {
  const base = requirement.severity as NeedsYouSeverity;
  return requirement.status === "expired" ? BUMP[base] : base;
}

/**
 * Which open requirements are worth interrupting somebody over.
 *
 * Not all of them, deliberately. Needs You is a queue of decisions, and a
 * carrier with fifty pieces of outstanding medium-severity paperwork has a
 * dashboard problem, not fifty interruptions. Anything already lapsed or about
 * to lapse raises an item whatever its severity; anything merely missing raises
 * one when it is severe enough to stop the subject working, or when a person
 * looked at the evidence and rejected it. The rest live on the compliance
 * dashboard, which is where you go to work through paperwork.
 */
function raisesNeedsYou(requirement: ComplianceRequirement): boolean {
  if (!isOpen(requirement.status)) return false;
  if (requirement.status === "expired" || requirement.status === "expiring") return true;
  if (requirement.evidence?.state === "rejected") return true;
  return requirement.severity === "critical" || requirement.severity === "high";
}

const SUBJECT_ENTITY: Record<
  ComplianceRequirement["subject"]["kind"], NeedsYouEntityRef["kind"]
> = {
  carrier: "organization", driver: "driver", truck: "truck", trailer: "trailer",
};

function reasonFor(requirement: ComplianceRequirement): string {
  if (requirement.evidence?.state === "rejected") {
    return (
      requirement.evidence.rejectionReason ??
      `The evidence on file for ${requirement.label.toLowerCase()} was rejected and nothing has replaced it.`
    );
  }
  if (requirement.status === "expired") {
    return `${requirement.label} lapsed${requirement.dueAt ? ` on ${requirement.dueAt.slice(0, 10)}` : ""}. ${requirement.subject.label} should not run until it is back in date.`;
  }
  if (requirement.status === "expiring") {
    return `${requirement.label} is inside its warning window${requirement.dueAt ? ` and is due on ${requirement.dueAt.slice(0, 10)}` : ""}.`;
  }
  return requirement.statusReason ?? `Nothing on file satisfies ${requirement.label.toLowerCase()}.`;
}

function relatedEntities(requirement: ComplianceRequirement): NeedsYouEntityRef[] {
  const related: NeedsYouEntityRef[] = [
    {
      kind: SUBJECT_ENTITY[requirement.subject.kind],
      id: requirement.subject.id,
      label: requirement.subject.label,
      href: requirement.subject.href,
    },
  ];
  // The document that would satisfy it, in the system that owns the file.
  if (requirement.evidence && requirement.evidence.system !== "recorded_attestation") {
    related.push({
      kind: "document",
      id: requirement.evidence.id,
      label: requirement.evidence.fileName ?? requirement.evidence.label,
      href: requirement.evidence.href,
    });
  }
  // Whoever owes it — always, because an item nobody owns is an item nobody
  // does. The recorded owner of a piece of equipment may be a person or a
  // company, and the item says which rather than guessing.
  const owner = requirement.responsible;
  related.push({
    kind: owner.driverProfileId
      ? "driver"
      : owner.kind === "organization" && owner.organizationId
        ? "organization"
        : "person",
    id: owner.driverProfileId ?? owner.membershipId ?? owner.organizationId ?? owner.displayName,
    label: owner.displayName,
    href: owner.href,
  });
  return related;
}

function itemIdFor(requirement: ComplianceRequirement): string {
  return `${COMPLIANCE_ITEM_PREFIX}${requirement.id}`;
}

export function requirementIdFromItemId(itemId: string): string {
  return itemId.slice(COMPLIANCE_ITEM_PREFIX.length);
}

function initialState(requirement: ComplianceRequirement): ItemState {
  return {
    status: "open",
    history: [
      {
        id: `nych_${requirement.id}`,
        at: requirement.updatedAt,
        actor: SYSTEM_ACTOR,
        action: "created",
        note: reasonFor(requirement),
      },
    ],
  };
}

function project(requirement: ComplianceRequirement, state: ItemState): NeedsYouItem {
  return {
    id: itemIdFor(requirement),
    organizationId: requirement.organizationId,
    category: categoryFor(requirement),
    severity: severityFor(requirement),
    status: state.status,
    title: `${requirement.subject.label} · ${requirement.label}`,
    reason: reasonFor(requirement),
    detail: `${requirement.description} Tracked as a requirement in its own right — ${requirement.authority.toLowerCase()}.`,
    entity: {
      kind: "compliance_requirement",
      id: requirement.id,
      label: `${requirement.subject.label} · ${requirement.label}`,
      href: `/compliance/${requirement.id}`,
    },
    relatedEntities: relatedEntities(requirement),
    recommendedAction: {
      kind: "open_compliance",
      label: "Open the compliance record",
      // Acting on it needs manage; the item itself is visible to viewers.
      requires: ["compliance:manage"],
    },
    dueAt: requirement.dueAt,
    assigneeMembershipId: state.assigneeMembershipId,
    source: "system",
    requires: [...requirement.requires] as PermissionKey[],
    createdAt: requirement.createdAt,
    snoozedUntil: state.snoozedUntil,
    snoozeReason: state.snoozeReason,
    resolvedAt: state.resolvedAt,
    resolutionNote: state.resolutionNote,
    history: state.history,
  };
}

/**
 * The compliance items this membership may see.
 *
 * Visibility is decided by the compliance service, not re-derived here, so a
 * dispatch organization's Needs You cannot surface a requirement its shares do
 * not cover.
 */
export function complianceNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!ctx.permissions.has("compliance:view")) return [];
  syncOrganization(ctx.organizationId);

  const items: NeedsYouItem[] = [];
  for (const requirement of allRequirements()) {
    // Frozen history never raises work, and neither does somebody else's record.
    if (requirement.frozenAt) continue;
    if (requirement.organizationId !== ctx.organizationId) continue;
    if (accessReasonFor(ctx, requirement) === null) continue;

    const id = itemIdFor(requirement);
    const existing = itemStates.get(id);
    const open = raisesNeedsYou(requirement);

    if (!open) {
      // The requirement is satisfied. An item that was open closes itself and
      // says why, rather than being deleted and losing its history.
      if (!existing || existing.status === "resolved") continue;
      const resolved: ItemState = {
        ...existing,
        status: "resolved",
        resolvedAt: new Date().toISOString(),
        resolutionNote: `The requirement is now ${requirement.status.replace("_", " ")}.`,
        snoozedUntil: undefined,
        snoozeReason: undefined,
        history: [
          ...existing.history,
          {
            id: `nych_auto_${requirement.id}_${existing.history.length}`,
            at: new Date().toISOString(),
            actor: SYSTEM_ACTOR,
            action: "resolved",
            note: `Closed automatically: the requirement is now ${requirement.status.replace("_", " ")}.`,
          },
        ],
      };
      itemStates.set(id, resolved);
      items.push(project(requirement, resolved));
      continue;
    }

    let state = existing ?? initialState(requirement);
    // A snooze that has run out puts the item back in the queue.
    if (state.status === "snoozed" && state.snoozedUntil && new Date(state.snoozedUntil).getTime() <= Date.now()) {
      state = { ...state, status: "open", snoozedUntil: undefined, snoozeReason: undefined };
    }
    // The requirement lapsed again after being closed: reopen rather than
    // silently creating a second item with no history.
    if (state.status === "resolved") {
      state = {
        ...state,
        status: "open",
        resolvedAt: undefined,
        resolutionNote: undefined,
        history: [
          ...state.history,
          {
            id: `nych_reopen_${requirement.id}_${state.history.length}`,
            at: new Date().toISOString(),
            actor: SYSTEM_ACTOR,
            action: "reopened",
            note: `The requirement needs action again: ${reasonFor(requirement)}`,
          },
        ],
      };
    }
    itemStates.set(id, state);
    items.push(project(requirement, state));
  }
  return items;
}

export function complianceNeedsYouItem(
  ctx: ServiceContext,
  itemId: string,
): NeedsYouItem | undefined {
  return complianceNeedsYouItems(ctx).find((i) => i.id === itemId);
}

/**
 * Persist what a person did to a compliance-backed item.
 *
 * Only the mutable half is stored. Everything derived from the requirement is
 * recomputed on the next read, which is why acting on the item can never make
 * it disagree with the record it describes.
 */
export function replaceComplianceNeedsYou(item: NeedsYouItem): void {
  itemStates.set(item.id, {
    status: item.status,
    assigneeMembershipId: item.assigneeMembershipId,
    snoozedUntil: item.snoozedUntil,
    snoozeReason: item.snoozeReason,
    resolvedAt: item.resolvedAt,
    resolutionNote: item.resolutionNote,
    history: item.history,
  });
}

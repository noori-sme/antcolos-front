import type {
  MtLoop, NeedsYouItem, PermissionKey, ResponsibilityContext,
  ResponsibilityFunction, ResponsibilityScopeRef, ResponsibilitySeverity,
} from "@/types";

/**
 * ███ MOCK-LAYER BRIDGE ███
 *
 * Where the existing domain modules emit typed responsibility context.
 *
 * The integration rule is explicit: "Existing domain modules must emit typed
 * responsibility context; the routing engine determines the default responsible
 * Membership. Feature components must not hardcode individual names or role
 * labels." This file is the first half of that. MT Loop keeps owning loops and
 * Needs You keeps owning items; neither learns anything about memberships, and
 * neither gains a second opinion about who should hold their work.
 *
 * Nothing here names a person, and nothing here reads a title.
 */

/* -------------------------------------------------------------------------- */
/* Which function work belongs to                                              */
/* -------------------------------------------------------------------------- */

/**
 * The work's function, derived from the PERMISSIONS it needs.
 *
 * This is the milestone's rule made mechanical. "Do not assign work based only
 * on role names" is easy to agree with and easy to violate by writing a table
 * from category to job title. So there is no such table: the function comes
 * from the permission domains the work actually requires, which is the same
 * evidence the eligibility gate uses to decide who may do it.
 *
 * The consequence is worth noticing — a Needs You category added next year is
 * classified correctly the day it appears, with no entry added here, because it
 * will declare the permissions it needs like every other item.
 */
const DOMAIN_FUNCTION: ReadonlyArray<[prefix: string, fn: ResponsibilityFunction]> = [
  // Most specific first: `maintenance:defects:report` must not be read as
  // dispatch just because a truck is involved.
  ["maintenance:", "maintenance"],
  ["compliance:", "compliance"],
  ["insurance:", "safety"],
  ["claims:", "safety"],
  ["risk:", "safety"],
  ["audit:", "safety"],
  ["proposals:", "driver_action"],
  ["trips:", "driver_action"],
  ["settlements:", "finance"],
  ["invoices:", "finance"],
  ["rates:", "finance"],
  ["revenue:", "finance"],
  ["expenses:", "finance"],
  ["profitability:", "finance"],
  ["fuel:", "finance"],
  ["mileage:", "finance"],
  ["ifta:", "finance"],
  ["documents:", "documents"],
  ["contracts:", "administration"],
  ["members:", "administration"],
  ["invitations:", "administration"],
  ["organization:", "administration"],
  ["integrations:", "administration"],
  ["permissions:", "administration"],
  ["customers:", "dispatch"],
  ["loads:", "dispatch"],
  ["dispatch:", "dispatch"],
  ["tracking:", "dispatch"],
  ["trucks:", "dispatch"],
  ["trailers:", "dispatch"],
  ["fleet:", "dispatch"],
  ["eld:", "dispatch"],
  ["drivers:", "dispatch"],
];

export function functionForPermissions(
  requires: readonly PermissionKey[],
): ResponsibilityFunction {
  for (const [prefix, fn] of DOMAIN_FUNCTION) {
    if (requires.some((key) => key.startsWith(prefix))) return fn;
  }
  // Work that needs no permission at all is somebody's to look at, and the
  // workspace's own business rather than any desk's.
  return "administration";
}

/* -------------------------------------------------------------------------- */
/* MT Loop                                                                     */
/* -------------------------------------------------------------------------- */

/** What a loop takes to work. The board already gates on exactly these two. */
const LOOP_REQUIRES: readonly PermissionKey[] = ["loads:view", "trucks:view"];

/**
 * How badly a loop needs somebody.
 *
 * Derived from the cycle rather than typed in anywhere: a truck that is empty
 * NOW with nobody on it is the most expensive thing on a dispatch board, and a
 * truck that goes empty on Thursday is not. Blocked sits between the two —
 * somebody has it and cannot move it.
 */
function loopSeverity(loop: MtLoop): ResponsibilitySeverity {
  const emptyAt = loop.expectedEmptyAt ? new Date(loop.expectedEmptyAt).getTime() : undefined;
  const emptyNow = emptyAt === undefined || emptyAt <= Date.now();

  if (loop.status === "blocked") return "high";
  if (!loop.responsibleMembershipId && emptyNow) return "critical";
  if (emptyNow) return "high";
  if (loop.status === "paused") return "low";
  return "medium";
}

/**
 * One loop, as the responsibility engine reads it.
 *
 * `acknowledgedAt` is the moment somebody first took the loop, which is exactly
 * what the acknowledgement clock is asking about: the first assignment on the
 * record, never the current one, so a handoff does not reset a clock that was
 * already met.
 */
export function responsibilityContextForLoop(loop: MtLoop): ResponsibilityContext {
  const scope: ResponsibilityScopeRef[] = [
    { kind: "truck", id: loop.truckId, label: `Truck ${loop.truckUnit}` },
    { kind: "carrier", id: loop.carrierOrganizationId, label: loop.carrierName },
    { kind: "function", label: "Dispatch" },
  ];
  if (loop.driverProfileId) {
    scope.splice(1, 0, {
      kind: "driver",
      id: loop.driverProfileId,
      label: loop.driverName ?? "Assigned driver",
    });
  }
  if (loop.loadId) {
    scope.push({ kind: "load", id: loop.loadId, label: loop.loadReference ?? "Booked load" });
  }

  const firstHeld = loop.assignments[0]?.assignedAt;

  return {
    organizationId: loop.dispatchOrganizationId,
    work: {
      kind: "mt_loop",
      id: loop.loopId,
      label: `${loop.truckUnit} — ${loop.carrierName}`,
      href: `/dispatch/trucks/${loop.truckId}`,
    },
    functionKey: "dispatch",
    severity: loopSeverity(loop),
    scope,
    requires: [...LOOP_REQUIRES],
    carrierOrganizationId: loop.carrierOrganizationId,
    truckId: loop.truckId,
    trailerId: loop.trailerId,
    driverProfileId: loop.driverProfileId,
    loadId: loop.loadId,
    openedAt: loop.openedAt,
    dueAt: loop.respondBy ?? loop.expectedEmptyAt,
    acknowledgedAt: firstHeld,
    resolvedAt: loop.closedAt,
    blocked: loop.status === "blocked",
    blockedReason: loop.blockReason,
    // A loop that has changed hands more than twice has been round the houses,
    // which is the loop-shaped version of "repeated failure".
    reopenCount: Math.max(0, loop.assignments.length - 1),
  };
}

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The actions that cannot be finished by the person doing them.
 *
 * Kept as recommended-action kinds rather than categories, because the action
 * is what says whether somebody else has to sign off: approving a settlement
 * and signing a contract are approvals wherever they come from, and a category
 * list would need a new entry every time one of them acquired a new source.
 */
const NEEDS_APPROVAL = new Set([
  "approve_settlement", "sign_contract", "review_contract", "resolve_dispute",
]);

/** The entity kinds that map cleanly onto a responsibility scope. */
const SCOPE_KIND: Partial<Record<NeedsYouItem["entity"]["kind"], ResponsibilityScopeRef["kind"]>> = {
  truck: "truck",
  trailer: "trailer",
  driver: "driver",
  load: "load",
  carrier: "carrier",
  mt_loop: "truck",
};

export function responsibilityContextForNeedsYou(
  item: NeedsYouItem,
): ResponsibilityContext {
  const requires = [
    ...new Set([...item.requires, ...item.recommendedAction.requires]),
  ] as PermissionKey[];

  const functionKey = functionForPermissions(requires);

  const scope: ResponsibilityScopeRef[] = [];
  const scopeKind = SCOPE_KIND[item.entity.kind];
  if (scopeKind) {
    scope.push({ kind: scopeKind, id: item.entity.id, label: item.entity.label });
  }
  for (const related of item.relatedEntities ?? []) {
    const kind = SCOPE_KIND[related.kind];
    if (kind && !scope.some((s) => s.id === related.id)) {
      scope.push({ kind, id: related.id, label: related.label });
    }
  }
  scope.push({ kind: "function", label: functionKey });

  const truckId = entityId(item, "truck");
  const driverProfileId = entityId(item, "driver");

  return {
    organizationId: item.organizationId,
    work: {
      kind: "needs_you",
      id: item.id,
      label: item.title,
      href: item.recommendedAction.href ?? item.entity.href,
    },
    functionKey,
    severity: item.severity,
    scope,
    requires,
    carrierOrganizationId: entityId(item, "carrier"),
    truckId,
    driverProfileId,
    loadId: entityId(item, "load"),
    openedAt: item.createdAt,
    dueAt: item.dueAt,
    // Somebody taking an item on is the acknowledgement. Derived from the
    // history rather than stored a second time, so the two can never disagree.
    acknowledgedAt: item.history.find((h) => h.action === "assigned")?.at,
    resolvedAt: item.resolvedAt,
    // The one honest "blocked" a Needs You item can have: the screen that would
    // fix it does not exist yet, so the person genuinely cannot act.
    blocked: item.recommendedAction.deferred === true,
    blockedReason: item.recommendedAction.deferred
      ? "The screen that fixes this is not built yet."
      : undefined,
    reopenCount: item.history.filter((h) => h.action === "reopened").length,
    approvalRequired: NEEDS_APPROVAL.has(item.recommendedAction.kind),
  };
}

/** The first entity of a kind on an item, main entity or related. */
function entityId(item: NeedsYouItem, kind: NeedsYouItem["entity"]["kind"]): string | undefined {
  if (item.entity.kind === kind) return item.entity.id;
  return item.relatedEntities?.find((r) => r.kind === kind)?.id;
}

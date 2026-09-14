import type {
  DispatchWorkspaceSummary, Load, Membership, Organization, WorkAssignment,
  Workspace, WorkspaceActivityItem, WorkspaceCarrier, WorkspaceWorkItem,
} from "@/types";
import { destinationStop, originStop } from "@/types";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import { mockStore } from "./store";
import { fleetSync, truckContextFrom } from "./truck-registry";
import { mtLoopBoardSync } from "./mt-loop";
import { syncDerivedNeedsYou } from "./needs-you-derive";
import { trailerFleetSync } from "./trailer-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The dispatch workspace dashboard, assembled in one place for both shapes of
 * dispatch workspace.
 *
 * There is one summary function, not two. What differs between a lone
 * dispatcher and a dispatch organization is not a different dashboard but a
 * different ANSWER from the same questions: a solo workspace has no team, so
 * `teamWork` comes back undefined rather than empty, and the screen renders
 * nothing for it. An employee scoped to their own records gets the same
 * undefined, for a completely different reason, and the screen is none the
 * wiser — which is the point. Every narrowing decision is made here, where the
 * records are, not in a component that could forget one.
 *
 * Absent and empty are kept apart throughout. `teamWork: undefined` means "not
 * yours to see"; `teamWork: []` means "nobody is holding anything".
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 280;

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;
const iso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Work assignments                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Partitioned by organization, exactly like every other mock collection, so a
 * membership in one workspace cannot reach work held in another.
 */
const assignments = new Map<string, WorkAssignment[]>();

function bucket(organizationId: string): WorkAssignment[] {
  let rows = assignments.get(organizationId);
  if (!rows) {
    rows = seedAssignments(organizationId);
    assignments.set(organizationId, rows);
  }
  return rows;
}

/** Test hook. Never called by the UI. */
export function resetWorkAssignments() {
  seq = 0;
  assignments.clear();
}

/**
 * Who is holding what, to begin with.
 *
 * Written against membership ids rather than names, because that is what a work
 * assignment points at. The solo workspace holds everything itself; the team
 * organization has some held, some with a colleague, and some in the queue.
 */
function seedAssignments(organizationId: string): WorkAssignment[] {
  const now = iso();
  const rows: WorkAssignment[] = [];
  const hold = (loadRef: string, membershipId: string, assigneeName: string) => {
    const load = mockStore.org(organizationId).loads.find((l) => l.reference === loadRef);
    if (!load) return;
    rows.push({
      id: rowId("work"), organizationId, loadId: load.id, membershipId, assigneeName,
      status: "assigned", assignedAt: now, assignedByMembershipId: membershipId,
    });
  };

  if (organizationId === "org_solo") {
    // Everything is the lone dispatcher's. There is nobody else.
    hold("SD-118", "mem_solo_dispatcher", "Sam Murtaza");
    hold("SD-121", "mem_solo_dispatcher", "Sam Murtaza");
    hold("SD-124", "mem_solo_dispatcher", "Sam Murtaza");
  }
  if (organizationId === "org_summit") {
    hold("SM-4410", "mem_summit_owner", "Sam Murtaza");
    hold("SM-4408", "mem_summit_owner", "Sam Murtaza");
    // Held by somebody else in the organization. The owner sees it as team work.
    hold("SM-4412", "mem_summit_rosa", "Rosa Delgado");
    // SM-4415 and SM-4417 are deliberately left unassigned.
  }
  if (organizationId === "org_meridian") {
    hold("MD-9042", "mem_meridian_dispatcher", "Sam Murtaza");
    hold("MD-9038", "mem_meridian_dispatcher", "Sam Murtaza");
    hold("MD-9051", "mem_meridian_lane", "Lane Okafor");
    // MD-9050 stays in the queue.
  }
  return rows;
}

function liveAssignment(organizationId: string, loadId: string): WorkAssignment | undefined {
  return bucket(organizationId).find((a) => a.loadId === loadId && a.status === "assigned");
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What the dashboard needs to know about the caller.
 *
 * The organization and the membership arrive together and are never inferred
 * from one another: the workspace shape comes from the organization, the
 * permissions and scope come from the membership, and the person's identity is
 * not consulted at all.
 */
export interface WorkspaceContext extends ServiceContext {
  organization: Organization;
  membership: Membership;
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

/** Carrier ids on loads are prefixed; the organization ids are not. */
function carrierOrgIdFrom(raw: string): string {
  return raw.startsWith("carrier_") ? `org_${raw.slice("carrier_".length)}` : raw;
}

const CARRIER_NAMES: Record<string, string> = {
  org_northline: "Northline Freight",
  org_baxter: "Baxter Transit LLC",
  org_ridgeway: "Ridgeway Carriers",
  org_crosswind: "Crosswind Freight",
  org_cascade: "Cascade Haul",
};
const carrierName = (id: string) => CARRIER_NAMES[id] ?? id;

const ACTIVE_STATUSES: Load["status"][] = [
  "planned", "offered", "accepted", "assigned", "dispatched",
  "at_pickup", "loaded", "in_transit", "at_delivery", "verifying",
];

function toWorkItem(load: Load, ctx: WorkspaceContext): WorkspaceWorkItem {
  const held = liveAssignment(ctx.organizationId, load.id);
  const origin = originStop(load);
  const destination = destinationStop(load);
  const carrierRaw = load.assignment?.carrierOrganizationId;

  return {
    loadId: load.id,
    reference: load.reference,
    status: load.status,
    customerName: load.customer.name,
    originCity: origin?.address.city,
    originState: origin?.address.state,
    destinationCity: destination?.address.city,
    destinationState: destination?.address.state,
    nextAppointmentAt: load.stops.find((s) => !s.departedAt)?.appointmentAt,
    assigneeName: held?.assigneeName,
    assigneeMembershipId: held?.membershipId,
    isMine: held?.membershipId === ctx.membershipId,
    carrierName: carrierRaw ? carrierName(carrierOrgIdFrom(carrierRaw)) : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The summary                                                                 */
/* -------------------------------------------------------------------------- */

export async function dispatchWorkspaceSummary(
  ctx: WorkspaceContext,
): Promise<DispatchWorkspaceSummary> {
  await sleep(LATENCY_MS);
  return dispatchWorkspaceSummarySync(ctx);
}

export function dispatchWorkspaceSummarySync(ctx: WorkspaceContext): DispatchWorkspaceSummary {
  const workspace = resolveWorkspace(ctx.organization, ctx.membership);
  if (!workspace) throw new PermissionDeniedError(["loads:view"]);

  const canSeeLoads = ctx.permissions.has("loads:view");
  const canAssignWork = ctx.permissions.has("loads:assign");
  const canSeeMembers = ctx.permissions.has("members:view");
  const canSeeInvitations = ctx.permissions.has("invitations:view");
  const canManageRoles = ctx.permissions.has("permissions:manage");
  // A membership scoped to its own records never sees another person's work,
  // whatever else it may do.
  const ownRecordsOnly = ctx.scope.loads === "assigned";

  const org = mockStore.org(ctx.organizationId);
  const loads = canSeeLoads ? org.loads : [];
  const active = loads.filter((l) => ACTIVE_STATUSES.includes(l.status));

  const mine: WorkspaceWorkItem[] = [];
  const others: WorkspaceWorkItem[] = [];
  const unassigned: WorkspaceWorkItem[] = [];

  for (const load of active) {
    const held = liveAssignment(ctx.organizationId, load.id);
    const item = toWorkItem(load, ctx);
    if (!held) unassigned.push(item);
    else if (held.membershipId === ctx.membershipId) mine.push(item);
    else others.push(item);
  }

  /* ---- Team work: absent unless there IS a team and it is theirs to see ---- */
  const maySeeTeamWork = workspace.supportsTeam && canSeeLoads && !ownRecordsOnly;
  /* ---- Unassigned: absent unless the person can actually hand work out ---- */
  const maySeeQueue = workspace.supportsTeam && canAssignWork && !ownRecordsOnly;

  /* ---- Carriers and equipment, from the dispatch-access grants ---- */
  const truckCtx = truckContextFrom(ctx);
  const trucks = ctx.permissions.has("trucks:view") ? fleetSync(truckCtx) : [];
  const trailers = ctx.permissions.has("trailers:view") ? trailerFleetSync(truckCtx) : [];

  const carrierMap = new Map<string, WorkspaceCarrier>();
  const bump = (id: string, patch: Partial<WorkspaceCarrier>) => {
    const existing = carrierMap.get(id) ?? {
      organizationId: id, name: carrierName(id),
      truckCount: 0, trailerCount: 0, activeLoadCount: 0,
    };
    carrierMap.set(id, {
      ...existing,
      truckCount: existing.truckCount + (patch.truckCount ?? 0),
      trailerCount: existing.trailerCount + (patch.trailerCount ?? 0),
      activeLoadCount: existing.activeLoadCount + (patch.activeLoadCount ?? 0),
    });
  };
  // Grouped by organization id, never by the printed name. One carrier writes
  // itself down as "Northline Freight" on a load and "Northline Freight LLC" on
  // a dispatch grant; keying on what is printed gives it two rows and halves
  // both counts.
  for (const t of trucks) {
    if (t.carrierOrganizationId) bump(t.carrierOrganizationId, { truckCount: 1 });
  }
  for (const t of trailers) {
    if (t.carrierOrganizationId) bump(t.carrierOrganizationId, { trailerCount: 1 });
  }
  for (const load of active) {
    const raw = load.assignment?.carrierOrganizationId;
    if (raw) bump(carrierOrgIdFrom(raw), { activeLoadCount: 1 });
  }

  /* ---- Activity: the load timeline, newest first, already org-scoped ---- */
  const referenceOf = new Map(loads.map((l) => [l.id, l.reference]));
  const activity: WorkspaceActivityItem[] = canSeeLoads
    ? [...org.events]
        .filter((e) => referenceOf.has(e.loadId))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 8)
        .map((e) => ({
          id: e.id,
          at: e.occurredAt,
          summary: e.payload?.note ?? EVENT_SUMMARY[e.kind] ?? e.kind.replace(/[._]/g, " "),
          loadReference: referenceOf.get(e.loadId),
          actorName: e.actor?.displayNameSnapshot,
        }))
    : [];

  /* ---- MT Loop, first thing on the dashboard and first thing computed ---- */
  // It runs before Needs You on purpose: the loops are reconciled against the
  // trucks here, and the Needs You rules then read the reconciled loops. One
  // direction, so the two can never disagree about the same truck.
  const mtLoop = mtLoopBoardSync(ctx);

  // Needs You is generated from live state rather than stored, so it is
  // regenerated here too — otherwise the count on this dashboard could differ
  // from the queue the person is about to open.
  syncDerivedNeedsYou(ctx);
  const needsYou = mockStore.org(ctx.organizationId).needsYou
    .filter((n) => n.status === "open" || n.status === "escalated")
    .filter((n) => n.requires.every((k) => ctx.permissions.has(k)));

  return {
    workspace,
    mtLoop,
    myWork: mine,
    teamWork: maySeeTeamWork ? others : undefined,
    unassignedWork: maySeeQueue ? unassigned : undefined,
    carriers: [...carrierMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    equipment: {
      truckCount: trucks.length,
      trailerCount: trailers.length,
      idleTruckCount: trucks.filter((t) => !t.currentDriverName).length,
      unattachedTrailerCount: trailers.filter((t) => t.attachmentState === "unattached").length,
    },
    activity,
    team: workspace.supportsTeam && canSeeMembers
      ? {
          memberCount: TEAM_SIZE[ctx.organizationId] ?? 1,
          pendingInvitationCount: canSeeInvitations ? (PENDING_INVITES[ctx.organizationId] ?? 0) : 0,
          roleCount: canManageRoles ? (ROLE_COUNT[ctx.organizationId] ?? 0) : 0,
        }
      : undefined,
    counts: {
      needsYouOpen: needsYou.length,
      needsYouCritical: needsYou.filter((n) => n.severity === "critical").length,
      myWorkCount: mine.length,
      teamWorkCount: maySeeTeamWork ? others.length : 0,
      unassignedCount: maySeeQueue ? unassigned.length : 0,
    },
  };
}

/** Plain-language names for the event kinds the dashboard shows. */
const EVENT_SUMMARY: Record<string, string> = {
  "load.created": "Load created",
  "load.status_changed": "Status changed",
  "load.assigned": "Assigned to a truck",
  "load.eta_updated": "ETA updated",
  "load.location_reported": "Location reported",
  "stop.arrived": "Arrived at a stop",
  "stop.departed": "Departed a stop",
  "document.uploaded": "Document added",
  "document.approved": "Document approved",
};

/** Stand-ins until the members service is wired to the dashboard. */
const TEAM_SIZE: Record<string, number> = { org_summit: 4, org_meridian: 9 };
const PENDING_INVITES: Record<string, number> = { org_summit: 1, org_meridian: 2 };
const ROLE_COUNT: Record<string, number> = { org_summit: 3, org_meridian: 5 };

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export type WorkActionOutcome =
  | { status: "assigned"; assignment: WorkAssignment }
  | { status: "released" }
  | { status: "already_held"; assigneeName: string }
  | { status: "not_permitted" }
  | { status: "not_found" };

/**
 * Take a piece of unassigned work for yourself.
 *
 * Claiming is deliberately a lower bar than handing work to somebody else:
 * anybody who may see the loads may pick one up, while assigning to another
 * person needs `loads:assign`. The check and the write happen together with no
 * await between them, so two dispatchers pressing Claim at the same moment
 * cannot both end up holding it.
 */
export async function claimWork(loadId: string, ctx: WorkspaceContext): Promise<WorkActionOutcome> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("loads:view")) return { status: "not_permitted" };

  /* ---- critical section: no awaits from here to the return ---- */
  const load = mockStore.org(ctx.organizationId).loads.find((l) => l.id === loadId);
  if (!load) return { status: "not_found" };

  const held = liveAssignment(ctx.organizationId, loadId);
  if (held) {
    return held.membershipId === ctx.membershipId
      ? { status: "assigned", assignment: held }
      : { status: "already_held", assigneeName: held.assigneeName };
  }

  const created: WorkAssignment = {
    id: rowId("work"),
    organizationId: ctx.organizationId,
    loadId,
    membershipId: ctx.membershipId,
    assigneeName: ctx.actor.displayNameSnapshot,
    status: "assigned",
    assignedAt: iso(),
    assignedByMembershipId: ctx.membershipId,
  };
  bucket(ctx.organizationId).push(created);
  /* ---- end critical section ---- */
  return { status: "assigned", assignment: created };
}

/** Put a piece of work back in the queue. Only the holder may let it go. */
export async function releaseWork(loadId: string, ctx: WorkspaceContext): Promise<WorkActionOutcome> {
  await sleep(LATENCY_MS);
  const held = liveAssignment(ctx.organizationId, loadId);
  if (!held) return { status: "not_found" };

  // The holder can always let go. Anybody else needs the authority to move work.
  const isHolder = held.membershipId === ctx.membershipId;
  if (!isHolder && !ctx.permissions.has("loads:assign")) return { status: "not_permitted" };

  const rows = bucket(ctx.organizationId);
  const i = rows.findIndex((a) => a.id === held.id);
  rows[i] = { ...held, status: "released", releasedAt: iso() };
  return { status: "released" };
}

/**
 * Hand a piece of work to somebody else in the workspace.
 *
 * Needs `loads:assign`, and needs the workspace to have somebody to hand it to
 * — in a workspace of one there is no such thing.
 */
export async function assignWorkTo(
  loadId: string,
  membershipId: string,
  assigneeName: string,
  ctx: WorkspaceContext,
): Promise<WorkActionOutcome> {
  await sleep(LATENCY_MS);
  const workspace = resolveWorkspace(ctx.organization, ctx.membership);
  if (!workspace?.supportsTeam) return { status: "not_permitted" };
  if (!ctx.permissions.has("loads:assign")) return { status: "not_permitted" };

  /* ---- critical section ---- */
  const load = mockStore.org(ctx.organizationId).loads.find((l) => l.id === loadId);
  if (!load) return { status: "not_found" };

  const rows = bucket(ctx.organizationId);
  const held = liveAssignment(ctx.organizationId, loadId);
  if (held) {
    const i = rows.findIndex((a) => a.id === held.id);
    rows[i] = { ...held, status: "released", releasedAt: iso() };
  }

  const created: WorkAssignment = {
    id: rowId("work"),
    organizationId: ctx.organizationId,
    loadId,
    membershipId,
    assigneeName,
    status: "assigned",
    assignedAt: iso(),
    assignedByMembershipId: ctx.membershipId,
  };
  rows.push(created);
  /* ---- end critical section ---- */
  return { status: "assigned", assignment: created };
}

/* -------------------------------------------------------------------------- */
/* Upgrading a solo workspace                                                  */
/* -------------------------------------------------------------------------- */

export type UpgradeOutcome =
  | { status: "upgraded"; workspace: Workspace }
  | { status: "not_permitted" }
  | { status: "already_an_organization" };

/**
 * Turn a one-person workspace into a dispatch organization.
 *
 * A one-way door, and the only thing that changes is the workspace SHAPE: the
 * organization keeps its id, its name, its loads, its carriers, its equipment
 * access and its history, and the person keeps their membership and every
 * permission they had. What they gain is somewhere to put a team.
 *
 * The mock flips the stored flag so the rest of the session behaves like a team
 * workspace. Nothing is sent anywhere and no team is created.
 */
export async function upgradeToOrganization(ctx: WorkspaceContext): Promise<UpgradeOutcome> {
  await sleep(LATENCY_MS);
  const workspace = resolveWorkspace(ctx.organization, ctx.membership);
  if (!workspace) return { status: "not_permitted" };
  if (workspace.supportsTeam) return { status: "already_an_organization" };
  if (!workspace.canUpgradeToOrganization) return { status: "not_permitted" };

  ctx.organization.soloDispatcher = false;
  const next = resolveWorkspace(ctx.organization, ctx.membership)!;
  return { status: "upgraded", workspace: next };
}

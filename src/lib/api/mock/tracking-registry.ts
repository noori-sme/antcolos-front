import type {
  IsoDateTime, Load, Membership, Organization, Provenance, PublicTrackingResult,
  PublicTrackingRefusal, PublicTrackingStop, PublicTrackingView, TrackingAudience,
  TrackingAuditEntry, TrackingLinkState, TrackingRecipient, TrackingSession,
  TrackingUpdate, TrackingUpdateKind, TrackingUpdatePolicy, TrackingUpdateState,
  TrackingVisibility,
} from "@/types";
import { destinationStop, originStop } from "@/types";
import {
  DEFAULT_LINK_TIMEOUT_HOURS, DEFAULT_POST_DELIVERY_GRACE_HOURS, PUBLIC_DISCLOSURE,
  clampVisibility, defaultVisibility, effectiveExpiry, issueLink, linkStateOf,
  refusalFor, type LinkContext,
} from "@/lib/tracking";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import { mockStore } from "./store";
import {
  truckApprovedCarriers, truckDispatchGrants, truckOperatingCarrier,
} from "./truck-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND, AND NOTHING IS SENT ANYWHERE ███
 *
 * Load-scoped tracking sessions: who outside the organization may watch one
 * load, what they may see of it, for how long, and every single thing that has
 * happened to that arrangement.
 *
 * This provides MacroPoint-style visibility. It is not MacroPoint, it is not
 * integrated with MacroPoint, Project44, FourKites or anything else, and no
 * page it produces claims to be. What it is, is the shape: one session per
 * load, revocable expiring links per recipient, per-audience visibility, a
 * configurable update policy, and an append-only history.
 *
 * Three things are load-bearing here:
 *
 *  1. ONE SESSION PER LOAD. Not per broker, not per link. "Who can see this
 *     load" is one question and there is one place to answer it.
 *  2. EVERY LINK EXPIRES, and closes by itself on delivery, on cancellation
 *     and when the carrier relationship behind it ends. Nobody has to remember.
 *  3. NOTHING IS DELIVERED. An update is drafted or queued. There is no
 *     `delivered` state in the type, because there is no channel behind it.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = process.env.ANTCOLOS_TEST === "1" ? 0 : 260;

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

const ADAPTER = "mock:antcolos_tracking";

function provenance(): Provenance {
  const at = nowIso();
  return { module: "notifications", adapter: ADAPTER, mock: true, observedAt: at, receivedAt: at };
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The caller. Structurally the MT Loop service's context, and passed straight
 * through from the same place, but declared here so the tracking service does
 * not depend on the loop service to describe its own caller.
 */
export interface TrackingContext extends ServiceContext {
  organization: Organization;
  membership: Membership;
}

/** Tracking is a dispatch activity. A driver is the subject, not the watcher. */
export function mayTrack(ctx: TrackingContext): boolean {
  const workspace = resolveWorkspace(ctx.organization, ctx.membership);
  if (!workspace || workspace.kind === "driver") return false;
  if (ctx.scope.loads === "assigned") return false;
  return ctx.permissions.has("tracking:view") && ctx.permissions.has("loads:view");
}

function require(ctx: TrackingContext, ...keys: Array<"tracking:view" | "tracking:share" | "tracking:update:send" | "loads:view">) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface TrackingState {
  /** organizationId → sessions. Partitioned like every other mock collection. */
  sessions: Map<string, TrackingSession[]>;
  /** organizationId → audit, newest last. Append-only. */
  audit: Map<string, TrackingAuditEntry[]>;
  /**
   * token → where it points.
   *
   * A global index, because a public resolver has no organization to look in —
   * that is the whole nature of an unauthenticated link. It holds ONLY the
   * three identifiers needed to find the session; every rule about what the
   * holder may then see is applied afterwards, against the session itself.
   */
  tokens: Map<string, { organizationId: string; sessionId: string; recipientId: string }>;
}

let state: TrackingState | null = null;

/* -------------------------------------------------------------------------- */
/* Browser-local persistence                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ███ MOCK-ONLY CONVENIENCE ███
 *
 * Tracking sessions are mirrored into `localStorage` so that a link actually
 * works when it is opened.
 *
 * The rest of the mock layer is in-memory and per page load, which is fine for
 * screens you reach by navigating. A tracking link is not one of those: it is
 * pasted into a different tab, by a different person, and a token minted in one
 * page load would not exist in the next. Without this, the single most
 * important thing to try in this milestone could not be tried.
 *
 * It stores sessions, their audit and the token index, and nothing else — no
 * loads, no positions, no permissions. A real backend replaces it and this
 * whole block goes; the rules above it do not change, because every one of
 * them is applied AFTER the session is found, not by finding it.
 */
const STORAGE_KEY = "antcolos.tracking.v1";

interface PersistedState {
  sessions: Array<[string, TrackingSession[]]>;
  audit: Array<[string, TrackingAuditEntry[]]>;
  tokens: Array<[string, { organizationId: string; sessionId: string; recipientId: string }]>;
  seq: number;
}

function emptyState(): TrackingState {
  return { sessions: new Map(), audit: new Map(), tokens: new Map() };
}

function hydrate(): TrackingState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PersistedState;
    seq = Math.max(seq, parsed.seq ?? 0);
    return {
      sessions: new Map(parsed.sessions ?? []),
      audit: new Map(parsed.audit ?? []),
      tokens: new Map(parsed.tokens ?? []),
    };
  } catch {
    // A corrupted or unreadable store is not worth crashing a page over. An
    // empty one is the honest fallback: links stop resolving and say so.
    return emptyState();
  }
}

function persist() {
  if (typeof window === "undefined" || !state) return;
  try {
    const payload: PersistedState = {
      sessions: [...state.sessions.entries()],
      audit: [...state.audit.entries()],
      tokens: [...state.tokens.entries()],
      seq,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing, a full quota, a blocked origin. The session still works
    // in this tab; only the cross-tab convenience is lost.
  }
}

function db(): TrackingState {
  if (!state) state = hydrate();
  return state;
}

/** Test hook. Never called by the UI. */
export function resetTracking() {
  seq = 0;
  state = emptyState();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }
}

function sessionBucket(organizationId: string): TrackingSession[] {
  let rows = db().sessions.get(organizationId);
  if (!rows) {
    rows = [];
    db().sessions.set(organizationId, rows);
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Append one immutable line.
 *
 * Every mint, every access, every refusal, every approval, every expiry and
 * every availability publication goes through here. Nothing in this module
 * edits or removes an entry, and nothing has a code path that could.
 */
export function audit(
  organizationId: string,
  entry: Omit<TrackingAuditEntry, "id" | "at"> & { at?: IsoDateTime },
): TrackingAuditEntry {
  const row: TrackingAuditEntry = { id: rowId("trk"), at: entry.at ?? nowIso(), ...entry };
  let rows = db().audit.get(organizationId);
  if (!rows) {
    rows = [];
    db().audit.set(organizationId, rows);
  }
  rows.push(row);
  persist();
  return row;
}

/** The history this workspace may read, newest first. */
export function trackingAudit(
  ctx: TrackingContext,
  subjectId?: string,
  limit = 60,
): TrackingAuditEntry[] {
  if (!mayTrack(ctx)) return [];
  const rows = db().audit.get(ctx.organizationId) ?? [];
  return rows
    .filter((r) => !subjectId || r.subjectId === subjectId)
    .slice()
    .reverse()
    .slice(0, limit);
}

/** A session's own history, which is also on the session record itself. */
function noteOnSession(session: TrackingSession, entry: Omit<TrackingAuditEntry, "id" | "at">) {
  const row = audit(session.organizationId, entry);
  session.audit.push(row);
  return row;
}

/* -------------------------------------------------------------------------- */
/* Load lookup                                                                 */
/* -------------------------------------------------------------------------- */

export function loadInOrg(organizationId: string, loadId: string): Load | undefined {
  try {
    return mockStore.org(organizationId).loads.find((l) => l.id === loadId);
  } catch {
    return undefined;
  }
}

/** When a load delivered, from its own timeline. Never guessed from a status. */
export function deliveredAtOf(organizationId: string, loadId: string): IsoDateTime | undefined {
  try {
    const org = mockStore.org(organizationId);
    const event = org.events
      .filter((e) => e.loadId === loadId && e.kind === "load.delivered")
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .pop();
    if (event) return event.occurredAt;
    const load = org.loads.find((l) => l.id === loadId);
    if (!load) return undefined;
    return ["delivered", "ready_to_invoice", "invoiced", "paid"].includes(load.status)
      ? destinationStop(load).departedAt ?? destinationStop(load).arrivedAt
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the organization still has the truck this session tracks.
 *
 * Deliberately ctx-free, because the public resolver has no caller to build a
 * context from and this is exactly the question it has to answer. It reads the
 * truck registry's own relationship records rather than keeping a copy, so a
 * relationship ended anywhere closes every link that depended on it, with no
 * reconciliation step and nothing to forget.
 */
export function organizationStillHasTruck(organizationId: string, truckId?: string): boolean {
  if (!truckId) return true;
  if (truckDispatchGrants(truckId).some((g) => g.dispatchOrganizationId === organizationId)) return true;
  if (truckOperatingCarrier(truckId)?.organizationId === organizationId) return true;
  return truckApprovedCarriers(truckId).some((c) => c.organizationId === organizationId);
}

function linkContextFor(session: TrackingSession, now = new Date()): LinkContext {
  const load = loadInOrg(session.organizationId, session.loadId);
  return {
    loadStatus: load?.status ?? "cancelled",
    deliveredAt: deliveredAtOf(session.organizationId, session.loadId),
    postDeliveryGraceHours: session.postDeliveryGraceHours,
    relationshipActive: organizationStillHasTruck(session.organizationId, session.truckId),
    sessionActive: session.status === "active",
    now,
  };
}

/**
 * Bring a session's derived state up to date.
 *
 * Runs on every read, like the MT Loop board's reconciliation and for the same
 * reason: a link that expired at 03:00 must read as expired at 03:01 whether
 * or not anybody opened the page. The first read after an expiry is what
 * writes the audit line, which is honest — it is when Antcolos noticed.
 */
function reconcile(session: TrackingSession, now = new Date()): TrackingSession {
  const ctx = linkContextFor(session, now);
  for (const recipient of session.recipients) {
    const next = linkStateOf(recipient.link, ctx);
    if (next !== recipient.state) {
      const previous = recipient.state;
      recipient.state = next;
      if (previous === "active" && next !== "active") {
        noteOnSession(session, {
          action: next === "revoked" ? "link_revoked" : "link_expired",
          subjectId: recipient.id,
          actorName: "Antcolos",
          summary: `${recipient.partyName}'s link is now ${next.replace(/_/g, " ")}.`,
          detail: closeReasonFor(next),
        });
      }
    }
  }

  const allClosed = session.recipients.length > 0
    && session.recipients.every((r) => r.state !== "active");
  if (session.status === "active" && allClosed && ctx.loadStatus === "cancelled") {
    session.status = "closed";
    session.closedAt = nowIso();
    session.closedReason = "The load was cancelled.";
  }
  return session;
}

function closeReasonFor(state: TrackingLinkState): string {
  switch (state) {
    case "expired": return "The configured timeout ran out.";
    case "completed": return "The load delivered and the grace period ran out.";
    case "cancelled": return "The load was cancelled.";
    case "relationship_ended": return "The carrier relationship behind this link ended.";
    case "revoked": return "Withdrawn by the carrier.";
    default: return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export function sessionForLoadSync(
  ctx: TrackingContext,
  loadId: string,
): TrackingSession | undefined {
  if (!mayTrack(ctx)) return undefined;
  const found = sessionBucket(ctx.organizationId).find((s) => s.loadId === loadId);
  return found ? reconcile(found) : undefined;
}

export function sessionByIdSync(
  ctx: TrackingContext,
  sessionId: string,
): TrackingSession | undefined {
  if (!mayTrack(ctx)) return undefined;
  const found = sessionBucket(ctx.organizationId).find((s) => s.id === sessionId);
  return found ? reconcile(found) : undefined;
}

export interface OpenSessionInput {
  loadId: string;
  updatePolicy?: TrackingUpdatePolicy;
  linkTimeoutHours?: number;
  postDeliveryGraceHours?: number;
}

/**
 * Open the load's tracking session, or return the one it already has.
 *
 * Idempotent by load, which is rule 1 made executable: two dispatchers pressing
 * "share tracking" on the same load thirty seconds apart get one session with
 * two recipients, not two sessions nobody can reconcile.
 */
export async function openTrackingSession(
  ctx: TrackingContext,
  input: OpenSessionInput,
): Promise<TrackingSession> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  if (!mayTrack(ctx)) throw new PermissionDeniedError(["tracking:view"]);

  const existing = sessionBucket(ctx.organizationId).find((s) => s.loadId === input.loadId);
  if (existing) return reconcile(existing);

  const load = loadInOrg(ctx.organizationId, input.loadId);
  if (!load) throw new PermissionDeniedError(["loads:view"]);

  const truckId = load.assignment?.truckId;
  const session: TrackingSession = {
    id: rowId("trs"),
    loadId: load.id,
    loadReference: load.reference,
    organizationId: ctx.organizationId,
    truckId,
    carrierOrganizationId: load.assignment?.carrierOrganizationId
      ?? (truckId ? truckOperatingCarrier(truckId)?.organizationId : undefined),
    carrierName: truckId ? truckOperatingCarrier(truckId)?.name : undefined,
    status: "active",
    updatePolicy: input.updatePolicy ?? "draft_for_approval",
    linkTimeoutHours: input.linkTimeoutHours ?? DEFAULT_LINK_TIMEOUT_HOURS,
    postDeliveryGraceHours: input.postDeliveryGraceHours ?? DEFAULT_POST_DELIVERY_GRACE_HOURS,
    createdAt: nowIso(),
    createdByName: ctx.actor.displayNameSnapshot,
    recipients: [],
    updates: [],
    audit: [],
  };
  sessionBucket(ctx.organizationId).push(session);
  persist();

  noteOnSession(session, {
    action: "session_opened",
    subjectId: session.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `Tracking opened on ${load.reference}.`,
    detail:
      `Links expire after ${session.linkTimeoutHours} hours and close ${session.postDeliveryGraceHours} `
      + `hours after delivery. Updates are ${session.updatePolicy === "draft_for_approval" ? "drafted for approval" : "queued automatically"}.`,
    provenance: provenance(),
  });
  return session;
}

export interface AddRecipientInput {
  sessionId: string;
  audience: TrackingAudience;
  partyName: string;
  contactName?: string;
  contactEmail?: string;
  visibility?: TrackingVisibility;
  timeoutHours?: number;
}

export async function addTrackingRecipient(
  ctx: TrackingContext,
  input: AddRecipientInput,
): Promise<TrackingRecipient> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  const session = sessionByIdSync(ctx, input.sessionId);
  if (!session) throw new PermissionDeniedError(["tracking:share"]);
  if (session.status !== "active") {
    throw new Error("This tracking session is closed. Nothing more can be shared from it.");
  }

  const visibility = clampVisibility(
    input.audience,
    input.visibility ?? defaultVisibility(input.audience),
  );
  const link = issueLink({ timeoutHours: input.timeoutHours ?? session.linkTimeoutHours });

  const recipient: TrackingRecipient = {
    id: rowId("trr"),
    sessionId: session.id,
    audience: input.audience,
    partyName: input.partyName.trim(),
    contactName: input.contactName?.trim() || undefined,
    contactEmail: input.contactEmail?.trim() || undefined,
    visibility,
    link,
    state: "active",
  };
  session.recipients.push(recipient);
  persist();
  db().tokens.set(link.token, {
    organizationId: ctx.organizationId,
    sessionId: session.id,
    recipientId: recipient.id,
  });

  noteOnSession(session, {
    action: "recipient_added",
    subjectId: recipient.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `${recipient.partyName} added as ${input.audience}.`,
    detail: describeVisibility(visibility),
    provenance: provenance(),
  });
  noteOnSession(session, {
    action: "link_issued",
    subjectId: recipient.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `A tracking link was issued to ${recipient.partyName}.`,
    detail: `It expires ${link.expiresAt}. Nothing was sent — the link is shown to the dispatcher to pass on.`,
    provenance: provenance(),
  });
  return recipient;
}

export async function setRecipientVisibility(
  ctx: TrackingContext,
  sessionId: string,
  recipientId: string,
  visibility: TrackingVisibility,
): Promise<TrackingRecipient | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  const session = sessionByIdSync(ctx, sessionId);
  const recipient = session?.recipients.find((r) => r.id === recipientId);
  if (!session || !recipient) return undefined;

  recipient.visibility = clampVisibility(recipient.audience, visibility);
  noteOnSession(session, {
    action: "visibility_changed",
    subjectId: recipient.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `What ${recipient.partyName} may see was changed.`,
    detail: describeVisibility(recipient.visibility),
    provenance: provenance(),
  });
  return recipient;
}

export async function revokeTrackingLink(
  ctx: TrackingContext,
  sessionId: string,
  recipientId: string,
  reason: string,
): Promise<TrackingRecipient | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  const session = sessionByIdSync(ctx, sessionId);
  const recipient = session?.recipients.find((r) => r.id === recipientId);
  if (!session || !recipient) return undefined;

  recipient.link.revokedAt = nowIso();
  recipient.link.revokedReason = reason.trim() || "Withdrawn by the carrier.";
  recipient.state = "revoked";

  noteOnSession(session, {
    action: "link_revoked",
    subjectId: recipient.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `${recipient.partyName}'s link was withdrawn.`,
    detail: recipient.link.revokedReason,
    provenance: provenance(),
  });
  return recipient;
}

/**
 * Issue a fresh link for a recipient whose link has closed.
 *
 * A new token, always. Un-revoking would mean a link somebody deliberately
 * withdrew could come back to life, and the audit trail would show one link
 * with two lives instead of two links with one each.
 */
export async function reissueTrackingLink(
  ctx: TrackingContext,
  sessionId: string,
  recipientId: string,
  timeoutHours?: number,
): Promise<TrackingRecipient | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  const session = sessionByIdSync(ctx, sessionId);
  const recipient = session?.recipients.find((r) => r.id === recipientId);
  if (!session || !recipient) return undefined;

  db().tokens.delete(recipient.link.token);
  recipient.link = issueLink({ timeoutHours: timeoutHours ?? session.linkTimeoutHours });
  recipient.state = "active";
  db().tokens.set(recipient.link.token, {
    organizationId: ctx.organizationId,
    sessionId: session.id,
    recipientId: recipient.id,
  });

  noteOnSession(session, {
    action: "link_reissued",
    subjectId: recipient.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `A new link was issued to ${recipient.partyName}.`,
    detail: `The previous token stopped working immediately. This one expires ${recipient.link.expiresAt}.`,
    provenance: provenance(),
  });
  return reconcile(session).recipients.find((r) => r.id === recipientId);
}

export async function setUpdatePolicy(
  ctx: TrackingContext,
  sessionId: string,
  policy: TrackingUpdatePolicy,
): Promise<TrackingSession | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  const session = sessionByIdSync(ctx, sessionId);
  if (!session) return undefined;
  const before = session.updatePolicy;
  if (before === policy) return session;
  session.updatePolicy = policy;
  noteOnSession(session, {
    action: "policy_changed",
    subjectId: session.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary:
      policy === "draft_for_approval"
        ? "Updates now wait for a dispatcher to approve them."
        : "Updates are now queued automatically, with no person in the loop.",
    detail:
      "Either way nothing is transmitted: there is no email, SMS or broker portal connected to this build.",
    provenance: provenance(),
  });
  return session;
}

export async function closeTrackingSession(
  ctx: TrackingContext,
  sessionId: string,
  reason: string,
): Promise<TrackingSession | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:share");
  const session = sessionByIdSync(ctx, sessionId);
  if (!session) return undefined;
  session.status = "closed";
  session.closedAt = nowIso();
  session.closedReason = reason.trim() || "Closed by the carrier.";
  for (const recipient of session.recipients) {
    if (recipient.state === "active") recipient.state = "completed";
  }
  noteOnSession(session, {
    action: "session_closed",
    subjectId: session.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `Tracking on ${session.loadReference} was closed.`,
    detail: session.closedReason,
    provenance: provenance(),
  });
  return session;
}

/* -------------------------------------------------------------------------- */
/* Updates                                                                     */
/* -------------------------------------------------------------------------- */

const HANDOFF_NOTE =
  "Queued for handoff. Nothing was transmitted: no email, SMS, portal or broker "
  + "integration is connected to this build.";

export interface DraftUpdateInput {
  sessionId: string;
  kind: TrackingUpdateKind;
  message: string;
  audience?: TrackingAudience[];
  basis?: "confirmed" | "inferred";
}

/**
 * Produce one outbound update.
 *
 * The policy decides its opening state and nothing else: `draft_for_approval`
 * makes a draft that waits for a person, `automatic_mock_handoff` queues it
 * straight away. Neither sends anything, and the state names say so.
 */
export async function draftTrackingUpdate(
  ctx: TrackingContext,
  input: DraftUpdateInput,
): Promise<TrackingUpdate | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view");
  const session = sessionByIdSync(ctx, input.sessionId);
  if (!session) return undefined;

  const automatic = session.updatePolicy === "automatic_mock_handoff";
  const state: TrackingUpdateState = automatic ? "queued" : "draft";
  const update: TrackingUpdate = {
    id: rowId("tru"),
    sessionId: session.id,
    loadId: session.loadId,
    kind: input.kind,
    audience: input.audience ?? session.recipients.map((r) => r.audience),
    state,
    message: input.message.trim(),
    basis: input.basis ?? "inferred",
    createdAt: nowIso(),
    createdByName: automatic ? "Antcolos" : ctx.actor.displayNameSnapshot,
    handoffNote: HANDOFF_NOTE,
    provenance: provenance(),
  };
  session.updates.push(update);
  persist();

  noteOnSession(session, {
    action: automatic ? "update_queued" : "update_drafted",
    subjectId: update.id,
    actorMembershipId: automatic ? undefined : ctx.membershipId,
    actorName: update.createdByName,
    basis: update.basis,
    summary: automatic
      ? `Queued automatically: ${update.message}`
      : `Drafted for approval: ${update.message}`,
    detail: HANDOFF_NOTE,
    provenance: update.provenance,
  });
  return update;
}

export async function approveTrackingUpdate(
  ctx: TrackingContext,
  sessionId: string,
  updateId: string,
): Promise<TrackingUpdate | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:update:send");
  const session = sessionByIdSync(ctx, sessionId);
  const update = session?.updates.find((u) => u.id === updateId);
  if (!session || !update) return undefined;
  if (update.state !== "draft") return update;

  update.state = "approved";
  update.approvedAt = nowIso();
  update.approvedByName = ctx.actor.displayNameSnapshot;

  noteOnSession(session, {
    action: "update_approved",
    subjectId: update.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    basis: update.basis,
    summary: `Approved: ${update.message}`,
    detail: HANDOFF_NOTE,
    provenance: provenance(),
  });
  return update;
}

export async function discardTrackingUpdate(
  ctx: TrackingContext,
  sessionId: string,
  updateId: string,
  reason: string,
): Promise<TrackingUpdate | undefined> {
  await sleep(LATENCY_MS);
  require(ctx, "tracking:view", "tracking:update:send");
  const session = sessionByIdSync(ctx, sessionId);
  const update = session?.updates.find((u) => u.id === updateId);
  if (!session || !update) return undefined;

  update.state = "discarded";
  update.discardedAt = nowIso();
  update.discardReason = reason.trim() || "Decided against by dispatch.";

  noteOnSession(session, {
    action: "update_discarded",
    subjectId: update.id,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    summary: `Discarded: ${update.message}`,
    detail: update.discardReason,
    provenance: provenance(),
  });
  return update;
}

/* -------------------------------------------------------------------------- */
/* The public view                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the outside world may be shown for one load.
 *
 * The one thing supplied by the caller is a token, and the caller is anonymous
 * by design. Everything else is derived here, so there is no parameter a
 * crafted URL could use to widen what comes back: no load id, no organization,
 * no field list. The token names a recipient; the recipient's own visibility
 * decides the rest.
 */
export interface PublicTrackingSnapshot {
  /** Where the truck was last reported. City and state only. */
  location?: { city?: string; state?: string };
  etaAt?: IsoDateTime;
  lastUpdateAt?: IsoDateTime;
  health?: PublicTrackingView["health"];
  healthNote?: string;
}

export function resolvePublicTracking(
  token: string,
  snapshotFor: (session: TrackingSession) => PublicTrackingSnapshot,
  now: Date = new Date(),
): PublicTrackingResult {
  const pointer = db().tokens.get(token);
  if (!pointer) {
    return {
      ok: false,
      refusal: "unknown_token",
      message: "This tracking link is not recognised.",
    };
  }

  const session = sessionBucket(pointer.organizationId).find((s) => s.id === pointer.sessionId);
  const recipient = session?.recipients.find((r) => r.id === pointer.recipientId);
  if (!session || !recipient) {
    return { ok: false, refusal: "unknown_token", message: "This tracking link is not recognised." };
  }

  reconcile(session, now);
  const refusal = refusalFor(recipient.state);
  if (refusal) {
    audit(session.organizationId, {
      action: "link_access_refused",
      subjectId: recipient.id,
      actorName: recipient.partyName,
      summary: `A refused attempt to open ${recipient.partyName}'s link on ${session.loadReference}.`,
      detail: closeReasonFor(recipient.state),
    });
    return { ok: false, refusal, message: messageFor(refusal) };
  }

  const load = loadInOrg(session.organizationId, session.loadId);
  if (!load) {
    return { ok: false, refusal: "unknown_token", message: "This tracking link is not recognised." };
  }

  recipient.link.accessCount += 1;
  recipient.link.lastAccessedAt = nowIso();
  audit(session.organizationId, {
    action: "link_accessed",
    subjectId: recipient.id,
    actorName: recipient.partyName,
    summary: `${recipient.partyName} opened the tracking link for ${session.loadReference}.`,
    detail: `Opened ${recipient.link.accessCount} time${recipient.link.accessCount === 1 ? "" : "s"} in total.`,
  });

  const snapshot = snapshotFor(session);
  const v = recipient.visibility;
  const pickup = originStop(load);
  const delivery = destinationStop(load);

  const stops: PublicTrackingStop[] = [];
  if (v.pickupProgress) {
    stops.push({
      kind: "pickup",
      city: pickup.address.city,
      state: pickup.address.state,
      facilityName: pickup.facilityName,
      appointmentAt: pickup.appointmentAt,
      arrivedAt: v.arrivalSignals ? pickup.arrivedAt : undefined,
      departedAt: v.arrivalSignals ? pickup.departedAt : undefined,
      basis: "confirmed",
    });
  }
  if (v.deliveryProgress) {
    stops.push({
      kind: "delivery",
      city: delivery.address.city,
      state: delivery.address.state,
      facilityName: delivery.facilityName,
      appointmentAt: delivery.appointmentAt,
      arrivedAt: v.arrivalSignals ? delivery.arrivedAt : undefined,
      departedAt: v.arrivalSignals ? delivery.departedAt : undefined,
      basis: "confirmed",
    });
  }

  const shown = session.updates.filter(
    (u) => (u.state === "approved" || u.state === "queued")
      && u.audience.includes(recipient.audience),
  );

  const view: PublicTrackingView = {
    audience: recipient.audience,
    // The customer's own number where they gave one — it is the number they
    // will quote — and the carrier's reference otherwise.
    reference: load.customerReference ?? load.reference,
    carrierName: v.carrierName ? session.carrierName : undefined,
    equipmentType: v.equipmentType ? EQUIPMENT_LABEL[load.equipment] ?? load.equipment : undefined,
    stops,
    truckLocation: v.truckLocation ? snapshot.location : undefined,
    etaAt: v.etaAndFreshness ? snapshot.etaAt : undefined,
    lastUpdateAt: v.etaAndFreshness ? snapshot.lastUpdateAt : undefined,
    health: v.exceptionStatus ? snapshot.health : undefined,
    healthNote: v.exceptionStatus ? snapshot.healthNote : undefined,
    status: v.exceptionStatus
      ? shown.map((u) => ({ kind: u.kind, message: u.message, at: u.createdAt, basis: u.basis }))
      : [],
    expiresAt: effectiveExpiry(recipient.link, linkContextFor(session, now)),
    disclosure: PUBLIC_DISCLOSURE,
  };

  return { ok: true, view };
}

const EQUIPMENT_LABEL: Record<string, string> = {
  cargo_van: "Cargo van",
  sprinter: "Sprinter van",
  box_truck: "Box truck",
  dry_van: "Dry van",
  reefer: "Reefer",
  flatbed: "Flatbed",
};

function messageFor(refusal: PublicTrackingRefusal): string {
  const messages: Record<PublicTrackingRefusal, string> = {
    unknown_token: "This tracking link is not recognised.",
    revoked: "This tracking link was withdrawn by the carrier.",
    expired: "This tracking link has expired.",
    completed: "This shipment has delivered and tracking has closed.",
    cancelled: "This load was cancelled and tracking has closed.",
    relationship_ended: "The carrier relationship behind this link has ended.",
  };
  return messages[refusal] ?? "This tracking link is no longer available.";
}

function describeVisibility(v: TrackingVisibility): string {
  const on = Object.entries(v).filter(([, value]) => value).map(([key]) => key);
  return on.length === 0
    ? "Nothing is shared."
    : `Shares: ${on.join(", ")}. Rates, driver details, hours of service, internal notes and any other load are never shared.`;
}

/**
 * The tracking history, for the shared audit ledger to PROJECT.
 *
 * The ledger does not own this history and does not write to it — the tracking
 * module remains the authority on what it says, keeps its own entry ids, and
 * nothing here is edited or removed. This is a read, gated on the same
 * permission the tracking screens are, so projecting into the ledger cannot
 * show somebody a line they could not already see.
 *
 * Deliberately takes a plain ServiceContext rather than a TrackingContext: the
 * ledger's feeds are built from one, and the workspace-shape check that
 * `mayTrack` also applies is about which SCREENS exist, not which records a
 * person may read.
 */
export function trackingAuditForLedger(
  ctx: Pick<ServiceContext, "organizationId" | "permissions" | "scope">,
): TrackingAuditEntry[] {
  if (!ctx.permissions.has("tracking:view")) return [];
  if (ctx.scope.loads === "assigned") return [];
  return [...(db().audit.get(ctx.organizationId) ?? [])];
}

/** The load a session is about, so a projected line can point at the record. */
export function sessionLoadRef(
  organizationId: string,
  sessionId: string,
): { loadId: string; loadReference: string } | undefined {
  const session = sessionBucket(organizationId).find((s) => s.id === sessionId);
  return session ? { loadId: session.loadId, loadReference: session.loadReference } : undefined;
}

/** Every session in this workspace, reconciled. Newest first. */
export function sessionsForWorkspace(ctx: TrackingContext): TrackingSession[] {
  if (!mayTrack(ctx)) return [];
  return sessionBucket(ctx.organizationId)
    .map((s) => reconcile(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

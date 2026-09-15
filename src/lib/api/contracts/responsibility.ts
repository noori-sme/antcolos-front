import type {
  EligibilityVerdict, EscalationPolicy, FleetProfile, ResponsibilityAssignment,
  ResponsibilityBoard, ResponsibilityQueue, ResponsibilityRole,
  ResponsibilityWorkKind, SlaTarget,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE RESPONSIBILITY SEAM ★
 *
 * Who holds every piece of work in this workspace, who answers for it, and what
 * is happening to it.
 *
 * Notice what this service does NOT own. It holds no MT Loops and no Needs You
 * items — it reads both from the services that do, through the typed
 * `ResponsibilityContext` each of them emits, and writes back nothing about the
 * work itself. It has no permission of its own to grant, no team to keep, no
 * notification to send. Everything it stores is the answer to "who", plus the
 * timeline of how that answer changed.
 *
 * ███ FRONTEND ONLY — WHAT THIS IS NOT ███
 * Every method below is honest about a frontend's limits, and the limits are
 * worth stating rather than discovering:
 *
 *   • No timers. SLA state and escalation level are COMPUTED from the records
 *     and the clock on every read. Close the tab and nothing is missed, because
 *     nothing was ever scheduled.
 *   • No delivery. A `reminder` step and `requestApproval` produce a line on a
 *     record and a row in a queue. No email, no push, no Telegram message
 *     leaves this app.
 *   • No enforcement. The permission checks below are the same honest mock the
 *     rest of Antcolos uses: they make the UI behave correctly and they prove
 *     the shape the real API must meet. Real authorization is the backend's.
 *   • No persistence. Everything lives in memory for the life of the tab.
 *
 * Real timers, real escalation jobs, real reminder delivery and real
 * authorization belong to the backend.
 */

/**
 * The three views, derived once.
 *
 * ★ ONE DERIVATION, EVERY SURFACE ★
 * Home and the Needs You page must agree about what needs somebody, and the
 * only way to guarantee that is for neither of them to decide. Both read this,
 * and `mockHomeService.summary` builds its Needs You numbers from the same
 * function rather than filtering the queue a second time with its own rule.
 */
export interface AttentionViews {
  organizationId: string;
  membershipId: string;
  /** Work that needs this person. The only one of the three that is a to-do list. */
  myNeedsYou: ResponsibilityAssignment[];
  /** Held by people they answer for. Watchable; never their work until it reaches them. */
  teamOversight: ResponsibilityAssignment[];
  /** The complete inventory, for deliberate inspection. */
  allOrganization: ResponsibilityAssignment[];
  /** False when the viewer may not see other people's work at all. */
  maySeeTeam: boolean;
  /**
   * False in a workspace with nobody to oversee.
   *
   * Kept apart from `maySeeTeam` on purpose: "you are not allowed to see other
   * people's work" and "there are no other people" are different statements,
   * and a lone owner-operator shown an empty Team oversight tab would read the
   * second as the first.
   */
  teamOversightApplies: boolean;
  counts: {
    myNeedsYou: number;
    myNeedsYouCritical: number;
    teamOversight: number;
    teamOversightAtRisk: number;
    allOrganization: number;
    ownerFallback: number;
    needsAssignment: number;
    trulyUnassigned: number;
    escalated: number;
  };
}

export interface BoardOptions {
  /** Narrow to one queue. Absent builds every queue the viewer may see. */
  queue?: ResponsibilityQueue;
}

export interface WorkKey {
  kind: ResponsibilityWorkKind;
  id: string;
}

export interface MoveWorkInput {
  toMembershipId: string;
  /** Required. An override with no reason is a decision nobody can review. */
  note: string;
}

export interface ApprovalDecisionInput {
  decision: "approve" | "decline";
  note: string;
}

export interface WatcherInput {
  membershipId: string;
  note?: string;
}

/** The subset of a policy a workspace may edit. Its identity is not editable. */
export interface PolicyPatch {
  name?: string;
  description?: string;
  sla?: SlaTarget;
  triggers?: EscalationPolicy["triggers"];
  steps?: EscalationPolicy["steps"];
  appliesToFunctions?: EscalationPolicy["appliesToFunctions"];
  appliesToSeverities?: EscalationPolicy["appliesToSeverities"];
}

export interface ResponsibilityService {
  /**
   * Every queue the viewer may see, with the work already routed.
   *
   * Assignments are reconciled against live MT Loop and Needs You state on
   * every call, exactly the way the MT Loop board reconciles against the truck
   * registry: fix the underlying work and the responsibility record follows,
   * rather than drifting until somebody notices.
   */
  board(ctx: ServiceContext, options?: BoardOptions): Promise<ResponsibilityBoard>;

  /**
   * The three separated views. THE shared derivation — see `AttentionViews`.
   *
   * Every surface that shows "what needs me" goes through this, so Home and the
   * Needs You page cannot drift apart.
   */
  attention(ctx: ServiceContext): Promise<AttentionViews>;

  /** One piece of work, with its full timeline. */
  get(ctx: ServiceContext, work: WorkKey): Promise<ResponsibilityAssignment>;

  /**
   * Everybody who was considered, and why each was passed over.
   *
   * The answer to "why did this land on me?", which an Owner is owed and which
   * a routing engine that cannot produce one has no business making decisions.
   */
  explain(ctx: ServiceContext, work: WorkKey): Promise<EligibilityVerdict[]>;

  /* -- The six distinct actions --------------------------------------- */

  /** "I have seen this." Stops the acknowledgement clock. Nothing moves. */
  acknowledge(ctx: ServiceContext, work: WorkKey): Promise<ResponsibilityAssignment>;

  /** "This is mine, I am on it." Quiets the reminder rung and nothing else. */
  keep(ctx: ServiceContext, work: WorkKey, note?: string): Promise<ResponsibilityAssignment>;

  /**
   * Hand the work to somebody else, keeping accountability where it is.
   *
   * Delegation and reassignment differ in exactly that: a delegation moves who
   * DOES it and leaves who ANSWERS for it alone.
   */
  delegate(
    ctx: ServiceContext, work: WorkKey, input: MoveWorkInput,
  ): Promise<ResponsibilityAssignment>;

  /** Move the work, and let accountability re-derive from where it lands. */
  reassign(
    ctx: ServiceContext, work: WorkKey, input: MoveWorkInput,
  ): Promise<ResponsibilityAssignment>;

  /** Take it yourself. Requires the authority to move work, not to be senior. */
  takeOver(
    ctx: ServiceContext, work: WorkKey, note: string,
  ): Promise<ResponsibilityAssignment>;

  /** Change who answers for the result, without touching who is doing it. */
  changeAccountable(
    ctx: ServiceContext, work: WorkKey, input: MoveWorkInput,
  ): Promise<ResponsibilityAssignment>;

  /**
   * Ask for an approval. Produces a state and a queue row — nothing is sent.
   */
  requestApproval(
    ctx: ServiceContext, work: WorkKey, input: { approverMembershipId?: string; note: string },
  ): Promise<ResponsibilityAssignment>;

  decideApproval(
    ctx: ServiceContext, work: WorkKey, input: ApprovalDecisionInput,
  ): Promise<ResponsibilityAssignment>;

  /**
   * "I need a decision on this." The assignee's own move.
   *
   * The one way work reaches somebody above the desk without a manager or a
   * policy putting it there, and — with `escalate` — one of only two things
   * that can move an item into another person's personal queue. It records who
   * was asked; it does not move the work, and the asker stays responsible.
   */
  requestHelp(
    ctx: ServiceContext, work: WorkKey, note: string,
  ): Promise<ResponsibilityAssignment>;

  /**
   * Raise it by hand, which is manager VISIBILITY and not reassignment.
   *
   * The original assignee still holds the work afterwards. That is the rule the
   * whole module is built around, and this method is where a person would most
   * expect it to be quietly broken.
   */
  escalate(
    ctx: ServiceContext, work: WorkKey, note: string,
  ): Promise<ResponsibilityAssignment>;

  addWatcher(
    ctx: ServiceContext, work: WorkKey, input: WatcherInput,
  ): Promise<ResponsibilityAssignment>;

  removeWatcher(
    ctx: ServiceContext, work: WorkKey, membershipId: string,
  ): Promise<ResponsibilityAssignment>;

  /* -- Progressive disclosure: everything below is behind settings ----- */

  fleetProfile(ctx: ServiceContext): Promise<FleetProfile>;

  /**
   * The ONE question onboarding asks a Carrier.
   *
   * Everything else — team queues, supervisors, escalation levels — is derived
   * from this answer and from who is actually in the workspace. There is no
   * wizard, and this is the only setup call in the module.
   */
  setFleetSize(ctx: ServiceContext, truckCount: number): Promise<FleetProfile>;

  policies(ctx: ServiceContext): Promise<EscalationPolicy[]>;

  /** Seeded policies may be edited. None may be deleted — see the mock. */
  updatePolicy(
    ctx: ServiceContext, policyId: string, patch: PolicyPatch,
  ): Promise<EscalationPolicy>;

  /**
   * Who could hold work here, and in which roles.
   *
   * A view of the ONE membership directory, never a second roster.
   */
  assignable(
    ctx: ServiceContext, role?: ResponsibilityRole,
  ): Promise<Array<{ membershipId: string; displayName: string; title?: string; available: boolean }>>;
}

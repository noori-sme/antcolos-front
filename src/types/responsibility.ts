import type { IsoDateTime } from "./common";
import type { NeedsYouSeverity } from "./needs-you";
import type { PermissionKey } from "./permission";

/**
 * ★ HIERARCHICAL RESPONSIBILITY, DELEGATION & ESCALATION ★
 *
 * The layer that answers one question for every piece of work in Antcolos:
 * WHO. Not "which role" — Antcolos has never had roles — but which Membership,
 * in which workspace, under which scope, with what happens when they do not
 * act.
 *
 * Five things are kept apart here that products routinely collapse into one
 * "owner" field, and every one of them is a different question:
 *
 *   Responsible   performs the work.
 *   Accountable   owns the RESULT and receives the escalation. Never absent.
 *   Approver      must approve before the work counts as done.
 *   Watchers      see it. They own nothing and are never escalated to.
 *   Scope         the slice of the world this holds over.
 *
 * The one invariant the whole module exists to keep: NO WORK IS OWNERLESS.
 * Where nothing else resolves, the Owner of the workspace is accountable, and
 * that is a computed fallback rather than a seeded row somebody could delete.
 *
 * ███ FRONTEND ONLY ███
 * Nothing here is enforced authorization, and nothing here is a timer. The
 * escalation state of a record is COMPUTED from the clock every time it is
 * read — see `src/lib/responsibility/escalation.ts` — because a frontend has
 * no background job and pretending otherwise would be the one lie that makes
 * every SLA on the screen meaningless. Real authorization, real timers, real
 * escalation jobs and real delivery belong to the backend.
 */

/* -------------------------------------------------------------------------- */
/* The four roles                                                              */
/* -------------------------------------------------------------------------- */

export type ResponsibilityRole =
  /** Performs the work. Exactly one at a time, and never absent. */
  | "responsible"
  /** Owns the result and receives escalation. Never absent. */
  | "accountable"
  /** Must approve before the work counts as done. Often absent. */
  | "approver"
  /** Sees it, owns nothing, is never escalated to. Any number. */
  | "watcher";

export const RESPONSIBILITY_ROLE_LABEL: Record<ResponsibilityRole, string> = {
  responsible: "Responsible",
  accountable: "Accountable",
  approver: "Approver",
  watcher: "Watching",
};

export const RESPONSIBILITY_ROLE_DESCRIPTION: Record<ResponsibilityRole, string> = {
  responsible: "Does the work.",
  accountable: "Owns the result, and hears about it if nobody acts.",
  approver: "Has to approve it before it counts as done.",
  watcher: "Can see it. Does not own it and is never escalated to.",
};

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The slice of the world a responsibility holds over.
 *
 * Deliberately a LIST on every assignment rather than one field: a dispatcher
 * can hold "these four trucks, for this carrier, on nights", and flattening
 * that to a single scope would lose the reason they hold it.
 */
export type ResponsibilityScopeKind =
  /** The whole workspace. What an Owner holds, and the fallback of last resort. */
  | "organization"
  /** One carrier whose authority the work runs under. */
  | "carrier"
  | "truck"
  | "trailer"
  | "driver"
  | "load"
  /** A named part of the business — safety, billing, the night desk. */
  | "department"
  /** A kind of work rather than a thing: dispatch, maintenance, compliance. */
  | "function"
  /** A time window rather than a thing. */
  | "shift"
  /** A relationship between two organizations — a dispatch grant, a lease. */
  | "relationship";

export interface ResponsibilityScopeRef {
  kind: ResponsibilityScopeKind;
  /** Absent for `organization`, and for a `function` or `shift` named by label. */
  id?: string;
  label: string;
}

export const RESPONSIBILITY_SCOPE_LABEL: Record<ResponsibilityScopeKind, string> = {
  organization: "Whole organization",
  carrier: "Carrier",
  truck: "Truck",
  trailer: "Trailer",
  driver: "Driver",
  load: "Load",
  department: "Department",
  function: "Function",
  shift: "Shift",
  relationship: "Relationship",
};

/* -------------------------------------------------------------------------- */
/* Work functions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What KIND of work this is, as the routing engine asks the question.
 *
 * Not a job title and not a role: it is the function the work belongs to, which
 * is what decides which memberships are even candidates. A person is eligible
 * for driver-action work because they are the driver assigned to the truck, not
 * because somebody called them "Driver".
 */
export type ResponsibilityFunction =
  | "dispatch"
  | "driver_action"
  | "maintenance"
  | "compliance"
  | "finance"
  | "documents"
  | "safety"
  | "administration";

export const RESPONSIBILITY_FUNCTION_LABEL: Record<ResponsibilityFunction, string> = {
  dispatch: "Dispatch",
  driver_action: "Driver action",
  maintenance: "Maintenance",
  compliance: "Compliance",
  finance: "Finance",
  documents: "Documents",
  safety: "Safety",
  administration: "Administration",
};

/** Severity shares Needs You's vocabulary so one word never means two things. */
export type ResponsibilitySeverity = NeedsYouSeverity;

/* -------------------------------------------------------------------------- */
/* What a domain module emits                                                  */
/* -------------------------------------------------------------------------- */

export type ResponsibilityWorkKind = "mt_loop" | "needs_you";

export interface ResponsibilityWorkRef {
  kind: ResponsibilityWorkKind;
  id: string;
  label: string;
  /** Straight to where the work is done. */
  href?: string;
}

/**
 * The typed context a domain module publishes about one piece of work.
 *
 * Notice what is NOT in it: no membership id, no person's name, no role label.
 * A module says what the work IS and what it takes; the routing engine decides
 * who. That separation is what stops "assign it to the dispatcher" being
 * written into six feature components with six different ideas of who that is.
 */
export interface ResponsibilityContext {
  /** The workspace the work belongs to. Never the carrier, when they differ. */
  organizationId: string;
  work: ResponsibilityWorkRef;
  functionKey: ResponsibilityFunction;
  severity: ResponsibilitySeverity;
  /** Everything this work is about, most specific first. */
  scope: ResponsibilityScopeRef[];
  /** What a membership must hold to actually perform it. */
  requires: PermissionKey[];

  /**
   * The membership that has personally ACCEPTED this work, where the module
   * records such a thing.
   *
   * ★ THE ONE MEMBERSHIP ID IN THIS TYPE, AND WHY IT IS NOT A CONTRADICTION ★
   * Everything above says a module describes work and never names a person.
   * That still holds: this is not the module saying who SHOULD do the work, it
   * is the module reporting that somebody has said "I have this" — an MT Loop
   * claim, a Needs You item somebody took. A fact with an actor and a time,
   * exactly like `acknowledgedAt`, which has always been here.
   *
   * The engine decides what to do with it. An acceptance from somebody who is
   * still eligible becomes the responsible membership; one from somebody who
   * has since lost the permission, left, or had their relationship end does
   * not, and the work routes on. That is the whole point of routing it here
   * rather than letting each module publish its own answer — which is what MT
   * Loop used to do, and how a board came to read "Nobody on it" about a loop
   * the engine had given a named dispatcher.
   */
  claimedByMembershipId?: string;
  /**
   * When they accepted it. Required alongside `claimedByMembershipId` for the
   * acceptance to count, because the engine settles a clash between an
   * acceptance and a delegation by which came last.
   */
  claimedAt?: IsoDateTime;

  /* -- The records the routing engine matches against ------------------- */
  /** The carrier whose operating authority the work runs under. */
  carrierOrganizationId?: string;
  truckId?: string;
  trailerId?: string;
  /** Set when a specific driver's action is what the work is waiting on. */
  driverProfileId?: string;
  loadId?: string;

  /* -- Lifecycle, for the SLA and the triggers -------------------------- */
  openedAt: IsoDateTime;
  /** The operational deadline the work itself carries, where it has one. */
  dueAt?: IsoDateTime;
  acknowledgedAt?: IsoDateTime;
  resolvedAt?: IsoDateTime;
  /** True when the work is stopped by a problem rather than by a choice. */
  blocked?: boolean;
  blockedReason?: string;
  /** How many times this has been reopened or has failed. */
  reopenCount?: number;
  /** An approval the work cannot be finished without. */
  approvalRequired?: boolean;
  /** When the relationship or assignment behind the scope runs out. */
  scopeEndsAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Where an assignment came from                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why this membership holds this work.
 *
 * Kept on the record because "the policy put you here" and "your manager put
 * you here" are different facts, and an override that cannot be told apart from
 * a default is an override nobody can undo with confidence.
 */
export type AssignmentSource =
  /** The routing engine's default, from permissions, scope and assignment. */
  | "default_policy"
  /** A carrier or dispatch organization delegated the scope this sits in. */
  | "delegation"
  /** A person chose it. */
  | "manual"
  /** Nothing else resolved, so the workspace Owner holds it. */
  | "fallback"
  /** An escalation step reassigned it. */
  | "escalation"
  /** An authorized person took it off whoever had it. */
  | "takeover";

export const ASSIGNMENT_SOURCE_LABEL: Record<AssignmentSource, string> = {
  default_policy: "Routed by default",
  delegation: "Follows a delegation",
  manual: "Assigned by a person",
  fallback: "Owner fallback",
  escalation: "Moved by escalation",
  takeover: "Taken over",
};

/**
 * What the ASSIGNMENT amounts to, in words a screen may show.
 *
 * Derived from the source plus whether anybody was eligible at all. It exists
 * because "unassigned" was being used for two different things and was wrong
 * about both: work that fell to the Owner because nobody else qualified has an
 * accountable person and a name on it, and calling that unassigned tells an
 * Owner nothing except that the product is confused.
 */
export type AssignmentState =
  /** The routing rules picked somebody. */
  | "routed"
  /** Follows a carrier grant, a truck assignment or a dispatch delegation. */
  | "delegated"
  /** A person chose, overrode, took over, or was moved by policy. */
  | "manual"
  /** Nobody else qualified, so the Owner holds it. NOT unassigned. */
  | "owner_fallback"
  /** Nobody in the workspace qualifies at all — this needs a person, not a queue. */
  | "needs_assignment";

export const ASSIGNMENT_STATE_LABEL: Record<AssignmentState, string> = {
  routed: "Routed by default",
  delegated: "Follows a delegation",
  manual: "Assigned by a person",
  owner_fallback: "Owner fallback",
  needs_assignment: "Needs assignment",
};

export const ASSIGNMENT_STATE_DESCRIPTION: Record<AssignmentState, string> = {
  routed: "The rules picked the best-placed person for it.",
  delegated: "It follows a delegation somebody granted.",
  manual: "Somebody chose this on purpose.",
  owner_fallback:
    "Nobody else in this workspace can do it yet, so it sits with the Owner. It has an owner — it is not unassigned.",
  needs_assignment:
    "Nobody here holds what this needs. Somebody has to be given the permission, or hired.",
};

/* -------------------------------------------------------------------------- */
/* Attention                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Why a piece of work needs ONE specific person, personally.
 *
 * The narrow question a personal queue is built from. See
 * `src/lib/responsibility/attention.ts` for the list of things that
 * deliberately do NOT appear here — chief among them being accountable in the
 * org-chart sense, which is oversight rather than action.
 */
export type AttentionReason =
  /** You are the one doing it. */
  | "responsible"
  /** Nobody else qualified, so it fell to you. */
  | "owner_fallback"
  /** Nobody in the workspace can do it at all. */
  | "needs_assignment"
  /** A person named you accountable, by hand. Never a derived roll-up. */
  | "explicit_accountable"
  /** You are the approver and it is waiting on you. */
  | "approval_required"
  /** A recorded escalation actually named you. Not a rung that is merely due. */
  | "escalation_reached_you"
  /** Whoever holds it asked you for a decision or a hand. */
  | "help_requested";

export const ATTENTION_REASON_LABEL: Record<AttentionReason, string> = {
  responsible: "Yours to do",
  owner_fallback: "Nobody else can do this",
  needs_assignment: "Needs somebody assigned",
  explicit_accountable: "You were named accountable",
  approval_required: "Waiting on your approval",
  escalation_reached_you: "Escalated to you",
  help_requested: "Help asked of you",
};

export const ATTENTION_REASON_DESCRIPTION: Record<AttentionReason, string> = {
  responsible: "You are the person doing this.",
  owner_fallback:
    "Nobody else in this workspace holds what it needs, so it is yours until somebody does.",
  needs_assignment:
    "Nobody here can do this, including you. It needs a permission granted or a person hired.",
  explicit_accountable: "Somebody put you in the accountable seat for this one.",
  approval_required: "It cannot be finished until you approve it.",
  escalation_reached_you: "Somebody escalated this to you, by hand, and it is recorded.",
  help_requested: "The person holding it has asked you to decide or to step in.",
};

/** True for the sources that mean a person overrode the default. */
export const ASSIGNMENT_IS_OVERRIDE: Record<AssignmentSource, boolean> = {
  default_policy: false,
  delegation: false,
  manual: true,
  fallback: false,
  escalation: true,
  takeover: true,
};

/* -------------------------------------------------------------------------- */
/* SLA                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Acknowledgement and resolution targets, in minutes from when work opened.
 *
 * Two clocks, not one, because they fail differently: nobody has picked this up
 * is a routing problem, and somebody picked it up and it is still not done is a
 * capacity problem. A single "overdue" number cannot tell an Owner which they
 * have.
 */
export interface SlaTarget {
  acknowledgeMinutes: number;
  resolveMinutes: number;
}

export type SlaClock = "acknowledge" | "resolve";

export type SlaState =
  /** Inside target with room to spare. */
  | "on_track"
  /** Inside target, but past the warning fraction. */
  | "due_soon"
  /** Past target. */
  | "breached"
  /** Already acknowledged (for the acknowledge clock) or resolved. */
  | "met"
  /** The clock is not running: blocked, paused, or nothing to measure. */
  | "paused";

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  on_track: "On track",
  due_soon: "Due soon",
  breached: "Overdue",
  met: "Met",
  paused: "Clock paused",
};

/** One clock's reading, worked out from the record and the current time. */
export interface SlaReading {
  clock: SlaClock;
  state: SlaState;
  /** When the target falls due. Absent when the clock is not running. */
  dueAt?: IsoDateTime;
  /** Negative once breached. */
  minutesRemaining?: number;
  /** Why the clock is paused, when it is. */
  pausedReason?: string;
}

export interface SlaStatus {
  target: SlaTarget;
  acknowledge: SlaReading;
  resolve: SlaReading;
  /** The worse of the two, which is what a queue sorts and colours by. */
  worst: SlaState;
}

/* -------------------------------------------------------------------------- */
/* Escalation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The conditions that can start an escalation.
 *
 * Every one of these is a fact about the work or the people, evaluated from
 * records. None of them is a timer, and none of them fires a notification: what
 * a trigger produces is a STATE the queue can show and a person can act on.
 */
export type EscalationTrigger =
  | "not_acknowledged"
  | "resolution_overdue"
  | "high_severity"
  | "blocked"
  | "missing_permission"
  | "assignee_unavailable"
  | "repeated_failure"
  | "approval_required"
  | "no_eligible_assignee"
  | "scope_ending";

export const ESCALATION_TRIGGER_LABEL: Record<EscalationTrigger, string> = {
  not_acknowledged: "Not acknowledged inside the SLA",
  resolution_overdue: "Resolution overdue",
  high_severity: "High or critical severity",
  blocked: "Work is blocked",
  missing_permission: "Assignee lacks a required permission",
  assignee_unavailable: "Assignee unavailable, suspended or removed",
  repeated_failure: "Repeated failure or reopening",
  approval_required: "Approval required",
  no_eligible_assignee: "No eligible assignee",
  scope_ending: "Relationship or assignment ending",
};

export const ESCALATION_TRIGGER_DESCRIPTION: Record<EscalationTrigger, string> = {
  not_acknowledged: "Nobody has picked it up inside the acknowledgement target.",
  resolution_overdue: "Somebody has it and the resolution target has passed.",
  high_severity: "The work is high or critical severity, so a manager sees it from the start.",
  blocked: "Something is stopping the work that the assignee cannot clear.",
  missing_permission: "Whoever holds it can no longer do what it asks.",
  assignee_unavailable: "The person holding it is away, suspended, or no longer a member.",
  repeated_failure: "It has been reopened or has failed more than once.",
  approval_required: "It cannot be finished until somebody approves it.",
  no_eligible_assignee: "Nobody in the workspace is eligible to do it.",
  scope_ending: "The relationship or assignment this sits under is about to end.",
};

/**
 * What an escalation step DOES.
 *
 * Kept as six distinct actions rather than one, because the central rule of
 * this module is that escalation is not reassignment. A `manager_visibility`
 * step leaves the responsible membership exactly where it was and adds the
 * manager as a watcher; only `reassign` and `takeover` move the work, and both
 * are recorded as such.
 */
export type EscalationAction =
  /** Nudge whoever holds it. Nothing moves. */
  | "reminder"
  /** The accountable manager can now see it. Nothing moves. */
  | "manager_visibility"
  /** Ask a named approver to approve. Nothing moves. */
  | "approval_request"
  /** Raise the level: a higher accountable membership, still nothing moves. */
  | "escalate"
  /** Move the work to somebody else. The one step that changes who is responsible. */
  | "reassign"
  /** An authorized person takes it, becoming responsible themselves. */
  | "takeover";

export const ESCALATION_ACTION_LABEL: Record<EscalationAction, string> = {
  reminder: "Remind",
  manager_visibility: "Give the manager visibility",
  approval_request: "Request approval",
  escalate: "Escalate",
  reassign: "Reassign",
  takeover: "Take over",
};

/** True for the two actions that actually move who is responsible. */
export const ESCALATION_ACTION_MOVES_WORK: Record<EscalationAction, boolean> = {
  reminder: false,
  manager_visibility: false,
  approval_request: false,
  escalate: false,
  reassign: true,
  takeover: true,
};

/**
 * One rung of an escalation ladder.
 *
 * `afterMinutes` is measured from the moment the trigger became true, not from
 * when the work opened, so a step written for "30 minutes after it goes
 * overdue" means that and not "30 minutes after it existed".
 */
export interface EscalationStep {
  /** 1-based. Level 1 is the first thing that happens, not the last. */
  level: number;
  afterMinutes: number;
  action: EscalationAction;
  /** Who this step is aimed at. `accountable` is the usual answer. */
  notify: ResponsibilityRole[];
  /** One sentence, shown on the record. */
  detail: string;
}

/**
 * A named ladder plus the conditions that start it.
 *
 * Seeded policies may be edited but not deleted, exactly like permission
 * templates: a workspace with no policy at all would be a workspace where
 * nothing ever escalates.
 */
export interface EscalationPolicy {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  /** Which work this applies to. Absent means every function. */
  appliesToFunctions?: ResponsibilityFunction[];
  /** Which severities this applies to. Absent means every severity. */
  appliesToSeverities?: ResponsibilitySeverity[];
  triggers: EscalationTrigger[];
  steps: EscalationStep[];
  sla: SlaTarget;
  /** Seeded policies may be edited but not deleted. */
  seeded: boolean;
  updatedAt: IsoDateTime;
}

/**
 * A trigger that is true right now, and how far up the ladder it has got.
 *
 * COMPUTED on every read. Nothing here is stored, because a stored escalation
 * level would go stale the moment somebody acknowledged the work in another
 * tab.
 */
export interface EscalationState {
  trigger: EscalationTrigger;
  /** When the trigger became true. */
  since: IsoDateTime;
  /** The steps whose time has come, in order. Empty while it is still early. */
  reached: EscalationStep[];
  /** The next step, and when it is due. Absent at the top of the ladder. */
  next?: { step: EscalationStep; dueAt: IsoDateTime };
  /** The highest level reached, 0 while no step has fired. */
  level: number;
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* The assignment record                                                       */
/* -------------------------------------------------------------------------- */

/** A membership in one of the four roles, with the reason it is there. */
export interface ResponsibilityHolder {
  membershipId: string;
  /** Snapshot, so an ended membership still reads sensibly in history. */
  displayName: string;
  /** The person's title in this workspace, display only. Never a permission. */
  title?: string;
  role: ResponsibilityRole;
  source: AssignmentSource;
  /** Why the engine chose them, in a sentence a person can argue with. */
  reason: string;
  /** False once the membership is suspended, ended or unavailable. */
  available: boolean;
}

export type ResponsibilityTimelineAction =
  | "routed"
  | "assigned"
  | "delegated"
  | "reassigned"
  | "accountable_changed"
  | "watcher_added"
  | "watcher_removed"
  | "acknowledged"
  | "approval_requested"
  | "help_requested"
  | "approved"
  | "approval_declined"
  | "escalated"
  | "reminded"
  | "taken_over"
  | "kept"
  | "resolved"
  | "reopened"
  | "fallback_applied"
  | "policy_changed";

export const RESPONSIBILITY_TIMELINE_LABEL: Record<ResponsibilityTimelineAction, string> = {
  routed: "Routed",
  assigned: "Assigned",
  delegated: "Delegated",
  reassigned: "Reassigned",
  accountable_changed: "Accountable changed",
  watcher_added: "Watcher added",
  watcher_removed: "Watcher removed",
  acknowledged: "Acknowledged",
  approval_requested: "Approval requested",
  help_requested: "Help requested",
  approved: "Approved",
  approval_declined: "Approval declined",
  escalated: "Escalated",
  reminded: "Reminder sent",
  taken_over: "Taken over",
  kept: "Kept",
  resolved: "Resolved",
  reopened: "Reopened",
  fallback_applied: "Owner fallback applied",
  policy_changed: "Policy changed",
};

/**
 * One line of the immutable timeline.
 *
 * Append-only, never edited and never deleted — including when a membership
 * ends. A handoff three weeks ago is still readable after the person who made
 * it has left, which is the whole reason the names are snapshotted.
 */
export interface ResponsibilityTimelineEntry {
  id: string;
  at: IsoDateTime;
  action: ResponsibilityTimelineAction;
  /** Absent when the system did it rather than a person. */
  actorMembershipId?: string;
  actorName: string;
  /** The membership this was done to, where there is one. */
  subjectMembershipId?: string;
  subjectName?: string;
  note: string;
  /** Set on escalation lines. */
  trigger?: EscalationTrigger;
  level?: number;
}

/**
 * Who holds one piece of work, under what targets, with what happening to it.
 *
 * The STORED part of this record is small on purpose — the holders, the policy
 * it runs under, and the timeline. Everything else (`sla`, `escalations`,
 * `atRisk`) is derived on every read from the clock and the live records, so a
 * card cannot claim an SLA is met when it has just been breached.
 */
export interface ResponsibilityAssignment {
  id: string;
  organizationId: string;
  work: ResponsibilityWorkRef;
  functionKey: ResponsibilityFunction;
  severity: ResponsibilitySeverity;
  scope: ResponsibilityScopeRef[];

  responsible: ResponsibilityHolder;
  /** Never absent. The invariant the whole module exists to keep. */
  accountable: ResponsibilityHolder;
  approver?: ResponsibilityHolder;
  watchers: ResponsibilityHolder[];

  policyId: string;
  policyName: string;

  openedAt: IsoDateTime;
  dueAt?: IsoDateTime;
  acknowledgedAt?: IsoDateTime;
  acknowledgedByMembershipId?: string;
  resolvedAt?: IsoDateTime;
  approvalState?: ApprovalState;

  /* -- Derived on every read. Nothing below is stored. ------------------- */
  sla: SlaStatus;
  escalations: EscalationState[];
  /** True when any clock is due soon or breached, or any trigger is live. */
  atRisk: boolean;
  /**
   * What the assignment amounts to, for a screen that has to name it.
   *
   * Never "unassigned": every assignment has a responsible membership, and
   * `owner_fallback` and `needs_assignment` say which kind of fallback it is
   * rather than pretending nobody holds it.
   */
  assignmentState: AssignmentState;
  /** True when nobody in the workspace is eligible, the holder included. */
  noEligibleAssignee: boolean;
  /**
   * Why this needs the VIEWER personally. Empty means it does not — which is
   * the normal state of most of a workspace's work for most of its people.
   */
  attention: AttentionReason[];
  /** What this viewer may do to it. */
  can: ResponsibilityAbilities;

  timeline: ResponsibilityTimelineEntry[];
}

export type ApprovalState = "not_required" | "requested" | "approved" | "declined";

export const APPROVAL_STATE_LABEL: Record<ApprovalState, string> = {
  not_required: "No approval needed",
  requested: "Waiting on approval",
  approved: "Approved",
  declined: "Approval declined",
};

/**
 * What one membership may do to one assignment.
 *
 * Worked out beside the records and re-checked inside every mutation, exactly
 * like `MtLoopAbilities`: a board that has gone stale in a tab cannot be used
 * to do something the person may no longer do.
 */
export interface ResponsibilityAbilities {
  acknowledge: boolean;
  /** Keep it: an explicit "this is mine, I am on it" that clears a reminder. */
  keep: boolean;
  delegate: boolean;
  reassign: boolean;
  changeAccountable: boolean;
  requestApproval: boolean;
  approve: boolean;
  /** Ask whoever answers for this to decide or step in. Moves nothing. */
  requestHelp: boolean;
  escalate: boolean;
  takeOver: boolean;
  addWatcher: boolean;
  customizePolicy: boolean;
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                 */
/* -------------------------------------------------------------------------- */

export type EligibilityFailure =
  | "missing_permission"
  | "out_of_scope"
  | "not_available"
  | "not_active"
  | "wrong_organization"
  | "not_assigned_to_asset";

export const ELIGIBILITY_FAILURE_LABEL: Record<EligibilityFailure, string> = {
  missing_permission: "Does not hold a permission this work needs",
  out_of_scope: "This work is outside their record scope",
  not_available: "Not available right now",
  not_active: "Membership is not active",
  wrong_organization: "Not a member of this workspace",
  not_assigned_to_asset: "Not assigned to the truck, driver or carrier this is about",
};

/**
 * One membership weighed against one piece of work.
 *
 * Both outcomes are returned, not just the eligible ones: an Owner asking "why
 * did this land on me?" is owed the list of people who were considered and the
 * reason each was passed over.
 */
export interface EligibilityVerdict {
  membershipId: string;
  displayName: string;
  title?: string;
  eligible: boolean;
  /** Empty when eligible. */
  failures: EligibilityFailure[];
  /** Higher is a better match. Ties break on membership id, so it is stable. */
  score: number;
  /** Why this membership scored what it did. */
  reasons: string[];
}

/* -------------------------------------------------------------------------- */
/* Fleet profile                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How big this operation is, and therefore how much structure it gets.
 *
 * The ONE input a Carrier is ever asked for during onboarding is the number of
 * trucks. Everything else — whether there are team queues, whether supervisors
 * exist, how many escalation levels there are — is derived from this and from
 * who is actually in the workspace. The thresholds live in
 * `src/config/responsibility.ts` and are configurable; nothing in the engine
 * compares a truck count to a literal.
 */
export type FleetTier = "solo" | "small" | "midsize" | "large";

export const FLEET_TIER_LABEL: Record<FleetTier, string> = {
  solo: "Owner-operator",
  small: "Small fleet",
  midsize: "Midsize fleet",
  large: "Large fleet",
};

export interface FleetProfile {
  organizationId: string;
  truckCount: number;
  tier: FleetTier;
  /** How many active, non-driver memberships could hold work. */
  eligibleMemberCount: number;
  /**
   * Capabilities the tier ALLOWS. Whether they are actually on also depends on
   * whether the people exist — a midsize tier with one member gets no team
   * queue, because there is nobody to queue work to.
   */
  teamQueuesEnabled: boolean;
  supervisorsEnabled: boolean;
  /** How many rungs of the ladder this workspace uses. */
  escalationLevels: number;
  /**
   * True when the shape is known: the registry holds trucks, or somebody has
   * answered the question.
   *
   * What it is FOR is deciding whether to ask. The zero-friction rule is "ask
   * only for the number of Trucks when fleet-size differences matter", and a
   * workspace that already has trucks registered has already told us — asking
   * again would be the kind of setup step the rule exists to prevent.
   */
  sizeConfirmed: boolean;
  /** Plain language, for the settings screen. */
  summary: string;
}

/* -------------------------------------------------------------------------- */
/* Queues                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The views, in the order a person reads them.
 *
 * The first three are the ones that matter and they are kept strictly apart,
 * because collapsing any two of them is how an Owner ends up with their whole
 * organization in their face:
 *
 *   my_needs_you      work that stops unless THIS person acts. See
 *                     `attention.ts` — it is a much narrower question than
 *                     "can they see it" or "do they answer for it".
 *   team_oversight    work held by people they answer for. Health, SLA risk
 *                     and escalation state, with no claim on their attention.
 *   all_organization  the complete inventory, for deliberate inspection. Not
 *                     an attention queue and never fed into one.
 *
 * The rest are lenses over the same work for the dispatch surface.
 */
export type ResponsibilityQueue =
  | "my_needs_you"
  | "team_oversight"
  | "all_organization"
  | "my_mt_loop"
  | "escalated"
  | "at_risk"
  /** Work the Owner holds because nobody else qualified. It HAS an owner. */
  | "owner_fallback"
  /** Work nobody in the workspace can do. It needs a person, not a queue. */
  | "needs_assignment";

export const QUEUE_LABEL: Record<ResponsibilityQueue, string> = {
  my_needs_you: "My Needs You",
  team_oversight: "Team oversight",
  all_organization: "All organization",
  my_mt_loop: "My MT Loop",
  escalated: "Escalated",
  at_risk: "At risk",
  owner_fallback: "Owner fallback",
  needs_assignment: "Needs assignment",
};

export const QUEUE_DESCRIPTION: Record<ResponsibilityQueue, string> = {
  my_needs_you:
    "Only what needs you personally — yours to do, escalated to you, waiting on your approval, or nobody else can.",
  team_oversight:
    "Held by people you answer for. Watch it here; it is not your work unless it reaches you.",
  all_organization:
    "Everything open in this workspace, for when you want to look. Not an attention queue.",
  my_mt_loop: "Truck cycles that need you personally.",
  escalated: "Somebody was actually brought in, by hand. The original assignee still holds it.",
  at_risk: "An acknowledgement or resolution target is close, or already missed.",
  owner_fallback:
    "Nobody else in this workspace can do these yet, so they sit with the Owner. They are owned, not unassigned.",
  needs_assignment:
    "Nobody here holds what these need. Grant a permission, or bring somebody in.",
};

/** The three the Needs You page shows, in order. */
export const NEEDS_YOU_VIEWS: readonly ResponsibilityQueue[] = [
  "my_needs_you", "team_oversight", "all_organization",
];

/** The queues every workspace always shows, however small it is. */
export const ALWAYS_VISIBLE_QUEUES: readonly ResponsibilityQueue[] = [
  "my_needs_you", "my_mt_loop",
];

export interface ResponsibilityQueueView {
  queue: ResponsibilityQueue;
  label: string;
  description: string;
  count: number;
  /** True when the queue is shown but empty, as opposed to not applicable. */
  applicable: boolean;
  items: ResponsibilityAssignment[];
}

/**
 * The whole work surface, already narrowed by the service.
 *
 * A queue the viewer may not see is ABSENT rather than empty, the same
 * convention the dispatch workspace uses: "team" missing means there is no team
 * to see, which renders differently from a team holding nothing.
 */
export interface ResponsibilityBoard {
  organizationId: string;
  fleetProfile: FleetProfile;
  queues: ResponsibilityQueueView[];
  counts: {
    total: number;
    /** Work that needs the viewer personally. The only number that is a to-do list. */
    mine: number;
    /** Held by the Owner because nobody else qualified. Owned, not unassigned. */
    ownerFallback: number;
    /** Nobody in the workspace can do it at all. */
    needsAssignment: number;
    /**
     * Work with no responsible membership whatsoever.
     *
     * Structurally always zero — routing cannot produce it — and reported
     * anyway, because an invariant nobody measures is an invariant nobody
     * notices breaking.
     */
    trulyUnassigned: number;
    escalated: number;
    atRisk: number;
    /** Work the viewer oversees but is not doing. Oversight, never a to-do list. */
    oversight: number;
  };
  /** Memberships the viewer may hand work to. Absent in a workspace of one. */
  assignableTo?: Array<{ membershipId: string; displayName: string; title?: string }>;
  /** True when the viewer may open the responsibility settings at all. */
  mayCustomize: boolean;
}

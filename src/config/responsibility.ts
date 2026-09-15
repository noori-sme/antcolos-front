import type {
  EscalationAction, EscalationStep, EscalationTrigger, FleetTier,
  ResponsibilityFunction, ResponsibilitySeverity, ResponsibilityRole,
  SlaTarget,
} from "@/types";

/**
 * ★ EVERY THRESHOLD AND EVERY DEFAULT, IN ONE FILE ★
 *
 * The milestone's rule is explicit: "Fleet-size thresholds and default policies
 * must be configurable — not scattered hardcoded checks." So nothing in
 * `src/lib/responsibility/` compares a truck count to a literal, names an SLA
 * in minutes, or decides how many escalation rungs a workspace gets. They all
 * read this file, and a workspace that wants different numbers overrides them
 * through the policy records rather than through a code change.
 *
 * ███ FRONTEND ONLY ███
 * These are product defaults expressed as data. They are not enforced by
 * anything, they do not start timers, and the real values will come from the
 * backend's own configuration when it exists.
 */

/* -------------------------------------------------------------------------- */
/* Fleet size                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The ONE question onboarding asks, and the only thing it decides.
 *
 * Bands are inclusive lower bounds, read in order, first match wins. A carrier
 * that says "1" gets the Owner-first model with no structure at all; one that
 * says "40" gets team queues and supervisors without ever seeing a wizard.
 */
export interface FleetBand {
  tier: FleetTier;
  /** Inclusive. The first band whose minimum the count meets is the answer. */
  minTrucks: number;
  teamQueuesEnabled: boolean;
  supervisorsEnabled: boolean;
  /** How many rungs of an escalation ladder this size of business uses. */
  escalationLevels: number;
  summary: string;
}

/** Ordered largest-first, so `find` returns the most specific band. */
export const FLEET_BANDS: readonly FleetBand[] = [
  {
    tier: "large",
    minTrucks: 26,
    teamQueuesEnabled: true,
    supervisorsEnabled: true,
    escalationLevels: 3,
    summary:
      "Team queues, supervisors and a three-step escalation ladder, switched on automatically because the people to run them are here.",
  },
  {
    tier: "midsize",
    minTrucks: 6,
    teamQueuesEnabled: true,
    supervisorsEnabled: true,
    escalationLevels: 2,
    summary:
      "Team queues and a supervisor level, so work can be held by one person and watched by another.",
  },
  {
    tier: "small",
    minTrucks: 2,
    teamQueuesEnabled: true,
    supervisorsEnabled: false,
    escalationLevels: 1,
    summary:
      "Owner-first, with a team queue once there is a second person to hand work to.",
  },
  {
    tier: "solo",
    minTrucks: 0,
    teamQueuesEnabled: false,
    supervisorsEnabled: false,
    escalationLevels: 1,
    summary:
      "Everything is yours. No queues to hand work to, and nothing to configure.",
  },
];

/**
 * The minimum number of eligible memberships before a tier's capabilities
 * actually switch on.
 *
 * The reason this exists separately from the band: a ten-truck carrier that has
 * not invited anybody yet must NOT get a team queue, because "assign to the
 * team" would mean "assign to nobody". Capability is the AND of the tier
 * allowing it and the people existing.
 */
export const MIN_MEMBERS_FOR_TEAM_QUEUE = 2;
export const MIN_MEMBERS_FOR_SUPERVISORS = 3;

/* -------------------------------------------------------------------------- */
/* SLA defaults                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Acknowledgement and resolution targets by severity, in minutes.
 *
 * Two clocks because they fail differently. A policy may override either.
 */
export const DEFAULT_SLA_BY_SEVERITY: Record<ResponsibilitySeverity, SlaTarget> = {
  critical: { acknowledgeMinutes: 15, resolveMinutes: 120 },
  high: { acknowledgeMinutes: 60, resolveMinutes: 480 },
  medium: { acknowledgeMinutes: 240, resolveMinutes: 1440 },
  low: { acknowledgeMinutes: 1440, resolveMinutes: 4320 },
};

/**
 * How far through a target counts as "due soon".
 *
 * 0.75 means the last quarter of the window is amber. A single fraction rather
 * than a per-severity minute count, so the warning scales with the target
 * instead of needing four more numbers to keep in step.
 */
export const SLA_WARNING_FRACTION = 0.75;

/**
 * Whether a blocked piece of work stops its resolution clock.
 *
 * True, deliberately: holding somebody to a resolution target for work they
 * cannot do is how an SLA stops meaning anything. The acknowledgement clock
 * keeps running, because somebody still has to pick it up and say it is
 * blocked — and `blocked` is itself an escalation trigger.
 */
export const BLOCKED_PAUSES_RESOLUTION_CLOCK = true;

/* -------------------------------------------------------------------------- */
/* Escalation defaults                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The triggers every workspace starts with.
 *
 * All ten of them. They cost nothing when nothing is wrong, and a workspace
 * that has to switch on "tell me when nobody can do this" has already been
 * bitten by it once.
 */
export const DEFAULT_TRIGGERS: readonly EscalationTrigger[] = [
  "not_acknowledged",
  "resolution_overdue",
  "high_severity",
  "blocked",
  "missing_permission",
  "assignee_unavailable",
  "repeated_failure",
  "approval_required",
  "no_eligible_assignee",
  "scope_ending",
];

/**
 * How many reopenings or failures count as "repeated".
 */
export const REPEATED_FAILURE_THRESHOLD = 2;

/**
 * How close a relationship or assignment ending starts being a problem.
 */
export const SCOPE_ENDING_WARNING_MINUTES = 72 * 60;

/**
 * The ladder, written once and trimmed to the tier's level count.
 *
 * Read this in order and notice what the first three rungs do NOT do: nothing
 * moves. A reminder, then the manager can see it, then the level goes up — the
 * original assignee is still responsible through all of it. Only rung four
 * reassigns, and no default policy in this file includes rung four, because
 * automatic reassignment is a decision a Carrier makes, not one Antcolos makes
 * for them.
 */
export const DEFAULT_LADDER: readonly EscalationStep[] = [
  {
    level: 1,
    afterMinutes: 0,
    action: "reminder",
    notify: ["responsible"],
    detail: "Whoever holds this is reminded. Nothing moves.",
  },
  {
    level: 2,
    afterMinutes: 30,
    action: "manager_visibility",
    notify: ["accountable"],
    detail: "The accountable manager can now see it. The assignee still holds it.",
  },
  {
    level: 3,
    afterMinutes: 120,
    action: "escalate",
    notify: ["accountable", "watcher"],
    detail: "Raised a level. Still nobody else's work — somebody has to decide.",
  },
];

/**
 * The rung from which work counts as ESCALATED.
 *
 * Level 1 is a reminder to whoever already holds the work, and a reminder is
 * not an escalation: nobody else has been involved and nothing has left the
 * desk. Escalation starts at the rung where somebody ELSE is brought in, which
 * is level 2 in the default ladder.
 *
 * Without this the Escalated queue fills with every high-severity item the
 * moment it opens, and a queue that always has three hundred rows in it is a
 * queue nobody opens.
 */
export const ESCALATED_FROM_LEVEL = 2;

/**
 * The extra rung a policy can add, and the reason it is not in the defaults.
 *
 * A Carrier that wants unattended reassignment can add this step in settings.
 * Antcolos does not turn it on for them, because moving work off somebody
 * without a person deciding is exactly the behaviour the milestone forbids by
 * default.
 */
export const OPTIONAL_REASSIGN_STEP: EscalationStep = {
  level: 4,
  afterMinutes: 240,
  action: "reassign",
  notify: ["accountable"],
  detail: "Moves the work to the next eligible person. Off unless you turn it on.",
};

/**
 * The step a trigger that is ABOUT a person, rather than about time, starts at.
 *
 * `assignee_unavailable` and `missing_permission` have no useful "remind them"
 * rung: the person cannot act, so reminding them is noise. These begin at
 * manager visibility instead.
 */
export const TRIGGER_STARTS_AT_LEVEL: Partial<Record<EscalationTrigger, number>> = {
  assignee_unavailable: 2,
  missing_permission: 2,
  no_eligible_assignee: 2,
  approval_required: 1,
  scope_ending: 2,
};

/**
 * Triggers that are a STANDING CONDITION rather than something that went wrong.
 *
 * "This is critical" is true the moment the work opens and stays true whoever
 * is doing it and however well. It should make the accountable manager able to
 * see the work immediately — which is exactly what the Owner-oversight rule
 * asks for — and then stop. Climbing a time ladder from it would mean every
 * high-severity item in the workspace reads as escalated half an hour after it
 * appears, and a queue that always holds most of the work is a queue nobody
 * opens.
 *
 * So these get ONE rung, at minute zero, and are excluded from what
 * `hasEscalated` counts. "Escalated" is reserved for something having gone
 * wrong: nobody acknowledged it, it ran over, it is blocked, the assignee left.
 */
export const VISIBILITY_ONLY_TRIGGERS: readonly EscalationTrigger[] = [
  "high_severity",
];

export const VISIBILITY_ONLY_STEP: EscalationStep = {
  level: 2,
  afterMinutes: 0,
  action: "manager_visibility",
  notify: ["accountable"],
  detail: "Severe enough that the accountable manager sees it from the start. Nothing moves.",
};

/**
 * The action a trigger leads with, where the ladder's own first action is wrong
 * for it.
 */
export const TRIGGER_LEAD_ACTION: Partial<Record<EscalationTrigger, EscalationAction>> = {
  approval_required: "approval_request",
  no_eligible_assignee: "manager_visibility",
  missing_permission: "manager_visibility",
  assignee_unavailable: "manager_visibility",
};

/* -------------------------------------------------------------------------- */
/* Routing weights                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What makes one candidate a better match than another.
 *
 * Higher wins, ties break on membership id so the answer is stable across
 * reads. Notice there is no weight for a job title: a title is display text in
 * this product and never a routing input.
 */
export const ROUTING_WEIGHTS = {
  /** The membership is the driver this work is waiting on. Decisive. */
  driverOfRecord: 1000,
  /** The membership is assigned to the truck the work is about. */
  assignedToTruck: 400,
  /** The membership holds a delegation covering this carrier. */
  carrierDelegation: 300,
  /** The membership's declared function matches the work's. */
  functionMatch: 200,
  /** The membership already holds other work on the same truck or load. */
  continuity: 120,
  /** The membership is a supervisor for this function. */
  supervisor: 60,
  /** Holds every permission with room to spare rather than exactly enough. */
  permissionHeadroom: 10,
  /** The workspace Owner. Lowest, so the Owner is the fallback, not the default. */
  owner: 1,
} as const;

/**
 * Functions a driver membership may ever be responsible for.
 *
 * Not a role check: this is the list of work a person scoped to their own
 * records can meaningfully perform. A driver can report a defect and produce a
 * document; a driver cannot be made responsible for dispatching a truck.
 */
export const DRIVER_ELIGIBLE_FUNCTIONS: readonly ResponsibilityFunction[] = [
  "driver_action", "documents", "compliance", "maintenance",
];

/* -------------------------------------------------------------------------- */
/* Owner oversight                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What reaches the Owner's PERSONAL queue once somebody else is responsible.
 *
 * The milestone is precise about this: the Owner "must still see oversight,
 * escalated, high-risk, and approval-required work without receiving every
 * routine item in their personal queue". Four things, and they are four
 * different filters rather than one severity cut:
 *
 *   oversight            → the `all_organization` queue and the oversight count,
 *                          which hold EVERYTHING and are not personal lists.
 *   escalated            → `OWNER_SEES_DELEGATED_WHEN_ESCALATED` below.
 *   high-risk            → `OWNER_SEES_DELEGATED_WHEN_AT_RISK`: actually at
 *                          risk, not merely tagged high. A high-severity item
 *                          somebody picked up ten minutes ago is being handled.
 *   approval-required    → `OWNER_ALWAYS_SEES`.
 *
 * Critical is the one severity that reaches them on its own, because a critical
 * item is worth an Owner's attention before any clock has run out.
 */
export const OWNER_PERSONAL_QUEUE_SEVERITIES: readonly ResponsibilitySeverity[] = [
  "critical",
];

/**
 * A delegated item whose acknowledgement or resolution target is slipping.
 *
 * OFF by default, and the reason is the `at_risk` queue right next to it. An
 * Owner already has a view of everything that is slipping; repeating all of it
 * in their personal list makes the personal list a copy of the At risk one, and
 * two identical queues is one queue nobody trusts. Turn it on for a workspace
 * whose Owner wants every wobble in their own list.
 */
export const OWNER_SEES_DELEGATED_WHEN_AT_RISK = false;

/** A delegated item a rung has fired on. */
export const OWNER_SEES_DELEGATED_WHEN_ESCALATED = true;

/**
 * Work the Owner sees personally whatever its severity, because it cannot move
 * without them.
 */
export const OWNER_ALWAYS_SEES: readonly EscalationTrigger[] = [
  "approval_required", "no_eligible_assignee", "assignee_unavailable",
];

/* -------------------------------------------------------------------------- */
/* Default policy shapes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The policies a workspace is created with.
 *
 * Deliberately three, not thirty. A new Carrier has a general policy that
 * covers everything, a tighter one for the work that stops trucks moving, and a
 * slower one for paperwork. Nobody is asked to choose between them: the routing
 * engine picks by function and severity, and a Carrier that never opens
 * settings never learns these exist.
 */
export interface DefaultPolicySeed {
  key: string;
  name: string;
  description: string;
  appliesToFunctions?: ResponsibilityFunction[];
  appliesToSeverities?: ResponsibilitySeverity[];
  /** Absent uses `DEFAULT_SLA_BY_SEVERITY` for the work's own severity. */
  sla?: SlaTarget;
  triggers?: EscalationTrigger[];
}

export const DEFAULT_POLICIES: readonly DefaultPolicySeed[] = [
  {
    key: "general",
    name: "Everything else",
    description:
      "The default. Applies to any work no tighter policy claims, at whatever severity it carries.",
  },
  {
    key: "moving_freight",
    name: "Work that stops a truck",
    description:
      "Dispatch and driver actions. Shorter targets, because an empty truck costs money every hour.",
    appliesToFunctions: ["dispatch", "driver_action"],
    sla: { acknowledgeMinutes: 30, resolveMinutes: 240 },
  },
  {
    key: "paperwork",
    name: "Paperwork and compliance",
    description:
      "Documents, compliance and finance. Longer targets, and nothing here escalates on the hour.",
    appliesToFunctions: ["documents", "compliance", "finance", "administration"],
    sla: { acknowledgeMinutes: 480, resolveMinutes: 2880 },
  },
];

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

/** The roles a person may be moved into from the UI. Watchers are added separately. */
export const ASSIGNABLE_ROLES: readonly ResponsibilityRole[] = [
  "responsible", "accountable", "approver",
];

/**
 * How long a "keep" holds a reminder off.
 *
 * Keeping work is an explicit "this is mine, I am on it". It silences the
 * reminder rung without touching the resolution clock — which still runs,
 * because saying you are on it is not the same as doing it.
 */
export const KEEP_QUIETS_REMINDER_MINUTES = 120;

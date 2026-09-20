import {
  RESPONSIBILITY_FUNCTION_LABEL, WORKFORCE_CLASSIFICATION_LABEL,
  WORKFORCE_TERMINAL_STATES,
  WORKFORCE_LEAVE_REASON_LABEL, WORKFORCE_START_BASIS_LABEL,
  WORKFORCE_STATE_LABEL,
  type ActorRef, type AuditAction, type OffboardingResult,
  type OffboardingResultStep, type OnboardingChecklist, type PermissionKey,
  isRestrictedQualificationCategory,
  type WorkforceEngagement, type WorkforceEngagementState,
  type WorkforceEngagementView, type WorkforceEventKind, type WorkforceFilters,
  type MembershipAvailability,
  type WorkforceFunctionAssignment, type WorkforceLeaveRecord,
  type WorkforceLink, type WorkforceNextAction, type WorkforceSummary,
} from "@/types";
import { assertTransition } from "@/lib/workforce/lifecycle";
import { rank, scorePerson, type PersonRecord } from "@/lib/setup/identity-matching";
import {
  availabilityFor, availabilityProjection, currentLeave, desiredSeatAvailability,
  isLeaveCurrent, leaveManagesSeat,
} from "@/lib/workforce/availability";
import { functionGapsFor } from "@/lib/workforce/functions";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AccessStepRequestInput, AssignFunctionInput, CancelLeaveInput,
  ClassificationChangeInput, CreateEngagementInput, EndEngagementInput,
  EndLeaveInput, LinkContractInput, ManagerChangeInput, RecordLeaveInput,
  RecordStartDateInput, RemoveFunctionInput, SuspendInput,
  TakeShareForwardInput, WaiveStepInput, WorkforceService,
} from "../contracts/workforce";
import {
  amendEngagement, engagementById, engagementsForOrganization, ensureSeeded,
  incompleteOffboardingFor, liveEngagementFor, nextEngagementId, nextLeaveId,
  putEngagement, putIncompleteOffboarding, putWaiver,
} from "./workforce-store";
import { buildOnboardingChecklist } from "./workforce-onboarding";
import { buildOffboardingPlan, runOffboardingSteps } from "./workforce-offboarding";
import { seedWorkforce } from "./workforce-seed";
import { appendAuditEvent, recordCrossOrganizationAttempt } from "./audit";
import { engagementNeedsYouCount } from "./workforce-needs-you";
import { memberIn, setMembershipAvailability } from "./membership-directory";
import { sharePackageById } from "./document-store";
import { recordsForDriver } from "./qualification-store";
import { driverProfileUnscoped } from "./driver-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE workforce service.
 *
 * What it owns: the answer to "on what basis, in what capacity, from what date
 * and in what status does this person work with this organization". Nothing
 * else, and the file is worth reading for what it cannot do:
 *
 *   • It never writes a permission. There is no import here that could.
 *   • It never creates or edits a membership. `requestAccessStep` records that
 *     the access system was ASKED; offboarding calls the access system's own
 *     command; no path writes into its store.
 *   • It never copies a contract term, a licence, a document or an amount.
 *   • It never decides a qualification. Safety does, and this reads Safety.
 *   • A job title, a classification and a manager grant nothing whatsoever.
 *
 * ── ISOLATION, PER A6 ──────────────────────────────────────────────────────
 * Engagements are read through `engagement.organizationId` and nothing else. No
 * engagement is readable because it names the reader as the manager, because
 * the reader is a party to the linked contract, or because it is about a driver
 * the reader can see: A6 settled that a field saying who a record is ABOUT is
 * attribution and never a grant, and the same reasoning applies one module over.
 * An id from another organization answers exactly as an invented id does, and
 * the attempt is recorded in the one ledger.
 *
 * ███ FRONTEND ONLY ███
 * No cross-module transaction exists. Activation reads every other module and
 * refuses when they disagree; it cannot change them together. Persistence,
 * unique constraints, real authorization, durable audit and job queues are the
 * backend's — see `docs/workforce-hr-foundation.md`.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 180;
const wait = () =>
  LATENCY_MS ? new Promise<void>((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve();

function required(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/**
 * Refusing to let somebody decide their own engagement.
 *
 * The one separation-of-duties rule this module keeps, and it is the same shape
 * as the Settlements rule about approving your own money: an Owner holds every
 * permission and is still not somebody else. Unlike a disposal rule, this one
 * cannot strand anybody — a solo owner-operator has nobody to start, because
 * they are not their own workforce.
 */
export class WorkforceSelfActionError extends Error {
  constructor(readonly action: string) {
    super(`You cannot ${action} your own engagement. Somebody else has to.`);
    this.name = "WorkforceSelfActionError";
  }
}

/** Refusing to start somebody another module says is not ready. */
export class OnboardingIncompleteError extends Error {
  constructor(readonly outstanding: OnboardingChecklist["outstanding"]) {
    super(
      `${outstanding.length} step${outstanding.length === 1 ? "" : "s"} required before starting `
      + `${outstanding.length === 1 ? "is" : "are"} outstanding in the module that owns `
      + `${outstanding.length === 1 ? "it" : "them"}: `
      + outstanding.map((s) => `${s.label} (${s.domain})`).join(", ")
      + ". Resolve it there, or have somebody authorised waive it with a reason.",
    );
    this.name = "OnboardingIncompleteError";
  }
}

/**
 * Refusing a start date nobody will say the provenance of.
 *
 * Not pedantry: "the carrier says March 2019" and "Antcolos saw it in March
 * 2019" are different claims with different weight, and the field is one a
 * regulator may ask about. A default would silently pick the stronger one.
 */
export class MissingStartDateBasisError extends Error {
  constructor() {
    super(
      "A start date needs a basis. Say whether this organization is stating the date or "
      + "whether Antcolos observed it — they are different claims, and Antcolos will not guess.",
    );
    this.name = "MissingStartDateBasisError";
  }
}

/** Refusing to act on leave that is not this engagement's, or is already over. */
export class LeaveNotFoundError extends Error {
  constructor(readonly leaveId: string) {
    super(`No open leave record ${leaveId} on this engagement.`);
    this.name = "LeaveNotFoundError";
  }
}

/**
 * Refusing to decide, either way, whether this is somebody the roster has.
 *
 * ★ NOT A DUPLICATE ERROR ★
 * `DuplicateEngagementError` means Antcolos KNOWS: the same account, driver
 * profile or address. This one means the opposite — the evidence is strong
 * enough that creating a second person would probably be wrong, and weak
 * enough that linking them would probably be wrong too. A name, an email and a
 * phone number are evidence, not identity.
 *
 * Both outcomes are permanent and only somebody who knows these people can
 * tell them apart, so the command stops and names what it found. This is the
 * same rule the roster import already keeps, using the same matcher.
 */
export class AmbiguousPersonError extends Error {
  constructor(
    readonly candidates: { engagementId: string; label: string; detail: string }[],
    readonly rationale: string,
  ) {
    super(
      `This organization already has somebody who may be this person: `
      + candidates.map((c) => c.label).join(", ")
      + `. ${rationale} Open the existing record if it is them, or confirm they are different `
      + "people — Antcolos will not decide it for you.",
    );
    this.name = "AmbiguousPersonError";
  }
}

/** Refusing a second live engagement for the same person. */
export class DuplicateEngagementError extends Error {
  constructor(readonly existingId: string) {
    super(
      "This person already has a live engagement with this organization. "
      + "End that one first; a person who left and came back gets a new engagement, "
      + "and the old one stays in history.",
    );
    this.name = "DuplicateEngagementError";
  }
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

function db() {
  ensureSeeded(seedWorkforce);
}

function own(ctx: ServiceContext, engagementId: string): WorkforceEngagement {
  db();
  const engagement = engagementById(engagementId);
  if (!engagement) throw new NotFoundError(`Engagement ${engagementId}`);
  if (engagement.organizationId !== ctx.organizationId) {
    recordCrossOrganizationAttempt(ctx, {
      entity: { kind: "workforce_engagement", id: engagementId, label: "Workforce engagement" },
      summary: "Attempted to read a workforce engagement belonging to another organization.",
    });
    throw new NotFoundError(`Engagement ${engagementId}`);
  }
  return engagement;
}

/**
 * True when the caller IS the person this engagement is about.
 *
 * Matched on the two canonical identities — the user account and the driver
 * profile — rather than on a name, because a name is not an identity and two
 * people share one often enough to matter.
 */
function isSubject(ctx: ServiceContext, engagement: WorkforceEngagement): boolean {
  if (ctx.actor.userId && engagement.person.userId === ctx.actor.userId) return true;
  if (ctx.driverProfileId && engagement.driverProfileId === ctx.driverProfileId) return true;
  return engagement.membershipId !== undefined && engagement.membershipId === ctx.membershipId;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

function audit(
  ctx: ServiceContext,
  action: AuditAction,
  engagement: WorkforceEngagement,
  summary: string,
  sourceAction: string,
): void {
  // `appendAuditEvent` rather than the async `record`: it is the same and only
  // write path into the one ledger, and calling it directly means the line
  // exists by the time the command returns instead of a tick later. A
  // fire-and-forget audit is a race in a test and a gap in a report.
  try {
    appendAuditEvent(ctx, {
      module: "workforce",
      action,
      sourceAction,
      entity: {
        kind: "workforce_engagement",
        id: engagement.id,
        label: `${engagement.person.displayName} · ${engagement.positionTitle}`,
        href: `/workforce/${engagement.id}`,
      },
      relatedEntities: engagement.driverProfileId
        ? [{
          kind: "driver", id: engagement.driverProfileId,
          label: engagement.person.displayName,
          href: `/people/drivers/${engagement.driverProfileId}`,
        }]
        : undefined,
      summary,
    });
  } catch {
    // A ledger that cannot be written is not a reason to refuse somebody an
    // HR action — the same rule the responsibility engine keeps.
  }
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

const STATE_EVENT: Partial<Record<WorkforceEngagementState, WorkforceEventKind>> = {
  onboarding: "onboarding_started",
  active: "activated",
  suspended: "suspended",
  ended: "ended",
  rejected: "rejected",
  withdrawn: "withdrawn",
};

const STATE_ACTION: Partial<Record<WorkforceEngagementState, AuditAction>> = {
  onboarding: "workforce.onboarding_started",
  active: "workforce.activated",
  suspended: "workforce.suspended",
  ended: "workforce.ended",
  rejected: "workforce.rejected",
  withdrawn: "workforce.withdrawn",
};

function transition(
  ctx: ServiceContext,
  engagement: WorkforceEngagement,
  to: WorkforceEngagementState,
  summary: string,
  changes: Partial<WorkforceEngagement> = {},
  kindOverride?: WorkforceEventKind,
  actionOverride?: AuditAction,
): WorkforceEngagement {
  assertTransition(engagement.state, to);
  const kind = kindOverride ?? STATE_EVENT[to] ?? "note";
  const next = amendEngagement(engagement.id, { ...changes, state: to }, {
    kind,
    summary,
    actor: ctx.actor,
    fromState: engagement.state,
    toState: to,
  });
  audit(ctx, actionOverride ?? STATE_ACTION[to] ?? "workforce.engagement_created",
    next, summary, `workforce.${kind}`);
  return next;
}

/* -------------------------------------------------------------------------- */
/* The one place leave touches the routing signal                              */
/* -------------------------------------------------------------------------- */

/**
 * Put the seat where leave says it should be, and nowhere else.
 *
 * ███ EVERY RULE HERE IS A DEFECT THIS REPLACED ███
 *
 *  1. **It never writes `available` blindly.** It restores what the leave
 *     DISPLACED. Somebody who was `off_shift` before going on leave is
 *     `off_shift` again afterwards, not handed back to the routing engine on a
 *     decision nobody made.
 *  2. **It asks `desiredSeatAvailability`, which refuses to speak for an
 *     engagement that is not active.** Ending an old leave record on somebody
 *     suspended or offboarded used to return them to work routing. Now leave
 *     has no opinion about them at all, and their seat is left exactly as the
 *     access system left it.
 *  3. **It will not overwrite a newer independent decision.** If the seat no
 *     longer reads `on_leave`, somebody else has since decided something, and
 *     leave ending is not a reason to undo it. The disagreement is reported by
 *     `availabilityProjection` instead of being silently resolved.
 *  4. **A failure is caught and left visible.** There is no cross-module
 *     transaction in this build, so the write can fail with the HR record
 *     already committed. The projection derivation then reports the drift and
 *     Needs You raises it — a resumable state rather than a silent one.
 *
 * Returns whether the seat now matches, so a caller can say so honestly.
 */
function applyLeaveProjection(
  engagement: WorkforceEngagement,
  displaced?: MembershipAvailability,
): void {
  if (!engagement.membershipId) return;
  const member = memberIn(engagement.organizationId, engagement.membershipId);
  if (!member) return;

  // ★ THE GUARD THAT COMES FIRST ★
  // A suspended or ended engagement is not leave's to speak for, and that
  // includes undoing leave's own earlier mark. Closing an old leave record on
  // somebody who has been stood down used to walk straight into the branch
  // below and write `available`, handing them back to the routing engine.
  if (!leaveManagesSeat(engagement)) return;

  const desired = desiredSeatAvailability(engagement, nowIso());

  try {
    if (desired !== undefined) {
      if (member.availability !== desired) {
        setMembershipAvailability(engagement.membershipId, desired);
      }
      return;
    }
    // Leave has no opinion. The ONLY thing it may undo is its own mark, and
    // only back to what it displaced.
    if (member.availability === "on_leave") {
      setMembershipAvailability(engagement.membershipId, displaced ?? "available");
    }
  } catch {
    // Deliberately swallowed, and deliberately not rolled back. The HR record
    // is the canonical fact and is already written; the projection is derived
    // and re-derivable. `availabilityProjection` reports the mismatch on the
    // next read and Needs You keeps asking until somebody applies it.
  }
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

function linksFor(engagement: WorkforceEngagement): WorkforceLink[] {
  const links: WorkforceLink[] = [];

  links.push(engagement.person.userId
    ? { kind: "user", label: "Antcolos account", href: "/settings/users" }
    : { kind: "user", label: "Antcolos account", absentReason: "This person has no Antcolos account. Somebody can work here without one." });

  links.push(engagement.membershipId
    ? { kind: "membership", label: "Access and permissions", href: "/settings/users" }
    : { kind: "membership", label: "Access and permissions", absentReason: "No access has been granted. Membership is separate from employment." });

  if (engagement.driverProfileId) {
    links.push({
      kind: "driver_profile",
      label: "Driver profile",
      href: `/people/drivers/${engagement.driverProfileId}`,
    });
    links.push({
      kind: "carrier_relationship",
      label: "Driver–carrier relationship",
      href: `/people/drivers/${engagement.driverProfileId}`,
    });
    links.push({ kind: "compliance", label: "Safety & Compliance", href: "/compliance" });
    links.push({ kind: "documents", label: "Documents", href: "/documents" });
    // Restricted categories are not counted: the page must not advertise the
    // existence of a record nobody may open.
    const qual = recordsForDriver(engagement.driverProfileId)
      .filter((r) => r.organizationId === engagement.organizationId)
      .filter((r) => !isRestrictedQualificationCategory(r.category)).length;
    links.push({
      kind: "qualification_file",
      label: `Qualification file (${qual})`,
      href: `/workforce/${engagement.id}`,
    });
    links.push({
      kind: "settlements",
      label: "Settlements",
      href: "/finance/settlements",
    });
  }

  links.push(engagement.contractId
    ? { kind: "contract", label: "Governing agreement", href: `/contracts/${engagement.contractId}` }
    : { kind: "contract", label: "Governing agreement", absentReason: "No agreement is linked. Contracts owns the terms; this only records which one governs." });

  return links;
}

/**
 * The next HR action, derived.
 *
 * ★ ONE, AND OFTEN NONE ★
 * An active person with nothing outstanding gets `undefined`, and that is the
 * whole discipline: a field that always has a value becomes a badge on every
 * row, and a badge on every row is read by nobody. The order below is a
 * priority, not a list — an unfinished offboarding outranks everything, because
 * somebody who has left still holds something.
 */
function nextActionFor(
  engagement: WorkforceEngagement,
  functionGapCount: number,
  now: string,
  drift: boolean,
): WorkforceNextAction | undefined {
  const href = `/workforce/${engagement.id}`;

  if (incompleteOffboardingFor(engagement.id).length > 0) {
    return {
      kind: "finish_offboarding",
      label: "Finish the offboarding",
      detail: "This person has left and something they held did not end. Until it does, they still hold it.",
      requires: ["workforce:end"],
      href,
    };
  }

  if (engagement.state === "prospective") {
    return {
      kind: "decide_on_candidate",
      label: "Decide about this person",
      detail: "They were taken forward and nobody has decided. Start onboarding, or record that they are not being taken forward.",
      requires: ["workforce:manage"],
      href,
    };
  }

  if (engagement.state === "onboarding") {
    const checklist = buildOnboardingChecklist(engagement);
    return checklist.readyToActivate
      ? {
        kind: "activate",
        label: "Start them",
        detail: "Every step the other modules own is done or waived. Nobody has started them.",
        requires: ["workforce:manage"],
        href,
      }
      : {
        kind: "finish_onboarding",
        label: `Finish ${checklist.outstanding.length} onboarding step${checklist.outstanding.length === 1 ? "" : "s"}`,
        detail: `Outstanding in the module that owns ${checklist.outstanding.length === 1 ? "it" : "them"}: `
          + checklist.outstanding.map((o) => o.label).join(", "),
        requires: ["workforce:manage"],
        href,
      };
  }

  // Outranks everything below it, and deliberately is NOT limited to an active
  // engagement: a seat left reading `on_leave` for somebody who has been
  // suspended is exactly as wrong as one taking work for somebody who is away,
  // and both are one idempotent command from correct.
  if (drift) {
    return {
      kind: "reconcile_availability",
      label: "Put work routing back in step with the recorded leave",
      detail: "The recorded leave and the work-routing signal disagree. Applying this changes "
        + "only that signal — it grants nothing and declares no dispatch readiness.",
      requires: ["workforce:manage"],
      href,
    };
  }

  if (engagement.state === "active") {
    // Overdue leave beats a function gap: somebody the organization believes is
    // back and has not said so is a person work may be routed to wrongly.
    const live = currentLeave(engagement, now);
    if (live?.expectedReturnDate && live.expectedReturnDate < now) {
      return {
        kind: "record_return_from_leave",
        label: "Record whether they came back",
        detail: `They were expected back on ${live.expectedReturnDate.slice(0, 10)}. Antcolos will not assume it — `
          + "say they returned, or record a new expected date.",
        requires: ["workforce:manage"],
        href,
      };
    }

    if (functionGapCount > 0) {
      return {
        kind: "close_function_gap",
        label: `Access does not match ${functionGapCount} recorded function${functionGapCount === 1 ? "" : "s"}`,
        detail: "This organization says they do this work and their seat cannot. Assigning a function here has "
          + "granted nothing; changing it is Access's to do.",
        // The permission that would actually close it, so the line says who can
        // rather than sending everybody to a screen half of them cannot use.
        requires: ["members:edit"],
        href: "/settings/users",
      };
    }

    /*
     * ★ WHAT IS DELIBERATELY NOT A NEXT ACTION ★
     * A start date with no recorded basis. Every engagement made before the
     * provenance field existed has one, so raising it here put the same nudge
     * on almost every row in the directory — and a queue that speaks on every
     * row is one nobody reads, which is the discipline this function was
     * written to keep.
     *
     * It is not blocked work and nobody is waiting on it. The engagement's own
     * page says "nobody recorded where this came from" beside the date, which
     * is where somebody correcting it would already be looking.
     */
  }

  return undefined;
}

function project(engagement: WorkforceEngagement): WorkforceEngagementView {
  const member = engagement.membershipId
    ? memberIn(engagement.organizationId, engagement.membershipId)
    : undefined;
  const now = nowIso();

  // The membership's EFFECTIVE permissions, computed by the access system and
  // read here. This module has never computed a permission and does not start.
  const functionGaps = functionGapsFor(
    engagement,
    member?.status === "active" ? member.permissions : undefined,
  );

  // Derived on every read, so a drift produced AFTER the command ran — a future
  // leave becoming effective, somebody changing the seat independently, a
  // failed projection write — shows up without anybody having been told.
  const projection = availabilityProjection(engagement, member?.availability, now);

  return {
    engagement,
    hasActiveMembership: member?.status === "active",
    links: linksFor(engagement),
    incompleteOffboarding: incompleteOffboardingFor(engagement.id),
    availability: { ...availabilityFor(engagement, now), projection },
    functionGaps,
    // A COUNT of the existing derived projection. The items themselves stay in
    // Needs You; this exists so a row can say "two things are waiting" without
    // this module growing a second queue to keep in step.
    openNeedsYouCount: countNeedsYouFor(engagement),
    nextAction: nextActionFor(engagement, functionGaps.length, now, !projection.inSync),
  };
}

/**
 * How many Needs You items this engagement currently produces.
 *
 * Deliberately asks the ONE derivation rather than re-deciding what counts.
 * Two answers to "does this need somebody" is how a badge comes to say 3 while
 * the queue shows 1.
 */
function countNeedsYouFor(engagement: WorkforceEngagement): number {
  return engagementNeedsYouCount(engagement);
}

/* -------------------------------------------------------------------------- */
/* Needs You input                                                             */
/* -------------------------------------------------------------------------- */

export function engagementsFor(organizationId: string): WorkforceEngagement[] {
  db();
  return engagementsForOrganization(organizationId);
}

export function outstandingOffboarding(engagementId: string): OffboardingResultStep[] {
  return incompleteOffboardingFor(engagementId);
}

export { buildOnboardingChecklist };

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

export const mockWorkforceService: WorkforceService = {
  async list(ctx, filters: WorkforceFilters = {}) {
    await wait();
    required(ctx, "workforce:view");
    db();
    const search = filters.search?.trim().toLowerCase();
    return engagementsForOrganization(ctx.organizationId)
      .filter((e) => {
        if (!filters.includeEnded && (e.state === "ended" || e.state === "rejected" || e.state === "withdrawn")) {
          return filters.state?.includes(e.state) ?? false;
        }
        if (filters.state?.length && !filters.state.includes(e.state)) return false;
        if (filters.classification?.length && !filters.classification.includes(e.classification)) return false;
        if (filters.managedByMembershipId && e.managerMembershipId !== filters.managedByMembershipId) return false;
        if (filters.functionKey
          && !e.functions.some((f) => f.functionKey === filters.functionKey)) return false;
        if (filters.onLeaveOnly && currentLeave(e, nowIso()) === undefined) return false;
        if (search) {
          const haystack = [e.person.displayName, e.positionTitle, e.person.email ?? ""]
            .join(" ").toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .map(project);
  },

  async get(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view");
    return project(own(ctx, engagementId));
  },

  async summary(ctx): Promise<WorkforceSummary> {
    await wait();
    required(ctx, "workforce:view");
    db();
    const all = engagementsForOrganization(ctx.organizationId);
    const byState = {
      prospective: 0, onboarding: 0, active: 0, suspended: 0,
      ended: 0, rejected: 0, withdrawn: 0,
    } as WorkforceSummary["byState"];
    const byClassification = {
      employee: 0, independent_contractor: 0, owner_operator: 0,
      organization_owner: 0, external_worker: 0,
    } as WorkforceSummary["byClassification"];
    let onboardingOutstanding = 0;
    let offboardingIncomplete = 0;
    let onLeave = 0;
    let functionGaps = 0;
    const at = nowIso();
    for (const e of all) {
      byState[e.state] += 1;
      byClassification[e.classification] += 1;
      if (e.state === "onboarding" && buildOnboardingChecklist(e).outstanding.length > 0) {
        onboardingOutstanding += 1;
      }
      if (incompleteOffboardingFor(e.id).length > 0) offboardingIncomplete += 1;
      if (e.state === "active" && currentLeave(e, at)) onLeave += 1;
      const member = e.membershipId ? memberIn(e.organizationId, e.membershipId) : undefined;
      functionGaps += functionGapsFor(
        e, member?.status === "active" ? member.permissions : undefined,
      ).length;
    }
    return {
      total: all.length, byState, byClassification,
      onboardingOutstanding, offboardingIncomplete, onLeave, functionGaps,
    };
  },

  async create(ctx, input: CreateEngagementInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    db();

    // The frontend stand-in for the backend's unique constraint. Named as such,
    // because an in-memory check is not a constraint: two tabs racing would
    // both pass it. See the backend requirements in the docs.
    const existing = liveEngagementFor(ctx.organizationId, {
      userId: input.person.userId,
      driverProfileId: input.person.driverProfileId,
      email: input.person.email,
    });
    if (existing) throw new DuplicateEngagementError(existing.id);

    /*
     * ★ AND THEN THE HARDER QUESTION ★
     * The check above answers "is this definitely the same person" — the same
     * account, driver profile or address. It cannot answer "is this PROBABLY
     * the same person", and that is the case a directory form produces all day:
     * somebody types a name that is one character off a person already on the
     * roster, with no email, and a second live engagement appears for a person
     * the carrier already had.
     *
     * The roster import already refuses to guess at this, using
     * `scorePerson`/`rank` in `@/lib/setup/identity-matching`. This is the SAME
     * matcher on the SAME question, so the two paths cannot disagree about who
     * is plausibly who — which is exactly what a second matcher here would
     * eventually do.
     *
     * The pool is this organization's LIVE engagements, deliberately narrower
     * than the import's: the question is "does this organization already have a
     * working relationship with this person", not "does this person exist
     * anywhere in Antcolos".
     */
    const acknowledged = new Set(input.confirmedDistinctFrom ?? []);
    const pool: PersonRecord[] = engagementsForOrganization(ctx.organizationId)
      .filter((e) => !WORKFORCE_TERMINAL_STATES.includes(e.state))
      // Acknowledged by EITHER id, because a person the roster knows has two:
      // the permanent driver profile, which is how the import names them, and
      // the engagement, which is how this module does. Matching on one only
      // would silently ignore half of the decisions a person already made.
      .filter((e) => !acknowledged.has(e.id)
        && !(e.driverProfileId !== undefined && acknowledged.has(e.driverProfileId)))
      .map((e) => {
        const profile = e.driverProfileId ? driverProfileUnscoped(e.driverProfileId) : undefined;
        return {
          // The SAME entity vocabulary the roster import uses: the permanent
          // profile where there is one, the engagement otherwise. One name for
          // one person across both paths, so a decision made on one is
          // recognisable to the other.
          entityId: e.driverProfileId ?? e.id,
          legalName: profile?.legalName ?? e.person.displayName,
          email: profile?.email ?? e.person.email,
          phone: profile?.phone,
          cdlNumber: profile?.cdlNumber,
          cdlState: profile?.cdlState,
          detail: `${WORKFORCE_STATE_LABEL[e.state]} · ${e.positionTitle}`,
        };
      });

    const ranking = rank(pool.map((record) => scorePerson({
      kind: "person",
      fullName: input.person.displayName,
      email: input.person.email,
      classification: input.classification,
    }, record)));

    // `matched` and `needs_decision` both stop. `matched` means the matcher is
    // sure and the exact check above was not — a driver profile the engagement
    // has and this input did not carry — and creating anyway would make the
    // duplicate the matcher just found.
    if (ranking.outcome === "needs_decision" || ranking.outcome === "matched") {
      throw new AmbiguousPersonError(
        ranking.candidates.slice(0, 5).map((c) => ({
          // Back to the engagement id, which is what a caller acknowledging
          // this would hold and what the directory links to.
          engagementId: engagementsForOrganization(ctx.organizationId)
            .find((e) => (e.driverProfileId ?? e.id) === c.entityId)?.id ?? c.entityId,
          label: c.label,
          detail: pool.find((r) => r.entityId === c.entityId)?.detail ?? "",
        })),
        ranking.rationale,
      );
    }

    // A start date with no basis is refused rather than guessed. The default a
    // caller would get wrong is the dangerous one — a migrated carrier's 2019
    // date silently recorded as something Antcolos watched happen.
    if (input.startDate && !input.startDateBasis) throw new MissingStartDateBasisError();

    const at = nowIso();
    const state: WorkforceEngagementState = input.startOnboarding ? "onboarding" : "prospective";
    const manager = input.managerMembershipId
      ? memberIn(ctx.organizationId, input.managerMembershipId)
      : undefined;

    const engagement: WorkforceEngagement = {
      id: nextEngagementId(),
      organizationId: ctx.organizationId,
      person: input.person,
      driverProfileId: input.person.driverProfileId,
      classification: input.classification,
      state,
      positionTitle: input.positionTitle,
      startDate: input.startDate,
      startDateProvenance: input.startDate && input.startDateBasis
        ? {
          value: input.startDate,
          basis: input.startDateBasis,
          recordedAt: at,
          recordedBy: ctx.actor,
          note: input.startDateNote,
        }
        : undefined,
      // Recorded, never granted. Nothing between this line and the permission
      // system, and `AssignFunctionInput` carries no key that could be.
      functions: (input.functions ?? []).map((functionKey) => ({
        functionKey,
        assignedByMembershipId: ctx.membershipId,
        assignedByName: ctx.actor.displayNameSnapshot,
        assignedAt: at,
      })),
      leave: [],
      managerMembershipId: manager?.membershipId,
      managerName: manager?.displayName,
      source: input.source,
      history: [{
        id: `${at}_created`,
        at,
        kind: "created",
        summary: `${WORKFORCE_CLASSIFICATION_LABEL[input.classification]} engagement created as ${WORKFORCE_STATE_LABEL[state].toLowerCase()}`,
        detail: input.source.label,
        actor: ctx.actor,
        toState: state,
      }],
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    putEngagement(engagement);
    audit(ctx, "workforce.engagement_created", engagement,
      `Engagement created for ${engagement.person.displayName} (${WORKFORCE_CLASSIFICATION_LABEL[engagement.classification]})`,
      "workforce.created");
    return project(engagement);
  },

  async takeShareForward(ctx, input: TakeShareForwardInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage", "documents:view");
    db();

    const pkg = sharePackageById(input.sharePackageId);
    // Scoped to a package addressed to THIS organization, and an unknown id and
    // somebody else's package answer identically — a carrier may not learn that
    // another carrier's share exists.
    if (!pkg || pkg.recipient.kind !== "organization"
      || pkg.recipient.organizationId !== ctx.organizationId) {
      throw new NotFoundError(`Share package ${input.sharePackageId}`);
    }

    // ★ THE ONLY BRIDGE FROM A SHARE TO A CANDIDATE ★
    // Sharing created nothing. Opening created nothing. Reviewing created
    // nothing. THIS, an explicit authorized command, is what makes somebody a
    // prospective candidate — and even it creates no membership, no carrier
    // relationship, no assignment and no permission.
    return this.create(ctx, {
      person: {
        displayName: pkg.driverName,
        driverProfileId: pkg.driverProfileId,
      },
      classification: input.classification,
      positionTitle: input.positionTitle,
      source: {
        kind: "document_share",
        id: pkg.id,
        label: `Documents ${pkg.driverName} shared with this organization`,
      },
    });
  },

  async onboardingChecklist(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view");
    return buildOnboardingChecklist(own(ctx, engagementId));
  },

  async startOnboarding(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (engagement.state === "onboarding") return project(engagement);
    return project(transition(ctx, engagement, "onboarding",
      `Onboarding started for ${engagement.person.displayName}`));
  },

  async waiveStep(ctx, engagementId, input: WaiveStepInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    // Scope check only: an engagement from another organization is refused here
    // before any waiver is written.
    own(ctx, engagementId);
    if (!input.reason.trim()) {
      throw new Error("A waiver needs a reason. A gap nobody can review is not a waiver.");
    }
    putWaiver(engagementId, input.stepKey, {
      authorizedByMembershipId: ctx.membershipId,
      authorizedByName: ctx.actor.displayNameSnapshot,
      at: nowIso(),
      reason: input.reason.trim(),
    });
    const next = amendEngagement(engagementId, {}, {
      kind: "onboarding_step_waived",
      summary: `Waived "${input.stepKey}"`,
      detail: input.reason.trim(),
      actor: ctx.actor,
    });
    audit(ctx, "workforce.onboarding_step_waived", next,
      `Onboarding step "${input.stepKey}" waived: ${input.reason.trim()}`,
      "workforce.step_waived");
    return buildOnboardingChecklist(next);
  },

  async activate(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (engagement.state === "active") return project(engagement);
    if (isSubject(ctx, engagement)) throw new WorkforceSelfActionError("start");

    // The lifecycle first, and deliberately before the checklist: a prospective
    // person cannot be started AT ALL, whatever the other modules say, and
    // refusing them with "three steps are outstanding" would send somebody off
    // to satisfy steps that were never the reason.
    assertTransition(engagement.state, "active");

    // Activation cannot claim that Safety, Contracts or the Document Center
    // agree. It ASKS them, on this read, and refuses when they do not.
    const checklist = buildOnboardingChecklist(engagement);
    if (!checklist.readyToActivate) throw new OnboardingIncompleteError(checklist.outstanding);

    /**
     * ███ THE START DATE IS NOT TOUCHED IF IT ALREADY EXISTS ███
     *
     * A carrier migrating onto Antcolos records that somebody has driven for
     * them since 2019, and then activates the engagement today. If activation
     * wrote today's date — or kept the date but relabelled its basis as
     * something Antcolos observed — the carrier's own assertion would silently
     * acquire an authority nobody gave it, and a twenty-year workforce would
     * read as though it were hired the week they signed up.
     *
     * So: an existing date and its provenance survive activation byte for byte.
     * Only an EMPTY date is filled, and only then is the basis `observed` —
     * which is true, because that is exactly what just happened here.
     */
    const observedStart = engagement.startDate === undefined;
    const startedAt = engagement.startDate ?? nowIso();
    return project(transition(ctx, engagement, "active",
      `${engagement.person.displayName} started as ${engagement.positionTitle}`,
      observedStart
        ? {
          startDate: startedAt,
          startDateProvenance: {
            value: startedAt,
            basis: "observed_by_antcolos",
            recordedAt: startedAt,
            recordedBy: ctx.actor,
            note: "Recorded when the engagement was activated in Antcolos.",
          },
        }
        : {}));
  },

  async suspend(ctx, engagementId, input: SuspendInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (engagement.state === "suspended") return project(engagement);
    if (isSubject(ctx, engagement)) throw new WorkforceSelfActionError("suspend");
    return project(transition(ctx, engagement, "suspended",
      `Suspended: ${input.reason}`, { suspensionReason: input.reason }));
  },

  async restore(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (engagement.state === "active") return project(engagement);
    if (isSubject(ctx, engagement)) throw new WorkforceSelfActionError("restore");
    // The suspension REASON is cleared from the live record; the history entry
    // that recorded it is not, and never can be.
    return project(transition(ctx, engagement, "active",
      `${engagement.person.displayName} restored from suspension`,
      { suspensionReason: undefined }, "restored", "workforce.restored"));
  },

  async reject(ctx, engagementId, reason) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    return project(transition(ctx, engagement, "rejected",
      `Not taken forward: ${reason}`, { rejectionReason: reason, endDate: nowIso() }));
  },

  async withdraw(ctx, engagementId, reason) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    return project(transition(ctx, engagement, "withdrawn",
      `Withdrew: ${reason}`, { rejectionReason: reason, endDate: nowIso() }));
  },

  async changeClassification(ctx, engagementId, input: ClassificationChangeInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (engagement.classification === input.classification) return project(engagement);
    const next = amendEngagement(engagementId, { classification: input.classification }, {
      kind: "classification_changed",
      summary: `Classification changed from ${WORKFORCE_CLASSIFICATION_LABEL[engagement.classification]} to ${WORKFORCE_CLASSIFICATION_LABEL[input.classification]}`,
      detail: input.reason,
      actor: ctx.actor,
    });
    // Worth saying where it is easy to miss: this changes which document and
    // compliance requirements the checklist asks for, and changes nobody's
    // permissions by one key.
    audit(ctx, "workforce.classification_changed", next,
      `Classification changed to ${WORKFORCE_CLASSIFICATION_LABEL[input.classification]}: ${input.reason}`,
      "workforce.classification_changed");
    return project(next);
  },

  async changeManager(ctx, engagementId, input: ManagerChangeInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    // Scope check only, as above.
    own(ctx, engagementId);
    const manager = input.managerMembershipId
      ? memberIn(ctx.organizationId, input.managerMembershipId)
      : undefined;
    if (input.managerMembershipId && !manager) {
      throw new NotFoundError(`Membership ${input.managerMembershipId}`);
    }
    const next = amendEngagement(engagementId, {
      managerMembershipId: manager?.membershipId,
      managerName: manager?.displayName,
    }, {
      kind: "manager_changed",
      summary: manager
        ? `Manager changed to ${manager.displayName}`
        : "Manager removed",
      // Said on the record, because it is the assumption people bring:
      // supervising somebody is not holding their work.
      detail: "A supervisor is not an assignment. Operational responsibility stays with the Responsibility Engine.",
      actor: ctx.actor,
    });
    audit(ctx, "workforce.manager_changed", next,
      manager ? `Manager changed to ${manager.displayName}` : "Manager removed",
      "workforce.manager_changed");
    return project(next);
  },

  async linkContract(ctx, engagementId, input: LinkContractInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage", "contracts:view");
    // Scope check only: an engagement from another organization is refused here
    // before anything is written.
    own(ctx, engagementId);
    const next = amendEngagement(engagementId, {
      contractId: input.contractId,
      contractVersionId: input.contractVersionId,
    }, {
      kind: "contract_linked",
      summary: `Governing agreement set to ${input.contractId}`,
      detail: "A reference only. Terms, signatures, compensation and effective dates stay on the contract version.",
      actor: ctx.actor,
    });
    audit(ctx, "workforce.contract_linked", next,
      `Linked contract changed to ${input.contractId}`, "workforce.contract_linked");
    return project(next);
  },

  /* ------------------------------------------------------------------------ */
  /* When it began                                                             */
  /* ------------------------------------------------------------------------ */

  async recordStartDate(ctx, engagementId, input: RecordStartDateInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);

    const at = nowIso();
    const previous = engagement.startDateProvenance;
    const next = amendEngagement(engagementId, {
      startDate: input.startDate,
      startDateProvenance: {
        value: input.startDate,
        basis: input.basis,
        recordedAt: at,
        recordedBy: ctx.actor,
        note: input.note,
        assertionRef: input.assertionRef,
      },
    }, {
      kind: "start_date_recorded",
      summary: `Start date recorded as ${input.startDate.slice(0, 10)} `
        + `(${WORKFORCE_START_BASIS_LABEL[input.basis].toLowerCase()})`,
      // The PREVIOUS value goes in the history line, because correcting a start
      // date is the change somebody will later need to see the shape of. The
      // record holds one date; the history holds every date it ever held.
      detail: previous
        ? `Previously ${previous.value.slice(0, 10)} `
          + `(${WORKFORCE_START_BASIS_LABEL[previous.basis].toLowerCase()}). ${input.note ?? ""}`.trim()
        : input.note,
      actor: ctx.actor,
    });
    audit(ctx, "workforce.start_date_recorded", next,
      `Start date recorded as ${input.startDate.slice(0, 10)}, `
      + `${WORKFORCE_START_BASIS_LABEL[input.basis].toLowerCase()}`,
      "workforce.start_date_recorded");
    return project(next);
  },

  /* ------------------------------------------------------------------------ */
  /* Functions — recorded, never granted                                       */
  /* ------------------------------------------------------------------------ */

  async assignFunction(ctx, engagementId, input: AssignFunctionInput) {
    await wait();
    // `workforce:manage` and nothing else. Deliberately NOT `members:manage`:
    // asking for it would be this module quietly agreeing that recording what
    // somebody does is the same kind of act as changing what they may do.
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);

    if (engagement.functions.some((f) => f.functionKey === input.functionKey)) {
      return project(engagement);
    }

    const label = RESPONSIBILITY_FUNCTION_LABEL[input.functionKey];
    const assignment: WorkforceFunctionAssignment = {
      functionKey: input.functionKey,
      assignedByMembershipId: ctx.membershipId,
      assignedByName: ctx.actor.displayNameSnapshot,
      assignedAt: nowIso(),
      note: input.note,
    };
    const next = amendEngagement(engagementId, {
      functions: [...engagement.functions, assignment],
    }, {
      kind: "function_assigned",
      summary: `${label} assigned to ${engagement.person.displayName}`,
      // Said on the record itself, because it is the assumption every reader
      // brings to an HR screen that lists "Dispatch" beside somebody's name.
      detail: "Recording what somebody does. It has granted no permission, created no membership "
        + "and changed no access. Where their seat cannot do this work, the engagement says so "
        + "and points at Access.",
      actor: ctx.actor,
    });
    audit(ctx, "workforce.function_assigned", next,
      `${label} assigned to ${engagement.person.displayName}. This granted no permission.`,
      "workforce.function_assigned");
    return project(next);
  },

  async removeFunction(ctx, engagementId, input: RemoveFunctionInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (!input.reason.trim()) {
      throw new Error("Removing a function needs a reason. Taking a responsibility off somebody is not a typo fix.");
    }
    if (!engagement.functions.some((f) => f.functionKey === input.functionKey)) {
      return project(engagement);
    }

    const label = RESPONSIBILITY_FUNCTION_LABEL[input.functionKey];
    const next = amendEngagement(engagementId, {
      functions: engagement.functions.filter((f) => f.functionKey !== input.functionKey),
    }, {
      kind: "function_removed",
      summary: `${label} removed from ${engagement.person.displayName}`,
      // Symmetrical to the line above, and worth saying for the same reason:
      // somebody who stops dispatching keeps every key they were ever granted
      // until Access takes them away.
      detail: `${input.reason.trim()} — this revoked no permission. If their access should narrow, `
        + "that is Access's to do.",
      actor: ctx.actor,
    });
    audit(ctx, "workforce.function_removed", next,
      `${label} removed from ${engagement.person.displayName}: ${input.reason.trim()}. `
      + "This revoked no permission.",
      "workforce.function_removed");
    return project(next);
  },

  /* ------------------------------------------------------------------------ */
  /* Leave                                                                     */
  /* ------------------------------------------------------------------------ */

  async recordLeave(ctx, engagementId, input: RecordLeaveInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);

    // Leave is a fact about somebody who works here. Recording it against a
    // candidate or somebody who has left would be recording a holiday for
    // somebody with no job, and the state it implies is already the answer.
    if (engagement.state !== "active") {
      throw new Error(
        `Leave can only be recorded for an active engagement. This one is `
        + `${WORKFORCE_STATE_LABEL[engagement.state].toLowerCase()}.`,
      );
    }
    if (input.expectedReturnDate && input.expectedReturnDate < input.startDate) {
      throw new Error("The expected return is before the leave starts.");
    }
    /*
     * ★ OVERLAP, NOT JUST "AWAY TODAY" ★
     * Checking only the CURRENT leave let two future leaves be recorded over
     * the same week — and on the Monday one of them started, the other was
     * still sitting there claiming a different reason for the same absence.
     * An interval that touches an existing open interval is refused whenever
     * either one of them starts.
     */
    const overlapping = engagement.leave.find((l) => {
      if (l.status === "ended" || l.status === "cancelled") return false;
      const existingEnd = l.actualReturnDate ?? l.expectedReturnDate;
      const newEnd = input.expectedReturnDate;
      // An absent end date means open-ended, which overlaps everything after it.
      const startsBeforeExistingEnds = existingEnd === undefined || input.startDate < existingEnd;
      const endsAfterExistingStarts = newEnd === undefined || newEnd > l.startDate;
      return startsBeforeExistingEnds && endsAfterExistingStarts;
    });
    if (overlapping) {
      throw new Error(
        "This person already has leave recorded over those dates "
        + `(from ${overlapping.startDate.slice(0, 10)}`
        + `${overlapping.expectedReturnDate ? ` to ${overlapping.expectedReturnDate.slice(0, 10)}` : ", open-ended"}). `
        + "End or cancel that one first, so the history says what actually happened rather than "
        + "two overlapping guesses.",
      );
    }

    const at = nowIso();
    const approver = input.approvedByMembershipId
      ? memberIn(ctx.organizationId, input.approvedByMembershipId)
      : undefined;
    if (input.approvedByMembershipId && !approver) {
      throw new NotFoundError(`Membership ${input.approvedByMembershipId}`);
    }

    /*
     * What the seat reads right now, kept so ending this leave can put it back.
     * `MembershipAvailability` is single-valued: going on leave DISPLACES an
     * `off_shift` or `unavailable` that somebody set for an unrelated reason,
     * and without this the leave ending would announce them available on a
     * decision nobody made.
     */
    const seatNow = engagement.membershipId
      ? memberIn(ctx.organizationId, engagement.membershipId)?.availability
      : undefined;

    const record: WorkforceLeaveRecord = {
      id: nextLeaveId(),
      reason: input.reason,
      status: input.startDate > at ? "planned" : "current",
      seatAvailabilityBefore: seatNow === "on_leave" ? undefined : seatNow,
      startDate: input.startDate,
      expectedReturnDate: input.expectedReturnDate,
      recordedByMembershipId: ctx.membershipId,
      recordedByName: ctx.actor.displayNameSnapshot,
      recordedAt: at,
      approvedByMembershipId: approver?.membershipId,
      approvedByName: approver?.displayName,
      note: input.note,
    };

    const label = WORKFORCE_LEAVE_REASON_LABEL[input.reason].toLowerCase();
    const next = amendEngagement(engagementId, {
      leave: [...engagement.leave, record],
      // ★ THE STATE DOES NOT MOVE ★
      // They are still active. Leave is a fact about an active engagement, not
      // a lifecycle state, and turning it into one would make "away until the
      // 14th" indistinguishable from "we have stood them down".
    }, {
      kind: "leave_recorded",
      summary: `${engagement.person.displayName} away (${label}) from ${input.startDate.slice(0, 10)}`
        + `${input.expectedReturnDate ? ` until ${input.expectedReturnDate.slice(0, 10)}` : ""}`,
      detail: approver
        ? `Approved by ${approver.displayName}. The engagement stays active.`
        : "The engagement stays active. Nobody is recorded as approving it.",
      actor: ctx.actor,
    });

    // ★ WORKFORCE HOLDS NO ROUTING FLAG ★
    // Availability lives on the membership profile, the responsibility engine's
    // candidate gate reads it through `takesWork`, and the way to change it is
    // the membership directory's own command — exactly as offboarding calls
    // `setMembershipStatus` rather than writing a second copy of a seat's state.
    //
    // `applyLeaveProjection` decides whether anything is written at all: a
    // holiday three weeks out changes nothing today, and when that Monday
    // arrives with nobody to apply it, `availabilityProjection` reports the
    // drift and Needs You raises it rather than the two quietly disagreeing.
    applyLeaveProjection(next, record.seatAvailabilityBefore);

    audit(ctx, "workforce.leave_recorded", next,
      `Leave recorded for ${engagement.person.displayName} (${label}) from `
      + `${input.startDate.slice(0, 10)}. The engagement stays active.`,
      "workforce.leave_recorded");
    return project(next);
  },

  async endLeave(ctx, engagementId, input: EndLeaveInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);

    const record = engagement.leave.find(
      (l) => l.id === input.leaveId && l.status !== "ended" && l.status !== "cancelled",
    );
    if (!record) throw new LeaveNotFoundError(input.leaveId);

    const at = nowIso();
    const returned = input.actualReturnDate ?? at;
    const next = amendEngagement(engagementId, {
      leave: engagement.leave.map((l) => (l.id === record.id
        ? {
          ...l,
          status: "ended" as const,
          // The ACTUAL return, never the expected one. A person who came back
          // four days late came back four days late, and a record that quietly
          // wrote the planned date would erase the only fact worth having.
          actualReturnDate: returned,
          endedByMembershipId: ctx.membershipId,
          endedByName: ctx.actor.displayNameSnapshot,
          endedAt: at,
          note: input.note ?? l.note,
        }
        : l)),
    }, {
      kind: "leave_ended",
      summary: `${engagement.person.displayName} returned on ${returned.slice(0, 10)}`,
      detail: record.expectedReturnDate && returned.slice(0, 10) !== record.expectedReturnDate.slice(0, 10)
        ? `Expected back on ${record.expectedReturnDate.slice(0, 10)}.`
        : undefined,
      actor: ctx.actor,
    });

    // ★ ELIGIBLE TO BE CONSIDERED. NOT DECLARED READY. NOT EVEN ALWAYS THAT. ★
    //
    // This used to write `available` unconditionally, which was wrong three
    // ways at once, and `applyLeaveProjection` is where each is refused:
    //
    //   • Somebody SUSPENDED or OFFBOARDED, whose old leave record somebody
    //     then closed, was handed straight back to the routing engine. Leave
    //     does not speak for an engagement that is not active.
    //   • Somebody who was `off_shift` before the leave started came back
    //     `available`, on a decision nobody made.
    //   • Somebody with a SECOND leave still covering today came back while
    //     still away.
    //
    // And where it does write, `available` still means only that the
    // responsibility engine may consider them: never that a load may be
    // assigned, a truck is roadworthy, or a driver is qualified and has hours.
    // Dispatch, Maintenance, Safety and the ELD own those four answers, none of
    // them reads this field, and returning from leave has told none of them
    // anything.
    applyLeaveProjection(next, record.seatAvailabilityBefore);

    audit(ctx, "workforce.leave_ended", next,
      `${engagement.person.displayName} returned from leave on ${returned.slice(0, 10)}. `
      + "They are eligible to be considered for work again; this declares no dispatch readiness.",
      "workforce.leave_ended");
    return project(next);
  },

  async cancelLeave(ctx, engagementId, input: CancelLeaveInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);
    if (!input.reason.trim()) throw new Error("Cancelling leave needs a reason.");

    const record = engagement.leave.find(
      (l) => l.id === input.leaveId && l.status !== "ended" && l.status !== "cancelled",
    );
    if (!record) throw new LeaveNotFoundError(input.leaveId);

    const wasCurrent = isLeaveCurrent(record, nowIso());
    const next = amendEngagement(engagementId, {
      leave: engagement.leave.map((l) => (l.id === record.id
        ? {
          ...l,
          status: "cancelled" as const,
          endedByMembershipId: ctx.membershipId,
          endedByName: ctx.actor.displayNameSnapshot,
          endedAt: nowIso(),
        }
        : l)),
    }, {
      kind: "leave_cancelled",
      summary: `Leave from ${record.startDate.slice(0, 10)} cancelled`,
      // Cancelled and ended are kept apart: one of them means the leave never
      // happened, and a reader a year later needs to be able to tell which.
      detail: `${input.reason.trim()} — cancelled, which is not the same as returned from.`,
      actor: ctx.actor,
    });

    // Same rules as ending it. A cancelled leave undoes only its own mark, only
    // back to what it displaced, and only on an engagement somebody still works
    // under — `wasCurrent` is kept for the history line, not as permission to
    // write, because whether anything should be written is the projection's
    // question and not this command's.
    void wasCurrent;
    applyLeaveProjection(next, record.seatAvailabilityBefore);

    audit(ctx, "workforce.leave_cancelled", next,
      `Leave from ${record.startDate.slice(0, 10)} cancelled: ${input.reason.trim()}`,
      "workforce.leave_cancelled");
    return project(next);
  },

  async reconcileAvailability(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    const engagement = own(ctx, engagementId);

    const member = engagement.membershipId
      ? memberIn(ctx.organizationId, engagement.membershipId)
      : undefined;
    const before = availabilityProjection(engagement, member?.availability, nowIso());

    // Already in step — and saying so costs nothing, while writing anyway
    // would put a meaningless line in the ledger every time somebody looked.
    if (before.inSync) return project(engagement);

    // The leave that displaced the seat, so restoring it restores the right
    // value rather than inventing `available`.
    const displaced = engagement.leave
      .slice()
      .reverse()
      .find((l) => l.seatAvailabilityBefore !== undefined)?.seatAvailabilityBefore;

    applyLeaveProjection(engagement, displaced);

    const after = availabilityProjection(
      engagement,
      engagement.membershipId
        ? memberIn(ctx.organizationId, engagement.membershipId)?.availability
        : undefined,
      nowIso(),
    );

    // Recorded on the engagement AND in the ledger, because a routing signal
    // changing underneath people is exactly the thing somebody asks about
    // later. The line says what it moved from and to, never just "reconciled".
    const next = amendEngagement(engagementId, {}, {
      kind: "note",
      summary: after.inSync
        ? `Work routing put back in step with the recorded leave (${before.actual ?? "no seat"} → ${after.actual ?? "no seat"})`
        : "Work routing could not be put back in step with the recorded leave",
      detail: after.inSync
        ? "Leave is the recorded fact; the seat's availability is the operational projection of it. "
          + "This changed only that projection and granted, revoked and decided nothing else."
        : after.summary,
      actor: ctx.actor,
    });

    audit(ctx, "workforce.availability_reconciled", next,
      after.inSync
        ? `Work routing for ${engagement.person.displayName} put back in step with the recorded leave. `
          + "This declares no dispatch readiness."
        : `Work routing for ${engagement.person.displayName} is still out of step: ${after.summary}`,
      "workforce.availability_reconciled");
    return project(next);
  },

  async requestAccessStep(ctx, engagementId, input: AccessStepRequestInput) {
    await wait();
    required(ctx, "workforce:view", "workforce:manage");
    // Scope check only, as above.
    own(ctx, engagementId);
    // ★ ASKS. DOES NOT DO. ★
    // Creating, suspending or ending a seat is the access system's, and it
    // requires `members:*` — which this module deliberately does not ask the
    // caller for, because holding it is not what makes somebody an HR
    // coordinator. This records the request; a person with that authority
    // performs it there, and the access system writes its own `access.*` line.
    const next = amendEngagement(engagementId, {}, {
      kind: "access_step_requested",
      summary: `Access step requested: ${input.kind.replace(/_/g, " ")}`,
      detail: `${input.note} — Antcolos has recorded the request only. The access system performs it, and its own audit line is what proves it happened.`,
      actor: ctx.actor,
    });
    audit(ctx, "workforce.access_step_requested", next,
      `Access step requested (${input.kind}): ${input.note}`, "workforce.access_requested");
    return project(next);
  },

  async offboardingPlan(ctx, engagementId) {
    await wait();
    required(ctx, "workforce:view", "workforce:end");
    return buildOffboardingPlan(ctx, own(ctx, engagementId));
  },

  async offboard(ctx, engagementId, input: EndEngagementInput): Promise<OffboardingResult> {
    await wait();
    required(ctx, "workforce:view", "workforce:end");
    const engagement = own(ctx, engagementId);
    if (isSubject(ctx, engagement)) throw new WorkforceSelfActionError("end");

    // Ends first, then the downstream steps. Deliberately that order: if a step
    // fails, the person is still ended and the failure is visible, rather than
    // the engagement staying open and the half-done work being invisible.
    const ended = transition(ctx, engagement, "ended",
      `Engagement ended: ${input.reason}`,
      { endReason: input.reason, endDate: input.endDate ?? nowIso() });

    const steps = runOffboardingSteps(ctx, ended, input.confirmedSteps, input.reason);
    const failed = steps.filter((s) => s.outcome === "failed");
    putIncompleteOffboarding(engagementId, failed);

    for (const s of steps) {
      amendEngagement(engagementId, {}, {
        kind: "offboarding_step_recorded",
        summary: `${s.label}: ${s.outcome}`,
        detail: s.reason ? `${s.detail} — ${s.reason}` : s.detail,
        actor: ctx.actor,
      });
    }
    audit(ctx, "workforce.offboarding_step_recorded", ended,
      failed.length === 0
        ? `Offboarding completed for ${ended.person.displayName}`
        : `Offboarding for ${ended.person.displayName} left ${failed.length} step${failed.length === 1 ? "" : "s"} unfinished`,
      "workforce.offboarding_recorded");

    return {
      engagement: engagementById(engagementId)!,
      steps,
      incomplete: failed.length > 0,
    };
  },
};

/** Exported for the seed, which builds history entries with a system actor. */
export const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

/**
 * Connects a person's permanent driver profile to an engagement this
 * organization already recorded.
 *
 * ★ A CONNECTION, NOT A HIRING ★
 * The ONLY field written is `driverProfileId`. The engagement's state, its
 * classification, its manager, its contract link and — most of all — its
 * `startDate` are untouched. A carrier that asserted Maria started in 2019 said
 * something about 2019; her getting an Antcolos account today says something
 * about today, and overwriting the first with the second is exactly the
 * mistake this module exists to make impossible.
 *
 * Idempotent: an engagement already carrying this profile is left alone and
 * reports success, so a retried acceptance adds no second history line.
 *
 * Called by the access module when an invitation names an engagement. It takes
 * the organization explicitly and checks it, because the caller is a person
 * accepting an invitation who has no membership here yet — the invitation is
 * the basis, and a scope check is still owed.
 */
export function linkDriverProfileToEngagement(
  engagementId: string,
  driverProfileId: string,
  organizationId: string,
): boolean {
  db();
  const engagement = engagementById(engagementId);
  if (!engagement || engagement.organizationId !== organizationId) return false;
  if (engagement.driverProfileId === driverProfileId) return true;

  amendEngagement(engagement.id, {
    driverProfileId,
    person: { ...engagement.person, driverProfileId },
  }, {
    kind: "driver_profile_linked",
    summary: `${engagement.person.displayName} connected their Antcolos driver profile`,
    detail:
      "They accepted an invitation and their permanent profile is now linked to this "
      + "engagement. The start date recorded here is unchanged.",
    actor: {
      userId: "system",
      membershipId: "system",
      displayNameSnapshot: "Antcolos",
      source: "system",
    },
  });
  return true;
}

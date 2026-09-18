import {
  WORKFORCE_CLASSIFICATION_LABEL, WORKFORCE_STATE_LABEL,
  type ActorRef, type AuditAction, type OffboardingResult,
  type OffboardingResultStep, type OnboardingChecklist, type PermissionKey,
  isRestrictedQualificationCategory,
  type WorkforceEngagement, type WorkforceEngagementState,
  type WorkforceEngagementView, type WorkforceEventKind, type WorkforceFilters,
  type WorkforceLink, type WorkforceSummary,
} from "@/types";
import { assertTransition } from "@/lib/workforce/lifecycle";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AccessStepRequestInput, ClassificationChangeInput, CreateEngagementInput,
  EndEngagementInput, LinkContractInput, ManagerChangeInput, SuspendInput,
  TakeShareForwardInput, WaiveStepInput, WorkforceService,
} from "../contracts/workforce";
import {
  amendEngagement, engagementById, engagementsForOrganization, ensureSeeded,
  incompleteOffboardingFor, liveEngagementFor, nextEngagementId, putEngagement,
  putIncompleteOffboarding, putWaiver,
} from "./workforce-store";
import { buildOnboardingChecklist } from "./workforce-onboarding";
import { buildOffboardingPlan, runOffboardingSteps } from "./workforce-offboarding";
import { seedWorkforce } from "./workforce-seed";
import { appendAuditEvent, recordCrossOrganizationAttempt } from "./audit";
import { memberIn } from "./membership-directory";
import { sharePackageById } from "./document-store";
import { recordsForDriver } from "./qualification-store";
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

function project(engagement: WorkforceEngagement): WorkforceEngagementView {
  const member = engagement.membershipId
    ? memberIn(engagement.organizationId, engagement.membershipId)
    : undefined;
  return {
    engagement,
    hasActiveMembership: member?.status === "active",
    links: linksFor(engagement),
    incompleteOffboarding: incompleteOffboardingFor(engagement.id),
  };
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
    } as WorkforceSummary["byClassification"];
    let onboardingOutstanding = 0;
    let offboardingIncomplete = 0;
    for (const e of all) {
      byState[e.state] += 1;
      byClassification[e.classification] += 1;
      if (e.state === "onboarding" && buildOnboardingChecklist(e).outstanding.length > 0) {
        onboardingOutstanding += 1;
      }
      if (incompleteOffboardingFor(e.id).length > 0) offboardingIncomplete += 1;
    }
    return {
      total: all.length, byState, byClassification,
      onboardingOutstanding, offboardingIncomplete,
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

    return project(transition(ctx, engagement, "active",
      `${engagement.person.displayName} started as ${engagement.positionTitle}`,
      { startDate: engagement.startDate ?? nowIso() }));
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

import type {
  ActorRef, PermissionKey, RiskCase, RiskCaseState, RiskCaseSummary,
  RiskCaseTimelineEntry, RiskSeverity, RiskSignal, RiskSignalFilters,
} from "@/types";
import {
  RISK_CASE_CLOSED_STATES, RISK_CASE_OPEN_STATES, RISK_SEVERITY_ORDER,
} from "@/types";
import { withCorrelation, newCorrelationId } from "@/lib/audit/correlation";
import {
  RISK_EXTENSION_POINTS, RISK_RULES, canTransition, defaultDueAt,
  evaluateRiskRules, isClosedState, latestDueAt, mayInvestigate,
  requiresIndependentReview, requiresRationale, SeparationOfDutiesError,
} from "@/lib/risk";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AddEvidenceInput, AddNoteInput, DismissSignalInput, OpenCaseInput,
  RecordDecisionInput, RiskService, TransitionInput,
} from "../contracts/risk";
import { appendAuditEvent, readableEvents } from "./audit";
import { mockRiskObservations } from "./audit-sources";
import { riskStore } from "./risk-store";
import { nowIso } from "./time";

/**
 * The mock risk adapter.
 *
 * Three things it is careful about, because they are the three things that make
 * the difference between an audit product and a liability:
 *
 *  1. It never writes an audit event directly. Every case action goes through
 *     `appendAuditEvent`, so working a case is itself auditable.
 *  2. It never touches an audit event. Dismissing a signal, closing a case and
 *     rejecting a finding all leave the ledger exactly as it was.
 *  3. Separation of duties is enforced HERE. A membership that is a subject of
 *     a case is refused investigation, assignment, decisions and closure on it,
 *     whatever permissions they hold — Owner included.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 140;
const wait = () =>
  LATENCY_MS ? new Promise<void>((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve();

function requirePermissions(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

const DASHBOARD_WINDOW_HOURS = 30 * 24;

/* -------------------------------------------------------------------------- */
/* Signals — derived on every read                                             */
/* -------------------------------------------------------------------------- */

async function deriveSignals(ctx: ServiceContext): Promise<RiskSignal[]> {
  const events = await readableEvents(ctx);
  const drafts = evaluateRiskRules({
    organizationId: ctx.organizationId,
    events,
    observations: mockRiskObservations(ctx),
  });

  return drafts.map((draft): RiskSignal => {
    const overlay = riskStore.overlay(ctx.organizationId, draft.id);
    return {
      id: draft.id,
      organizationId: ctx.organizationId,
      ruleId: draft.ruleId,
      kind: draft.kind,
      severity: draft.severity,
      title: draft.title,
      rationale: draft.rationale,
      detectedAt: draft.detectedAt,
      entity: draft.entity,
      relatedEntities: draft.relatedEntities,
      subjectActor: draft.subjectActor,
      auditEventIds: draft.auditEventIds,
      status: overlay?.status ?? "new",
      caseId: overlay?.caseId,
      dismissedAt: overlay?.dismissedAt,
      dismissedBy: overlay?.dismissedBy,
      dismissalReason: overlay?.dismissalReason,
      requires: draft.requires,
      mock: true,
    };
  });
}

function matchesSignal(
  ctx: ServiceContext,
  signal: RiskSignal,
  f: RiskSignalFilters,
): boolean {
  if (f.kind?.length && !f.kind.includes(signal.kind)) return false;
  if (f.severity?.length && !f.severity.includes(signal.severity)) return false;
  if (f.status?.length && !f.status.includes(signal.status)) return false;
  if (f.ruleId && signal.ruleId !== f.ruleId) return false;
  if (f.entityId) {
    const touches = signal.entity.id === f.entityId
      || (signal.relatedEntities ?? []).some((r) => r.id === f.entityId);
    if (!touches) return false;
  }
  if (f.subjectMembershipId && signal.subjectActor?.membershipId !== f.subjectMembershipId) {
    return false;
  }
  if (f.from && new Date(signal.detectedAt) < new Date(f.from)) return false;
  if (f.to && new Date(signal.detectedAt) > new Date(f.to)) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${signal.title} ${signal.rationale} ${signal.entity.label}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return signal.requires.every((k) => ctx.permissions.has(k));
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                       */
/* -------------------------------------------------------------------------- */

let timelineSeq = 0;
const timelineId = () => `rct_${(timelineSeq += 1).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function entry(
  actor: ActorRef,
  action: RiskCaseTimelineEntry["action"],
  rest: Partial<Omit<RiskCaseTimelineEntry, "id" | "at" | "actor" | "action">> = {},
): RiskCaseTimelineEntry {
  return { id: timelineId(), at: nowIso(), actor, action, ...rest };
}

/** Timelines are append-only. This is the only way a case's history changes. */
function withTimeline(
  riskCase: RiskCase,
  ...entries: RiskCaseTimelineEntry[]
): RiskCase {
  return { ...riskCase, timeline: [...riskCase.timeline, ...entries] };
}

function severityOf(signals: readonly RiskSignal[]): RiskSeverity {
  if (!signals.length) return "informational";
  return signals.reduce<RiskSeverity>(
    (worst, s) => (RISK_SEVERITY_ORDER[s.severity] < RISK_SEVERITY_ORDER[worst] ? s.severity : worst),
    "informational",
  );
}

function summarize(riskCase: RiskCase): RiskCaseSummary {
  return {
    id: riskCase.id,
    organizationId: riskCase.organizationId,
    reference: riskCase.reference,
    title: riskCase.title,
    severity: riskCase.severity,
    state: riskCase.state,
    signalCount: riskCase.signalIds.length,
    assigneeMembershipId: riskCase.assigneeMembershipId,
    assigneeName: riskCase.assigneeName,
    dueAt: riskCase.dueAt,
    openedAt: riskCase.openedAt,
    closedAt: riskCase.closedAt,
    independentReviewRequired: riskCase.independentReviewRequired,
  };
}

function findCase(ctx: ServiceContext, caseId: string): RiskCase {
  const riskCase = riskStore.findCase(ctx.organizationId, caseId);
  // Another organization's case is NOT FOUND, never forbidden: the store is
  // partitioned, so there is nothing here to confirm the existence of.
  if (!riskCase) throw new NotFoundError("Risk case");
  return riskCase;
}

/** The gate every investigative write goes through. */
function assertMayWork(ctx: ServiceContext, riskCase: RiskCase) {
  const verdict = mayInvestigate(ctx.membershipId, riskCase);
  if (!verdict.allowed) throw new SeparationOfDutiesError(verdict.reason);
}

function caseUrgency(riskCase: RiskCaseSummary): number {
  const NO_DEADLINE = Date.UTC(2100, 0, 1);
  const due = riskCase.dueAt ? new Date(riskCase.dueAt).getTime() : NO_DEADLINE;
  const closed = RISK_CASE_CLOSED_STATES.includes(riskCase.state) ? 1 : 0;
  return closed * 1e15 + RISK_SEVERITY_ORDER[riskCase.severity] * 1e13 + due / 1e3;
}

/**
 * The memberships Antcolos has SEEN act in this organization.
 *
 * There is no member registry on this branch, so the honest answer is "the
 * people who appear in the ledger", plus the caller. A real backend would list
 * memberships; the shape of the answer does not change when it does.
 */
async function knownMemberships(
  ctx: ServiceContext,
): Promise<{ membershipId: string; name: string }[]> {
  const events = await readableEvents(ctx);
  const seen = new Map<string, string>();
  seen.set(ctx.membershipId, ctx.actor.displayNameSnapshot);
  for (const e of events) {
    if (e.actor.source === "system") continue;
    if (!seen.has(e.membershipId)) seen.set(e.membershipId, e.actor.displayNameSnapshot);
  }

  // Two memberships can legitimately carry the same display name — the same
  // person in two seats, or two people who share a name. Offering "Sam Murtaza"
  // twice with no way to tell them apart is how a case gets handed to the wrong
  // membership, so the id is shown when, and only when, the name repeats.
  const nameCounts = new Map<string, number>();
  for (const name of seen.values()) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  return [...seen].map(([membershipId, name]) => ({
    membershipId,
    name: (nameCounts.get(name) ?? 0) > 1 ? `${name} (${membershipId})` : name,
  }));
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockRiskService: RiskService = {
  async dashboard(ctx) {
    await wait();
    requirePermissions(ctx, "risk:view");
    const windowStart = Date.now() - DASHBOARD_WINDOW_HOURS * 3_600_000;
    const events = (await readableEvents(ctx)).filter(
      (e) => new Date(e.occurredAt).getTime() >= windowStart,
    );
    const signals = (await deriveSignals(ctx)).filter((s) =>
      s.requires.every((k) => ctx.permissions.has(k)),
    );
    const cases = riskStore.cases(ctx.organizationId);
    const now = Date.now();

    const signalsBySeverity: Record<RiskSeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, informational: 0,
    };
    for (const s of signals) {
      if (s.status === "dismissed") continue;
      signalsBySeverity[s.severity] += 1;
    }

    const casesByState: Record<RiskCaseState, number> = {
      open: 0, investigating: 0, action_required: 0, resolved: 0,
      accepted_risk: 0, dismissed: 0, escalated: 0,
    };
    for (const c of cases) casesByState[c.state] += 1;

    return {
      organizationId: ctx.organizationId,
      generatedAt: nowIso(),
      auditEventCount: events.length,
      windowHours: DASHBOARD_WINDOW_HOURS,
      signalsBySeverity,
      openSignalCount: signals.filter((s) => s.status !== "dismissed").length,
      casesByState,
      openCaseCount: cases.filter((c) => RISK_CASE_OPEN_STATES.includes(c.state)).length,
      overdueCaseCount: cases.filter(
        (c) => RISK_CASE_OPEN_STATES.includes(c.state) && c.dueAt && new Date(c.dueAt).getTime() < now,
      ).length,
      myAttentionCount: cases.filter(
        (c) => c.assigneeMembershipId === ctx.membershipId
          && RISK_CASE_OPEN_STATES.includes(c.state)
          && (c.severity === "critical" || c.severity === "high"),
      ).length,
      deniedActionCount: events.filter((e) => e.outcome !== "succeeded").length,
      rulesAreMock: true,
    };
  },

  async rules(ctx) {
    await wait();
    requirePermissions(ctx, "risk:view");
    return RISK_RULES;
  },

  async signals(ctx, filters = {}) {
    await wait();
    requirePermissions(ctx, "risk:view");
    return (await deriveSignals(ctx))
      .filter((s) => matchesSignal(ctx, s, filters))
      .sort((a, b) => {
        const bySeverity = RISK_SEVERITY_ORDER[a.severity] - RISK_SEVERITY_ORDER[b.severity];
        if (bySeverity !== 0) return bySeverity;
        return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
      });
  },

  async signal(ctx, signalId) {
    await wait();
    requirePermissions(ctx, "risk:view");
    const signal = (await deriveSignals(ctx)).find((s) => s.id === signalId);
    if (!signal || !signal.requires.every((k) => ctx.permissions.has(k))) {
      throw new NotFoundError("Risk signal");
    }
    return signal;
  },

  async dismissSignal(ctx, signalId, input: DismissSignalInput) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    const reason = input.reason?.trim();
    if (!reason) throw new Error("Say why this is not a concern. A dismissal with no reason cannot be reviewed.");

    const signal = await this.signal(ctx, signalId);
    // A person cannot wave away a signal about their own actions.
    if (signal.subjectActor?.membershipId === ctx.membershipId) {
      throw new SeparationOfDutiesError(
        "This signal is about your own actions. Somebody else has to decide whether it matters.",
      );
    }

    riskStore.setOverlay(ctx.organizationId, signalId, {
      status: "dismissed",
      caseId: signal.caseId,
      dismissedAt: nowIso(),
      dismissedBy: ctx.actor,
      dismissalReason: reason,
    });

    // The signal is dismissed. The audit events behind it are untouched — and
    // the dismissal itself becomes part of the record.
    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.signal_dismissed",
      entity: { kind: "risk_signal", id: signalId, label: signal.title },
      relatedEntities: [signal.entity],
      summary: `Dismissed a ${signal.severity} signal: ${reason}`,
    });

    return { ...signal, status: "dismissed", dismissedAt: nowIso(), dismissedBy: ctx.actor, dismissalReason: reason };
  },

  async cases(ctx, filters = {}) {
    await wait();
    requirePermissions(ctx, "risk:view");
    const now = Date.now();
    return riskStore
      .cases(ctx.organizationId)
      .map(summarize)
      .filter((c) => {
        if (filters.state?.length && !filters.state.includes(c.state)) return false;
        if (filters.severity?.length && !filters.severity.includes(c.severity)) return false;
        if (filters.owner === "me" && c.assigneeMembershipId !== ctx.membershipId) return false;
        if (filters.owner === "unassigned" && c.assigneeMembershipId) return false;
        if (filters.overdue) {
          if (!c.dueAt || new Date(c.dueAt).getTime() >= now) return false;
          if (!RISK_CASE_OPEN_STATES.includes(c.state)) return false;
        }
        if (filters.dueWithinHours != null) {
          if (!c.dueAt) return false;
          if (new Date(c.dueAt).getTime() > now + filters.dueWithinHours * 3_600_000) return false;
        }
        if (filters.entityId) {
          const full = riskStore.findCase(ctx.organizationId, c.id)!;
          const touches = full.evidence.some((e) => e.ref.id === filters.entityId);
          if (!touches) return false;
        }
        if (filters.search) {
          const q = filters.search.toLowerCase();
          if (!`${c.reference} ${c.title}`.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => caseUrgency(a) - caseUrgency(b));
  },

  async case(ctx, caseId) {
    await wait();
    requirePermissions(ctx, "risk:view");
    return findCase(ctx, caseId);
  },

  async openCase(ctx, input: OpenCaseInput) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    if (!input.signalIds.length) {
      throw new Error("A case needs at least one signal. Without one there is nothing to investigate.");
    }

    const signals = await deriveSignals(ctx);
    const linked = signals.filter((s) => input.signalIds.includes(s.id));
    if (linked.length !== input.signalIds.length) throw new NotFoundError("Risk signal");

    const severity = severityOf(linked);
    const subjects = [
      ...new Set(
        linked
          .map((s) => s.subjectActor?.membershipId)
          .filter((id): id is string => Boolean(id) && id !== "system"),
      ),
    ];
    const independentReviewRequired = requiresIndependentReview(severity);

    // Opening a case about yourself is allowed — refusing it would mean a
    // person could avoid one by being the only witness. Working it is not.
    const id = `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const correlationId = newCorrelationId();
    const reference = riskStore.nextReference(ctx.organizationId);
    const openedAt = nowIso();

    const assignable = input.assigneeMembershipId
      && !(independentReviewRequired && subjects.includes(input.assigneeMembershipId));

    let riskCase: RiskCase = {
      id,
      organizationId: ctx.organizationId,
      reference,
      title: input.title.trim() || linked[0].title,
      summary: input.summary.trim(),
      severity,
      state: "open",
      signalIds: [...input.signalIds],
      assigneeMembershipId: assignable ? input.assigneeMembershipId : undefined,
      assigneeName: undefined,
      dueAt: input.dueAt ?? defaultDueAt(severity),
      notes: [],
      evidence: linked.flatMap((s) =>
        s.auditEventIds.slice(0, 5).map((eventId) => ({
          id: `rce_${eventId}`,
          at: openedAt,
          addedBy: ctx.actor,
          kind: "audit_event" as const,
          ref: { kind: "audit_event" as const, id: eventId, label: s.title },
          description: `Audit event behind ${s.title}`,
        })),
      ),
      decisions: [],
      timeline: [],
      openedAt,
      openedBy: ctx.actor,
      subjectMembershipIds: subjects,
      independentReviewRequired,
      correlationIds: [correlationId],
      mock: true,
    };

    riskCase = withTimeline(
      riskCase,
      entry(ctx.actor, "opened", { note: riskCase.summary }),
      ...linked.map((s) => entry(ctx.actor, "signal_linked", { relatedId: s.id, note: s.title })),
    );

    if (riskCase.assigneeMembershipId) {
      riskCase = withTimeline(
        riskCase,
        entry(ctx.actor, "assigned", { relatedId: riskCase.assigneeMembershipId }),
      );
    }

    riskStore.putCase(riskCase);
    for (const s of linked) {
      riskStore.setOverlay(ctx.organizationId, s.id, { status: "linked", caseId: id });
    }

    withCorrelation(correlationId, () => {
      appendAuditEvent(ctx, {
        module: "risk",
        action: "risk.case_opened",
        entity: { kind: "risk_case", id, label: `${reference} — ${riskCase.title}`, href: `/audit/cases/${id}` },
        relatedEntities: linked.map((s) => ({
          kind: "risk_signal" as const, id: s.id, label: s.title,
        })),
        summary: `Opened ${reference}: ${riskCase.title}`,
        correlationId,
        changes: [
          { field: "severity", after: severity },
          { field: "signalCount", after: linked.length },
          { field: "independentReviewRequired", after: independentReviewRequired },
        ],
      });
    });

    return riskCase;
  },

  async linkSignal(ctx, caseId, signalId) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    const existing = findCase(ctx, caseId);
    assertMayWork(ctx, existing);
    if (existing.signalIds.includes(signalId)) return existing;

    const signal = await this.signal(ctx, signalId);
    const signals = (await deriveSignals(ctx)).filter(
      (s) => [...existing.signalIds, signalId].includes(s.id),
    );
    const severity = severityOf(signals);
    const subjects = [
      ...new Set([
        ...existing.subjectMembershipIds,
        ...(signal.subjectActor && signal.subjectActor.membershipId !== "system"
          ? [signal.subjectActor.membershipId]
          : []),
      ]),
    ];

    const next = withTimeline(
      {
        ...existing,
        signalIds: [...existing.signalIds, signalId],
        severity,
        subjectMembershipIds: subjects,
        independentReviewRequired:
          existing.independentReviewRequired || requiresIndependentReview(severity),
      },
      entry(ctx.actor, "signal_linked", { relatedId: signalId, note: signal.title }),
    );
    riskStore.putCase(next);
    riskStore.setOverlay(ctx.organizationId, signalId, { status: "linked", caseId });

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_state_changed",
      sourceAction: "signal_linked",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      relatedEntities: [{ kind: "risk_signal", id: signalId, label: signal.title }],
      summary: `Linked a ${signal.severity} signal to ${next.reference}`,
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async assign(ctx, caseId, membershipId) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:assign");
    const existing = findCase(ctx, caseId);

    if (membershipId) {
      // Checked here as well as filtered in `eligibleAssignees`, because the
      // screen's list is a convenience and this is the rule.
      const verdict = mayInvestigate(membershipId, existing);
      if (!verdict.allowed) {
        throw new SeparationOfDutiesError(
          "That person's own actions are what this case is about. Somebody else has to look at it.",
        );
      }
    }

    const people = await knownMemberships(ctx);
    const name = membershipId
      ? people.find((p) => p.membershipId === membershipId)?.name
      : undefined;

    const next = withTimeline(
      {
        ...existing,
        assigneeMembershipId: membershipId ?? undefined,
        assigneeName: membershipId ? name : undefined,
      },
      entry(ctx.actor, membershipId ? "assigned" : "unassigned", {
        relatedId: membershipId ?? undefined,
        note: membershipId ? `Assigned to ${name ?? membershipId}` : "Responsibility cleared",
      }),
    );
    riskStore.putCase(next);

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_assigned",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      summary: membershipId
        ? `Assigned ${next.reference} to ${name ?? membershipId}`
        : `Cleared responsibility on ${next.reference}`,
      changes: [{
        field: "assigneeMembershipId",
        before: existing.assigneeMembershipId ?? null,
        after: membershipId ?? null,
      }],
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async setDueDate(ctx, caseId, dueAt) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    const existing = findCase(ctx, caseId);
    assertMayWork(ctx, existing);

    // Policy caps how long a case of this severity may sit. A critical case
    // somebody gave a fortnight to is a critical case nobody is working.
    const cap = latestDueAt(existing.severity);
    const clamped = dueAt && new Date(dueAt).getTime() > new Date(cap).getTime() ? cap : dueAt;

    const next = withTimeline(
      { ...existing, dueAt: clamped ?? undefined },
      entry(ctx.actor, clamped ? "due_date_set" : "due_date_cleared", {
        note: clamped ? `Due ${clamped}` : undefined,
      }),
    );
    riskStore.putCase(next);

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_state_changed",
      sourceAction: "due_date",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      summary: clamped ? `Set a due date on ${next.reference}` : `Cleared the due date on ${next.reference}`,
      changes: [{ field: "dueAt", before: existing.dueAt ?? null, after: clamped ?? null }],
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async addNote(ctx, caseId, input: AddNoteInput) {
    await wait();
    // Deliberately NOT gated on risk:investigate. A person who is the subject
    // of a case can explain themselves; that is not investigating it.
    requirePermissions(ctx, "risk:view");
    const existing = findCase(ctx, caseId);
    const body = input.body?.trim();
    if (!body) throw new Error("A note needs something in it.");

    const note = { id: `rcn_${timelineId()}`, at: nowIso(), actor: ctx.actor, body };
    const next = withTimeline(
      { ...existing, notes: [...existing.notes, note] },
      entry(ctx.actor, "note_added", { note: body, relatedId: note.id }),
    );
    riskStore.putCase(next);

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_note_added",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      summary: `Added a note to ${next.reference}`,
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async addEvidence(ctx, caseId, input: AddEvidenceInput) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    const existing = findCase(ctx, caseId);
    assertMayWork(ctx, existing);
    const description = input.description?.trim();
    if (!description) throw new Error("Say what this evidence shows.");

    const evidence = {
      id: `rce_${timelineId()}`,
      at: nowIso(),
      addedBy: ctx.actor,
      kind: input.kind,
      // A pointer, never a copy: the module that owns the record stays the
      // authority on what it says.
      ref: { kind: input.refKind, id: input.refId, label: input.refLabel },
      description,
    };
    const next = withTimeline(
      { ...existing, evidence: [...existing.evidence, evidence] },
      entry(ctx.actor, "evidence_added", { relatedId: evidence.id, note: description }),
    );
    riskStore.putCase(next);

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_evidence_added",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      relatedEntities: [evidence.ref],
      summary: `Attached evidence to ${next.reference}: ${description}`,
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async recordDecision(ctx, caseId, input: RecordDecisionInput) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    const existing = findCase(ctx, caseId);
    assertMayWork(ctx, existing);

    const rationale = input.rationale?.trim();
    if (!rationale) throw new Error("A decision needs a rationale. It is the part an auditor reads first.");

    if (input.resultingState && isClosedState(input.resultingState)) {
      requirePermissions(ctx, "risk:resolve");
    }
    if (input.resultingState && !canTransition(existing.state, input.resultingState)) {
      throw new Error(
        `A case cannot move from ${existing.state} to ${input.resultingState}.`,
      );
    }

    const decision = {
      id: `rcd_${timelineId()}`,
      at: nowIso(),
      actor: ctx.actor,
      kind: input.kind,
      rationale,
      resultingState: input.resultingState,
    };

    let next: RiskCase = {
      ...existing,
      decisions: [...existing.decisions, decision],
    };
    next = withTimeline(
      next,
      entry(ctx.actor, "decision_recorded", { relatedId: decision.id, note: rationale }),
    );

    if (input.resultingState) {
      next = applyState(next, ctx.actor, input.resultingState, rationale);
    }
    riskStore.putCase(next);

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_decision_recorded",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      summary: `Recorded a decision on ${next.reference}: ${rationale}`,
      changes: [
        { field: "decision", after: input.kind },
        { field: "state", before: existing.state, after: next.state },
      ],
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async transition(ctx, caseId, input: TransitionInput) {
    await wait();
    requirePermissions(ctx, "risk:view", "risk:investigate");
    const existing = findCase(ctx, caseId);
    assertMayWork(ctx, existing);

    if (!canTransition(existing.state, input.to)) {
      throw new Error(`A case cannot move from ${existing.state} to ${input.to}.`);
    }
    const rationale = input.rationale?.trim();
    if (requiresRationale(input.to) && !rationale) {
      throw new Error(
        "Closing or escalating a case needs a reason. That reason is the record of why it ended.",
      );
    }
    if (isClosedState(input.to)) requirePermissions(ctx, "risk:resolve");

    const next = applyState(existing, ctx.actor, input.to, rationale);
    riskStore.putCase(next);

    appendAuditEvent(ctx, {
      module: "risk",
      action: "risk.case_state_changed",
      entity: { kind: "risk_case", id: caseId, label: `${next.reference} — ${next.title}`, href: `/audit/cases/${caseId}` },
      summary: `${next.reference} moved to ${input.to}${rationale ? `: ${rationale}` : ""}`,
      changes: [{ field: "state", before: existing.state, after: input.to }],
      correlationId: next.correlationIds[0],
    });

    return next;
  },

  async eligibleAssignees(ctx, caseId) {
    await wait();
    requirePermissions(ctx, "risk:view");
    const riskCase = findCase(ctx, caseId);
    const people = await knownMemberships(ctx);
    return people.filter((p) => mayInvestigate(p.membershipId, riskCase).allowed);
  },

  async extensionPoints(ctx) {
    await wait();
    requirePermissions(ctx, "risk:view");
    return RISK_EXTENSION_POINTS;
  },
};

/**
 * Moves a case, appending rather than rewriting.
 *
 * Reopening a closed case clears the closure fields on the NEW version and
 * leaves every previous entry, note, decision and timeline line exactly where
 * it was — which is the only way a reopened case can still answer "what did you
 * decide the first time?".
 */
function applyState(
  riskCase: RiskCase,
  actor: ActorRef,
  to: RiskCaseState,
  rationale?: string,
): RiskCase {
  const closing = isClosedState(to);
  const reopening = isClosedState(riskCase.state) && !closing;

  return withTimeline(
    {
      ...riskCase,
      state: to,
      closedAt: closing ? nowIso() : undefined,
      resolutionNote: closing ? rationale : undefined,
    },
    entry(actor, reopening ? "reopened" : "state_changed", {
      fromState: riskCase.state,
      toState: to,
      note: rationale,
    }),
  );
}

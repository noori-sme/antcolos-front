"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { RISK_CASE_STATE_DESCRIPTION, RISK_TIMELINE_ACTION_LABEL } from "@/config/audit";
import { canTransition } from "@/lib/risk/case-states";
import { mayInvestigate } from "@/lib/risk/separation-of-duties";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  RISK_CASE_STATE_LABEL, RISK_DECISION_LABEL, type RiskCase, type RiskCaseState,
  type RiskDecisionKind,
} from "@/types";
import { AppendOnlyMark, CaseStateBadge, SeverityBadge } from "./chips";
import { dueLabel, formatDateTime, isOverdue } from "./format";
import { useCaseAction, useEligibleAssignees, useRiskCase } from "./use-audit";

const CLOSING_STATES: RiskCaseState[] = ["resolved", "accepted_risk", "dismissed"];
const WORKING_STATES: RiskCaseState[] = ["investigating", "action_required", "escalated"];
const DECISIONS: RiskDecisionKind[] = [
  "no_action", "corrective_action", "policy_change", "access_change",
  "accepted_risk", "escalated",
];

/**
 * One investigation.
 *
 * Everything on this screen appends. Nothing edits: a note, an evidence
 * reference, a decision and a state change each add a timeline entry, and the
 * entries already there are never rewritten — including when a closed case is
 * reopened.
 */
export function RiskCaseScreen({ caseId }: { caseId: string }) {
  const query = useRiskCase(caseId);
  const ctx = useServiceContext();
  const { organization } = useActiveMembership();
  const timeZone = organization?.timeZone ?? "UTC";

  if (query.isLoading) return <LoadingSkeleton rows={6} />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="No such case here"
        description="It does not exist, or it belongs to another organization."
      />
    );
  }

  const riskCase = query.data;
  const verdict = ctx ? mayInvestigate(ctx.membershipId, riskCase) : { allowed: false as const, reason: "" };
  const conflicted = !verdict.allowed;

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/audit/cases"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All risk cases
        </Link>
      </div>

      <PageHeader title={riskCase.title} description={riskCase.summary || undefined} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="tnum text-[0.75rem] font-semibold text-fg-subtle">
          {riskCase.reference}
        </span>
        <SeverityBadge severity={riskCase.severity} />
        <CaseStateBadge state={riskCase.state} />
        <Badge tone="outline">Mock signals</Badge>
      </div>
      <p className="text-[0.8125rem] text-fg-muted">
        {RISK_CASE_STATE_DESCRIPTION[riskCase.state]}
      </p>

      {conflicted ? (
        <section className="flex gap-3 rounded-lg border border-st-warning/40 bg-st-warning-bg/40 p-4">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
          <div className="min-w-0">
            <p className="text-[0.875rem] font-semibold text-fg">
              You cannot work this case
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
              {verdict.reason} This is enforced at the service, not by hiding buttons — and it
              applies to Owners too.
            </p>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <CaseTimeline riskCase={riskCase} timeZone={timeZone} />
          <CaseNotes riskCase={riskCase} timeZone={timeZone} />
          <CaseDecisions riskCase={riskCase} timeZone={timeZone} />
          <CaseEvidence riskCase={riskCase} timeZone={timeZone} />
        </div>
        <div className="space-y-4">
          <CaseFacts riskCase={riskCase} timeZone={timeZone} />
          <CaseActions riskCase={riskCase} conflicted={conflicted} />
        </div>
      </div>
    </div>
  );
}

function Panel({
  id, title, children, note,
}: {
  id: string;
  title: React.ReactNode;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={id} className="flex flex-wrap items-center gap-2 text-[0.875rem] font-semibold text-fg">
        {title}
      </h2>
      {note ? <p className="mt-1 text-[0.8125rem] text-fg-muted">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CaseFacts({ riskCase, timeZone }: { riskCase: RiskCase; timeZone: string }) {
  const overdue = isOverdue(riskCase.dueAt) && !CLOSING_STATES.includes(riskCase.state);
  return (
    <Panel id="case-facts" title="At a glance">
      <dl className="space-y-3">
        <div>
          <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
            Responsible
          </dt>
          <dd className="mt-0.5 text-[0.8125rem] text-fg">
            {riskCase.assigneeName ?? riskCase.assigneeMembershipId ?? "Nobody is on it"}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
            Due
          </dt>
          <dd className={overdue ? "mt-0.5 text-[0.8125rem] font-medium text-st-warning" : "mt-0.5 text-[0.8125rem] text-fg"}>
            {dueLabel(riskCase.dueAt)}
            {riskCase.dueAt ? (
              <span className="block text-[0.75rem] text-fg-subtle">
                {formatDateTime(riskCase.dueAt, timeZone)}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
            Opened
          </dt>
          <dd className="mt-0.5 text-[0.8125rem] text-fg">
            {formatDateTime(riskCase.openedAt, timeZone)}
            <span className="block text-[0.75rem] text-fg-subtle">
              by {riskCase.openedBy.displayNameSnapshot}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
            Independent review
          </dt>
          <dd className="mt-0.5 text-[0.8125rem] text-fg">
            {riskCase.independentReviewRequired
              ? "Required. Nobody whose actions this case is about may investigate, decide or close it."
              : "Not required at this severity."}
          </dd>
        </div>
        {riskCase.subjectMembershipIds.length ? (
          <div>
            <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
              Whose actions this is about
            </dt>
            <dd className="mt-0.5 text-[0.8125rem] text-fg">
              {riskCase.subjectMembershipIds.join(", ")}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
            Signals
          </dt>
          <dd className="mt-0.5 text-[0.8125rem] text-fg">
            <Link href="/audit/signals" className="text-primary hover:underline">
              {riskCase.signalIds.length} linked
            </Link>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function CaseTimeline({ riskCase, timeZone }: { riskCase: RiskCase; timeZone: string }) {
  const entries = [...riskCase.timeline].reverse();
  return (
    <Panel
      id="case-timeline"
      title={<>Timeline <AppendOnlyMark /></>}
      note="Nothing here is ever edited or removed. Reopening a closed case adds an entry; it does not undo the ones before it."
    >
      <ol className="space-y-0">
        {entries.map((entry, index) => (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            <span aria-hidden className="flex flex-col items-center">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong" />
              {index === entries.length - 1 ? null : (
                <span className="w-px flex-1 bg-border" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.8125rem] font-medium text-fg">
                  {RISK_TIMELINE_ACTION_LABEL[entry.action]}
                </p>
                {entry.toState && entry.toState !== entry.fromState ? (
                  <CaseStateBadge state={entry.toState} />
                ) : null}
              </div>
              {entry.note ? (
                <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                  {entry.note}
                </p>
              ) : null}
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                {entry.actor.displayNameSnapshot} · {formatDateTime(entry.at, timeZone)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function CaseNotes({ riskCase, timeZone }: { riskCase: RiskCase; timeZone: string }) {
  const action = useCaseAction();
  const canView = useCan("risk:view");
  const [body, setBody] = useState("");

  return (
    <Panel
      id="case-notes"
      title="Notes"
      note="Anybody who can see the case can add one — including somebody whose own actions it is about, so they can explain themselves."
    >
      {riskCase.notes.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {riskCase.notes.map((note) => (
            <li key={note.id} className="rounded-md border border-border bg-surface-sunken p-3">
              <p className="text-[0.8125rem] leading-relaxed text-fg">{note.body}</p>
              <p className="mt-1 text-[0.75rem] text-fg-subtle">
                {note.actor.displayNameSnapshot} · {formatDateTime(note.at, timeZone)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canView ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="case-note" className="sr-only">Add a note</label>
          <Textarea
            id="case-note"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="What you found, or what you want on the record."
          />
          <Button
            size="sm"
            disabled={!body.trim() || action.isPending}
            onClick={() =>
              action.mutate(
                { caseId: riskCase.id, action: { kind: "note", input: { body } } },
                { onSuccess: () => setBody("") },
              )
            }
          >
            Add note
          </Button>
          {action.isError ? (
            <p className="text-[0.8125rem] text-st-danger">{(action.error as Error).message}</p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function CaseDecisions({ riskCase, timeZone }: { riskCase: RiskCase; timeZone: string }) {
  return (
    <Panel
      id="case-decisions"
      title="Decisions"
      note="Kept apart from the timeline because 'what was decided, and by whom' is the first thing asked about a closed case."
    >
      {riskCase.decisions.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">Nothing has been decided yet.</p>
      ) : (
        <ul className="space-y-2">
          {riskCase.decisions.map((decision) => (
            <li key={decision.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="outline">{RISK_DECISION_LABEL[decision.kind]}</Badge>
                {decision.resultingState ? (
                  <CaseStateBadge state={decision.resultingState} />
                ) : null}
              </div>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg">
                {decision.rationale}
              </p>
              <p className="mt-1 text-[0.75rem] text-fg-subtle">
                {decision.actor.displayNameSnapshot} · {formatDateTime(decision.at, timeZone)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CaseEvidence({ riskCase, timeZone }: { riskCase: RiskCase; timeZone: string }) {
  return (
    <Panel
      id="case-evidence"
      title="Evidence"
      note="References, never copies. The module that owns each record stays the authority on what it says."
    >
      {riskCase.evidence.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">Nothing attached.</p>
      ) : (
        <ul className="space-y-2">
          {riskCase.evidence.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-3">
              <p className="text-[0.8125rem] text-fg">{item.description}</p>
              <p className="mt-1 text-[0.75rem] text-fg-subtle">
                {item.ref.kind === "audit_event" ? (
                  <Link
                    href={`/audit/events/${item.ref.id}`}
                    className="text-primary hover:underline"
                  >
                    {item.ref.label}
                  </Link>
                ) : (
                  item.ref.label
                )}{" "}
                · added by {item.addedBy.displayNameSnapshot} ·{" "}
                {formatDateTime(item.at, timeZone)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CaseActions({
  riskCase, conflicted,
}: {
  riskCase: RiskCase;
  conflicted: boolean;
}) {
  const action = useCaseAction();
  const canAssign = useCan("risk:assign");
  const canInvestigate = useCan("risk:investigate");
  const canResolve = useCan("risk:resolve");
  const assignees = useEligibleAssignees(riskCase.id, canAssign);
  const [rationale, setRationale] = useState("");
  const [decision, setDecision] = useState<RiskDecisionKind>("corrective_action");

  const move = (to: RiskCaseState) =>
    action.mutate({
      caseId: riskCase.id,
      action: { kind: "transition", input: { to, rationale: rationale || undefined } },
    });

  return (
    <Panel id="case-actions" title="Work the case">
      {conflicted ? (
        <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-fg-muted">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          You can add a note. Everything else on this case belongs to somebody who is not part
          of what it is about.
        </p>
      ) : (
        <div className="space-y-4">
          {canAssign ? (
            <div>
              <label
                htmlFor="case-assignee"
                className="text-[0.8125rem] font-medium text-fg"
              >
                Responsible
              </label>
              <select
                id="case-assignee"
                value={riskCase.assigneeMembershipId ?? ""}
                onChange={(e) =>
                  action.mutate({
                    caseId: riskCase.id,
                    action: { kind: "assign", membershipId: e.target.value || null },
                  })
                }
                className="mt-1 h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
              >
                <option value="">Nobody</option>
                {(assignees.data ?? []).map((person) => (
                  <option key={person.membershipId} value={person.membershipId}>
                    {person.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.75rem] text-fg-subtle">
                Anybody whose own actions this case is about is left off this list, and refused
                again at the service if they are named anyway.
              </p>
            </div>
          ) : null}

          {canInvestigate ? (
            <>
              <div>
                <label htmlFor="case-rationale" className="text-[0.8125rem] font-medium text-fg">
                  Reason
                </label>
                <Textarea
                  id="case-rationale"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={2}
                  placeholder="Required to close or escalate."
                  className="mt-1"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {WORKING_STATES.filter((s) => canTransition(riskCase.state, s)).map((state) => (
                  <Button key={state} variant="secondary" size="sm" onClick={() => move(state)}>
                    {RISK_CASE_STATE_LABEL[state]}
                  </Button>
                ))}
              </div>

              <div>
                <label htmlFor="case-decision" className="text-[0.8125rem] font-medium text-fg">
                  Record a decision
                </label>
                <select
                  id="case-decision"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as RiskDecisionKind)}
                  className="mt-1 h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
                >
                  {DECISIONS.map((kind) => (
                    <option key={kind} value={kind}>{RISK_DECISION_LABEL[kind]}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={!rationale.trim() || action.isPending}
                  onClick={() =>
                    action.mutate(
                      {
                        caseId: riskCase.id,
                        action: { kind: "decision", input: { kind: decision, rationale } },
                      },
                      { onSuccess: () => setRationale("") },
                    )
                  }
                >
                  Record it
                </Button>
              </div>

              {canResolve ? (
                <div>
                  <p className="text-[0.8125rem] font-medium text-fg">Close the case</p>
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                    Three different endings, kept apart on purpose: it was dealt with, it was
                    accepted, or it was never a problem.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CLOSING_STATES.filter((s) => canTransition(riskCase.state, s)).map((state) => (
                      <Button
                        key={state}
                        variant="secondary"
                        size="sm"
                        disabled={!rationale.trim() || action.isPending}
                        onClick={() => move(state)}
                      >
                        {RISK_CASE_STATE_LABEL[state]}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
                  Closing a case needs the &ldquo;Close risk cases&rdquo; permission. Moving it
                  along does not — investigating and deciding are different powers.
                </p>
              )}
            </>
          ) : (
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              You can read this case and add a note. Working it needs the
              &ldquo;Investigate risk cases&rdquo; permission.
            </p>
          )}

          {action.isError ? (
            <p className="text-[0.8125rem] text-st-danger">{(action.error as Error).message}</p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

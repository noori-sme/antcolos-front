"use client";

import {
  ArrowUpCircle, CheckCircle2, ExternalLink, Gavel, HandHelping, Pin,
  Share2, UserCog, UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetCloseButton, SheetContent } from "@/components/ui/sheet";
import { useActiveMembership } from "@/lib/session/hooks";
import { recentFirst } from "@/lib/responsibility";
import { dateTimeIn, relativeTime, useNow } from "@/lib/utils";
import {
  RESPONSIBILITY_FUNCTION_LABEL, RESPONSIBILITY_ROLE_DESCRIPTION,
  RESPONSIBILITY_SCOPE_LABEL, RESPONSIBILITY_TIMELINE_LABEL,
  type ResponsibilityAssignment,
} from "@/types";
import {
  ApprovalDialog, MoveWorkDialog, NoteActionDialog, type MoveKind,
  type NoteActionKind,
} from "./action-dialogs";
import {
  ApprovalBadge, EscalationLine, HolderLine, SlaClockLine, SourceBadge,
} from "./chips";
import type { ResponsibilityAction, ResponsibilityMutation } from "./hooks";

/**
 * Everything about who holds one piece of work, and every way to change it.
 *
 * The panel is organised the way the responsibility model is: the four roles
 * first and kept visibly apart, then the targets, then what has fired, then the
 * timeline. A person reading it can answer "who is doing this, who answers for
 * it, and has anything happened" without scrolling.
 *
 * Buttons render from `assignment.can`, which the service worked out beside the
 * records. This component makes no access judgement of its own, so a panel left
 * open in a tab since this morning cannot be used to do something the person may
 * no longer do — the mutation re-checks anyway.
 */

interface MemberOption {
  membershipId: string;
  displayName: string;
  title?: string;
  available: boolean;
}

export function ResponsibilityPanel({
  assignment, open, onOpenChange, action, members, onUpdated,
}: {
  assignment: ResponsibilityAssignment | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: ResponsibilityMutation;
  members: MemberOption[];
  onUpdated: (next: ResponsibilityAssignment) => void;
}) {
  const { organization } = useActiveMembership();
  const now = useNow();
  const [move, setMove] = useState<MoveKind | null>(null);
  const [note, setNote] = useState<NoteActionKind | null>(null);
  const [approval, setApproval] = useState(false);

  if (!assignment) return null;

  const tz = organization?.timeZone ?? "UTC";
  const pending = action.isPending;
  const error = action.isError ? action.error.message : null;
  const work = { kind: assignment.work.kind, id: assignment.work.id };

  const run = (a: ResponsibilityAction) =>
    action.mutate(
      { work, action: a },
      {
        onSuccess: (next) => {
          onUpdated(next);
          setMove(null);
          setNote(null);
          setApproval(false);
        },
      },
    );

  const can = assignment.can;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={assignment.work.label}
        description="Who holds this work, what the targets are, and how it got here."
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[0.75rem] text-fg-subtle">
              {RESPONSIBILITY_FUNCTION_LABEL[assignment.functionKey]}
            </p>
            <h2 className="mt-0.5 text-[1rem] leading-6 font-semibold text-fg">
              {assignment.work.label}
            </h2>
          </div>
          <SheetCloseButton />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* -- The four roles, kept apart ------------------------------- */}
          <section className="space-y-3">
            <SectionTitle
              title="Who holds this"
              hint="Doing it and answering for it are different jobs."
            />
            <HolderLine holder={assignment.responsible} />
            <HolderLine holder={assignment.accountable} />
            {assignment.approver ? <HolderLine holder={assignment.approver} /> : null}
            {assignment.watchers.map((w) => (
              <HolderLine key={w.membershipId} holder={w} />
            ))}
            {assignment.watchers.length > 0 ? (
              <p className="text-[0.75rem] text-fg-subtle">
                {RESPONSIBILITY_ROLE_DESCRIPTION.watcher}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceBadge source={assignment.responsible.source} />
              <ApprovalBadge state={assignment.approvalState ?? "not_required"} />
            </div>
          </section>

          {/* -- Scope --------------------------------------------------- */}
          {assignment.scope.length > 0 ? (
            <section className="space-y-2">
              <SectionTitle title="What it covers" />
              <div className="flex flex-wrap gap-1.5">
                {assignment.scope.map((s, i) => (
                  <Badge key={`${s.kind}-${s.id ?? i}`} tone="outline">
                    {RESPONSIBILITY_SCOPE_LABEL[s.kind]}: {s.label}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}

          {/* -- Targets ------------------------------------------------- */}
          <section className="space-y-2">
            <SectionTitle
              title="Targets"
              hint={`Policy: ${assignment.policyName}. Worked out from the clock, never scheduled.`}
            />
            <SlaClockLine reading={assignment.sla.acknowledge} />
            <SlaClockLine reading={assignment.sla.resolve} />
            {assignment.dueAt ? (
              <p className="text-[0.75rem] text-fg-subtle">
                Operational deadline {dateTimeIn(assignment.dueAt, tz)}
                {/* `useNow` is null until the client has mounted, so the
                    relative half is added after hydration rather than rendered
                    from a server clock that would immediately disagree. */}
                {now != null ? ` (${relativeTime(assignment.dueAt, now)})` : null}.
              </p>
            ) : null}
          </section>

          {/* -- Escalation ---------------------------------------------- */}
          <section className="space-y-2">
            <SectionTitle
              title="What has fired"
              hint="Escalation gives somebody visibility. It does not move the work."
            />
            {assignment.escalations.length === 0 ? (
              <p className="text-[0.8125rem] text-fg-muted">
                Nothing. No trigger is true for this right now.
              </p>
            ) : (
              <div className="space-y-2">
                {assignment.escalations.map((e) => (
                  <EscalationLine key={e.trigger} state={e} />
                ))}
              </div>
            )}
          </section>

          {/* -- Timeline ------------------------------------------------ */}
          <section className="space-y-2">
            <SectionTitle
              title="History"
              hint="Append-only. Nothing here is ever edited or removed."
            />
            <ol className="space-y-2.5">
              {recentFirst(assignment.timeline).map((entry) => (
                <li key={entry.id} className="border-l-2 border-border pl-3">
                  <p className="text-[0.8125rem] font-medium text-fg">
                    {RESPONSIBILITY_TIMELINE_LABEL[entry.action]}
                    {entry.subjectName ? (
                      <span className="font-normal text-fg-muted"> — {entry.subjectName}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">{entry.note}</p>
                  <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">
                    {entry.actorName} · {dateTimeIn(entry.at, tz)}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* ★ The honesty note. Every screen in this module carries one. ★ */}
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] text-fg-subtle">
            Targets and escalation levels here are worked out from the records
            every time this panel is opened. Antcolos is not running a timer, and
            no reminder, approval request or escalation is delivered anywhere —
            those belong to the backend, along with real authorization.
          </p>
        </div>

        {/* -- Actions --------------------------------------------------- */}
        <div className="border-t border-border px-5 py-4">
          {error ? (
            <p role="alert" className="mb-3 text-[0.8125rem] text-st-danger">{error}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {can.acknowledge ? (
              <Button size="sm" disabled={pending} onClick={() => run({ kind: "acknowledge" })}>
                <CheckCircle2 aria-hidden />
                Acknowledge
              </Button>
            ) : null}
            {can.keep ? (
              <Button size="sm" variant="secondary" onClick={() => setNote("keep")}>
                <Pin aria-hidden />
                Keep it
              </Button>
            ) : null}
            {can.delegate ? (
              <Button size="sm" variant="secondary" onClick={() => setMove("delegate")}>
                <HandHelping aria-hidden />
                Delegate
              </Button>
            ) : null}
            {can.reassign ? (
              <Button size="sm" variant="secondary" onClick={() => setMove("reassign")}>
                <UserPlus aria-hidden />
                Reassign
              </Button>
            ) : null}
            {can.changeAccountable ? (
              <Button size="sm" variant="secondary" onClick={() => setMove("changeAccountable")}>
                <UserCog aria-hidden />
                Change accountable
              </Button>
            ) : null}
            {can.takeOver ? (
              <Button size="sm" variant="secondary" onClick={() => setNote("takeOver")}>
                <Share2 aria-hidden />
                Take over
              </Button>
            ) : null}
            {can.requestApproval ? (
              <Button size="sm" variant="secondary" onClick={() => setNote("requestApproval")}>
                <Gavel aria-hidden />
                Request approval
              </Button>
            ) : null}
            {can.approve ? (
              <Button size="sm" onClick={() => setApproval(true)}>
                <Gavel aria-hidden />
                Approve
              </Button>
            ) : null}
            {can.escalate ? (
              <Button size="sm" variant="secondary" onClick={() => setNote("escalate")}>
                <ArrowUpCircle aria-hidden />
                Escalate
              </Button>
            ) : null}
            {assignment.work.href ? (
              <Button size="sm" variant="ghost" asChild>
                <Link href={assignment.work.href}>
                  <ExternalLink aria-hidden />
                  Open the work
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        {move ? (
          <MoveWorkDialog
            kind={move}
            open
            onOpenChange={(v) => !v && setMove(null)}
            members={members}
            pending={pending}
            error={error}
            onSubmit={(toMembershipId, reason) =>
              run(
                move === "delegate"
                  ? { kind: "delegate", toMembershipId, note: reason }
                  : move === "reassign"
                    ? { kind: "reassign", toMembershipId, note: reason }
                    : { kind: "changeAccountable", toMembershipId, note: reason },
              )
            }
          />
        ) : null}

        {note ? (
          <NoteActionDialog
            kind={note}
            open
            onOpenChange={(v) => !v && setNote(null)}
            pending={pending}
            error={error}
            onSubmit={(reason) =>
              run(
                note === "escalate"
                  ? { kind: "escalate", note: reason }
                  : note === "takeOver"
                    ? { kind: "takeOver", note: reason }
                    : note === "requestApproval"
                      ? { kind: "requestApproval", note: reason }
                      : { kind: "keep", note: reason },
              )
            }
          />
        ) : null}

        {approval ? (
          <ApprovalDialog
            open
            onOpenChange={setApproval}
            pending={pending}
            error={error}
            onSubmit={(decision, reason) =>
              run({ kind: "decideApproval", decision, note: reason })
            }
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-[0.8125rem] font-semibold text-fg">{title}</h3>
      {hint ? <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

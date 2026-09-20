"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ASSIGNABLE_FUNCTIONS, expectedPermissionsFor } from "@/lib/workforce/functions";
import {
  RESPONSIBILITY_FUNCTION_LABEL, WORKFORCE_AVAILABILITY_LABEL,
  WORKFORCE_FUNCTION_REMEDY_LABEL, WORKFORCE_LEAVE_REASON_LABEL,
  WORKFORCE_LEAVE_STATUS_LABEL, WORKFORCE_START_BASIS_DESCRIPTION,
  WORKFORCE_START_BASIS_LABEL,
  type ResponsibilityFunction, type WorkforceEngagementView,
} from "@/types";

const day = (iso: string) => iso.slice(0, 10);

/**
 * When the relationship began, and what kind of fact that is.
 *
 * The basis is shown with equal weight to the date, not as a footnote: a
 * migrated carrier's "since 2019" and an Antcolos-observed activation look
 * identical on a screen that prints only the date, and they are not the same
 * claim at all.
 */
export function StartDatePanel({ view }: { view: WorkforceEngagementView }) {
  const { engagement } = view;
  if (!engagement.startDate) {
    return (
      <p className="text-[0.8125rem] text-fg-muted">
        No start date has been recorded. Activating this engagement records one.
      </p>
    );
  }

  const provenance = engagement.startDateProvenance;
  return (
    <div className="rounded-lg border border-border bg-surface p-4" data-testid="start-date-panel">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-[0.9375rem] font-semibold text-fg">{day(engagement.startDate)}</span>
        {provenance ? (
          <Badge
            tone={provenance.basis === "observed_by_antcolos" ? "success" : "outline"}
            data-basis={provenance.basis}
          >
            {WORKFORCE_START_BASIS_LABEL[provenance.basis]}
          </Badge>
        ) : (
          /* Absent is not "observed". Saying nothing was recorded is the truth
             about a row that pre-dates the field, and better than a guess. */
          <Badge tone="warning">Nobody recorded where this came from</Badge>
        )}
      </p>
      {provenance ? (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          {WORKFORCE_START_BASIS_DESCRIPTION[provenance.basis]}
        </p>
      ) : null}
      {provenance?.note ? (
        <p className="mt-1 text-[0.8125rem] text-fg-subtle">{provenance.note}</p>
      ) : null}
      {provenance ? (
        <p className="mt-1 text-[0.6875rem] text-fg-subtle">
          Recorded {day(provenance.recordedAt)} by {provenance.recordedBy.displayNameSnapshot}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What this person does here, and where their access does not support it.
 *
 * ★ THE GAP IS THE FEATURE ★
 * Every route out of a mismatch leads to Access. There is no button on this
 * panel that grants anything, because the moment there is one, a job title has
 * become an authorization and this module has become the second permission
 * system it exists not to be.
 */
export function FunctionsPanel({
  view,
  canManage,
  onAssign,
  onRemove,
  pending,
}: {
  view: WorkforceEngagementView;
  canManage: boolean;
  onAssign: (key: ResponsibilityFunction) => void;
  onRemove: (key: ResponsibilityFunction) => void;
  pending: boolean;
}) {
  const assigned = view.engagement.functions;
  const gapFor = (key: ResponsibilityFunction) =>
    view.functionGaps.find((g) => g.functionKey === key);

  return (
    <div className="space-y-3" data-testid="functions-panel">
      <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
        What this organization says they do. Recording a function grants no permission and
        creates no access — permissions live on their membership and change only in Access.
      </p>

      {assigned.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-subtle">No functions are recorded.</p>
      ) : (
        <ul className="space-y-2" data-testid="assigned-functions">
          {assigned.map((assignment) => {
            const gap = gapFor(assignment.functionKey);
            return (
              <li
                key={assignment.functionKey}
                data-function={assignment.functionKey}
                data-has-gap={gap ? "true" : "false"}
                className="rounded-md border border-border bg-surface px-3.5 py-3"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium text-fg">
                    {RESPONSIBILITY_FUNCTION_LABEL[assignment.functionKey]}
                  </span>
                  {gap ? <Badge tone="warning">Access does not match</Badge> : null}
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => onRemove(assignment.functionKey)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">
                  Assigned by {assignment.assignedByName} on {day(assignment.assignedAt)}
                  {assignment.note ? ` · ${assignment.note}` : ""}
                </p>
                {gap ? (
                  <div className="mt-2 rounded-md border border-dashed border-border px-3 py-2">
                    <p className="text-[0.8125rem] leading-relaxed text-fg-muted">{gap.reason}</p>
                    <p className="mt-1 text-[0.75rem] text-fg-subtle">
                      Ordinarily needs: {gap.missing.join(", ")}
                    </p>
                    <p className="mt-1.5 text-[0.75rem]">
                      {/* The ONLY route out, and it goes to the module that
                          owns the answer. Never a grant button here. */}
                      <Link
                        href={gap.remedy === "invite_to_workspace" ? "/settings/users" : "/settings/users"}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {WORKFORCE_FUNCTION_REMEDY_LABEL[gap.remedy]}
                      </Link>
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-wrap gap-2 pt-1" data-testid="assign-function">
          {ASSIGNABLE_FUNCTIONS
            .filter((key) => !assigned.some((a) => a.functionKey === key))
            .map((key) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                data-function={key}
                disabled={pending}
                title={`Ordinarily needs ${expectedPermissionsFor(key).join(", ")}. Recording it grants nothing.`}
                onClick={() => onAssign(key)}
              >
                + {RESPONSIBILITY_FUNCTION_LABEL[key]}
              </Button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Whether this person is working right now, and the leave behind it.
 *
 * The limitation is printed on the panel rather than assumed: everybody who
 * reads "Working" on an HR screen about a driver wants it to mean the truck can
 * roll, and it has never meant that.
 */
export function AvailabilityPanel({
  view,
  canManage,
  onRecordLeave,
  onEndLeave,
  pending,
}: {
  view: WorkforceEngagementView;
  canManage: boolean;
  onRecordLeave: () => void;
  onEndLeave: (leaveId: string) => void;
  pending: boolean;
}) {
  const { availability, engagement } = view;
  const live = availability.leave;
  const history = engagement.leave.filter((l) => l.id !== live?.id);

  return (
    <div className="space-y-3" data-testid="availability-panel">
      <div
        className="rounded-lg border border-border bg-surface p-4"
        data-availability={availability.state}
      >
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={availability.availableForWork ? "success" : "warning"}>
            {WORKFORCE_AVAILABILITY_LABEL[availability.state]}
          </Badge>
          <span className="text-[0.8125rem] text-fg-muted">{availability.summary}</span>
        </p>
        {live ? (
          <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
            {WORKFORCE_LEAVE_REASON_LABEL[live.reason]} · recorded by {live.recordedByName}
            {live.approvedByName ? ` · approved by ${live.approvedByName}` : " · nobody is recorded as approving it"}
          </p>
        ) : null}
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-subtle">
          {availability.limitation}
        </p>
      </div>

      {canManage && engagement.state === "active" ? (
        <div className="flex flex-wrap gap-2">
          {live ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-testid="end-leave"
              onClick={() => onEndLeave(live.id)}
            >
              Record that they came back
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-testid="record-leave"
              onClick={onRecordLeave}
            >
              Record leave
            </Button>
          )}
        </div>
      ) : null}

      {history.length > 0 ? (
        <ul className="space-y-1.5" data-testid="leave-history">
          {history.map((l) => (
            <li key={l.id} className="text-[0.75rem] text-fg-subtle">
              {WORKFORCE_LEAVE_REASON_LABEL[l.reason]} · {day(l.startDate)}
              {l.actualReturnDate ? ` – ${day(l.actualReturnDate)}` : ""}
              {" · "}
              {WORKFORCE_LEAVE_STATUS_LABEL[l.status]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The single next HR action, or nothing at all. */
export function NextActionPanel({ view }: { view: WorkforceEngagementView }) {
  const action = view.nextAction;
  if (!action) {
    return (
      <p className="text-[0.8125rem] text-fg-subtle" data-testid="next-action-none">
        Nothing is waiting on anybody here.
      </p>
    );
  }
  return (
    <div
      className="rounded-lg border border-border bg-surface p-4"
      data-testid="next-action"
      data-action={action.kind}
    >
      <p className="text-[0.875rem] font-medium text-fg">{action.label}</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{action.detail}</p>
      {action.href ? (
        <Link
          href={action.href}
          className="mt-2 inline-block text-[0.75rem] font-medium text-primary underline-offset-2 hover:underline"
        >
          Go there
        </Link>
      ) : null}
    </div>
  );
}

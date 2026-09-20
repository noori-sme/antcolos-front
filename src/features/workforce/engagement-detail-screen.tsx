"use client";

import { ArrowLeft, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { useCan } from "@/lib/session/hooks";
import {
  ONBOARDING_DOMAIN_LABEL, QUALIFICATION_CATEGORY_LABEL,
  QUALIFICATION_SOURCE_LABEL, QUALIFICATION_VERIFICATION_LABEL,
  WORKFORCE_CLASSIFICATION_DESCRIPTION, WORKFORCE_EVENT_LABEL,
  WORKFORCE_STATE_DESCRIPTION,
  type OffboardingStepKey,
} from "@/types";
import {
  ClassificationChip, EngagementStateChip, RetentionStateChip, StepStatusChip,
} from "./chips";
import {
  useEngagement, useEngagementAction, useOnboardingChecklist,
  useQualificationRecords,
} from "./hooks";
import { OffboardDialog } from "./offboard-dialog";
import { LeaveDialog } from "./leave-dialog";
import {
  AvailabilityPanel, FunctionsPanel, NextActionPanel, StartDatePanel,
} from "./engagement-panels";

/**
 * One engagement, and the canonical records around it.
 *
 * The page is organised around a claim it is trying not to make: that HR knows
 * any of this. Every panel below is either the engagement itself — which this
 * module owns — or a LINK to the module that owns the fact, or a checklist row
 * that says which module reported it and what that module said. There is no
 * panel showing a licence, a contract term, a permission or an amount.
 */
export function EngagementDetailScreen({ engagementId }: { engagementId: string }) {
  const view = useEngagement(engagementId);
  const checklist = useOnboardingChecklist(engagementId);
  const qualification = useQualificationRecords(engagementId);
  const action = useEngagementAction(engagementId);
  const canManage = useCan("workforce:manage");
  const canEnd = useCan("workforce:end");
  const canSeeQualification = useCan("qualification:view");

  const [offboardOpen, setOffboardOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  if (view.isPending) return <LoadingSkeleton />;
  if (view.isError) {
    return (
      <ErrorState
        title="That engagement could not be opened"
        description={view.error instanceof Error ? view.error.message : undefined}
        onRetry={() => void view.refetch()}
      />
    );
  }
  if (!view.data) {
    return <EmptyState icon={UsersRound} title="Not found" description="No such engagement in this workspace." />;
  }

  const { engagement, hasActiveMembership, links, incompleteOffboarding } = view.data;

  const run = (input: Parameters<typeof action.mutate>[0]) => {
    setActionError(undefined);
    action.mutate(input, {
      onError: (e) => setActionError(e instanceof Error ? e.message : "That did not work."),
      onSuccess: () => {
        setOffboardOpen(false);
        setLeaveOpen(false);
      },
    });
  };

  return (
    <div className="space-y-section">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/workforce"><ArrowLeft aria-hidden />Back to the workforce</Link>
      </Button>

      <PageHeader
        title={engagement.person.displayName}
        description={`${engagement.positionTitle}${engagement.startDate ? ` · since ${engagement.startDate.slice(0, 10)}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage && engagement.state === "prospective" ? (
              <Button size="sm" onClick={() => run({ kind: "startOnboarding" })} variant="primary">
                Start onboarding
              </Button>
            ) : null}
            {canManage && engagement.state === "onboarding" ? (
              <Button size="sm" variant="primary" onClick={() => run({ kind: "activate" })}>
                Start them
              </Button>
            ) : null}
            {canManage && engagement.state === "active" ? (
              <Button
                size="sm"
                onClick={() => run({ kind: "suspend", input: { reason: "Suspended from the workforce page." } })}
              >
                Suspend
              </Button>
            ) : null}
            {canManage && engagement.state === "suspended" ? (
              <Button size="sm" onClick={() => run({ kind: "restore" })}>Restore</Button>
            ) : null}
            {canEnd && (engagement.state === "active" || engagement.state === "suspended") ? (
              <Button size="sm" variant="danger" onClick={() => setOffboardOpen(true)}>
                End engagement
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <EngagementStateChip state={engagement.state} />
        <ClassificationChip value={engagement.classification} />
        <span className="text-[0.75rem] text-fg-subtle">
          {hasActiveMembership ? "Has Antcolos access" : "No Antcolos access"}
        </span>
      </div>

      {actionError ? (
        <FormAlert tone="danger" title="That did not work">{actionError}</FormAlert>
      ) : null}

      {incompleteOffboarding.length > 0 ? (
        <FormAlert tone="danger" title="This offboarding did not finish" >
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {incompleteOffboarding.map((s) => (
              <li key={s.key}>
                <span className="font-medium">{s.label}</span>
                {s.reason ? ` — ${s.reason}` : null}
              </li>
            ))}
          </ul>
        </FormAlert>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">What this record says</h2>
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
          <Row label="Basis">{WORKFORCE_CLASSIFICATION_DESCRIPTION[engagement.classification]}</Row>
          <Row label="Status">{WORKFORCE_STATE_DESCRIPTION[engagement.state]}</Row>
          <Row label="Position">{engagement.positionTitle} — a label, never a permission.</Row>
          <Row label="Supervisor">
            {engagement.managerName
              ? `${engagement.managerName}. A supervisor, not an assignment: operational responsibility stays with the Responsibility Engine.`
              : "Nobody is recorded as supervising this person."}
          </Row>
          <Row label="Where it came from">{engagement.source.label}</Row>
          <Row label="Ended">
            {engagement.endDate
              ? `${engagement.endDate.slice(0, 10)}${engagement.endReason ? ` — ${engagement.endReason}` : ""}`
              : "Not ended."}
          </Row>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">What happens next</h2>
        <NextActionPanel view={view.data} />
      </section>

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">When this began</h2>
        <StartDatePanel view={view.data} />
      </section>

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">What they do here</h2>
        <FunctionsPanel
          view={view.data}
          canManage={canManage}
          pending={action.isPending}
          onAssign={(functionKey) => run({ kind: "assignFunction", input: { functionKey } })}
          onRemove={(functionKey) => run({
            kind: "removeFunction",
            input: { functionKey, reason: "Removed from the workforce page." },
          })}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">Availability</h2>
        <AvailabilityPanel
          view={view.data}
          canManage={canManage}
          pending={action.isPending}
          onRecordLeave={() => setLeaveOpen(true)}
          onEndLeave={(leaveId) => run({ kind: "endLeave", input: { leaveId } })}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">Onboarding, as the other modules report it</h2>
        {checklist.data ? (
          <>
            <ul className="space-y-2" data-testid="onboarding-checklist">
              {checklist.data.steps.map((step) => (
                <li
                  key={step.key}
                  data-step={step.key}
                  data-status={step.status}
                  className="rounded-md border border-border bg-surface px-3.5 py-3"
                >
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.875rem] font-medium text-fg">{step.label}</span>
                    <StepStatusChip status={step.status} />
                    <span className="text-[0.6875rem] text-fg-subtle">
                      {ONBOARDING_DOMAIN_LABEL[step.domain]}
                      {step.requiredForActivation ? " · required before starting" : ""}
                    </span>
                  </p>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{step.detail}</p>
                  {step.sourceRef?.href ? (
                    <Link
                      href={step.sourceRef.href}
                      className="mt-1 inline-block text-[0.75rem] text-primary underline-offset-4 hover:underline"
                    >
                      Open it in {ONBOARDING_DOMAIN_LABEL[step.domain]}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
              {checklist.data.limitation}
            </p>
          </>
        ) : null}
      </section>

      {canSeeQualification ? (
        <section className="space-y-2">
          <h2 className="text-[0.9375rem] font-semibold text-fg">
            Qualification file — what this carrier relied on
          </h2>
          {qualification.data && qualification.data.length > 0 ? (
            <ul className="space-y-2" data-testid="qualification-records">
              {qualification.data.map(({ record, retentionState, retentionExplanation, newerVersionAvailable, shareEnded }) => (
                <li
                  key={record.id}
                  data-qualification-record={record.id}
                  className="rounded-md border border-border bg-surface px-3.5 py-3"
                >
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.875rem] font-medium text-fg">
                      {QUALIFICATION_CATEGORY_LABEL[record.category]}
                    </span>
                    {/* The pinned version, stated as a version. This is the
                        whole point of the record and it is never a live link
                        to "whatever is current". */}
                    <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
                      version {record.evidence.documentVersion}, pinned
                    </span>
                    <RetentionStateChip state={retentionState} />
                  </p>
                  <p className="mt-1 text-[0.75rem] text-fg-muted">
                    {QUALIFICATION_SOURCE_LABEL[record.source]} ·{" "}
                    {QUALIFICATION_VERIFICATION_LABEL[record.verification]} · adopted{" "}
                    {record.adoptedAt.slice(0, 10)} by {record.adoptedByName}
                  </p>
                  {newerVersionAvailable ? (
                    <p className="mt-1 text-[0.75rem] text-st-warning">
                      The driver has a newer version. This record still shows exactly what was
                      relied on, and nothing moved on its own.
                    </p>
                  ) : null}
                  {shareEnded ? (
                    <p className="mt-1 text-[0.75rem] text-fg-subtle">
                      The share that carried this document has ended. The record is kept.
                    </p>
                  ) : null}
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
                    {retentionExplanation}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.8125rem] text-fg-muted">
              This carrier has adopted no document version into its qualification file for this
              person. Adopting is explicit — a shared document is not adopted by being opened.
            </p>
          )}
          <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
            These are records of <span className="font-medium">which version</span> this carrier
            received and relied on, not copies of the documents. Antcolos stores no file in this
            build, so a retained record proves what was reviewed and when — it is not evidence
            custody. Durable storage, content hashing and retention enforcement are the
            backend&rsquo;s.
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">The canonical records</h2>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="engagement-links">
          {links.map((link) => (
            <li
              key={`${link.kind}-${link.label}`}
              className="rounded-md border border-border bg-surface px-3.5 py-2.5 text-[0.8125rem]"
            >
              {link.href ? (
                <Link href={link.href} className="text-primary underline-offset-4 hover:underline">
                  {link.label}
                </Link>
              ) : (
                <>
                  <span className="text-fg">{link.label}</span>
                  <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">
                    {link.absentReason}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-[0.9375rem] font-semibold text-fg">History</h2>
        <ol className="space-y-2" data-testid="engagement-history">
          {[...engagement.history].reverse().map((event) => (
            <li key={event.id} className="rounded-md border border-border bg-surface px-3.5 py-2.5">
              <p className="text-[0.8125rem] text-fg">
                <span className="font-medium">{WORKFORCE_EVENT_LABEL[event.kind]}</span>
                {" — "}{event.summary}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                {event.at.slice(0, 16).replace("T", " ")} · {event.actor.displayNameSnapshot}
              </p>
              {event.detail ? (
                <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">{event.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <LeaveDialog
        personName={engagement.person.displayName}
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        pending={action.isPending}
        error={actionError}
        onSubmit={(input) => run({ kind: "recordLeave", input })}
      />

      <OffboardDialog
        engagementId={engagementId}
        personName={engagement.person.displayName}
        open={offboardOpen}
        onOpenChange={setOffboardOpen}
        pending={action.isPending}
        error={actionError}
        onConfirm={({ reason, confirmedSteps }) =>
          run({
            kind: "offboard",
            input: { reason, confirmedSteps: confirmedSteps as OffboardingStepKey[] },
          })}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] font-medium text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">{children}</dd>
    </div>
  );
}

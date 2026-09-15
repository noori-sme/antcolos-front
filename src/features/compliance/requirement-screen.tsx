"use client";

import {
  ArrowLeft, Building2, Container, ExternalLink, FileText, Info, Lock,
  PauseCircle, PlayCircle, ShieldCheck, StickyNote, Truck, UserRound,
  UsersRound, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  COMPLIANCE_SUBJECT_LABEL, EVIDENCE_SYSTEM_LABEL, RENEWAL_BASIS_LABEL,
  RESPONSIBILITY_LABEL, VERIFICATION_BASIS_LABEL,
} from "@/config/compliance";
import { useActiveMembership } from "@/lib/session/hooks";
import type { ComplianceRequirement, ComplianceSubjectKind } from "@/types";
import { AddNoteDialog, ResolveDialog, SuspendDialog } from "./action-dialogs";
import { DueLabel } from "./due-label";
import { formatDate } from "./format";
import { ComplianceHistory } from "./history";
import {
  ComplianceStatusBadge, EvidenceStateBadge, SeverityBadge,
} from "./status-chips";
import { useComplianceAction, useComplianceRequirement } from "./use-compliance";

const SUBJECT_ICON: Record<ComplianceSubjectKind, LucideIcon> = {
  carrier: Building2, driver: UsersRound, truck: Truck, trailer: Container,
};

/**
 * One requirement, in full.
 *
 * The screen is laid out around the question an auditor asks: what is owed,
 * what state is it in, what satisfies it, who is answerable, and what has
 * happened to it. Every one of those is a link to the record that owns it
 * rather than a copy of it.
 */
export function ComplianceRequirementScreen({ requirementId }: { requirementId: string }) {
  const query = useComplianceRequirement(requirementId);
  const action = useComplianceAction();
  const { organization } = useActiveMembership();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  if (query.isPending) return <LoadingSkeleton rows={6} />;
  if (query.isError || !query.data) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="That compliance record is not available"
          description="It may belong to another organization, or to a relationship you no longer have. An id is never a way into somebody else's records."
        />
      </div>
    );
  }

  const requirement = query.data;
  const frozen = Boolean(requirement.frozenAt);
  const foreign = requirement.organizationId !== organization?.id;
  const SubjectIcon = SUBJECT_ICON[requirement.subject.kind];

  const close = () => {
    setResolveOpen(false);
    setSuspendOpen(false);
    setNoteOpen(false);
  };

  return (
    <div className="space-y-section">
      <BackLink />

      <PageHeader
        title={requirement.label}
        description={requirement.description}
        actions={
          frozen || foreign ? null : (
            <Can permission="compliance:manage">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setNoteOpen(true)}>
                  <StickyNote aria-hidden />
                  Add note
                </Button>
                {requirement.status === "suspended" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => action.mutate({ id: requirement.id, action: { kind: "reinstate" } })}
                    disabled={action.isPending}
                  >
                    <PlayCircle aria-hidden />
                    Reinstate
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setSuspendOpen(true)}>
                    <PauseCircle aria-hidden />
                    Suspend
                  </Button>
                )}
                <Button variant="primary" size="sm" onClick={() => setResolveOpen(true)}>
                  <ShieldCheck aria-hidden />
                  Record resolution
                </Button>
              </div>
            </Can>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ComplianceStatusBadge status={requirement.status} />
        <SeverityBadge severity={requirement.severity} />
        <DueLabel dueAt={requirement.dueAt} status={requirement.status} />
        {frozen ? (
          <Badge tone="neutral">
            <Lock aria-hidden className="size-3" />
            History — relationship ended
          </Badge>
        ) : null}
        {foreign ? <Badge tone="info">Shared with you</Badge> : null}
      </div>

      {requirement.statusReason ? (
        <p className="rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-fg">
          {requirement.statusReason}
        </p>
      ) : null}

      {frozen ? (
        <p className="rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          {requirement.frozenReason} Nothing about it can be changed, and nothing about
          it has been removed.
        </p>
      ) : null}

      {action.isError ? (
        <p className="rounded-lg border border-st-danger/35 bg-st-danger-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {/* What satisfies it — a pointer, never a copy. */}
          <section
            aria-labelledby="evidence"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h2 id="evidence" className="text-[0.875rem] font-semibold text-fg">
              What satisfies this
            </h2>
            {requirement.evidence ? (
              <div className="mt-3 rounded-md border border-border bg-surface-sunken p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                  <p className="text-[0.875rem] font-medium text-fg">
                    {requirement.evidence.fileName ?? requirement.evidence.label}
                  </p>
                  <EvidenceStateBadge state={requirement.evidence.state} />
                </div>
                <dl className="mt-2.5 space-y-1 text-[0.8125rem]">
                  <Row label="Held by">
                    {EVIDENCE_SYSTEM_LABEL[requirement.evidence.system]}
                  </Row>
                  {requirement.evidence.capturedAt ? (
                    <Row label="Recorded">{formatDate(requirement.evidence.capturedAt)}</Row>
                  ) : null}
                  {requirement.evidence.expiresAt ? (
                    <Row label="Expires">{formatDate(requirement.evidence.expiresAt)}</Row>
                  ) : null}
                </dl>
                {requirement.evidence.rejectionReason ? (
                  <p className="mt-2 rounded border border-st-danger/30 bg-st-danger-bg/40 px-3 py-2 text-[0.8125rem] text-st-danger">
                    {requirement.evidence.rejectionReason}
                  </p>
                ) : null}
                {requirement.evidence.href ? (
                  <Button variant="secondary" size="sm" className="mt-3" asChild>
                    <Link href={requirement.evidence.href}>
                      <ExternalLink aria-hidden />
                      Open it where it lives
                    </Link>
                  </Button>
                ) : null}
                <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                  This requirement points at that record. It is not that record: replacing,
                  rejecting or removing the document changes this status and leaves the
                  requirement standing.
                </p>
              </div>
            ) : (
              <p className="mt-2 rounded-md border border-dashed border-border px-3.5 py-3 text-[0.8125rem] leading-relaxed text-fg-muted">
                Nothing on file satisfies this yet. The requirement exists regardless —
                that is what makes it a requirement rather than a document.
              </p>
            )}
          </section>

          <ComplianceHistory requirement={requirement} timeZone={organization?.timeZone ?? "UTC"} />
        </div>

        <aside className="space-y-4">
          <section
            aria-labelledby="about"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h2 id="about" className="text-[0.875rem] font-semibold text-fg">
              About this requirement
            </h2>
            <dl className="mt-3 space-y-2 text-[0.8125rem]">
              <Row label={COMPLIANCE_SUBJECT_LABEL[requirement.subject.kind]}>
                {requirement.subject.href ? (
                  <Link
                    href={requirement.subject.href}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <SubjectIcon aria-hidden className="size-3.5" />
                    {requirement.subject.label}
                  </Link>
                ) : (
                  requirement.subject.label
                )}
              </Row>
              <Row label="Responsible">
                {requirement.responsible.href ? (
                  <Link
                    href={requirement.responsible.href}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <UserRound aria-hidden className="size-3.5" />
                    {requirement.responsible.displayName}
                  </Link>
                ) : (
                  requirement.responsible.displayName
                )}
              </Row>
              <Row label="Responsibility">
                {RESPONSIBILITY_LABEL[requirement.responsible.kind]}
              </Row>
              <Row label="Renewal">
                {RENEWAL_BASIS_LABEL[requirement.renewal.basis]}
                {requirement.renewal.basis === "fixed_interval" && requirement.renewal.intervalMonths
                  ? ` · every ${requirement.renewal.intervalMonths} months`
                  : ""}
              </Row>
              {requirement.renewal.warnWithinDays > 0 ? (
                <Row label="Warns">
                  {requirement.renewal.warnWithinDays} days before it is due
                </Row>
              ) : null}
              <Row label="Next due">{formatDate(requirement.dueAt)}</Row>
              <Row label="Last satisfied">{formatDate(requirement.satisfiedAt)}</Row>
              <Row label="Where it comes from">{requirement.authority}</Row>
            </dl>
            <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {VERIFICATION_BASIS_LABEL[requirement.verificationBasis]}.
            </p>
          </section>

          <ResolutionList requirement={requirement} />
        </aside>
      </div>

      <ResolveDialog
        requirement={requirement}
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        action={action}
        onDone={close}
      />
      <SuspendDialog
        requirement={requirement}
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        action={action}
        onDone={close}
      />
      <AddNoteDialog
        requirement={requirement}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        action={action}
        onDone={close}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/compliance"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Safety &amp; Compliance
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

/** What was done about it, each time. The first question an audit asks. */
function ResolutionList({ requirement }: { requirement: ComplianceRequirement }) {
  if (requirement.resolutions.length === 0) return null;
  return (
    <section
      aria-labelledby="resolutions"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="resolutions" className="text-[0.875rem] font-semibold text-fg">
        Resolution history
      </h2>
      <ul className="mt-3 space-y-3">
        {[...requirement.resolutions].reverse().map((resolution) => (
          <li key={resolution.id} className="border-l-2 border-border pl-3">
            <p className="text-[0.8125rem] font-medium text-fg">{resolution.note}</p>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              {resolution.actor.displayNameSnapshot} · {formatDate(resolution.at)} · from{" "}
              {resolution.fromStatus.replace("_", " ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

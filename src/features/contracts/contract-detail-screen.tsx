"use client";

import {
  ArrowLeft, Ban, CalendarClock, CheckCircle2, ChevronRight, ClipboardList,
  FileSignature, History, Link2, ListChecks, PenLine, Scale, Send, ShieldAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  MOCK_SIGNATURE_DISCLOSURE, TERMINATION_PRESERVES, agreementTypeLabel,
  compensationLabel, compensationWindowLabel, contractDate, contractDateTime,
  effectiveRangeLabel, endsInLabel, renewalLabel,
} from "@/lib/contracts";
import {
  CONTRACT_EVENT_LABEL, CONTRACT_LINK_LABEL, CONTRACT_TERM_GROUP_LABEL,
  RELATIONSHIP_REF_LABEL, RESPONSIBILITY_AREA_LABEL, SIGNER_AUTHORITY_LABEL,
  TERMINATION_GROUND_LABEL,
  type ContractView, type TerminationGround,
} from "@/types";
import { useNow } from "@/lib/utils/use-now";
import { cn } from "@/lib/utils";
import {
  AgreementTypeChip, ContractStatusChip, Disclosure, MockChip, PartyRoleChip,
  RequirementStatusChip, TerminationStatusChip, VersionStatusChip,
} from "./chips";
import { useContract, useContractAction } from "./hooks";

/**
 * One agreement, in full.
 *
 * Arranged in the order a person needs it: what state it is in and what is
 * blocking it, who the parties are and who may sign, the terms in force, what the
 * agreement asks for, what relationships it papers, what it is linked to, and
 * the whole history underneath.
 *
 * Every action on this page is offered from `view.capabilities`, which the
 * service computes — and the service refuses the action anyway if the UI is
 * wrong. Where an action is unavailable the reason is shown rather than the
 * button being silently greyed out.
 */
export function ContractDetailScreen({ contractId }: { contractId: string }) {
  const nowMs = useNow();
  const now = nowMs == null ? null : new Date(nowMs).toISOString();
  const { data, isPending, isError, error, refetch } = useContract(contractId);

  if (isPending) return <LoadingSkeleton rows={8} />;
  if (isError || !data) {
    return (
      <ErrorState
        title="That agreement is not available"
        description={
          error instanceof Error
            ? error.message
            : "It may belong to another organization, or you may not have permission to read it."
        }
        onRetry={() => refetch()}
      />
    );
  }

  return <Loaded view={data} now={now} />;
}

function Loaded({ view, now }: { view: ContractView; now: string | null }) {
  const { contract, currentVersion, capabilities } = view;
  const action = useContractAction(contract.contractId);
  const effective = currentVersion.terms.effective;

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/contracts"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          All agreements
        </Link>
      </div>

      <PageHeader
        title={contract.title}
        description={`${contract.reference} · ${agreementTypeLabel(contract.agreementType)}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <ContractStatusChip status={contract.status} />
        <AgreementTypeChip type={contract.agreementType} />
        <VersionStatusChip status={currentVersion.status} />
        <Badge tone="neutral">Version {currentVersion.versionNumber}</Badge>
        <MockChip />
      </div>

      <Disclosure>
        <strong className="font-semibold text-fg">This is a mock agreement.</strong>{" "}
        {MOCK_SIGNATURE_DISCLOSURE}
      </Disclosure>

      {capabilities.blockedReasons.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert aria-hidden className="size-4 text-st-warning" />
              What is in the way
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-[0.8125rem] text-fg-muted">
              {capabilities.blockedReasons.map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span aria-hidden className="text-fg-subtle">·</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Actions view={view} action={action} />

      {/* ---- Parties and signers ------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users aria-hidden className="size-4 text-fg-subtle" />
            Parties and authorised signers
          </CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            A party is a reference to a record that lives elsewhere — an
            organization, a driver profile, a membership. Signing authority is
            per membership: no party may sign for another, whatever permissions
            they hold.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.parties.map((party) => {
            const signers = view.signers.filter((s) => s.partyId === party.partyId);
            const signature = view.signatures.find(
              (s) => s.partyId === party.partyId
                && s.contractVersionId === currentVersion.contractVersionId,
            );
            return (
              <div
                key={party.partyId}
                className="rounded-md border border-border bg-surface-sunken px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9375rem] font-medium text-fg">
                    {party.legalNameSnapshot}
                  </span>
                  <PartyRoleChip role={party.role} />
                  {party.isOwningParty ? <Badge tone="info">This workspace</Badge> : null}
                  {signature ? (
                    <Badge tone="success">
                      <CheckCircle2 aria-hidden className="size-3" />
                      Signed {contractDate(signature.signedAt)}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Not signed</Badge>
                  )}
                </div>
                <p className="mt-1 text-[0.75rem] text-fg-subtle">
                  {[
                    party.organizationRef ? `Organization ${party.organizationRef}` : null,
                    party.driverProfileRef ? `Driver profile ${party.driverProfileRef}` : null,
                    party.membershipRef ? `Membership ${party.membershipRef}` : null,
                    party.externalIdentifier ? `Not in Antcolos (${party.externalIdentifier})` : null,
                  ].filter(Boolean).join(" · ") || "No linked record"}
                </p>

                <ul className="mt-2 space-y-1">
                  {signers.length === 0 ? (
                    <li className="text-[0.8125rem] text-st-warning">
                      Nobody is authorised to sign for this party yet. The version
                      cannot be issued until somebody is.
                    </li>
                  ) : null}
                  {signers.map((signer) => (
                    <li key={signer.signerId} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <span className="text-fg">{signer.nameSnapshot}</span>
                      {signer.titleSnapshot ? (
                        <span className="text-fg-subtle">{signer.titleSnapshot}</span>
                      ) : null}
                      <Badge tone="outline">{SIGNER_AUTHORITY_LABEL[signer.authority]}</Badge>
                      {signer.revokedAt ? (
                        <Badge tone="danger">
                          Authority withdrawn {contractDate(signer.revokedAt)}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {signature ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.75rem] text-fg-muted">
                      What was recorded with this signature
                    </summary>
                    <div className="mt-1.5 rounded border border-border bg-surface px-2.5 py-2">
                      <p className="text-[0.8125rem] text-fg">
                        Typed name: <span className="font-medium">{signature.typedName}</span>
                      </p>
                      <p className="mt-1 text-[0.75rem] text-fg-subtle">{signature.statement}</p>
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ---- Terms ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale aria-hidden className="size-4 text-fg-subtle" />
            Terms in force — version {currentVersion.versionNumber}
          </CardTitle>
          {currentVersion.changeReason ? (
            <p className="mt-1 text-[0.8125rem] text-fg-muted">
              <span className="font-medium text-fg">Why this version exists:</span>{" "}
              {currentVersion.changeReason}
              {currentVersion.changedTermGroups.length > 0 ? (
                <>
                  {" "}Changed:{" "}
                  {currentVersion.changedTermGroups
                    .map((g) => CONTRACT_TERM_GROUP_LABEL[g].toLowerCase())
                    .join(", ")}.
                </>
              ) : null}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[0.875rem] text-fg">{currentVersion.terms.summary}</p>

          <Field label="Effective">
            {effectiveRangeLabel(currentVersion.terms)}
            {now ? ` · ${endsInLabel(currentVersion.terms, now)}` : ""}
            {effective.probationEndsAt
              ? ` · trial period to ${contractDate(effective.probationEndsAt)}`
              : ""}
          </Field>

          <Field label="Renewal">{renewalLabel(currentVersion.terms.renewal)}</Field>

          <Field label="Termination">
            {currentVersion.terms.termination.grounds
              .map((g) => TERMINATION_GROUND_LABEL[g].toLowerCase()).join(", ")}
            {" · "}
            {currentVersion.terms.termination.noticeDays} days&apos; notice for
            convenience, {currentVersion.terms.termination.forCauseNoticeDays} for cause
          </Field>

          <div>
            <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">
              Compensation
            </p>
            {!view.compensationVisible ? (
              <p className="mt-1.5 text-[0.8125rem] text-fg-muted">
                Compensation terms are not included in what you can see. This is
                not a blanked-out figure — the rules were left out of the payload
                entirely. You need <code className="text-fg">contracts:financials:view</code>.
              </p>
            ) : currentVersion.terms.compensation.length === 0 ? (
              <p className="mt-1.5 text-[0.8125rem] text-fg-muted">
                The parties agreed no compensation rules on this version.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {currentVersion.terms.compensation.map((rule) => (
                  <li
                    key={rule.id}
                    className="rounded-md border border-border bg-surface-sunken px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.875rem] font-medium text-fg">{rule.label}</span>
                      <Badge tone="outline">{compensationLabel(rule)}</Badge>
                      <PartyRoleChip role={rule.payeeRole} />
                      {compensationWindowLabel(rule) ? (
                        <Badge tone="neutral">{compensationWindowLabel(rule)}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[0.8125rem] text-fg-muted">{rule.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              These are terms, not arithmetic. Settlements price work under the
              agreement that was in force when the work was performed and freeze
              their numbers on approval, so a new version never rewrites a period
              that has already been settled.
            </p>
          </div>

          {currentVersion.terms.responsibilities.length > 0 ? (
            <div>
              <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">
                Responsibilities
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {currentVersion.terms.responsibilities.map((duty) => (
                  <li key={duty.id} className="flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
                    <Badge tone="outline">{RESPONSIBILITY_AREA_LABEL[duty.area]}</Badge>
                    <PartyRoleChip role={duty.owedByRole} />
                    <span className="text-fg-muted">{duty.detail}</span>
                    {duty.material ? <Badge tone="warning">Material</Badge> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {currentVersion.terms.additionalTerms ? (
            <Field label="Additional terms">{currentVersion.terms.additionalTerms}</Field>
          ) : null}
        </CardContent>
      </Card>

      {/* ---- Requirements ------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks aria-hidden className="size-4 text-fg-subtle" />
            What this agreement asks for
          </CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            A requirement is not the thing it asks for. Each one is checked
            against the module that owns the answer — the Document Center for a
            document, the carrier profile for Operating Authority — every time
            this page is read. Produce the document and the row turns green on its
            own.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {view.requirements.map((requirement) => {
            const party = view.parties.find((p) => p.partyId === requirement.owedByPartyId);
            return (
              <div
                key={requirement.requirementId}
                className="rounded-md border border-border bg-surface-sunken px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium text-fg">{requirement.label}</span>
                  <RequirementStatusChip status={requirement.status} />
                  {requirement.blocking ? <Badge tone="danger">Blocking</Badge> : null}
                </div>
                <p className="mt-1 text-[0.8125rem] text-fg-muted">{requirement.reason}</p>
                <p className="mt-1 text-[0.75rem] text-fg-subtle">
                  Owed by {party?.legalNameSnapshot ?? "a party"}
                  {requirement.dueAt ? ` · due ${contractDate(requirement.dueAt)}` : ""}
                  {requirement.waivedReason ? ` · waived: ${requirement.waivedReason}` : ""}
                </p>
                {capabilities.canWaiveRequirement
                  && requirement.kind !== "signature"
                  && requirement.status !== "waived"
                  && requirement.status !== "met" ? (
                    <WaiveButton
                      onWaive={(reason) => action.mutate({
                        kind: "waive", requirementId: requirement.requirementId, reason,
                      })}
                      pending={action.isPending}
                    />
                  ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ---- Relationships ----------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 aria-hidden className="size-4 text-fg-subtle" />
            Relationships this agreement papers
          </CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            References, and only references. This contract records the terms; the
            relationship itself is owned by another service and cannot be created,
            altered or ended from here.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {view.relationships.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">
              Nothing referenced yet. An agreement with no reference is still a
              valid agreement — it just is not pointed at a relationship record.
            </p>
          ) : null}
          {view.relationships.map((ref) => (
            <div
              key={ref.id}
              className={cn(
                "flex items-start gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2.5",
                ref.detachedAt && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="outline">{RELATIONSHIP_REF_LABEL[ref.kind]}</Badge>
                  <span className="text-[0.875rem] text-fg">{ref.labelSnapshot}</span>
                  {ref.detachedAt ? <Badge tone="neutral">Reference detached</Badge> : null}
                </div>
                <p className="mt-1 font-mono text-[0.75rem] text-fg-subtle">{ref.externalId}</p>
              </div>
              {ref.href ? (
                <Link
                  href={ref.href}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[0.8125rem] text-primary hover:underline"
                >
                  Open
                  <ChevronRight aria-hidden className="size-3.5" />
                </Link>
              ) : null}
            </div>
          ))}

          {view.transitionRequests.length > 0 ? (
            <div className="mt-3 rounded-md border border-st-warning/30 bg-st-warning-bg/40 px-3 py-2.5">
              <p className="text-[0.8125rem] font-medium text-fg">
                Access changes this agreement has asked for
              </p>
              <ul className="mt-1.5 space-y-2">
                {view.transitionRequests.map((request) => (
                  <li key={request.id} className="text-[0.8125rem] text-fg-muted">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">
                        {request.kind.replace(/_/g, " ")}
                      </span>
                      <MockChip label="Not applied" />
                    </span>
                    <span className="mt-0.5 block">{request.nextStep}</span>
                    <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">
                      Owned by {request.ownerService} · asked{" "}
                      {contractDateTime(request.requestedAt)} by {request.requestedByName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---- Links ------------------------------------------------------- */}
      {view.links.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList aria-hidden className="size-4 text-fg-subtle" />
              Linked records
            </CardTitle>
            <p className="mt-1 text-[0.8125rem] text-fg-muted">
              Documents, equipment, loads, invoices and settlements this agreement
              is about. Linking reads those records and never changes them.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {view.links.map((link) => (
              <div
                key={link.id}
                className="flex items-center gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2"
              >
                <Badge tone="outline">{CONTRACT_LINK_LABEL[link.ref.kind]}</Badge>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-fg">
                  {link.ref.labelSnapshot}
                </span>
                {link.ref.href ? (
                  <Link
                    href={link.ref.href}
                    className="shrink-0 text-[0.8125rem] text-primary hover:underline"
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ---- Termination ------------------------------------------------- */}
      {view.termination ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ban aria-hidden className="size-4 text-st-warning" />
              Termination
            </CardTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <TerminationStatusChip status={view.termination.status} />
              <Badge tone="outline">
                {TERMINATION_GROUND_LABEL[view.termination.ground]}
              </Badge>
              <span className="text-[0.8125rem] text-fg-muted">
                Notice {contractDate(view.termination.noticeGivenAt)} · effective{" "}
                {contractDate(view.termination.effectiveAt)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[0.875rem] text-fg">{view.termination.reason}</p>

            <div>
              <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">
                Closeout
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {view.termination.steps.map((step) => (
                  <li
                    key={step.key}
                    className="flex flex-wrap items-center gap-2 text-[0.8125rem]"
                  >
                    {step.confirmedAt ? (
                      <CheckCircle2 aria-hidden className="size-4 text-st-success" />
                    ) : (
                      <span
                        aria-hidden
                        className="size-3.5 rounded-full border border-border-strong"
                      />
                    )}
                    <span className={step.confirmedAt ? "text-fg-muted" : "text-fg"}>
                      {step.label}
                    </span>
                    <PartyRoleChip role={step.owedByRole} />
                    {step.confirmedAt ? (
                      <span className="text-[0.75rem] text-fg-subtle">
                        confirmed {contractDate(step.confirmedAt)} by {step.confirmedByName}
                      </span>
                    ) : capabilities.canTerminate || view.termination?.status !== "completed" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ kind: "confirm_step", step: step.key })}
                      >
                        Confirm
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-border bg-surface-sunken px-3 py-2.5">
              <p className="text-[0.8125rem] font-medium text-fg">
                Ending this relationship does not delete
              </p>
              <ul className="mt-1.5 space-y-1 text-[0.8125rem] text-fg-muted">
                {TERMINATION_PRESERVES.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden className="text-fg-subtle">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---- Versions ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature aria-hidden className="size-4 text-fg-subtle" />
            Versions
          </CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            Every version ever issued, newest first. A signed version is frozen
            forever — its terms, its signatures and its compensation rules are
            exactly what they were. Amending creates a new one; nothing is
            overwritten.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {view.versions.map((version) => (
            <Link
              key={version.contractVersionId}
              href={`/contracts/${contract.contractId}/versions/${version.contractVersionId}`}
              className="flex items-start gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2.5 transition-colors hover:border-border-strong"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium text-fg">
                    Version {version.versionNumber}
                  </span>
                  <VersionStatusChip status={version.status} />
                  <Badge tone="outline">{version.kind}</Badge>
                  {version.frozen ? <Badge tone="neutral">Frozen</Badge> : null}
                  {version.contractVersionId === contract.currentVersionId ? (
                    <Badge tone="info">Current</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[0.75rem] text-fg-subtle">
                  {effectiveRangeLabel(version.terms)} · created{" "}
                  {contractDate(version.createdAt)} by {version.createdByName}
                  {version.signedAt ? ` · signed ${contractDate(version.signedAt)}` : ""}
                </p>
                {version.changeReason ? (
                  <p className="mt-1 text-[0.8125rem] text-fg-muted">{version.changeReason}</p>
                ) : null}
              </div>
              <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-fg-subtle" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* ---- Timeline ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History aria-hidden className="size-4 text-fg-subtle" />
            Audit timeline
          </CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            Append-only. Nothing here is ever edited or removed.
          </p>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {view.timeline.map((event) => (
              <li key={event.id} className="border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium text-fg">
                    {CONTRACT_EVENT_LABEL[event.kind]}
                  </span>
                  <span className="text-[0.75rem] text-fg-subtle">
                    {contractDateTime(event.at)}
                  </span>
                  <span className="text-[0.75rem] text-fg-subtle">
                    {event.actor.displayNameSnapshot}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{event.summary}</p>
                {event.detail ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{event.detail}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

function Actions({
  view, action,
}: {
  view: ContractView;
  action: ReturnType<typeof useContractAction>;
}) {
  const { capabilities, currentVersion } = view;
  const [mode, setMode] = useState<
    "none" | "sign" | "terminate" | "amend" | "cancel" | "review"
  >("none");

  const signableParties = view.parties.filter(
    (p) => capabilities.signableForPartyIds.includes(p.partyId),
  );

  const anything = capabilities.canSendForReview || capabilities.canIssueForSignature
    || capabilities.canSign || capabilities.canAmend || capabilities.canTerminate
    || capabilities.canCancel;

  if (!anything && !view.termination) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What you can do</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {action.isError ? (
          <p className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-fg">
            {action.error instanceof Error ? action.error.message : "That did not work."}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {capabilities.canSendForReview ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={action.isPending}
              onClick={() => setMode(mode === "review" ? "none" : "review")}
            >
              <Send aria-hidden />
              Send for review
            </Button>
          ) : null}
          {capabilities.canIssueForSignature ? (
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => action.mutate({ kind: "issue" })}
            >
              <PenLine aria-hidden />
              Issue for signature
            </Button>
          ) : null}
          {capabilities.canSign ? (
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => setMode(mode === "sign" ? "none" : "sign")}
            >
              <PenLine aria-hidden />
              Sign
            </Button>
          ) : null}
          {capabilities.canAmend ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={action.isPending}
              onClick={() => setMode(mode === "amend" ? "none" : "amend")}
            >
              Amend
            </Button>
          ) : null}
          {capabilities.canTerminate ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={action.isPending}
              onClick={() => setMode(mode === "terminate" ? "none" : "terminate")}
            >
              <Ban aria-hidden />
              Give termination notice
            </Button>
          ) : null}
          {capabilities.canCancel ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={action.isPending}
              onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}
            >
              Cancel
            </Button>
          ) : null}
          {view.termination && view.termination.status !== "completed"
            && capabilities.canWaiveRequirement ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() => action.mutate({
                  kind: "withdraw_termination", reason: "Withdrawn by agreement.",
                })}
              >
                Withdraw the termination
              </Button>
            ) : null}
        </div>

        {mode === "review" ? (
          <ReasonForm
            label="What should the reviewer look at?"
            submitLabel="Send for review"
            hint={'"Pending review" means somebody on your team is reading it. No lawyer sees anything — Antcolos has no legal review integration.'}
            pending={action.isPending}
            onSubmit={(note) => {
              action.mutate({ kind: "send_for_review", note });
              setMode("none");
            }}
          />
        ) : null}

        {mode === "sign" ? (
          <div className="space-y-3">
            <Disclosure>
              <strong className="font-semibold text-fg">Mock signature.</strong>{" "}
              {MOCK_SIGNATURE_DISCLOSURE}
            </Disclosure>
            {signableParties.map((party) => (
              <SignForm
                key={party.partyId}
                partyName={party.legalNameSnapshot}
                pending={action.isPending}
                onSign={(typedName) => {
                  action.mutate({
                    kind: "sign",
                    input: {
                      contractVersionId: currentVersion.contractVersionId,
                      partyId: party.partyId,
                      typedName,
                    },
                  });
                  setMode("none");
                }}
              />
            ))}
          </div>
        ) : null}

        {mode === "amend" ? (
          <ReasonForm
            label="Why are the terms changing?"
            submitLabel="Create the amendment"
            hint="The signed version stays exactly as it is, with its signatures and its compensation rules. This creates a new draft version on top of it."
            pending={action.isPending}
            onSubmit={(changeReason) => {
              action.mutate({ kind: "amend", input: { changeReason, terms: {} } });
              setMode("none");
            }}
          />
        ) : null}

        {mode === "cancel" ? (
          <ReasonForm
            label="Why is this being abandoned?"
            submitLabel="Cancel the agreement"
            hint="The record, its versions and its history are all kept. A cancelled agreement never took effect."
            pending={action.isPending}
            onSubmit={(reason) => {
              action.mutate({ kind: "cancel", reason });
              setMode("none");
            }}
          />
        ) : null}

        {mode === "terminate" ? (
          <TerminateForm
            grounds={currentVersion.terms.termination.grounds}
            pending={action.isPending}
            onSubmit={(ground, reason) => {
              action.mutate({ kind: "terminate", input: { ground, reason } });
              setMode("none");
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-[0.875rem] text-fg">{children}</p>
    </div>
  );
}

function ReasonForm({
  label, submitLabel, hint, pending, onSubmit,
}: {
  label: string;
  submitLabel: string;
  hint: string;
  pending: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3">
      <label className="block text-[0.8125rem] font-medium text-fg">
        {label}
        <Textarea
          className="mt-1.5"
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className="text-[0.75rem] text-fg-subtle">{hint}</p>
      <Button size="sm" disabled={pending || !value.trim()} onClick={() => onSubmit(value.trim())}>
        {submitLabel}
      </Button>
    </div>
  );
}

function SignForm({
  partyName, pending, onSign,
}: {
  partyName: string;
  pending: boolean;
  onSign: (typedName: string) => void;
}) {
  const [typedName, setTypedName] = useState("");
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3">
      <label className="block text-[0.8125rem] font-medium text-fg">
        Type your name to sign for {partyName}
        <Input
          className="mt-1.5"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Your full name"
        />
      </label>
      <Button
        size="sm"
        disabled={pending || !typedName.trim()}
        onClick={() => onSign(typedName.trim())}
      >
        Record the mock signature
      </Button>
    </div>
  );
}

function TerminateForm({
  grounds, pending, onSubmit,
}: {
  grounds: TerminationGround[];
  pending: boolean;
  onSubmit: (ground: TerminationGround, reason: string) => void;
}) {
  const [ground, setGround] = useState<TerminationGround>(grounds[0]);
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3 rounded-md border border-st-warning/30 bg-st-warning-bg/40 p-3">
      <div>
        <p className="text-[0.8125rem] font-medium text-fg">On what ground?</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {grounds.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={ground === g}
              onClick={() => setGround(g)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                ground === g
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong",
              )}
            >
              {TERMINATION_GROUND_LABEL[g]}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-[0.8125rem] font-medium text-fg">
        Why?
        <Textarea
          className="mt-1.5"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="text-[0.75rem] text-fg-muted">
        Giving notice records a termination and asks the modules that control
        access to revoke it. It revokes nothing itself and deletes nothing at all.
      </p>
      <Button
        size="sm"
        disabled={pending || !reason.trim()}
        onClick={() => onSubmit(ground, reason.trim())}
      >
        <CalendarClock aria-hidden />
        Give notice
      </Button>
    </div>
  );
}

function WaiveButton({
  onWaive, pending,
}: {
  onWaive: (reason: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => setOpen(true)}>
        Waive this
      </Button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this being set aside?"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !reason.trim()}
          onClick={() => { onWaive(reason.trim()); setOpen(false); }}
        >
          Waive
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

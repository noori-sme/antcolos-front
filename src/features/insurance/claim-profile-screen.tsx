"use client";

import {
  ArrowLeft, History, Paperclip, ShieldOff, TriangleAlert, Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Can } from "@/components/auth/can";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  CLAIM_STATUS_LABEL, CLAIM_TRANSITIONS,
} from "@/lib/insurance/claim-states";
import {
  CLAIM_COST_LABEL, COVERAGE_TYPE_LABEL, insuranceDate, insuranceDateTime,
  RESPONSIBILITY_LABEL, THIRD_PARTY_ROLE_LABEL,
} from "@/lib/insurance/labels";
import { money } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ClaimStatus, ClaimView } from "@/types";
import {
  ClaimSeverityChip, ClaimStatusChip, ClaimTypeChip, CoverageOutcomeChip,
  DisclosureNotice,
} from "./chips";
import { useClaim, useClaimAction } from "./hooks";

export function ClaimProfileScreen({ claimId }: { claimId: string }) {
  const { data, isPending, isError } = useClaim(claimId);

  if (isPending) return <LoadingSkeleton rows={8} />;
  if (isError || !data) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Claim not found"
        description="Either it does not exist or your organization has not been given it. Antcolos answers both the same way on purpose."
        action={<Button variant="secondary" asChild><Link href="/insurance/claims">Back to claims</Link></Button>}
      />
    );
  }

  return <Profile claim={data} />;
}

function Profile({ claim }: { claim: ClaimView }) {
  const action = useClaimAction(claim.claimId);
  const full = claim.disclosure === "full";

  return (
    <div className="space-y-section">
      <Link
        href="/insurance/claims"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Claims
      </Link>

      <PageHeader title={claim.claimReference} description={claim.title} />

      <DisclosureNotice level={claim.disclosure} />

      <div className="flex flex-wrap items-center gap-2">
        <ClaimStatusChip status={claim.status} />
        <ClaimTypeChip type={claim.claimType} />
        <ClaimSeverityChip severity={claim.severity} />
        {claim.insurerClaimNumber ? (
          <Badge tone="outline">Insurer ref {claim.insurerClaimNumber}</Badge>
        ) : null}
        {claim.missingRequiredEvidence > 0 ? (
          <Badge tone="warning">
            {claim.missingRequiredEvidence}{" "}
            {claim.missingRequiredEvidence === 1 ? "document" : "documents"} missing
          </Badge>
        ) : null}
      </div>

      <Attribution claim={claim} />

      <Card>
        <CardHeader><CardTitle>What happened</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[0.875rem] leading-relaxed text-fg">{claim.description}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Event" value={insuranceDateTime(claim.eventAt)} />
            <Fact label="Reported" value={insuranceDateTime(claim.reportedAt)} />
            <Fact
              label="Where"
              value={
                claim.eventLocation
                  ? [claim.eventLocation.city, claim.eventLocation.state].filter(Boolean).join(", ") || "—"
                  : "Not recorded"
              }
            />
            <Fact
              label="Responsibility"
              value={
                claim.responsibleParty
                  ? RESPONSIBILITY_LABEL[claim.responsibleParty.kind]
                    + (claim.responsibleParty.name ? ` · ${claim.responsibleParty.name}` : "")
                  : "Not shared with you"
              }
            />
          </div>
          {claim.eventLocation?.description ? (
            <p className="text-[0.8125rem] text-fg-muted">{claim.eventLocation.description}</p>
          ) : null}
          {claim.responsibleParty?.note ? (
            <p className="rounded-md bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              {claim.responsibleParty.note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>What it is attached to</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {claim.links.loadId && claim.links.loadReference ? (
            <LinkChip href={`/loads/${claim.links.loadId}`} label={`Load ${claim.links.loadReference}`} />
          ) : claim.links.loadReference ? (
            <span className="rounded-md bg-surface-sunken px-3 py-1.5 text-[0.8125rem] text-fg-muted">
              Load {claim.links.loadReference}
            </span>
          ) : null}
          {claim.links.truckId ? (
            <LinkChip href={`/fleet/trucks/${claim.links.truckId}`} label={claim.links.truckLabel ?? "Truck"} />
          ) : null}
          {claim.links.trailerId ? (
            <LinkChip href={`/fleet/trailers/${claim.links.trailerId}`} label={claim.links.trailerLabel ?? "Trailer"} />
          ) : null}
          {claim.links.driverName ? (
            <LinkChip href="/people/drivers" label={claim.links.driverName} />
          ) : null}
          <span className="rounded-md bg-surface-sunken px-3 py-1.5 text-[0.8125rem] text-fg-muted">
            {claim.carrierName}
          </span>
        </CardContent>
      </Card>

      <Evidence claim={claim} />

      {claim.financials && claim.costs ? <Money claim={claim} /> : (
        <Card>
          <CardHeader><CardTitle>Costs</CardTitle></CardHeader>
          <CardContent>
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              Reserves, repair costs and deductibles stay with the carrier that owns the
              claim. They were not sent to your organization, so there is nothing hidden
              here to reveal.
            </p>
          </CardContent>
        </Card>
      )}

      {claim.thirdParties.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-fg-subtle" aria-hidden />
              Third parties
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {claim.thirdParties.map((tp) => (
              <div key={tp.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {tp.name}
                  <Badge tone="outline">{THIRD_PARTY_ROLE_LABEL[tp.role]}</Badge>
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                  {tp.organization ? <span>{tp.organization}</span> : null}
                  {tp.phone ? <span>{tp.phone}</span> : null}
                  {tp.insurerName ? <span>{tp.insurerName} {tp.policyNumber ?? ""}</span> : null}
                </p>
                {tp.note ? (
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-subtle">{tp.note}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Notes claim={claim} />

      {full ? <StatusControl claim={claim} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-fg-subtle" aria-hidden />
            History
          </CardTitle>
          <Badge tone="outline">Append-only</Badge>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {claim.history.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-fg">{event.summary}</p>
                  {event.detail ? (
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">{event.detail}</p>
                  ) : null}
                  <p className="mt-0.5 text-[0.75rem] tabular-nums text-fg-subtle">
                    {insuranceDateTime(event.at)} · {event.actor.displayNameSnapshot}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {action.isError ? (
        <p className="text-[0.8125rem] text-st-danger">{action.error.message}</p>
      ) : null}
    </div>
  );
}

/**
 * The frozen attribution, shown as the first thing on the claim.
 *
 * It is stated as "read as at the date of the event" rather than "covered",
 * because the distinction is the whole reason the record exists: this is what
 * the policy said THEN, and it does not move when the policy renews.
 */
function Attribution({ claim }: { claim: ClaimView }) {
  const a = claim.attribution;
  const covered = a.outcome === "covered";

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        covered ? "border-st-success/35 bg-st-success-bg/40" : "border-st-danger/35 bg-st-danger-bg/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {covered ? null : <ShieldOff className="size-4 text-st-danger" aria-hidden />}
        <p className="text-[0.875rem] font-semibold text-fg">
          Coverage as at {insuranceDate(a.eventAt)}
        </p>
        <CoverageOutcomeChip outcome={a.outcome} />
      </div>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{a.reason}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Policy" value={a.policyNumber ? `${a.policyNumber}${a.policyVersionNumber ? ` (v${a.policyVersionNumber})` : ""}` : "None answered"} />
        <Fact label="Insurer" value={a.insurerName ?? "—"} />
        <Fact label="Cover" value={a.coverageType ? COVERAGE_TYPE_LABEL[a.coverageType] : "—"} />
        <Fact
          label="Limit and deductible"
          value={
            a.limitPerOccurrence
              ? `${money(a.limitPerOccurrence.amount, { compact: true })} / ${a.deductible ? money(a.deductible.amount) : "—"}`
              : claim.disclosure === "full" ? "—" : "Not shared with you"
          }
        />
      </div>
      <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        Worked out once, when the claim was recorded, and never worked out again. Renewing
        the policy, selling the unit, a driver leaving or the operating authority moving to
        another carrier do not change what this claim is attributed to.
      </p>
    </div>
  );
}

function Evidence({ claim }: { claim: ClaimView }) {
  const action = useClaimAction(claim.claimId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="size-4 text-fg-subtle" aria-hidden />
          Evidence
        </CardTitle>
        {claim.missingRequiredEvidence > 0 ? (
          <Badge tone="warning">{claim.missingRequiredEvidence} still needed</Badge>
        ) : <Badge tone="success">Complete</Badge>}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          Choosing a file records its name, type and size. Nothing is uploaded, stored,
          read or sent to an insurer.
        </p>
        {claim.evidence.map((item) => {
          const missing = item.status === "missing" || item.status === "rejected";
          return (
            <div
              key={item.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border px-3.5 py-2.5",
                missing ? "border-st-warning/35 bg-st-warning-bg/30" : "border-border bg-surface-sunken",
              )}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {item.label}
                  {item.required ? <Badge tone="outline">Required</Badge> : null}
                  {missing ? <Badge tone="warning">Missing</Badge> : <Badge tone="success">On file</Badge>}
                </p>
                {item.file ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                    {item.file.fileName}
                    {item.receivedAt ? ` · ${insuranceDate(item.receivedAt)}` : ""}
                  </p>
                ) : null}
              </div>
              {missing && claim.disclosure === "full" ? (
                <Can permission="claims:manage">
                  <label className="inline-flex h-control-sm cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-[0.8125rem] font-medium text-fg shadow-e1 hover:bg-surface-hover">
                    Choose a file
                    <input
                      type="file"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        action.mutate({
                          kind: "evidence",
                          evidenceId: item.id,
                          fileName: file.name,
                          fileType: file.type,
                          sizeBytes: file.size,
                        });
                      }}
                    />
                  </label>
                </Can>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Money({ claim }: { claim: ClaimView }) {
  const f = claim.financials!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Costs</CardTitle>
        <Badge tone="outline">Recorded by your team, not paid through Antcolos</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Incurred" value={money(f.totalIncurred.amount)} />
          <Fact label="Recorded as paid" value={money(f.totalPaid.amount)} />
          <Fact label="Reserve outstanding" value={money(f.outstandingReserve.amount)} />
          <Fact label="Deductible applied" value={`${money(f.deductibleApplied.amount)} of ${money(f.deductible.amount)}`} />
        </div>
        <ul className="space-y-2">
          {claim.costs!.map((cost) => (
            <li
              key={cost.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border px-3.5 py-2.5",
                cost.reversesCostId ? "bg-transparent line-through opacity-70" : "bg-surface-sunken",
              )}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {CLAIM_COST_LABEL[cost.kind]}
                  <Badge tone="outline">{cost.bearer === "carrier" ? "We paid" : cost.bearer === "insurer" ? "Insurer" : cost.bearer === "third_party" ? "Third party" : "Driver"}</Badge>
                  {cost.paidAt ? <Badge tone="success">Paid</Badge> : <Badge tone="neutral">Outstanding</Badge>}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-muted">{cost.description}</p>
              </div>
              <p className="shrink-0 text-[0.875rem] font-semibold tabular-nums text-fg">
                {money(cost.amount.amount)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Notes({ claim }: { claim: ClaimView }) {
  const action = useClaimAction(claim.claimId);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "operational">("internal");

  return (
    <Card>
      <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {claim.notes.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">Nothing has been noted on this claim yet.</p>
        ) : null}
        {claim.notes.map((note) => (
          <div key={note.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
            <p className="text-[0.875rem] leading-relaxed text-fg">{note.body}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-subtle">
              <span>{note.actor.displayNameSnapshot}</span>
              <span className="tabular-nums">{insuranceDateTime(note.at)}</span>
              <Badge tone="outline">
                {note.visibility === "internal" ? "Stays with this carrier" : "Visible to shared viewers"}
              </Badge>
            </p>
          </div>
        ))}

        {claim.disclosure === "full" ? (
          <Can permission="claims:manage">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate({ kind: "note", body, visibility }, { onSuccess: () => setBody("") });
              }}
            >
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add a note. Notes are never edited or deleted."
                aria-label="New note"
                rows={3}
                required
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="note-visibility">Who can read this note</label>
                <select
                  id="note-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as "internal" | "operational")}
                  className="h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1"
                >
                  <option value="internal">Stays with this carrier</option>
                  <option value="operational">Visible to shared viewers</option>
                </select>
                <Button type="submit" variant="secondary" disabled={action.isPending}>Add note</Button>
              </div>
            </form>
          </Can>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Moving a claim along.
 *
 * Only the transitions the service will actually accept are offered, read from
 * the same table the service checks — so the screen cannot present a move that
 * is then refused.
 */
function StatusControl({ claim }: { claim: ClaimView }) {
  const action = useClaimAction(claim.claimId);
  const [note, setNote] = useState("");
  const next = CLAIM_TRANSITIONS[claim.status];

  return (
    <Can permission="claims:manage">
      <Card>
        <CardHeader><CardTitle>Move this claim on</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {next.length === 0 ? (
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              This claim is closed. Re-opening belongs with appeals and litigation, which
              Antcolos does not handle yet — so it is not offered rather than half-built.
            </p>
          ) : (
            <>
              <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
                Recording a move says what your team did. Antcolos has not told the insurer
                anything.
              </p>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the history"
                aria-label="Note for the status change"
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                {next.map((to: ClaimStatus) => (
                  <Button
                    key={to}
                    variant={to === "closed" || to === "denied" ? "secondary" : "primary"}
                    size="sm"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ kind: "advance", to, note }, { onSuccess: () => setNote("") })}
                  >
                    {CLAIM_STATUS_LABEL[to]}
                  </Button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Can>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.75rem] text-fg-muted">{label}</p>
      <p className="mt-0.5 text-[0.875rem] font-medium text-fg">{value}</p>
    </div>
  );
}

function LinkChip({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border bg-surface px-3 py-1.5 text-[0.8125rem] font-medium text-fg hover:border-border-strong hover:bg-surface-hover"
    >
      {label}
    </Link>
  );
}

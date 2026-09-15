"use client";

import {
  ArrowLeft, Check, Clock3, MapPin, MessageSquare, Pause, Play, Send, X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { money, dateTimeIn, relativeTime, useNow } from "@/lib/utils";
import type { CounterofferKind, DriverProposalView, ProposalActionKind } from "@/types";
import {
  CommentDialog, ApproveDialog, CounterofferDialog, PauseDialog, RejectDialog,
} from "./proposal-actions";
import { useIdempotencyKeys, useProposal, useProposalCommand, useProposalEvents } from "./hooks";
import { COUNTEROFFER_LABEL, ProposalStatusBadge } from "./labels";
import { ProposalHistory } from "./proposal-history";
import { RatePanel } from "./rate-panel";

/**
 * One proposal, everything on it, and the answers the driver may give.
 *
 * The buttons come from `availableActions`, which the service computes with the
 * same rules it enforces — so a disabled action always carries the reason it is
 * disabled, and an enabled one will not be refused when it is pressed.
 */
export function ProposalDetail({ proposalId }: { proposalId: string }) {
  const proposal = useProposal(proposalId);
  const events = useProposalEvents(proposalId);
  const command = useProposalCommand();
  const { keyFor, rotate } = useIdempotencyKeys();
  const [open, setOpen] = useState<ProposalActionKind | null>(null);
  const now = useNow();

  if (proposal.isPending) return <LoadingSkeleton rows={5} />;
  if (proposal.isError) {
    return (
      <ErrorState
        title="This proposal is not available"
        description={proposal.error.message}
        onRetry={() => proposal.refetch()}
      />
    );
  }

  const p = proposal.data;
  const can = (kind: ProposalActionKind) => p.availableActions.find((a) => a.kind === kind);

  /**
   * One key per intent, minted when the driver opens the action and reused for
   * every attempt at it. A double tap or a retry on a bad connection is the
   * same submission, not a second one.
   */
  function run(intent: string, build: (idempotencyKey: string) => Parameters<typeof command.mutate>[0]) {
    const idempotencyKey = keyFor(`${proposalId}:${intent}`);
    command.mutate(build(idempotencyKey), {
      onSuccess: () => {
        rotate(`${proposalId}:${intent}`);
        setOpen(null);
      },
    });
  }

  return (
    <div className="space-y-stack">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/driver/proposals">
            <ArrowLeft aria-hidden />
            All proposals
          </Link>
        </Button>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              {p.customerKind === "broker" ? "Broker" : "Shipper"}
            </p>
            <h1 className="mt-0.5 text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
              {p.customerName}
            </h1>
          </div>
          <ProposalStatusBadge status={p.status} />
        </div>
        <p className="text-[0.8125rem] text-fg-muted">
          Sent by {p.sentByName} · {dateTimeIn(p.sentAt, p.stops[0].timeZone)}
          {p.respondByAt && now !== null
            ? ` · answer ${relativeTime(p.respondByAt, now)}`
            : ""}
        </p>
      </header>

      <StatusNotice proposal={p} />

      {p.dispatchNote ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              From dispatch
            </p>
            <p className="mt-1.5 text-[0.9375rem] leading-6 text-fg">{p.dispatchNote}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>The run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3">
            {p.stops.map((stop, i) => (
              <li key={`${stop.kind}-${stop.sequence}`} className="flex gap-3">
                <span className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={`mt-1 size-2.5 rounded-full ${i === 0 ? "bg-fg-subtle" : "bg-primary"}`}
                  />
                  {i < p.stops.length - 1 ? (
                    <span aria-hidden className="my-1 w-px flex-1 bg-border" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 pb-1">
                  <span className="block text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                    {stop.kind === "pickup" ? "Pick up" : "Deliver"}
                    {stop.facilityName ? ` · ${stop.facilityName}` : ""}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[1rem] font-semibold text-fg">
                    <MapPin aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                    {stop.address.city}, {stop.address.state}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] text-fg-muted">
                    <Clock3 aria-hidden className="size-3.5 shrink-0" />
                    {dateTimeIn(stop.appointmentAt, stop.timeZone)}
                    {stop.appointmentEndAt
                      ? ` – ${dateTimeIn(stop.appointmentEndAt, stop.timeZone)}`
                      : ""}
                  </span>
                  {stop.notes ? (
                    <span className="mt-1 block text-[0.8125rem] text-fg-muted">{stop.notes}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-4 sm:grid-cols-3">
            <Detail label="Equipment" value={EQUIPMENT_LABEL[p.equipmentType] ?? p.equipmentType} />
            {p.commodity ? <Detail label="Commodity" value={p.commodity} /> : null}
            {p.weightLbs ? (
              <Detail label="Weight" value={`${p.weightLbs.toLocaleString()} lb`} />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>What it pays</CardTitle>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{p.policyLabel}</p>
          </div>
        </CardHeader>
        <CardContent>
          <RatePanel rate={p.rate} policyLabel={p.policyLabel} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Your answer</CardTitle>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {p.policy.approvalGrantsBookingConsent
                ? "Approving here also gives consent to be booked, under this carrier's policy."
                : "Approving keeps the negotiation going. It is not consent to be booked."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {command.isError ? (
            <p role="alert" className="rounded-md bg-st-danger-bg px-3 py-2 text-[0.8125rem] text-st-danger">
              {command.error.message}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <ActionButton
              action={can("approve")}
              variant="primary"
              icon={<Check aria-hidden />}
              label="Approve negotiation"
              onClick={() => setOpen("approve")}
            />
            <ActionButton
              action={can("counteroffer")}
              variant="secondary"
              icon={<Send aria-hidden />}
              label="Counter"
              onClick={() => setOpen("counteroffer")}
            />
            {p.activePause ? (
              <ActionButton
                action={can("resume")}
                variant="secondary"
                icon={<Play aria-hidden />}
                label="Resume now"
                onClick={() =>
                  run("resume", (idempotencyKey) => ({
                    type: "resume",
                    proposalId,
                    pauseId: p.activePause!.id,
                    idempotencyKey,
                  }))
                }
              />
            ) : (
              <ActionButton
                action={can("pause")}
                variant="secondary"
                icon={<Pause aria-hidden />}
                label="Pause"
                onClick={() => setOpen("pause")}
              />
            )}
            <ActionButton
              action={can("comment")}
              variant="secondary"
              icon={<MessageSquare aria-hidden />}
              label="Comment"
              onClick={() => setOpen("comment")}
            />
            <ActionButton
              action={can("reject")}
              variant="ghost"
              icon={<X aria-hidden />}
              label="Reject"
              onClick={() => setOpen("reject")}
            />
          </div>

          <DisabledReasons proposal={p} />
        </CardContent>
      </Card>

      <Counteroffers proposal={p} onWithdraw={(id) =>
        run(`withdraw:${id}`, (idempotencyKey) => ({
          type: "withdraw_counteroffer",
          proposalId,
          counterofferId: id,
          idempotencyKey,
        }))
      } />

      <ProposalHistory
        proposal={p}
        events={events.data ?? []}
        loading={events.isPending}
      />

      {/* Dialogs */}
      <ApproveDialog
        proposal={p}
        open={open === "approve"}
        onOpenChange={(v) => setOpen(v ? "approve" : null)}
        pending={command.isPending}
        onConfirm={(note) =>
          run("approve", (idempotencyKey) => ({
            type: "approve",
            proposalId,
            note: note || undefined,
            idempotencyKey,
          }))
        }
      />
      <RejectDialog
        open={open === "reject"}
        onOpenChange={(v) => setOpen(v ? "reject" : null)}
        pending={command.isPending}
        onConfirm={(reason) =>
          run("reject", (idempotencyKey) => ({
            type: "reject",
            proposalId,
            reason: reason || undefined,
            idempotencyKey,
          }))
        }
      />
      <PauseDialog
        proposal={p}
        open={open === "pause"}
        onOpenChange={(v) => setOpen(v ? "pause" : null)}
        pending={command.isPending}
        onConfirm={(minutes, reason) =>
          run("pause", (idempotencyKey) => ({
            type: "pause",
            proposalId,
            minutes,
            reason: reason || undefined,
            idempotencyKey,
          }))
        }
      />
      <CommentDialog
        open={open === "comment"}
        onOpenChange={(v) => setOpen(v ? "comment" : null)}
        pending={command.isPending}
        onConfirm={(body) =>
          run(`comment:${body.slice(0, 24)}`, (idempotencyKey) => ({
            type: "comment",
            proposalId,
            body,
            idempotencyKey,
          }))
        }
      />
      <CounterofferDialog
        proposal={p}
        open={open === "counteroffer"}
        onOpenChange={(v) => setOpen(v ? "counteroffer" : null)}
        pending={command.isPending}
        onConfirm={({ kind, message, amountCents }) =>
          run(`counter:${kind}:${message.slice(0, 24)}`, (idempotencyKey) => ({
            type: "counteroffer",
            proposalId,
            kind,
            message,
            proposedAmountCents: amountCents,
            idempotencyKey,
          }))
        }
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[0.9375rem] text-fg">{value}</dd>
    </div>
  );
}

function ActionButton({
  action, variant, icon, label, onClick,
}: {
  action?: { enabled: boolean; disabledReason?: string };
  variant: "primary" | "secondary" | "ghost";
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  if (!action) return null;
  return (
    <Button
      size="lg"
      variant={variant}
      disabled={!action.enabled}
      title={action.disabledReason}
      onClick={onClick}
      className="w-full sm:w-auto"
    >
      {icon}
      {label}
    </Button>
  );
}

/** A greyed-out button with no explanation is an insult. This is the explanation. */
function DisabledReasons({ proposal }: { proposal: DriverProposalView }) {
  const blocked = proposal.availableActions.filter((a) => !a.enabled && a.disabledReason);
  if (blocked.length === 0) return null;
  return (
    <ul className="space-y-1 border-t border-border pt-3">
      {blocked.map((a) => (
        <li key={a.kind} className="text-[0.75rem] text-fg-subtle">
          <span className="font-medium text-fg-muted capitalize">{a.kind}</span>{" "}
          — {a.disabledReason}
        </li>
      ))}
    </ul>
  );
}

function StatusNotice({ proposal }: { proposal: DriverProposalView }) {
  const now = useNow();

  if (proposal.activePause && now !== null) {
    return (
      <Card className="border-st-info/40 bg-st-info-bg/40">
        <CardContent className="flex items-start gap-3 pt-4">
          <Pause aria-hidden className="mt-0.5 size-4 shrink-0 text-st-info" />
          <div>
            <p className="text-[0.9375rem] font-semibold text-fg">
              Paused — back to you {relativeTime(proposal.activePause.expiresAt, now)}
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              When it runs out this goes back to waiting for your answer. Running out is
              never taken as a yes or a no.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (proposal.approval) {
    return (
      <Card className="border-st-success/40 bg-st-success-bg/40">
        <CardContent className="flex items-start gap-3 pt-4">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-st-success" />
          <div>
            <p className="text-[0.9375rem] font-semibold text-fg">
              You approved continued negotiation
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {proposal.approval.bookingConsent === "granted"
                ? `Under ${proposal.approval.policyLabelSnapshot} this also gave your consent to be booked.`
                : `This is not consent to be booked. Under ${proposal.approval.policyLabelSnapshot}, dispatch has to come back to you before the load is yours.`}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (proposal.unavailability) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-[0.9375rem] font-semibold text-fg">No longer available</p>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {proposal.unavailability.reason} Everything on this proposal — your comments,
            counteroffers and pauses — is kept exactly as it was.
          </p>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function Counteroffers({
  proposal, onWithdraw,
}: {
  proposal: DriverProposalView;
  onWithdraw: (id: string) => void;
}) {
  if (proposal.counteroffers.length === 0) return null;

  const label = (kind: CounterofferKind) => COUNTEROFFER_LABEL[kind] ?? kind;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your counteroffers</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ul className="divide-y divide-border border-t border-border">
          {proposal.counteroffers.map((c) => (
            <li key={c.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="outline">{label(c.kind)}</Badge>
                {c.proposedAmountCents != null ? (
                  <span className="tnum text-[0.9375rem] font-semibold text-fg">
                    {money(c.proposedAmountCents)}
                  </span>
                ) : null}
                <Badge tone={c.status === "submitted" ? "info" : "neutral"}>
                  {c.status === "submitted" ? "With dispatch" : c.status}
                </Badge>
              </div>
              <p className="mt-1.5 text-[0.875rem] leading-6 text-fg">{c.message}</p>
              {c.status === "submitted" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 mt-1"
                  onClick={() => onWithdraw(c.id)}
                >
                  Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

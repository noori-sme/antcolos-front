"use client";

import { ArrowLeft, History, Lock, Radio, Route, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import {
  ETA_SOURCE_LABEL, TRACKING_ALERT_LABEL, TRACKING_AUDIT_LABEL,
  type AvailabilityBasis, type TrackingAudience, type TrackingUpdateKind,
  type TrackingUpdatePolicy, type TrackingVisibility,
} from "@/types";
import { formatAge } from "@/lib/tracking";
import {
  addTrackingRecipient, approveTrackingUpdate, discardTrackingUpdate, draftTrackingUpdate,
  openTrackingSession, reissueTrackingLink, revokeTrackingLink, setRecipientVisibility,
  setUpdatePolicy,
} from "@/lib/api/mock/tracking-registry";
import { confirmTruckEmpty } from "@/lib/api/mock/tracking-board";
import {
  cityPoint, feedIsMuted, latestLocationSignal, simulatePosition, simulateSignalOutage,
} from "@/lib/api/mock/tracking-signals";
import { AvailabilityChip, BasisChip, HealthChip, MockSourceNotice } from "./chips";
import { AvailabilityPanel } from "./availability-panel";
import { SharingPanel } from "./sharing-panel";
import { UpdatesPanel } from "./updates-panel";
import { MockControls } from "./mock-controls";
import { useLoadTracking, useTrackingContext, useTrackingRefresh } from "./use-tracking";

/**
 * One load, tracked.
 *
 * Everything the dispatcher needs in one column: where it is and how well we
 * know, what the availability engine concluded and on what evidence, who
 * outside the organization can see it, what they have been told, and the
 * immutable history of all of it.
 *
 * The screen makes no judgements. Every button it renders comes from a
 * permission the service re-checks when the button is pressed, and every
 * conclusion it shows arrives pre-labelled confirmed or inferred.
 */
export function TrackingDetailScreen({ loadId }: { loadId: string }) {
  const ctx = useTrackingContext();
  const tracking = useLoadTracking(loadId);
  const refresh = useTrackingRefresh();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, success: string) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError((e as Error)?.message ?? "Something went wrong. Nothing was changed.");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  if (tracking.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="Tracking" />
        <ErrorState
          title="This load's tracking could not be assembled"
          description={(tracking.error as Error)?.message ?? "The request did not complete."}
          onRetry={() => tracking.refetch()}
        />
      </div>
    );
  }

  if (tracking.isPending) return <LoadingSkeleton rows={6} />;

  const view = tracking.data;
  if (!view || !ctx) {
    return (
      <EmptyState
        icon={Route}
        title="Not available here"
        description="This load is not one this workspace tracks, or your membership may not open the tracking board."
      />
    );
  }

  const { row } = view;
  const canShare = ctx.permissions.has("tracking:share");
  const canApprove = ctx.permissions.has("tracking:update:send");
  const muted = row.truckId ? feedIsMuted(ctx.organizationId, row.truckId) : false;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function simulate(what: Parameters<Parameters<typeof MockControls>[0]["onSimulate"]>[0]) {
    if (!ctx || !row.truckId) return;
    const receiverCity = row.destinationLabel.split(",")[0]?.trim();
    const receiverState = row.destinationLabel.split(",")[1]?.trim();
    const point = cityPoint(receiverCity, receiverState);

    if (what === "toggle_outage") {
      simulateSignalOutage(ctx.organizationId, row.truckId, !muted);
      void run(async () => {}, muted ? "The feed is reporting again." : "The feed has been silenced.");
      return;
    }
    if (what === "duplicate") {
      const latest = latestLocationSignal(ctx, { truckId: row.truckId, loadId: row.loadId });
      if (!latest) {
        setError("There is no position to repeat yet.");
        return;
      }
      simulatePosition({
        organizationId: ctx.organizationId,
        truckId: row.truckId,
        loadId: row.loadId,
        city: latest.city,
        state: latest.state,
        point: latest.point,
        speedMph: latest.speedMph,
        description: latest.description,
        minutesAgo: Math.max(0, Math.round((Date.now() - Date.parse(latest.observedAt)) / 60_000)),
      });
      void run(async () => {}, "The same observation was sent again. It should be collapsed, not counted twice.");
      return;
    }

    simulatePosition({
      organizationId: ctx.organizationId,
      truckId: row.truckId,
      loadId: row.loadId,
      city: receiverCity,
      state: receiverState,
      point,
      speedMph: what === "pass_by" ? 62 : 0,
      minutesAgo: what === "stale" ? 360 : 0,
      description:
        what === "pass_by"
          ? "Simulated: passing the receiver on the interstate"
          : what === "stale"
            ? "Simulated: a position from six hours ago"
            : "Simulated: on the receiver's yard",
    });
    void run(
      async () => {},
      what === "pass_by"
        ? "A pass-by was reported. The geofence guard should refuse to call it an arrival."
        : what === "stale"
          ? "An old position was reported. Availability should stop trusting it."
          : "A position at the receiver was reported.",
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title={`${row.loadReference} — tracking`}
        description={`${row.originLabel} → ${row.destinationLabel}`}
        actions={
          <Link
            href="/dispatch/tracking"
            className="inline-flex h-control items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 text-[0.875rem] font-medium text-fg shadow-e1 hover:bg-surface-hover"
          >
            <ArrowLeft className="size-4" aria-hidden />
            All tracking
          </Link>
        }
      />

      <MockSourceNotice />

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-st-success/40 bg-st-success-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {message}
        </p>
      ) : null}

      {/* Where it is ------------------------------------------------------ */}
      <section
        aria-labelledby="position-heading"
        className="rounded-lg border border-border bg-surface p-4 shadow-e1"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2
            id="position-heading"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
          >
            <Radio className="size-4 text-fg-subtle" aria-hidden />
            Position and progress
          </h2>
          <HealthChip health={row.health} />
        </div>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg">{row.healthReason}</p>

        {row.precisionNote ? (
          <p className="mt-2 flex items-start gap-2 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span>
              <span className="font-medium text-fg">
                Route progress, miles to delivery and geofence proximity need precise-location
                access.
              </span>{" "}
              {row.precisionNote}
            </span>
          </p>
        ) : null}

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[0.75rem] sm:grid-cols-4">
          <Fact label="Last seen" value={
            row.currentCity
              ? `${row.currentDescription ?? `${row.currentCity}, ${row.currentState ?? ""}`}`
              : "Nothing reported"
          } />
          <Fact label="Last update" value={
            row.lastUpdateAgeMinutes != null ? `${formatAge(row.lastUpdateAgeMinutes)} ago` : "—"
          } />
          <Fact label="Signal source" value={row.lastSignalLabel ?? "—"} />
          <Fact label="Route progress" value={
            row.precision !== "exact"
              ? "Needs precise-location access"
              : row.routeProgressPercent != null ? `${row.routeProgressPercent}%` : "—"
          } />
          <Fact label="Straight-line to delivery" value={
            row.precision !== "exact"
              ? "Needs precise-location access"
              : row.milesToDelivery != null ? `${row.milesToDelivery} mi` : "—"
          } />
          <Fact label="Delivery appointment" value={
            row.deliveryAppointmentAt ? new Date(row.deliveryAppointmentAt).toLocaleString() : "—"
          } />
          <Fact
            label="ETA"
            value={row.etaAt ? new Date(row.etaAt).toLocaleString() : "Not reported"}
            note={ETA_SOURCE_LABEL[row.etaSource]}
          />
          <Fact label="Against the appointment" value={
            row.etaVarianceMinutes == null
              ? "—"
              : row.etaVarianceMinutes > 0
                ? `${formatAge(row.etaVarianceMinutes)} late`
                : `${formatAge(Math.abs(row.etaVarianceMinutes))} early`
          } />
        </dl>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3 text-[0.75rem] sm:grid-cols-4">
          <Fact label="Carrier" value={row.carrierName ?? "Not identified here"} />
          <Fact label="Operating authority" value={
            row.authority
              ? `${row.authority.authority.status.replace(/_/g, " ")}${row.authority.mcNumber ? ` · ${row.authority.mcNumber}` : ""}`
              : "Not readable here"
          } />
          <Fact label="Driver" value={row.driverName ?? "—"} />
          <Fact label="Equipment" value={
            row.truckUnit
              ? `Unit ${row.truckUnit}${row.trailerUnit ? ` · trailer ${row.trailerUnit}` : ""}`
              : "Not shared with this workspace"
          } />
        </dl>
      </section>

      {/* Availability ------------------------------------------------------ */}
      {view.availability ? (
        <AvailabilityPanel
          decision={view.availability}
          truckUnit={row.truckUnit}
          busy={busy}
          onConfirm={
            row.truckId
              ? (empty, note) =>
                run(
                  () => confirmTruckEmpty(ctx, { truckId: row.truckId!, empty, note }),
                  empty
                    ? "Recorded as confirmed empty, and published to the truck's MT Loop cycle."
                    : "Recorded: the truck is not empty.",
                )
              : undefined
          }
        />
      ) : null}

      {/* Milestones -------------------------------------------------------- */}
      <section
        aria-labelledby="milestones-heading"
        className="rounded-lg border border-border bg-surface p-4 shadow-e1"
      >
        <h2 id="milestones-heading" className="text-[0.875rem] font-semibold text-fg">
          Milestones
        </h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          A machine can suggest a milestone. It never asserts that the driver did anything, so
          anything a signal produced is marked inferred and stays that way until a person confirms
          it in the Driver Trip Workflow.
        </p>
        <ol className="mt-3 space-y-2">
          {row.milestones.map((m) => (
            <li key={m.key} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
              <span className={m.at ? "text-fg" : "text-fg-subtle"}>{m.label}</span>
              {m.at ? (
                <>
                  <span className="text-[0.75rem] text-fg-subtle">
                    {new Date(m.at).toLocaleString()}
                  </span>
                  {m.basis ? <BasisChip basis={m.basis} confidence={m.confidence} /> : null}
                </>
              ) : (
                <Badge tone="outline">Not reached</Badge>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Alerts ------------------------------------------------------------ */}
      {row.alerts.length > 0 ? (
        <section
          aria-labelledby="alerts-heading"
          className="rounded-lg border border-border bg-surface p-4 shadow-e1"
        >
          <h2
            id="alerts-heading"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
          >
            <TriangleAlert className="size-4 text-st-warning" aria-hidden />
            Alerts
          </h2>
          <ul className="mt-2 divide-y divide-border">
            {row.alerts.map((a) => (
              <li key={a.id} className="py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {a.title}
                  <Badge tone="outline">{TRACKING_ALERT_LABEL[a.kind]}</Badge>
                  <BasisChip basis={a.basis} />
                </p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{a.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Customer visibility ------------------------------------------------ */}
      {canShare ? (
        <SharingPanel
          loadReference={row.loadReference}
          session={view.session}
          origin={origin}
          busy={busy}
          onOpen={() => run(
            () => openTrackingSession(ctx, { loadId: row.loadId }),
            "Tracking opened on this load.",
          )}
          onAddRecipient={(input: {
            audience: TrackingAudience;
            partyName: string;
            contactName?: string;
            contactEmail?: string;
            timeoutHours?: number;
          }) => run(
            () => addTrackingRecipient(ctx, { sessionId: view.session!.id, ...input }),
            `A link was issued to ${input.partyName}. Copy it and send it on — nothing was emailed.`,
          )}
          onRevoke={(recipientId: string, reason: string) => run(
            () => revokeTrackingLink(ctx, view.session!.id, recipientId, reason),
            "That link stopped working immediately.",
          )}
          onReissue={(recipientId: string) => run(
            () => reissueTrackingLink(ctx, view.session!.id, recipientId),
            "A new link was issued. The old token stays dead.",
          )}
          onSetVisibility={(recipientId: string, visibility: TrackingVisibility) => run(
            () => setRecipientVisibility(ctx, view.session!.id, recipientId, visibility),
            "What that recipient may see was changed.",
          )}
          onSetPolicy={(policy: TrackingUpdatePolicy) => run(
            () => setUpdatePolicy(ctx, view.session!.id, policy),
            "The update policy was changed.",
          )}
        />
      ) : null}

      {view.session ? (
        <UpdatesPanel
          session={view.session}
          suggestions={view.suggestedUpdates}
          canApprove={canApprove}
          busy={busy}
          onDraft={(input: { kind: TrackingUpdateKind; message: string; basis: AvailabilityBasis }) => run(
            () => draftTrackingUpdate(ctx, { sessionId: view.session!.id, ...input }),
            "Recorded. Nothing was transmitted.",
          )}
          onApprove={(updateId: string) => run(
            () => approveTrackingUpdate(ctx, view.session!.id, updateId),
            "Approved and queued for a handoff that does not exist yet.",
          )}
          onDiscard={(updateId: string) => run(
            () => discardTrackingUpdate(ctx, view.session!.id, updateId, "Decided against by dispatch."),
            "Discarded. It stays on the record with its reason.",
          )}
        />
      ) : null}

      {/* Mock controls ------------------------------------------------------ */}
      <MockControls
        busy={busy}
        muted={muted}
        disabled={!row.truckId}
        disabledReason="There is no truck on this load, so there is nothing to report a position for."
        onSimulate={simulate}
      />

      {/* History ------------------------------------------------------------ */}
      <section
        aria-labelledby="history-heading"
        className="rounded-lg border border-border bg-surface p-4 shadow-e1"
      >
        <h2
          id="history-heading"
          className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
        >
          <History className="size-4 text-fg-subtle" aria-hidden />
          Tracking history
        </h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          Append-only. Every link issued, opened, refused and withdrawn, every visibility change,
          every update and every availability decision, with the source that produced it.
        </p>
        {view.history.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-fg-muted">Nothing yet on this load.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {view.history.map((entry) => (
              <li key={entry.id} className="py-2">
                <p className="flex flex-wrap items-center gap-2 text-[0.75rem]">
                  <Badge tone="outline">{TRACKING_AUDIT_LABEL[entry.action]}</Badge>
                  <span className="text-fg-subtle">
                    {new Date(entry.at).toLocaleString()} · {entry.actorName}
                  </span>
                  {entry.basis ? <BasisChip basis={entry.basis} /> : null}
                </p>
                <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg">{entry.summary}</p>
                {entry.detail ? (
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{entry.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Positions ---------------------------------------------------------- */}
      <section
        aria-labelledby="signals-heading"
        className="rounded-lg border border-border bg-surface p-4 shadow-e1"
      >
        <h2 id="signals-heading" className="text-[0.875rem] font-semibold text-fg">
          Position history
        </h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          Every normalized position this workspace may read, newest first, with the transport it
          arrived on and the adapter that produced it. Repeats are collapsed before anything is
          derived from them.
        </p>
        {view.signals.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-fg-muted">
            Nothing has reported a position for this truck on this load.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {view.signals.slice(0, 20).map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-[0.75rem]">
                <span className="tnum text-fg-subtle">{new Date(s.observedAt).toLocaleString()}</span>
                <span className="text-fg">
                  {s.description ?? [s.city, s.state].filter(Boolean).join(", ")}
                </span>
                {s.speedMph != null ? (
                  <span className="tnum text-fg-subtle">{Math.round(s.speedMph)} mph</span>
                ) : null}
                <Badge tone="outline">{s.transport.replace(/_/g, " ")}</Badge>
                {s.provenance.mock ? <Badge tone="warning">mock</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.availability ? (
        <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
          Availability for this truck is{" "}
          <AvailabilityChip state={view.availability.state} className="align-middle" /> and is
          published to the truck&rsquo;s existing MT Loop cycle. Repeated readings of one cycle
          never produce a second entry on the empty board.
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] break-words text-fg">{value}</dd>
      {note ? <p className="mt-0.5 text-[0.6875rem] leading-snug text-fg-subtle">{note}</p> : null}
    </div>
  );
}

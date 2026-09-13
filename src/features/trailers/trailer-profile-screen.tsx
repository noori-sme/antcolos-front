"use client";

import {
  ArrowLeft, Circle, CircleCheck, Container, Eye, EyeOff, Gavel, Link2Off, LoaderCircle,
  LockKeyhole, LockKeyholeOpen, TriangleAlert, Unlink,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { Can } from "@/components/auth/can";
import { useCan } from "@/lib/session/hooks";
import {
  CONFIG_LABEL, CONFIG_UNIT, TRAILER_DOCUMENT_LABEL, TRAILER_SPEC_LABEL, TRAILER_SPEC_UNIT,
  TRAILER_TYPE_DESCRIPTION, TRAILER_TYPE_LABEL, configFieldsFor, isBooleanConfig,
  isDateConfig, trailerDocumentRequirementsFor, trailerSpecFieldsFor, type ConfigField,
} from "@/lib/fleet/trailer-equipment";
import {
  TRAILER_TERMINATION_STEPS, TRAILER_TERMINATION_STEP_LABEL, activateCombination,
  activateTrailerLease, addTrailerDocument, approveTrailerCarrierRelationship,
  attachTrailer, cancelAttachmentReservation, detachTrailer, endTrailerCarrierRelationship,
  getTrailerProfile, listAttachmentCandidates, outstandingTrailerTerminationSteps,
  recordTrailerTerminationStep, releaseTrailerLease, requestDetach, resolveTrailerOwnershipClaim,
  setTrailerStatus, submitTrailerDocument, trailerTerminationComplete,
  type CompatibilityCandidate, type TerminationStep, type TrailerClaimDecision,
  type TrailerProfileView,
} from "@/lib/api/mock/trailer-registry";
import type {
  TrailerConfiguration, TrailerDocumentKind, TrailerOperatingLease, TrailerOperatingStatus,
} from "@/types";
import {
  AttachmentStateChip, CompatibilityChip, TrailerActivationChip, TrailerCarrierStatusChip,
  TrailerClaimChip, TrailerDocumentChip, TrailerLeaseStatusChip, TrailerStatusChip,
} from "./trailer-chips";
import {
  ATTACHMENT_STATE_DESCRIPTION, TRAILER_ACTIVATION_DESCRIPTION, TRAILER_ACTIVATION_LABEL,
  TRAILER_CARRIER_STATUS_DESCRIPTION, TRAILER_RELATIONSHIP_TYPE_LABEL, TRAILER_STATUS_LABEL,
  formatDate, formatInches, formatNumber, maskTrailerVin,
} from "./trailer-labels";
import { useTrailerContext } from "./use-trailer-context";
import { cn } from "@/lib/utils";

const TABS = [
  ["overview", "Overview"],
  ["specs", "Specifications"],
  ["equipment", "Equipment"],
  ["documents", "Documents"],
  ["attachment", "Power unit"],
  ["authority", "Operating authority"],
  ["relationships", "Carrier relationships"],
  ["ownership", "Ownership"],
  ["history", "Movements"],
  ["timeline", "Timeline"],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * The permanent trailer.
 *
 * An unknown id and a trailer belonging to somebody else produce exactly the
 * same screen, because telling the two apart would turn the URL into a way of
 * probing other carriers' equipment. It never falls back to "the last trailer
 * created" — a missing id means not found, and says so.
 */
export function TrailerProfileScreen({ trailerId }: { trailerId: string }) {
  const ctx = useTrailerContext();
  const uid = useId();
  const canReviewOwnership = useCan("trailers:ownership:review");

  const [view, setView] = useState<TrailerProfileView | null | "denied">(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [revealVin, setRevealVin] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    getTrailerProfile(trailerId, ctx)
      .then((result) => { if (!cancelled) setView(result); })
      .catch(() => { if (!cancelled) setView("denied"); });
    return () => { cancelled = true; };
  }, [ctx, trailerId]);

  useEffect(() => load(), [load]);

  if (view === null) return <LoadingSkeleton rows={6} />;

  if (view === "denied") {
    return (
      <EmptyState
        icon={Container}
        title="Trailer not found"
        description="This trailer does not exist, or your organization has no relationship with it. Those look the same from here on purpose."
        action={
          <Button variant="secondary" asChild>
            <Link href="/fleet/trailers">Back to trailers</Link>
          </Button>
        }
      />
    );
  }

  const { trailer } = view;
  const activeOwner = view.ownership.find((o) => o.status === "active");
  const myRelationship = view.myRelationship;
  const openClaim = view.claims.find((c) => c.status === "pending" || c.status === "manual_review");
  const iAmOwner = activeOwner?.ownerRef === ctx?.organizationId;
  const readOnly = view.accessReason === "dispatch_access";
  const documentIssues = view.documents.filter(
    (d) => ["expired", "expiring_soon", "rejected"].includes(d.status),
  );
  const requirements = trailerDocumentRequirementsFor(trailer.trailerType);
  const missingRequired = requirements.filter(
    (r) => r.required && !view.documents.some((d) => d.kind === r.kind && d.status !== "superseded"),
  );

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/fleet/trailers"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All trailers
        </Link>
      </div>

      <PageHeader
        title={`Unit ${myRelationship?.unitNumber ?? view.relationships[0]?.unitNumber ?? "—"}`}
        description={`${trailer.year} ${trailer.make} ${trailer.model} · ${TRAILER_TYPE_LABEL[trailer.trailerType]}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <TrailerStatusChip status={trailer.status} />
        <AttachmentStateChip state={view.attachmentState} />
        {readOnly ? (
          <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
            Dispatch access — read only
          </span>
        ) : null}
        <span className="font-mono text-[0.75rem] break-all text-fg-subtle">
          {revealVin ? trailer.vin : maskTrailerVin(trailer.vin)}
        </span>
        <button
          type="button"
          onClick={() => setRevealVin((v) => !v)}
          aria-pressed={revealVin}
          className="rounded-sm p-1 text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {revealVin ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          <span className="sr-only">{revealVin ? "Hide VIN" : "Show VIN"}</span>
        </button>
      </div>

      {openClaim && iAmOwner && canReviewOwnership ? (
        <ClaimReview
          claim={openClaim}
          busy={busy}
          onDecide={async (decision, note) => {
            if (!ctx) return;
            setBusy(true);
            await resolveTrailerOwnershipClaim(openClaim.id, decision, ctx, note).catch(() => undefined);
            setBusy(false);
            load();
          }}
        />
      ) : null}

      <div role="tablist" aria-label="Trailer sections" className="flex flex-wrap gap-1.5">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              tab === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- OVERVIEW */}
      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Panel title="Identity and status">
            <dl className="divide-y divide-border">
              <Row label="Permanent trailer ID" value={trailer.trailerId} mono />
              <Row label="VIN" value={revealVin ? trailer.vin : maskTrailerVin(trailer.vin)} mono />
              <Row label="Trailer type" value={TRAILER_TYPE_LABEL[trailer.trailerType]} />
              <Row label="Status" value={TRAILER_STATUS_LABEL[trailer.status]} />
              <Row
                label="Where it is"
                value={[trailer.availability.city, trailer.availability.state].filter(Boolean).join(", ") || "—"}
              />
              <Row
                label="Free from"
                value={trailer.availability.expectedAvailableAt ? formatDate(trailer.availability.expectedAvailableAt) : "—"}
              />
              <Row label="Licence plate" value={`${trailer.registration.plateNumber} (${trailer.registration.plateState})`} />
              <Row
                label="Registration expires"
                value={trailer.registration.expiresAt ? formatDate(trailer.registration.expiresAt) : "Not recorded"}
              />
            </dl>
            {trailer.availability.unavailableReason ? (
              <p className="mt-2 rounded-md border border-st-warning/40 bg-st-warning-bg/50 px-3 py-2 text-[0.75rem] leading-relaxed text-fg">
                {trailer.availability.unavailableReason}
              </p>
            ) : null}
            {!readOnly ? (
              <Can permission="trailers:status:manage">
                <StatusControl
                  uid={uid}
                  current={trailer.status}
                  busy={busy}
                  onChange={async (status, reason) => {
                    if (!ctx) return;
                    setBusy(true);
                    await setTrailerStatus(trailerId, status, ctx, { unavailableReason: reason || undefined })
                      .catch(() => undefined);
                    setBusy(false);
                    load();
                  }}
                />
              </Can>
            ) : null}
          </Panel>

          <div className="space-y-4">
            <Panel title="Who has what">
              <dl className="divide-y divide-border">
                <Row label="Legal owner" value={activeOwner ? `${activeOwner.ownerName} (${activeOwner.ownerType})` : "Not recorded"} />
                <Row
                  label="Operating carrier"
                  value={
                    view.operatingCarrierName
                      ? view.operatingCarrierName
                      : view.lockedByAnotherCarrier
                        ? "Another carrier — not shown"
                        : "None — no active operating lease"
                  }
                />
                <Row label="Your activation state" value={TRAILER_ACTIVATION_LABEL[view.activationState]} />
                <Row
                  label="Power unit"
                  value={view.currentAttachment ? `Unit ${view.currentAttachment.truckUnitLabel}` : "Not attached"}
                />
                <Row
                  label="Dispatch access"
                  value={view.dispatchAccess.filter((d) => d.status === "active").map((d) => d.dispatchOrganizationName).join(", ") || "None"}
                />
              </dl>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
                Owning it, being approved to run it, holding it right now, being hooked to a power
                unit and dispatching it are five separate things. They can all be true at once.
              </p>
            </Panel>

            <Panel title="Needs attention">
              {documentIssues.length === 0 && missingRequired.length === 0 ? (
                <p className="text-[0.8125rem] text-fg-muted">Nothing outstanding.</p>
              ) : (
                <ul className="space-y-2">
                  {missingRequired.map((r) => (
                    <li key={r.kind} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-[0.8125rem] text-fg">{r.label}</span>
                      <TrailerDocumentChip status="missing" />
                    </li>
                  ))}
                  {documentIssues.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-[0.8125rem] text-fg">
                        {TRAILER_DOCUMENT_LABEL[d.kind] ?? d.kind}
                      </span>
                      <TrailerDocumentChip status={d.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- SPECS */}
      {tab === "specs" ? (
        <Panel title="Measurements and capacity">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {trailerSpecFieldsFor(trailer.trailerType).map((field) => {
              const raw = trailer.specs[field];
              const unit = TRAILER_SPEC_UNIT[field];
              const value = field === "suspension" || field === "tireSize"
                ? (raw as string | undefined) ?? "—"
                : unit === "in"
                  ? formatInches(raw as number | undefined)
                  : formatNumber(raw as number | undefined, unit);
              return <Row key={field} label={TRAILER_SPEC_LABEL[field]} value={String(value)} />;
            })}
          </dl>
          <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
            A dash means nobody has measured it. Antcolos will not fill in a typical figure for the
            type, because a dispatcher would read that as measured.
          </p>
        </Panel>
      ) : null}

      {/* --------------------------------------------------------- EQUIPMENT */}
      {tab === "equipment" ? (
        <Panel title={`${TRAILER_TYPE_LABEL[trailer.trailerType]} equipment`}>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            {TRAILER_TYPE_DESCRIPTION[trailer.trailerType]}
          </p>
          <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
            {configFieldsFor(trailer.trailerType).map((field) => (
              <Row
                key={field}
                label={CONFIG_LABEL[field]}
                value={configValue(trailer.configuration, field)}
              />
            ))}
          </dl>
          {trailer.trailerType === "reefer" ? (
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              The reefer unit status and last service date were typed in by a person. Antcolos does
              not monitor this unit and holds no live temperature reading.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {/* --------------------------------------------------------- DOCUMENTS */}
      {tab === "documents" ? (
        <DocumentsTab
          trailerId={trailerId}
          view={view}
          readOnly={readOnly}
          busy={busy}
          setBusy={setBusy}
          onChanged={load}
        />
      ) : null}

      {/* -------------------------------------------------------- ATTACHMENT */}
      {tab === "attachment" ? (
        <AttachmentTab
          trailerId={trailerId}
          view={view}
          readOnly={readOnly}
          busy={busy}
          setBusy={setBusy}
          onChanged={load}
        />
      ) : null}

      {/* --------------------------------------------------------- AUTHORITY */}
      {tab === "authority" ? (
        <AuthorityTab
          trailerId={trailerId}
          view={view}
          readOnly={readOnly}
          busy={busy}
          setBusy={setBusy}
          onChanged={load}
        />
      ) : null}

      {/* ----------------------------------------------------- RELATIONSHIPS */}
      {tab === "relationships" ? (
        <div className="space-y-4">
          <Panel title="Carriers onboarded on this trailer">
            <ul className="space-y-2">
              {view.relationships.map((r) => (
                <li key={r.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                    {r.organizationName}
                    <TrailerCarrierStatusChip status={r.status} />
                    <span className="text-[0.75rem] font-normal text-fg-muted">
                      {TRAILER_RELATIONSHIP_TYPE_LABEL[r.relationshipType]} · unit {r.unitNumber}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    Started {formatDate(r.startedAt)}
                    {r.endedAt ? ` · ended ${formatDate(r.endedAt)}` : ""}
                    {r.endReason ? ` · ${r.endReason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
              Several carriers can be approved on one trailer at the same time. Only one of them can
              be running it.
            </p>
          </Panel>

          {view.dispatchAccess.length > 0 ? (
            <Panel title="Dispatch access">
              <ul className="space-y-2">
                {view.dispatchAccess.map((d) => (
                  <li key={d.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                    <p className="text-[0.8125rem] font-medium text-fg">{d.dispatchOrganizationName}</p>
                    <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                      Granted by {d.grantedByCarrierName} · started {formatDate(d.startedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
                A dispatch organization books freight on this trailer. It neither owns it nor runs it
                on its own authority, and ending its access changes nothing else.
              </p>
            </Panel>
          ) : null}

          {myRelationship?.status === "approved" && !readOnly ? (
            <Can permission="trailers:relationships:manage">
              <EndRelationship
                organizationName={myRelationship.organizationName}
                busy={busy}
                onEnd={async (reason) => {
                  if (!ctx) return;
                  setBusy(true);
                  await endTrailerCarrierRelationship(myRelationship.id, reason, ctx).catch(() => undefined);
                  setBusy(false);
                  load();
                }}
              />
            </Can>
          ) : null}
        </div>
      ) : null}

      {/* --------------------------------------------------------- OWNERSHIP */}
      {tab === "ownership" ? (
        <div className="space-y-4">
          <Panel title="Ownership history">
            <ul className="space-y-2">
              {view.ownership.map((o) => (
                <li key={o.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                    {o.ownerName}
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                      o.status === "active" ? "bg-st-success-bg text-st-success" : "bg-st-neutral-bg text-st-neutral",
                    )}>
                      {o.status === "active" ? "Current owner" : "Former owner"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {o.ownerType === "person" ? "Person" : "Organization"} · from {formatDate(o.startedAt)}
                    {o.endedAt ? ` to ${formatDate(o.endedAt)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
              An ownership change ends one record and opens another. The trailer, its id, its VIN,
              its documents, its carrier relationships, its attachments and every other history stay
              exactly as they were.
            </p>
          </Panel>

          {view.claims.length > 0 ? (
            <Panel title="Ownership claims">
              <ul className="space-y-2">
                {view.claims.map((c) => (
                  <li key={c.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                    <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                      {c.claimantName}
                      <TrailerClaimChip status={c.status} />
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                      Opened {formatDate(c.createdAt)}
                      {c.resolvedAt ? ` · resolved ${formatDate(c.resolvedAt)}` : ""}
                    </p>
                    {c.note ? <p className="mt-1 text-[0.75rem] text-fg-muted">{c.note}</p> : null}
                    {c.resolutionNote ? (
                      <p className="mt-1 text-[0.75rem] text-fg-muted">Decision: {c.resolutionNote}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {/* --------------------------------------------------------- MOVEMENTS */}
      {tab === "history" ? (
        <Panel title="Movements">
          {view.movements.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">
              No movement has been recorded for this trailer yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {view.movements.map((m) => (
                <li key={m.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                  <p className="text-[0.8125rem] font-medium text-fg">
                    {[m.originCity, m.originState].filter(Boolean).join(", ") || "Origin not recorded"}
                    {" → "}
                    {[m.destinationCity, m.destinationState].filter(Boolean).join(", ") || "Destination not recorded"}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {m.organizationName} · started {formatDate(m.startedAt)}
                    {m.endedAt ? ` · finished ${formatDate(m.endedAt)}` : " · still running"}
                    {m.loadReference ? ` · ${m.loadReference}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
            The start of load history. Movements are recorded when a power unit and this trailer are
            activated together; load detail arrives in a later milestone.
          </p>
        </Panel>
      ) : null}

      {/* ---------------------------------------------------------- TIMELINE */}
      {tab === "timeline" ? (
        <Panel title="Event timeline">
          <ol className="space-y-3">
            {view.events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-fg">{e.summary}</p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {formatDate(e.at)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Attachment                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The power unit this trailer is on, and the ones it could go on.
 *
 * Every candidate carries its own verdict and its own reason, so the answer to
 * "why can't I hook this up?" is on the screen before anybody presses anything.
 */
function AttachmentTab({
  trailerId, view, readOnly, busy, setBusy, onChanged,
}: {
  trailerId: string;
  view: TrailerProfileView;
  readOnly: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onChanged: () => void;
}) {
  const ctx = useTrailerContext();
  const uid = useId();
  const [candidates, setCandidates] = useState<CompatibilityCandidate[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [detachReason, setDetachReason] = useState("");

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    listAttachmentCandidates(trailerId, ctx).then((rows) => {
      if (!cancelled) setCandidates(rows);
    });
    return () => { cancelled = true; };
  }, [ctx, trailerId, view]);

  const live = view.currentAttachment;
  const history = view.attachments.filter((a) => a.status === "detached");
  const canAct = !readOnly;

  async function doAttach(truckId: string, reserveOnly: boolean) {
    if (!ctx) return;
    setBusy(true); setError(null); setMessage(null); setConfirming(null);
    const outcome = await attachTrailer(trailerId, truckId, ctx, { reserveOnly }).catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "refused") setError(outcome.result.reasons.join(" "));
    else if (outcome.status === "reserved") {
      setMessage(`Reserved for unit ${outcome.attachment.truckUnitLabel}. No other power unit can take this trailer while the reservation stands.`);
    } else {
      setMessage(`Attached to unit ${outcome.attachment.truckUnitLabel}.`);
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <Panel title="Current power unit">
        <p className="flex flex-wrap items-center gap-2">
          <AttachmentStateChip state={view.attachmentState} />
        </p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
          {ATTACHMENT_STATE_DESCRIPTION[view.attachmentState]}
        </p>

        {live ? (
          <>
            <dl className="mt-3 divide-y divide-border">
              <Row label="Power unit" value={`Unit ${live.truckUnitLabel}`} />
              <Row label="Carrier" value={live.organizationName} />
              <Row label="Reserved" value={live.reservedAt ? formatDate(live.reservedAt) : "—"} />
              <Row label="Attached" value={live.attachedAt ? formatDate(live.attachedAt) : "Not yet"} />
            </dl>
            {canAct ? (
              <Can permission="trailers:attachments:manage">
                <div className="mt-3 space-y-3">
                  {live.status === "reserved" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" size="sm" disabled={busy} onClick={() => void doAttach(live.truckId, false)}>
                        Confirm the attachment
                      </Button>
                      <Button
                        variant="secondary" size="sm" disabled={busy}
                        onClick={async () => {
                          if (!ctx) return;
                          setBusy(true); setError(null); setMessage(null);
                          await cancelAttachmentReservation(live.id, ctx).catch(() => setError("That could not be cancelled."));
                          setBusy(false); onChanged();
                        }}
                      >
                        Cancel the reservation
                      </Button>
                    </div>
                  ) : null}

                  {live.status === "in_movement" ? (
                    <p className="rounded-md border border-st-warning/40 bg-st-warning-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
                      This trailer is on a live movement. It cannot be unhooked until the movement is
                      finished — end the operating lease on the Operating authority tab first.
                    </p>
                  ) : null}

                  {live.status === "attached" || live.status === "pending_detachment" ? (
                    <div>
                      {live.status === "attached" ? (
                        <Button
                          variant="secondary" size="sm" disabled={busy}
                          onClick={async () => {
                            if (!ctx) return;
                            setBusy(true); setError(null); setMessage(null);
                            await requestDetach(live.id, ctx).catch(() => setError("That could not be recorded."));
                            setBusy(false); onChanged();
                          }}
                        >
                          <Unlink aria-hidden />
                          Ask for it to come off
                        </Button>
                      ) : (
                        <div className="max-w-md space-y-2">
                          <Field label="Why is it coming off?" htmlFor={`${uid}-detach-reason`} hint="Recorded on the timeline.">
                            <Input id={`${uid}-detach-reason`} value={detachReason} onChange={(e) => setDetachReason(e.target.value)} />
                          </Field>
                          <Button
                            variant="primary" size="sm" disabled={busy}
                            onClick={async () => {
                              if (!ctx) return;
                              setBusy(true); setError(null); setMessage(null);
                              const outcome = await detachTrailer(live.id, detachReason, ctx).catch(() => null);
                              setBusy(false);
                              if (!outcome) setError("Something went wrong. Nothing was changed.");
                              else if (outcome.status === "blocked") setError(outcome.reason);
                              else setMessage("Detached. The trailer keeps its id, its documents and its full history.");
                              onChanged();
                            }}
                          >
                            Detach it now
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </Can>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-fg-muted">
            {canAct
              ? "Pick one of the power units below to hook it up."
              : "Nothing to show until it is hooked up."}
          </p>
        )}
      </Panel>

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-st-success/40 bg-st-success-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
          {message}
        </p>
      ) : null}

      {canAct ? (
        <Can permission="trailers:attachments:manage">
          <Panel title="Power units in your fleet">
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              Every power unit you operate, checked against this trailer. A verdict of
              &ldquo;not enough information&rdquo; means nothing rules the pairing out and nothing
              confirms it either — Antcolos will say so rather than guess.
            </p>
            {candidates === null ? (
              <div className="mt-3"><LoadingSkeleton rows={3} /></div>
            ) : candidates.length === 0 ? (
              <p className="mt-3 text-[0.8125rem] text-fg-muted">
                You do not operate any power units yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {candidates.map((c) => (
                  <li key={c.truckId} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                    <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                        Unit {c.unit}
                        <CompatibilityChip verdict={c.result.verdict} />
                      </span>
                      {(c.result.verdict === "compatible" || c.result.verdict === "missing_required_data")
                        && live?.truckId !== c.truckId ? (
                          confirming === c.truckId ? (
                            <span className="flex flex-wrap gap-2">
                              <Button variant="primary" size="sm" disabled={busy} onClick={() => void doAttach(c.truckId, false)}>
                                Yes, attach it
                              </Button>
                              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void doAttach(c.truckId, true)}>
                                Reserve only
                              </Button>
                              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                                Cancel
                              </Button>
                            </span>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(c.truckId)}>
                              {live ? "Move it here" : "Attach"}
                            </Button>
                          )
                        ) : null}
                    </p>
                    <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
                      {c.result.reasons.join(" ")}
                    </p>
                    {c.result.missing.length > 0 ? (
                      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-st-warning">
                        Not recorded: {c.result.missing.join("; ")}.
                      </p>
                    ) : null}
                    {confirming === c.truckId && live ? (
                      <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">
                        This will take the trailer off unit {live.truckUnitLabel} and put it on unit{" "}
                        {c.unit}. Both are kept in the attachment history.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Can>
      ) : null}

      <Panel title="Attachment history">
        {history.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">No completed attachment yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((a) => (
              <li key={a.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="text-[0.8125rem] font-medium text-fg">Unit {a.truckUnitLabel}</p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {a.attachedAt ? `Attached ${formatDate(a.attachedAt)}` : "Never attached"}
                  {a.detachedAt ? ` · detached ${formatDate(a.detachedAt)}` : ""}
                  {a.detachReason ? ` · ${a.detachReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Moving a trailer to another power unit never deletes where it has been.
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Operating authority                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Who is allowed to run this trailer, and who is running it.
 *
 * The two are kept apart on purpose. What is different from the truck version
 * is the combination: a trailer can be activated on its own, or together with
 * the power unit it is attached to, and the second form locks both assets in
 * one step so an attached pair can never run under two authorities.
 */
function AuthorityTab({
  trailerId, view, readOnly, busy, setBusy, onChanged,
}: {
  trailerId: string;
  view: TrailerProfileView;
  readOnly: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onChanged: () => void;
}) {
  const ctx = useTrailerContext();
  const uid = useId();
  const [loadReference, setLoadReference] = useState("");
  const [expectedEnd, setExpectedEnd] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = view.activationState;
  const lease = view.myLease;
  const canAct = !readOnly;
  const history = view.leases.filter((l) => l.status === "ended");
  const attached = view.currentAttachment;

  function reset() { setError(null); setMessage(null); }

  async function activate(reserveOnly: boolean) {
    if (!ctx) return;
    setBusy(true); reset();
    const outcome = await activateTrailerLease(trailerId, ctx, {
      loadReference: loadReference.trim() || undefined,
      expectedEndAt: expectedEnd ? new Date(expectedEnd).toISOString() : undefined,
      reserveOnly,
    }).catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "locked_by_other") {
      setError("This trailer is already under another carrier's active operating lease, so your activation was refused. Nothing was reserved and nothing was changed.");
    } else if (outcome.status === "not_approved") {
      setError("Your organization is not approved to operate this trailer yet.");
    } else if (outcome.status === "unauthorized") {
      setError("You do not have permission to activate operating authority.");
    } else if (outcome.status === "reserved") {
      setMessage("Activation reserved. No other carrier can take this trailer while your reservation stands.");
    } else {
      setMessage("You now hold exclusive operating authority for this trailer.");
    }
    onChanged();
  }

  async function activateBoth() {
    if (!ctx || !attached) return;
    setBusy(true); reset();
    const outcome = await activateCombination(attached.truckId, trailerId, ctx, {
      loadReference: loadReference.trim() || undefined,
      expectedEndAt: expectedEnd ? new Date(expectedEnd).toISOString() : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "trailer_locked_by_other") {
      setError("The trailer is under another carrier's active operating lease. Neither asset was locked and nothing was changed.");
    } else if (outcome.status === "power_unit_locked_by_other") {
      setError("The power unit is under another carrier's active operating lease. Neither asset was locked and nothing was changed.");
    } else if (outcome.status === "not_approved") {
      setError(outcome.asset === "truck"
        ? "Your organization is not approved to operate that power unit. Neither asset was locked."
        : "Your organization is not approved to operate this trailer. Neither asset was locked.");
    } else if (outcome.status === "attachment_refused") {
      setError(`${outcome.result.reasons.join(" ")} Neither asset was locked.`);
    } else if (outcome.status === "unauthorized") {
      setError("Activating a power unit and a trailer together needs permission over both.");
    } else {
      setMessage(`Unit ${outcome.attachment.truckUnitLabel} and this trailer are both locked to your organization for this movement.`);
    }
    onChanged();
  }

  async function step(which: TerminationStep) {
    if (!ctx || !lease) return;
    setBusy(true); reset();
    await recordTrailerTerminationStep(lease.id, which, ctx).catch(() => setError("That step could not be recorded."));
    setBusy(false);
    onChanged();
  }

  async function release() {
    if (!ctx || !lease) return;
    setBusy(true); reset();
    const outcome = await releaseTrailerLease(lease.id, ctx).catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "blocked") {
      setError(`The trailer cannot be released yet. Still outstanding: ${outcome.outstanding
        .map((o) => TRAILER_TERMINATION_STEP_LABEL[o].toLowerCase()).join("; ")}.`);
    } else if (outcome.status === "unauthorized") {
      setError("You do not have permission to end this operating lease.");
    } else {
      setMessage("The lease has ended and is kept as history. The trailer is available again to every approved carrier, with the same ID, VIN, documents, attachments and relationships.");
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <Panel title="Your position on this trailer">
        <p className="flex flex-wrap items-center gap-2">
          <TrailerActivationChip state={state} />
          {view.myRelationship ? <TrailerCarrierStatusChip status={view.myRelationship.status} /> : null}
        </p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
          {TRAILER_ACTIVATION_DESCRIPTION[state]}
        </p>
        {view.myRelationship ? (
          <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
            {TRAILER_CARRIER_STATUS_DESCRIPTION[view.myRelationship.status]}
          </p>
        ) : null}
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          Being approved and operating are two different things. Approval stays yours whatever
          happens here; it is the lease that decides who runs the trailer.
        </p>
      </Panel>

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-st-success/40 bg-st-success-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
          {message}
        </p>
      ) : null}

      {state === "locked_by_other" ? (
        <Panel title="Temporarily unavailable">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            It becomes available for activation again once that lease is ended by the carrier
            holding it — not when any estimated delivery time passes.
          </p>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
            Your onboarding, insurance, lease paperwork, permissions and history with this trailer
            are untouched and stay exactly as they are. You do not need to onboard again.
          </p>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
            Who holds it, what power unit it is on and what they are hauling are not shown here.
          </p>
        </Panel>
      ) : null}

      {state === "pending_approval" || state === "onboarding" ? (
        <Panel title="Onboarding review">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Activation stays closed until this onboarding is approved. Approval makes you eligible;
            it does not give you the trailer.
          </p>
          {canAct && view.myRelationship ? (
            <Can permission="trailers:relationships:manage">
              <Button
                className="mt-3" variant="secondary" size="sm" disabled={busy}
                onClick={async () => {
                  if (!ctx || !view.myRelationship) return;
                  setBusy(true); reset();
                  await approveTrailerCarrierRelationship(view.myRelationship.id, ctx)
                    .catch(() => setError("That could not be approved."));
                  setBusy(false); onChanged();
                }}
              >
                Record onboarding as approved
              </Button>
            </Can>
          ) : null}
        </Panel>
      ) : null}

      {state === "available_for_activation" && canAct ? (
        <Can permission="trailers:relationships:manage">
          <Panel title="Take operating authority">
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              This creates a time-bound operating lease. While it is live you are the only carrier
              that can run this trailer, and every other approved carrier sees it as temporarily
              unavailable.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Your load reference" htmlFor={`${uid}-ref`}
                hint="Optional, and only ever visible to your organization."
              >
                <Input id={`${uid}-ref`} value={loadReference} onChange={(e) => setLoadReference(e.target.value)} placeholder="e.g. NL-4417" />
              </Field>
              <Field
                label="Expected end" htmlFor={`${uid}-end`}
                hint="A plan, not a trigger. Reaching it does not release the trailer."
              >
                <Input id={`${uid}-end`} type="datetime-local" value={expectedEnd} onChange={(e) => setExpectedEnd(e.target.value)} />
              </Field>
            </div>

            {attached ? (
              <div className="mt-3 rounded-md border border-st-info/35 bg-st-info-bg/40 px-3.5 py-3">
                <p className="text-[0.8125rem] font-medium text-fg">
                  This trailer is on unit {attached.truckUnitLabel}
                </p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                  An attached power unit and trailer cannot run under two different carriers for one
                  movement. Activating them together locks both to your organization in a single
                  step — if either one is refused, neither is locked.
                </p>
                <Button className="mt-3" variant="primary" size="sm" disabled={busy} onClick={() => void activateBoth()}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <LockKeyhole aria-hidden />}
                  Activate unit {attached.truckUnitLabel} and this trailer together
                </Button>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant={attached ? "secondary" : "primary"} size="sm" disabled={busy} onClick={() => void activate(false)}>
                <LockKeyhole aria-hidden />
                Activate the trailer only
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void activate(true)}>
                Reserve activation only
              </Button>
            </div>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
              A reservation locks the trailer too. If another carrier activates first, your request
              is refused and nothing is created.
            </p>
          </Panel>
        </Can>
      ) : null}

      {lease && lease.status !== "ended" ? (
        <Panel title={lease.status === "reserved" ? "Your reservation" : "Your operating lease"}>
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {lease.organizationName}
            <TrailerLeaseStatusChip status={lease.status} />
            {lease.combinationId ? (
              <span className="rounded-full bg-st-info-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-info">
                Locked with a power unit
              </span>
            ) : null}
          </p>
          <dl className="mt-2 divide-y divide-border">
            <Row label="Reserved" value={lease.reservedAt ? formatDate(lease.reservedAt) : "—"} />
            <Row label="Activated" value={lease.activatedAt ? formatDate(lease.activatedAt) : "Not yet"} />
            <Row label="Expected end" value={lease.expectedEndAt ? formatDate(lease.expectedEndAt) : "Not set"} />
            <Row label="Your load reference" value={lease.loadReference ?? "None recorded"} />
            <Row
              label="Power unit on this lease"
              value={lease.truckId && view.currentAttachment ? `Unit ${view.currentAttachment.truckUnitLabel}` : "Trailer only"}
            />
          </dl>

          {lease.status === "reserved" && canAct ? (
            <Can permission="trailers:relationships:manage">
              <Button className="mt-3" variant="primary" size="sm" disabled={busy} onClick={() => void activate(false)}>
                Confirm activation
              </Button>
            </Can>
          ) : null}

          {lease.status !== "reserved" ? (
            <div className="mt-4">
              <h4 className="text-[0.8125rem] font-semibold text-fg">Before the trailer can be released</h4>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                All four have to be on the record. The expected end time passing is not one of them
                and never releases the trailer on its own.
              </p>
              <ul className="mt-3 space-y-2">
                {TRAILER_TERMINATION_STEPS.map((which) => {
                  const done = terminationStepAt(lease, which);
                  return (
                    <li key={which} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                      <span className="flex min-w-0 items-start gap-2 text-[0.8125rem] text-fg">
                        {done
                          ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-success" aria-hidden />
                          : <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />}
                        <span className="min-w-0">
                          {TRAILER_TERMINATION_STEP_LABEL[which]}
                          {done ? (
                            <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">Recorded {formatDate(done)}</span>
                          ) : null}
                        </span>
                      </span>
                      {!done && canAct ? (
                        <Can permission="trailers:relationships:manage">
                          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void step(which)}>
                            Record
                          </Button>
                        </Can>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {canAct ? (
                <Can permission="trailers:relationships:manage">
                  <div className="mt-3">
                    <Button
                      variant="primary" size="sm"
                      disabled={busy || !trailerTerminationComplete(lease.termination)}
                      onClick={() => void release()}
                    >
                      <LockKeyholeOpen aria-hidden />
                      End the lease and release the trailer
                    </Button>
                    {!trailerTerminationComplete(lease.termination) ? (
                      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                        Still outstanding:{" "}
                        {outstandingTrailerTerminationSteps(lease.termination)
                          .map((o) => TRAILER_TERMINATION_STEP_LABEL[o].toLowerCase()).join("; ")}.
                      </p>
                    ) : null}
                  </div>
                </Can>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Lease history">
        {history.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">No lease has been completed on this trailer yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((l) => (
              <li key={l.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {l.organizationName}
                  <TrailerLeaseStatusChip status={l.status} />
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {l.activatedAt ? `Activated ${formatDate(l.activatedAt)}` : "Never activated"}
                  {l.endedAt ? ` · ended ${formatDate(l.endedAt)}` : ""}
                  {l.loadReference ? ` · ${l.loadReference}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Ended leases are kept for good. Releasing a trailer removes the lock and nothing else.
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

function DocumentsTab({
  trailerId, view, readOnly, busy, setBusy, onChanged,
}: {
  trailerId: string;
  view: TrailerProfileView;
  readOnly: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onChanged: () => void;
}) {
  const ctx = useTrailerContext();
  const uid = useId();
  const [kind, setKind] = useState<TrailerDocumentKind>("registration");
  const requirements = trailerDocumentRequirementsFor(view.trailer.trailerType);
  const current = view.documents.filter((d) => d.status !== "superseded");
  const replaced = view.documents.filter((d) => d.status === "superseded");
  const satisfied = requirements.filter((r) => current.some((d) => d.kind === r.kind)).length;

  return (
    <div className="space-y-4">
      <Panel title="Readiness">
        <p className="text-[0.8125rem] text-fg-muted">
          {satisfied} of {requirements.length} document{requirements.length === 1 ? "" : "s"} for a{" "}
          {TRAILER_TYPE_LABEL[view.trailer.trailerType].toLowerCase()} have something against them.
        </p>
        <ul className="mt-3 space-y-2">
          {requirements.map((r) => {
            const doc = current.find((d) => d.kind === r.kind);
            return (
              <li key={r.kind} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                    {r.label}
                    <TrailerDocumentChip status={doc?.status ?? "missing"} />
                    {!r.required ? (
                      <span className="text-[0.75rem] font-normal text-fg-subtle">Optional</span>
                    ) : null}
                  </span>
                  {doc && doc.status === "selected_local" && !readOnly ? (
                    <Can permission="trailers:documents:manage">
                      <Button
                        variant="secondary" size="sm" disabled={busy}
                        onClick={async () => {
                          if (!ctx) return;
                          setBusy(true);
                          await submitTrailerDocument(doc.id, ctx).catch(() => undefined);
                          setBusy(false); onChanged();
                        }}
                      >
                        Send for review
                      </Button>
                    </Can>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-subtle">{r.description}</p>
                {doc?.fileName ? (
                  <p className="mt-1 break-all text-[0.75rem] text-fg-subtle">
                    {doc.fileName}
                    {doc.expiresAt ? ` · expires ${formatDate(doc.expiresAt)}` : ""}
                  </p>
                ) : null}
                {doc?.rejectionReason ? (
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-st-danger">{doc.rejectionReason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          Preview build: no document here was uploaded, stored, opened, read or verified by anyone,
          and no insurer or inspector has confirmed anything.
        </p>
      </Panel>

      {!readOnly ? (
        <Can permission="trailers:documents:manage">
          <Panel title="Add a document">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What is it?" htmlFor={`${uid}-doc-kind`}>
                <select
                  id={`${uid}-doc-kind`}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as TrailerDocumentKind)}
                  className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                >
                  {requirements.map((r) => (
                    <option key={r.kind} value={r.kind}>{r.label}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end">
                <FilePicker
                  id={`${uid}-doc-file`}
                  busy={busy}
                  onPick={async (file) => {
                    if (!ctx) return;
                    setBusy(true);
                    await addTrailerDocument(trailerId, kind, file, ctx).catch(() => undefined);
                    setBusy(false); onChanged();
                  }}
                />
              </div>
            </div>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
              Replacing a document keeps the old one. Nothing is ever deleted from the record.
            </p>
          </Panel>
        </Can>
      ) : null}

      {replaced.length > 0 ? (
        <Panel title="Replaced documents">
          <ul className="space-y-2">
            {replaced.map((d) => (
              <li key={d.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                  {TRAILER_DOCUMENT_LABEL[d.kind] ?? d.kind}
                  <TrailerDocumentChip status={d.status} />
                </p>
                <p className="mt-0.5 break-all text-[0.75rem] text-fg-subtle">
                  {d.fileName} · kept from {formatDate(d.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function FilePicker({
  id, busy, onPick,
}: {
  id: string;
  busy: boolean;
  onPick: (file: { name: string; type?: string; size?: number }) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-[0.75rem] font-medium text-fg">Choose a file</label>
      <input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setName(f.name);
          onPick({ name: f.name, type: f.type, size: f.size });
        }}
        className="mt-1 block w-full text-[0.8125rem] text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-[0.8125rem] file:text-fg hover:file:bg-surface-hover"
      />
      {name ? <p className="mt-1 break-all text-[0.75rem] text-fg-subtle">{name}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                                */
/* -------------------------------------------------------------------------- */

function StatusControl({
  uid, current, busy, onChange,
}: {
  uid: string;
  current: TrailerOperatingStatus;
  busy: boolean;
  onChange: (status: TrailerOperatingStatus, reason: string) => void;
}) {
  const [next, setNext] = useState<TrailerOperatingStatus>(current);
  const [reason, setReason] = useState("");
  const needsReason = next === "maintenance" || next === "out_of_service";

  return (
    <div className="mt-3">
      <label htmlFor={`${uid}-status`} className="block text-[0.75rem] font-medium text-fg">
        Change status
      </label>
      <select
        id={`${uid}-status`}
        value={next}
        disabled={busy}
        onChange={(e) => setNext(e.target.value as TrailerOperatingStatus)}
        className="mt-1 h-control w-full max-w-xs rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        {(Object.keys(TRAILER_STATUS_LABEL) as TrailerOperatingStatus[]).map((s) => (
          <option key={s} value={s}>{TRAILER_STATUS_LABEL[s]}</option>
        ))}
      </select>
      {needsReason ? (
        <div className="mt-2 max-w-xs">
          <Field label="Why?" htmlFor={`${uid}-status-reason`} hint="Shown to everyone who can see the trailer.">
            <Input id={`${uid}-status-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      ) : null}
      <Button
        className="mt-2" variant="secondary" size="sm"
        disabled={busy || next === current}
        onClick={() => onChange(next, reason)}
      >
        Save the status
      </Button>
      <p className="mt-1 text-[0.75rem] text-fg-subtle">
        Every change is recorded on the timeline. Status is not ownership and not a carrier
        relationship, and changing it touches neither.
      </p>
    </div>
  );
}

function ClaimReview({
  claim, busy, onDecide,
}: {
  claim: { id: string; claimantName: string; claimedOwnerName: string; note?: string; status: string };
  busy: boolean;
  onDecide: (decision: TrailerClaimDecision, note?: string) => void;
}) {
  const uid = useId();
  const [note, setNote] = useState("");
  return (
    <div role="alert" className="rounded-lg border border-st-warning/40 bg-st-warning-bg/60 p-4">
      <p className="flex items-center gap-2 text-[0.875rem] font-medium text-fg">
        <Gavel className="size-4 shrink-0 text-st-warning" aria-hidden />
        {claim.claimantName} claims to own this trailer
      </p>
      {claim.note ? <p className="mt-1 text-[0.8125rem] text-fg-muted">&ldquo;{claim.note}&rdquo;</p> : null}
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
        If you accept, your ownership record is closed with today&apos;s date and{" "}
        {claim.claimedOwnerName} becomes the recorded owner. The trailer keeps its permanent id, VIN,
        specifications, equipment, documents, carrier relationships, attachments, movements and full
        history — only the ownership records change.
      </p>
      <div className="mt-3 max-w-md">
        <Field label="Note" htmlFor={`${uid}-note`} hint="Optional. Recorded with your decision.">
          <Textarea id={`${uid}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => onDecide("accept", note)}>
          Accept — transfer ownership
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide("manual_review", note)}>
          Send to manual review
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDecide("reject", note)}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function EndRelationship({
  organizationName, busy, onEnd,
}: {
  organizationName: string;
  busy: boolean;
  onEnd: (reason: string) => void;
}) {
  const uid = useId();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  if (!confirming) {
    return (
      <Panel title="End your relationship with this trailer">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          {organizationName} stops operating the trailer and stops being able to see it. The trailer
          itself, its ownership, its documents, its attachment history and its timeline all survive.
        </p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          <Link2Off aria-hidden />
          End the relationship
        </Button>
      </Panel>
    );
  }

  return (
    <div role="alert" className="rounded-lg border border-st-danger/40 bg-st-danger-bg/50 p-4">
      <p className="flex items-center gap-2 text-[0.875rem] font-medium text-fg">
        <TriangleAlert className="size-4 shrink-0 text-st-danger" aria-hidden />
        End {organizationName}&apos;s relationship with this trailer?
      </p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        You will no longer be able to open this trailer. Anything it is attached to comes off, and
        the attachment is kept in its history.
      </p>
      <div className="mt-3 max-w-md">
        <Field label="Why?" htmlFor={`${uid}-end-reason`} hint="Recorded on the timeline.">
          <Input id={`${uid}-end-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => onEnd(reason)}>
          Yes, end it
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h3 className="text-[0.875rem] font-semibold text-fg">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className={cn("min-w-0 break-all text-right text-[0.8125rem] text-fg", mono && "font-mono")}>
        {value || "—"}
      </dd>
    </div>
  );
}

const TERMINATION_FIELD: Record<TerminationStep, keyof TrailerOperatingLease["termination"]> = {
  unloaded: "unloadedAt",
  trip_requirements: "tripRequirementsCompletedAt",
  delivery_confirmation: "deliveryConfirmationRecordedAt",
  exclusive_control: "exclusiveControlEndedAt",
};

function terminationStepAt(lease: TrailerOperatingLease, step: TerminationStep): string | undefined {
  return lease.termination[TERMINATION_FIELD[step]];
}

/** Reads one equipment field the way a person would say it. */
function configValue(config: TrailerConfiguration, field: ConfigField): string {
  const raw = config[field];
  if (raw === undefined || raw === "") return "—";
  if (isBooleanConfig(field)) return raw ? "Yes" : "No";
  if (isDateConfig(field)) return formatDate(String(raw));
  const unit = CONFIG_UNIT[field];
  if (unit === "in") return formatInches(Number(raw));
  if (typeof raw === "number") return `${raw.toLocaleString()}${unit ? ` ${unit}` : ""}`;
  return PRETTY[String(raw)] ?? String(raw);
}

/** Enum values as they should read on screen rather than in the database. */
const PRETTY: Record<string, string> = {
  swing: "Swing doors", roll_up: "Roll-up door",
  diesel: "Diesel", electric: "Electric", hybrid: "Hybrid",
  operational: "Operational", needs_service: "Needs service", down: "Down",
  air_chute: "Air chute", floor_channels: "Floor channels", none: "None",
  slide_in: "Slide-in", fold_down: "Fold-down", beavertail: "Beavertail",
  single: "Single level", double: "Double deck", stinger: "Stinger",
  fifth_wheel: "Fifth wheel", gooseneck_ball: "Gooseneck ball",
  pintle: "Pintle hook", bumper_pull: "Bumper pull",
};

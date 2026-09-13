"use client";

import {
  ArrowLeft, Circle, CircleCheck, Eye, EyeOff, Gavel, Link2Off, LockKeyhole, LockKeyholeOpen,
  TriangleAlert, Truck as TruckIcon, UserMinus, UserPlus,
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
  DOCUMENT_LABEL, EQUIPMENT_LABEL, SPEC_LABEL, SPEC_UNIT, isBooleanSpec, specFieldsFor,
} from "@/lib/fleet/equipment";
import { maskVin } from "@/lib/fleet/vin";
import {
  TERMINATION_STEPS, TERMINATION_STEP_LABEL, activateOperatingLease, approveCarrierRelationship,
  assignDriver, endCarrierRelationship, endDriverAssignment, getTruckProfile,
  outstandingTerminationSteps, recordTerminationStep, releaseOperatingLease,
  resolveOwnershipClaim, setTruckStatus, terminationComplete,
  type ClaimDecision, type TerminationStep, type TruckProfileView,
} from "@/lib/api/mock/truck-registry";
import { mockListCarrierDrivers } from "@/features/driver/mock-carrier-drivers";
import type { TruckOperatingLease, TruckOperatingStatus, TruckSpecs } from "@/types";
import {
  ActivationStateChip, CarrierStatusChip, ClaimStatusChip, DocumentStatusChip, LeaseStatusChip,
  RelationshipStatusChip, TruckStatusChip,
} from "./status-chips";
import {
  ACTIVATION_STATE_DESCRIPTION, ACTIVATION_STATE_LABEL, CARRIER_STATUS_DESCRIPTION,
  RELATIONSHIP_TYPE_LABEL, TRUCK_STATUS_LABEL, formatDate, formatInches, formatNumber,
} from "./fleet-labels";
import { useTruckContext } from "./use-truck-context";
import { cn } from "@/lib/utils";

const TABS = [
  ["overview", "Overview"],
  ["specs", "Specifications"],
  ["documents", "Documents"],
  ["driver", "Driver"],
  ["authority", "Operating authority"],
  ["relationships", "Carrier relationships"],
  ["ownership", "Ownership"],
  ["timeline", "Timeline"],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * The permanent truck.
 *
 * An unknown id and a truck belonging to somebody else produce exactly the same
 * screen, because telling the two apart would turn the URL into a way of
 * probing other carriers' fleets. It never falls back to "the last truck
 * created" — a missing id means not found, and says so.
 */
export function TruckProfileScreen({ truckId }: { truckId: string }) {
  const ctx = useTruckContext();
  const uid = useId();
  const canReviewOwnership = useCan("trucks:ownership:review");

  const [view, setView] = useState<TruckProfileView | null | "denied">(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [revealVin, setRevealVin] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    getTruckProfile(truckId, ctx)
      .then((result) => { if (!cancelled) setView(result); })
      .catch(() => { if (!cancelled) setView("denied"); });
    return () => { cancelled = true; };
  }, [ctx, truckId]);

  useEffect(() => load(), [load]);

  if (view === null) return <LoadingSkeleton rows={6} />;

  if (view === "denied") {
    return (
      <EmptyState
        icon={TruckIcon}
        title="Truck not found"
        description="This truck does not exist, or your organization has no relationship with it. Those look the same from here on purpose."
        action={
          <Button variant="secondary" asChild>
            <Link href="/fleet/trucks">Back to trucks</Link>
          </Button>
        }
      />
    );
  }

  const { truck } = view;
  const activeOwner = view.ownership.find((o) => o.status === "active");
  // Whoever holds the truck is whoever holds the lease — approval alone is not
  // operating. The relationship may be absent from `view` when the viewer is
  // not entitled to see that carrier, which is why the name comes from the
  // service rather than from this list.
  const heldLease = view.leases.find(
    (l) => l.status === "active" || l.status === "reserved" || l.status === "pending_release",
  );
  const operator = heldLease
    ? view.relationships.find((r) => r.id === heldLease.relationshipId)
    : undefined;
  const visibleCarrier = view.relationships.find((r) => r.status === "approved");
  const myRelationship = view.myRelationship;
  const assignment = view.assignments.find(
    (a) => !a.endedAt && a.organizationId === ctx?.organizationId,
  );
  const openClaim = view.claims.find((c) => c.status === "pending" || c.status === "manual_review");
  const iAmOwner = activeOwner?.ownerRef === ctx?.organizationId;
  const readOnly = view.accessReason === "dispatch_access" || view.accessReason === "assigned_driver";

  const documentIssues = view.documents.filter(
    (d) => ["expired", "expiring_soon", "rejected"].includes(d.status),
  );

  async function changeStatus(status: TruckOperatingStatus) {
    if (!ctx || busy) return;
    setBusy(true);
    await setTruckStatus(truckId, status, ctx).catch(() => undefined);
    setBusy(false);
    load();
  }

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/fleet/trucks"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All trucks
        </Link>
      </div>

      <PageHeader
        title={`Unit ${myRelationship?.unitNumber ?? visibleCarrier?.unitNumber ?? "—"}`}
        description={`${truck.year} ${truck.make} ${truck.model} · ${EQUIPMENT_LABEL[truck.equipmentType]}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <TruckStatusChip status={truck.status} />
        {readOnly ? (
          <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
            {view.accessReason === "dispatch_access" ? "Dispatch access — read only" : "Your assigned truck"}
          </span>
        ) : null}
        <span className="font-mono text-[0.75rem] break-all text-fg-subtle">
          {revealVin ? truck.vin : maskVin(truck.vin)}
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
            await resolveOwnershipClaim(openClaim.id, decision, ctx, note).catch(() => undefined);
            setBusy(false);
            load();
          }}
        />
      ) : null}

      <div role="tablist" aria-label="Truck sections" className="flex flex-wrap gap-1.5">
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

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Panel title="Identity and status">
            <dl className="divide-y divide-border">
              <Row label="Permanent truck ID" value={truck.truckId} mono />
              <Row label="VIN" value={revealVin ? truck.vin : maskVin(truck.vin)} mono />
              <Row label="Equipment" value={EQUIPMENT_LABEL[truck.equipmentType]} />
              <Row label="Status" value={TRUCK_STATUS_LABEL[truck.status]} />
              <Row
                label="Availability"
                value={[truck.availability.city, truck.availability.state].filter(Boolean).join(", ") || "—"}
              />
              <Row
                label="Expected available"
                value={truck.availability.expectedAvailableAt ? formatDate(truck.availability.expectedAvailableAt) : "—"}
              />
              <Row label="Home terminal" value={truck.availability.homeTerminal ?? "—"} />
            </dl>
            {!readOnly ? (
              <Can permission="trucks:edit">
                <div className="mt-3">
                  <label htmlFor={`${uid}-status`} className="block text-[0.75rem] font-medium text-fg">
                    Change status
                  </label>
                  <select
                    id={`${uid}-status`}
                    value={truck.status}
                    disabled={busy}
                    onChange={(e) => void changeStatus(e.target.value as TruckOperatingStatus)}
                    className="mt-1 h-control w-full max-w-xs rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                  >
                    {(Object.keys(TRUCK_STATUS_LABEL) as TruckOperatingStatus[]).map((s) => (
                      <option key={s} value={s}>{TRUCK_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[0.75rem] text-fg-subtle">Every change is recorded on the timeline.</p>
                </div>
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
                      ? `${view.operatingCarrierName}${operator ? ` · ${RELATIONSHIP_TYPE_LABEL[operator.relationshipType]}` : ""}`
                      : view.lockedByAnotherCarrier
                        ? "Another carrier — not shown"
                        : "None — no active operating lease"
                  }
                />
                <Row label="Your activation state" value={ACTIVATION_STATE_LABEL[view.activationState]} />
                <Row
                  label="Dispatch access"
                  value={view.dispatchAccess.filter((d) => d.status === "active").map((d) => d.dispatchOrganizationName).join(", ") || "None"}
                />
                <Row label="Current driver" value={assignment?.driverName ?? "Unassigned"} />
              </dl>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
                Owning, operating and dispatching are three separate relationships. All three can be
                live at once on this one truck.
              </p>
            </Panel>

            <Panel title="Needs attention">
              {documentIssues.length === 0 ? (
                <p className="text-[0.8125rem] text-fg-muted">Nothing outstanding.</p>
              ) : (
                <ul className="space-y-2">
                  {documentIssues.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[0.8125rem] text-fg">
                        {DOCUMENT_LABEL[d.kind] ?? d.kind}
                      </span>
                      <DocumentStatusChip status={d.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "specs" ? (
        <Panel title={`Specifications — ${EQUIPMENT_LABEL[truck.equipmentType]}`}>
          <dl className="divide-y divide-border">
            {specFieldsFor(truck.equipmentType).map((field) => {
              const raw = (truck.specs as TruckSpecs)[field as keyof TruckSpecs];
              const unit = SPEC_UNIT[field];
              const value = raw === undefined ? "—"
                : isBooleanSpec(field) ? (raw ? "Yes" : "No")
                : field.endsWith("In") ? formatInches(raw as number)
                : formatNumber(raw as number, unit);
              return <Row key={field} label={SPEC_LABEL[field]} value={String(value)} />;
            })}
          </dl>
          <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
            Only the fields a {EQUIPMENT_LABEL[truck.equipmentType].toLowerCase()} can answer are
            shown. A dash means nobody has stated it — not that it is zero.
          </p>
        </Panel>
      ) : null}

      {tab === "documents" ? (
        <Panel title="Documents">
          {view.documents.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">No documents on this truck yet.</p>
          ) : (
            <ul className="space-y-2">
              {view.documents.map((d) => (
                <li key={d.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p className="text-[0.8125rem] font-medium text-fg">{DOCUMENT_LABEL[d.kind] ?? d.kind}</p>
                    <DocumentStatusChip status={d.status} />
                  </div>
                  <p className="mt-0.5 text-[0.75rem] break-all text-fg-subtle">
                    {d.fileName ?? "No file"}
                    {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ""}
                  </p>
                  {d.rejectionReason ? (
                    <p className="mt-1 text-[0.75rem] leading-relaxed text-st-danger">{d.rejectionReason}</p>
                  ) : null}
                  {d.status === "superseded" ? (
                    <p className="mt-1 text-[0.75rem] text-fg-subtle">
                      Replaced by a newer document. Kept for the record.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
            Preview build: no document here was uploaded, stored, read or verified by anyone.
          </p>
        </Panel>
      ) : null}

      {tab === "driver" ? (
        <DriverTab
          truckId={truckId}
          assignments={view.assignments}
          canManage={!readOnly && Boolean(myRelationship && myRelationship.status === "approved")}
          busy={busy}
          onChanged={load}
          setBusy={setBusy}
        />
      ) : null}

      {tab === "authority" ? (
        <OperatingAuthorityTab
          view={view}
          busy={busy}
          readOnly={readOnly}
          onChanged={load}
          setBusy={setBusy}
        />
      ) : null}

      {tab === "relationships" ? (
        <div className="space-y-4">
          <Panel title="Operating carriers">
            <ul className="space-y-2">
              {view.relationships.map((r) => (
                <li key={r.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                    {r.organizationName}
                    <CarrierStatusChip status={r.status} />
                    <span className="text-[0.75rem] font-normal text-fg-muted">
                      {RELATIONSHIP_TYPE_LABEL[r.relationshipType]} · unit {r.unitNumber}
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
          </Panel>

          {view.dispatchAccess.length > 0 ? (
            <Panel title="Dispatch access">
              <ul className="space-y-2">
                {view.dispatchAccess.map((d) => (
                  <li key={d.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                    <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                      {d.dispatchOrganizationName}
                      <RelationshipStatusChip status={d.status} />
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                      Granted by {d.grantedByCarrierName} · started {formatDate(d.startedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
                A dispatch organization books freight on this truck. It neither owns it nor runs it
                on its own authority.
              </p>
            </Panel>
          ) : null}

          {myRelationship?.status === "approved" && !readOnly ? (
            <Can permission="trucks:relationships:manage">
              <EndRelationship
                organizationName={myRelationship.organizationName}
                busy={busy}
                onEnd={async (reason) => {
                  if (!ctx) return;
                  setBusy(true);
                  await endCarrierRelationship(myRelationship.id, reason, ctx).catch(() => undefined);
                  setBusy(false);
                  load();
                }}
              />
            </Can>
          ) : null}
        </div>
      ) : null}

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
              An ownership change ends one record and opens another. The truck, its id, its VIN, its
              documents and every other history stay exactly as they were.
            </p>
          </Panel>

          {view.claims.length > 0 ? (
            <Panel title="Ownership claims">
              <ul className="space-y-2">
                {view.claims.map((c) => (
                  <li key={c.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                    <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                      {c.claimantName}
                      <ClaimStatusChip status={c.status} />
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

function ClaimReview({
  claim, busy, onDecide,
}: {
  claim: { id: string; claimantName: string; claimedOwnerName: string; note?: string; status: string };
  busy: boolean;
  onDecide: (decision: ClaimDecision, note?: string) => void;
}) {
  const uid = useId();
  const [note, setNote] = useState("");
  return (
    <div role="alert" className="rounded-lg border border-st-warning/40 bg-st-warning-bg/60 p-4">
      <p className="flex items-center gap-2 text-[0.875rem] font-medium text-fg">
        <Gavel className="size-4 shrink-0 text-st-warning" aria-hidden />
        {claim.claimantName} claims to own this truck
      </p>
      {claim.note ? <p className="mt-1 text-[0.8125rem] text-fg-muted">“{claim.note}”</p> : null}
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
        If you accept, your ownership record is closed with today&apos;s date and{" "}
        {claim.claimedOwnerName} becomes the recorded owner. The truck keeps its permanent id, VIN,
        specifications, documents, carrier relationships, driver assignments and full history —
        only the ownership records change.
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
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        <Link2Off aria-hidden />
        Stop operating this truck
      </Button>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-st-warning/40 bg-st-warning-bg/60 p-4">
      <p className="text-[0.875rem] font-medium text-fg">
        End {organizationName}&apos;s operating relationship with this truck?
      </p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        It leaves your fleet and your driver&apos;s assignment ends. The truck itself, its owner,
        its documents and its history are not deleted, and the driver keeps their permanent profile.
      </p>
      <div className="mt-3 max-w-md">
        <Field label="Reason" htmlFor={`${uid}-reason`} error={error ?? undefined}>
          <Textarea id={`${uid}-reason`} rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="danger" size="sm" disabled={busy}
          onClick={() => {
            if (reason.trim().length < 3) { setError("Give a short reason. It is kept on the record."); return; }
            onEnd(reason);
          }}
        >
          End relationship
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Operating authority: who is allowed to run this truck, and who is running it.
 *
 * The two are deliberately kept apart on this screen. Several carriers can be
 * approved at once; exactly one can hold the truck. When somebody else holds
 * it, this tab says so and says nothing else — no carrier name, no load, no
 * dates, no driver.
 */
function OperatingAuthorityTab({
  view, busy, readOnly, onChanged, setBusy,
}: {
  view: TruckProfileView;
  busy: boolean;
  readOnly: boolean;
  onChanged: () => void;
  setBusy: (v: boolean) => void;
}) {
  const ctx = useTruckContext();
  const uid = useId();
  const [loadReference, setLoadReference] = useState("");
  const [expectedEnd, setExpectedEnd] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = view.activationState;
  const lease = view.myLease;
  // Controls stay on the page while a request is in flight and are disabled
  // instead of removed — a checklist that vanishes mid-click is disorienting,
  // and it makes it impossible to see what you just pressed.
  const canAct = !readOnly;
  const history = view.leases.filter((l) => l.status === "ended");

  async function activate(reserveOnly: boolean) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const outcome = await activateOperatingLease(view.truck.truckId, ctx, {
      loadReference: loadReference.trim() || undefined,
      expectedEndAt: expectedEnd ? new Date(expectedEnd).toISOString() : undefined,
      reserveOnly,
    }).catch(() => null);
    setBusy(false);
    if (!outcome) {
      setError("Something went wrong. Nothing was changed.");
    } else if (outcome.status === "locked_by_other") {
      setError(
        "This truck is already under another carrier's active operating lease, so your activation was refused. Nothing was reserved and nothing was changed.",
      );
    } else if (outcome.status === "not_approved") {
      setError("Your organization is not approved to operate this truck yet.");
    } else if (outcome.status === "unauthorized") {
      setError("You do not have permission to activate operating authority.");
    } else if (outcome.status === "reserved") {
      setMessage("Activation reserved. No other carrier can take this truck while your reservation stands.");
    } else {
      setMessage("You now hold exclusive operating authority for this truck.");
    }
    onChanged();
  }

  async function step(which: TerminationStep) {
    if (!ctx || !lease) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    await recordTerminationStep(lease.id, which, ctx).catch(() => setError("That step could not be recorded."));
    setBusy(false);
    onChanged();
  }

  async function release() {
    if (!ctx || !lease) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const outcome = await releaseOperatingLease(lease.id, ctx).catch(() => null);
    setBusy(false);
    if (!outcome) {
      setError("Something went wrong. Nothing was changed.");
    } else if (outcome.status === "blocked") {
      setError(
        `The truck cannot be released yet. Still outstanding: ${outcome.outstanding
          .map((o) => TERMINATION_STEP_LABEL[o].toLowerCase()).join("; ")}.`,
      );
    } else if (outcome.status === "unauthorized") {
      setError("You do not have permission to end this operating lease.");
    } else {
      setMessage(
        "The lease has ended and is kept as history. The truck is available again to every approved carrier, with the same ID, VIN, documents and relationships.",
      );
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <Panel title="Your position on this truck">
        <p className="flex flex-wrap items-center gap-2">
          <ActivationStateChip state={state} />
          {view.myRelationship ? <CarrierStatusChip status={view.myRelationship.status} /> : null}
        </p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
          {ACTIVATION_STATE_DESCRIPTION[state]}
        </p>
        {view.myRelationship ? (
          <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
            {CARRIER_STATUS_DESCRIPTION[view.myRelationship.status]}
          </p>
        ) : null}
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          Being approved and operating are two different things. Approval stays yours whatever
          happens here; it is the lease that decides who runs the truck.
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
            Your onboarding, insurance, lease paperwork, permissions and history with this truck are
            untouched and stay exactly as they are. You do not need to onboard again.
          </p>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
            Who holds it, what they are hauling and when they expect to finish are not shown here.
          </p>
        </Panel>
      ) : null}

      {state === "pending_approval" || state === "onboarding" ? (
        <Panel title="Onboarding review">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Activation stays closed until this onboarding is approved. Approval makes you eligible;
            it does not give you the truck.
          </p>
          {canAct && view.myRelationship ? (
            <Can permission="trucks:relationships:manage">
              <Button
                className="mt-3" variant="secondary" size="sm" disabled={busy}
                onClick={async () => {
                  if (!ctx || !view.myRelationship) return;
                  setBusy(true);
                  setError(null);
                  setMessage(null);
                  await approveCarrierRelationship(view.myRelationship.id, ctx)
                    .catch(() => setError("That could not be approved."));
                  setBusy(false);
                  onChanged();
                }}
              >
                Record onboarding as approved
              </Button>
            </Can>
          ) : null}
        </Panel>
      ) : null}

      {state === "available_for_activation" && canAct ? (
        <Can permission="trucks:relationships:manage">
          <Panel title="Take operating authority">
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              This creates a time-bound operating lease. While it is live you are the only carrier
              that can run this truck, and every other approved carrier sees it as temporarily
              unavailable.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Your load reference"
                htmlFor={`${uid}-ref`}
                hint="Optional, and only ever visible to your organization."
              >
                <Input
                  id={`${uid}-ref`}
                  value={loadReference}
                  onChange={(e) => setLoadReference(e.target.value)}
                  placeholder="e.g. NL-2291"
                />
              </Field>
              <Field
                label="Expected end"
                htmlFor={`${uid}-end`}
                hint="A plan, not a trigger. Reaching it does not release the truck."
              >
                <Input
                  id={`${uid}-end`}
                  type="datetime-local"
                  value={expectedEnd}
                  onChange={(e) => setExpectedEnd(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void activate(false)}>
                <LockKeyhole aria-hidden />
                Activate operating authority
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void activate(true)}>
                Reserve activation only
              </Button>
            </div>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
              A reservation locks the truck too. If another carrier activates first, your request is
              refused and nothing is created.
            </p>
          </Panel>
        </Can>
      ) : null}

      {lease && lease.status !== "ended" ? (
        <Panel title={lease.status === "reserved" ? "Your reservation" : "Your operating lease"}>
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {lease.organizationName}
            <LeaseStatusChip status={lease.status} />
          </p>
          <dl className="mt-2 divide-y divide-border">
            <Row label="Reserved" value={lease.reservedAt ? formatDate(lease.reservedAt) : "—"} />
            <Row label="Activated" value={lease.activatedAt ? formatDate(lease.activatedAt) : "Not yet"} />
            <Row label="Expected end" value={lease.expectedEndAt ? formatDate(lease.expectedEndAt) : "Not set"} />
            <Row label="Your load reference" value={lease.loadReference ?? "None recorded"} />
          </dl>

          {lease.status === "reserved" && canAct ? (
            <Can permission="trucks:relationships:manage">
              <Button className="mt-3" variant="primary" size="sm" disabled={busy} onClick={() => void activate(false)}>
                Confirm activation
              </Button>
            </Can>
          ) : null}

          {lease.status !== "reserved" ? (
            <div className="mt-4">
              <h4 className="text-[0.8125rem] font-semibold text-fg">Before the truck can be released</h4>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                All four have to be on the record. The expected end time passing is not one of them
                and never releases the truck on its own.
              </p>
              <ul className="mt-3 space-y-2">
                {TERMINATION_STEPS.map((which) => {
                  const done = terminationStepAt(lease, which);
                  return (
                    <li
                      key={which}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5"
                    >
                      <span className="flex min-w-0 items-start gap-2 text-[0.8125rem] text-fg">
                        {done ? (
                          <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-success" aria-hidden />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                        )}
                        <span className="min-w-0">
                          {TERMINATION_STEP_LABEL[which]}
                          {done ? (
                            <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">
                              Recorded {formatDate(done)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {!done && canAct ? (
                        <Can permission="trucks:relationships:manage">
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
                <Can permission="trucks:relationships:manage">
                  <div className="mt-3">
                    <Button
                      variant="primary" size="sm"
                      disabled={busy || !terminationComplete(lease.termination)}
                      onClick={() => void release()}
                    >
                      <LockKeyholeOpen aria-hidden />
                      End the lease and release the truck
                    </Button>
                    {!terminationComplete(lease.termination) ? (
                      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                        Still outstanding:{" "}
                        {outstandingTerminationSteps(lease.termination)
                          .map((o) => TERMINATION_STEP_LABEL[o].toLowerCase()).join("; ")}.
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
          <p className="text-[0.8125rem] text-fg-muted">No lease has been completed on this truck yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((l) => (
              <li key={l.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {l.organizationName}
                  <LeaseStatusChip status={l.status} />
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
          Ended leases are kept for good. Releasing a truck removes the lock and nothing else.
        </p>
      </Panel>
    </div>
  );
}

const TERMINATION_FIELD: Record<TerminationStep, keyof TruckOperatingLease["termination"]> = {
  unloaded: "unloadedAt",
  trip_requirements: "tripRequirementsCompletedAt",
  delivery_confirmation: "deliveryConfirmationRecordedAt",
  exclusive_control: "exclusiveControlEndedAt",
};

function terminationStepAt(lease: TruckOperatingLease, step: TerminationStep): string | undefined {
  return lease.termination[TERMINATION_FIELD[step]];
}

function DriverTab({
  truckId, assignments, canManage, busy, onChanged, setBusy,
}: {
  truckId: string;
  assignments: TruckProfileView["assignments"];
  canManage: boolean;
  busy: boolean;
  onChanged: () => void;
  setBusy: (v: boolean) => void;
}) {
  const ctx = useTruckContext();
  const uid = useId();
  const [eligible, setEligible] = useState<Array<{ id: string; name: string }>>([]);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mockListCarrierDrivers().then((rows) => {
      if (cancelled) return;
      // Only this carrier's own drivers are ever offered.
      setEligible(
        rows.filter((r) => r.status !== "ended")
          .map((r) => ({ id: r.driverProfileId, name: r.name })),
      );
    });
    return () => { cancelled = true; };
  }, []);

  const current = assignments.find((a) => !a.endedAt && a.organizationId === ctx?.organizationId);
  const history = assignments.filter((a) => a.endedAt);

  return (
    <div className="space-y-4">
      <Panel title="Current driver">
        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold text-fg">{current.driverName}</p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                Assigned {formatDate(current.startedAt)}
              </p>
            </div>
            {canManage ? (
              <Can permission="trucks:assignments:manage">
                <Button
                  variant="secondary" size="sm" disabled={busy}
                  onClick={async () => {
                    if (!ctx) return;
                    setBusy(true);
                    await endDriverAssignment(current.id, "Ended from the truck profile.", ctx).catch(() => undefined);
                    setBusy(false);
                    onChanged();
                  }}
                >
                  <UserMinus aria-hidden />
                  End assignment
                </Button>
              </Can>
            ) : null}
          </div>
        ) : (
          <p className="text-[0.8125rem] text-fg-muted">
            No driver is assigned to this truck right now.
          </p>
        )}
      </Panel>

      {canManage ? (
        <Can permission="trucks:assignments:manage">
          <Panel title={current ? "Replace the driver" : "Assign a driver"}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <Field label="Driver" htmlFor={`${uid}-driver`} hint="Only drivers in your own organization." error={error ?? undefined}>
                  <select
                    id={`${uid}-driver`}
                    value={choice}
                    onChange={(e) => { setChoice(e.target.value); setError(null); }}
                    className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                  >
                    <option value="">Choose a driver…</option>
                    {eligible.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              </div>
              <Button
                variant="primary" disabled={busy}
                onClick={async () => {
                  if (!ctx) return;
                  const driver = eligible.find((d) => d.id === choice);
                  if (!driver) { setError("Choose a driver first."); return; }
                  setBusy(true);
                  await assignDriver(
                    truckId,
                    { driverProfileId: driver.id, driverName: driver.name },
                    eligible.map((d) => d.id),
                    ctx,
                  ).catch(() => setError("That assignment was refused."));
                  setBusy(false);
                  setChoice("");
                  onChanged();
                }}
              >
                <UserPlus aria-hidden />
                {current ? "Replace" : "Assign"}
              </Button>
            </div>
          </Panel>
        </Can>
      ) : null}

      <Panel title="Assignment history">
        {history.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">No previous assignments.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((a) => (
              <li key={a.id} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="text-[0.8125rem] font-medium text-fg">{a.driverName}</p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {formatDate(a.startedAt)} – {a.endedAt ? formatDate(a.endedAt) : "now"}
                  {a.endReason ? ` · ${a.endReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex items-start gap-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Ending an assignment never touches the driver&apos;s permanent profile.
        </p>
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="mb-3 text-[0.9375rem] font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className={cn("min-w-0 text-[0.8125rem] font-medium break-all text-fg", mono && "font-mono text-[0.75rem]")}>
        {value}
      </dd>
    </div>
  );
}

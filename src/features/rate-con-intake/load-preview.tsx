"use client";

import { AlertTriangle, CircleCheck, PackagePlus } from "lucide-react";
import { Can } from "@/components/auth/can";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { stopLabel } from "@/lib/rate-con/fields";
import type { LoadDraft, LoadDraftStop, LoadDraftView } from "@/types/rate-con-intake";
import type { PermissionKey } from "@/types";
import { useApproveRateCon, useIntentKey, useLoadDraft } from "./hooks";

function equipment(value: string | null): string | null {
  if (!value) return null;
  const key = value.toLowerCase();
  return EQUIPMENT_LABEL[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function money(value: string | null): string | null {
  if (!value) return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : value;
}

/** Local date and window of a stop, in the stop's own time zone. */
function when(stop: LoadDraftStop): string {
  const zone = stop.timezone ?? undefined;
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).format(new Date(iso));
  const parts = [stop.scheduledDate ?? "No date"];
  if (stop.windowStart) {
    parts.push(stop.windowEnd ? `${time(stop.windowStart)} – ${time(stop.windowEnd)}` : time(stop.windowStart));
  }
  return parts.join(" · ");
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="truncate text-[0.875rem] text-fg">
        {value ?? <span className="italic text-fg-subtle">Missing</span>}
      </dd>
    </div>
  );
}

function DraftFacts({ draft }: { draft: LoadDraft }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Broker" value={draft.brokerName} />
        <Fact label="Broker MC" value={draft.brokerMcNumber} />
        <Fact label="Load number" value={draft.brokerLoadNumber} />
        <Fact label="Equipment" value={equipment(draft.equipmentType)} />
        <Fact label="Weight" value={draft.weightLbs ? `${draft.weightLbs.toLocaleString("en-US")} lbs` : null} />
        <Fact label="Rate" value={money(draft.rateTotal)} />
      </dl>
      <ol className="space-y-2">
        {draft.stops.map((stop, i) => (
          <li key={i} className="rounded-md border border-border px-3 py-2">
            <p className="text-[0.75rem] font-medium text-fg-muted">
              {i + 1}. {stop.type === "pickup" ? "Pickup" : "Delivery"}
              {stop.facilityName ? ` · ${stop.facilityName}` : ""}
            </p>
            <p className="text-[0.875rem] text-fg">
              {[stop.addressLine1, stop.city, stop.state, stop.postalCode].filter(Boolean).join(", ") ||
                "No address"}
            </p>
            <p className="text-[0.75rem] text-fg-subtle">{when(stop)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What approval will write, and Approve (plan 13; contract §9–§10). Shown once
 * the review is complete; read-only after approval.
 */
export function LoadPreview({
  documentId,
  onFix,
}: {
  documentId: string;
  onFix: (path: string) => void;
}) {
  const draft = useLoadDraft(documentId, true);
  const approve = useApproveRateCon(documentId);
  const approveKey = useIntentKey();

  if (draft.isPending) return <LoadingSkeleton rows={2} />;
  if (draft.isError) {
    return (
      <ErrorState
        title="Could not build the load preview"
        description={draft.error.message}
        onRetry={() => void draft.refetch()}
      />
    );
  }

  const view: LoadDraftView = draft.data;
  const required = view.missing.filter((m) => m.required);
  const optional = view.missing.filter((m) => !m.required);
  const needs: PermissionKey[] =
    view.action === "update" ? ["loads:create", "loads:edit"] : ["loads:create"];
  const blockedReason = required.length
    ? "Fix the missing values first."
    : view.problems.length
      ? "Fix the problems first."
      : null;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>The load</CardTitle>
          <CardDescription>
            {view.action === "update"
              ? "A load with this broker MC and load number exists. Approving updates it."
              : "Approving creates this load from the values you checked."}
          </CardDescription>
        </div>
        <Badge tone={view.action === "update" ? "warning" : "info"}>
          {view.action === "update" ? "Updates a load" : "New load"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.draft ? <DraftFacts draft={view.draft} /> : null}

        {required.length || view.problems.length ? (
          <div role="alert" className="space-y-2 rounded-md bg-st-danger-bg px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-st-danger">
              <AlertTriangle className="size-4" aria-hidden />
              Needed before approving
            </p>
            <ul className="space-y-1.5 text-[0.8125rem] text-fg">
              {required.map((m) => (
                <li key={m.field} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{stopLabel(m.field)}</span>
                  {m.paths[0] ? (
                    <Button size="sm" variant="link" onClick={() => onFix(m.paths[0])}>
                      Fix in the review
                    </Button>
                  ) : (
                    <span className="text-[0.75rem] text-fg-muted">
                      Not on this Rate Con: create the load by hand.
                    </span>
                  )}
                </li>
              ))}
              {view.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {view.warnings.length || optional.length ? (
          <ul className="space-y-1 text-[0.8125rem] text-fg-muted">
            {view.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
            {optional.map((m) => (
              <li key={m.field}>• {stopLabel(m.field)} is not on the Rate Con (optional).</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <Can
            permissions={needs}
            fallback={
              <p className="text-[0.8125rem] text-fg-muted">
                Approving needs permission to {view.action === "update" ? "create and edit" : "create"} loads.
              </p>
            }
          >
            <Button
              variant="primary"
              disabled={!view.canApprove || approve.isPending}
              onClick={() =>
                approve.mutate(
                  { idempotencyKey: approveKey.keyFor("approve") },
                  { onSuccess: () => approveKey.clear() },
                )
              }
            >
              <PackagePlus aria-hidden />
              {approve.isPending ? "Approving…" : view.action === "update" ? "Approve and update load" : "Approve and create load"}
            </Button>
          </Can>
          {blockedReason ? <p className="text-[0.75rem] text-fg-subtle">{blockedReason}</p> : null}
        </div>
        {approve.error ? (
          <p role="alert" className="text-[0.8125rem] text-st-danger">
            {approve.error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * After approval: the load it went into. No link yet: the loads screens still
 * read demo data until they move to the real API (F1.2).
 */
export function ApprovedBanner({ loadId }: { loadId: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-st-success/30 bg-st-success-bg px-4 py-3">
      <p className="flex items-center gap-2 text-[0.875rem] font-medium text-st-success">
        <CircleCheck className="size-4" aria-hidden />
        Approved into a load
      </p>
      {loadId ? (
        <p className="text-[0.75rem] text-fg-muted">
          Load <span className="font-mono">{loadId.slice(0, 8)}</span>
        </p>
      ) : null}
    </div>
  );
}

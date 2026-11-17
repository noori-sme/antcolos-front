"use client";

import { useState } from "react";
import { AlertTriangle, BadgeCheck, History, Plus } from "lucide-react";
import { Can } from "@/components/auth/can";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "@/components/data/states";
import { Button } from "@/components/ui/button";
import {
  CREDENTIAL_STATUS_LABELS,
  credentialTitle,
  credentialTone,
  expiresSoon,
  type CredentialTone,
} from "@/lib/driver-credentials/status";
import { cn } from "@/lib/utils";
import type {
  CredentialStatus,
  DriverCredential,
} from "@/types/driver-credential";
import {
  AddCredentialDialog,
  ChangeStatusDialog,
  EditCredentialDialog,
} from "./driver-credential-dialogs";
import { useCredentialHistory, useDriverCredentials } from "./hooks";

const TONE: Record<CredentialTone, string> = {
  success: "bg-st-success-bg text-st-success border-st-success/20",
  info: "bg-st-info-bg text-st-info border-st-info/20",
  warning: "bg-st-warning-bg text-st-warning border-st-warning/20",
  danger: "bg-st-danger-bg text-st-danger border-st-danger/20",
  neutral: "bg-surface-sunken text-fg-muted border-border",
};

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

const HISTORY_LABELS: Record<string, string> = {
  "driver_credential.created": "Recorded",
  "driver_credential.updated": "Edited",
  "driver_credential.status_changed": "Status changed",
  "driver_credential.expiring": "Expiry reminder",
};

function StatusPill({ status }: { status: CredentialStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.75rem] font-medium",
        TONE[credentialTone(status)],
      )}
    >
      {CREDENTIAL_STATUS_LABELS[status]}
    </span>
  );
}

function CredentialHistory({ credentialId }: { credentialId: string }) {
  const { data, isPending, isError, refetch } = useCredentialHistory(
    credentialId,
    true,
  );
  if (isPending)
    return (
      <p className="py-2 text-[0.75rem] text-fg-subtle">Loading history…</p>
    );
  if (isError) {
    return (
      <p className="flex items-center gap-2 py-2 text-[0.75rem] text-st-danger">
        History could not be loaded.
        <Button size="sm" variant="link" onClick={() => void refetch()}>
          Try again
        </Button>
      </p>
    );
  }
  if (data.data.length === 0) {
    return (
      <p className="py-2 text-[0.75rem] text-fg-subtle">No history yet.</p>
    );
  }
  const more = data.meta.totalItems - data.data.length;
  return (
    <>
      <ol className="space-y-1.5 border-l border-border py-2 pl-3">
        {data.data.map((entry) => {
          const d = entry.details as {
            from?: string;
            to?: string;
            reason?: string | null;
            changedFields?: string[];
          };
          return (
            <li key={entry.id} className="text-[0.75rem] text-fg-muted">
              <span className="font-medium text-fg">
                {HISTORY_LABELS[entry.type] ?? entry.type}
              </span>
              {d.from && d.to
                ? ` ${statusLabel(d.from)} → ${statusLabel(d.to)}`
                : ""}
              {d.changedFields?.length
                ? ` (${d.changedFields.join(", ")})`
                : ""}
              {d.reason ? ` — ${d.reason}` : ""}
              <span className="text-fg-subtle">
                {" "}
                · {day(entry.occurredAt)}
                {entry.source === "system" ? " · automatic" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {more > 0 ? (
        <p className="text-[0.75rem] text-fg-subtle">
          {more} earlier change(s) not shown.
        </p>
      ) : null}
    </>
  );
}

const statusLabel = (value: string) =>
  CREDENTIAL_STATUS_LABELS[value as CredentialStatus] ?? value;

function CredentialRow({ credential }: { credential: DriverCredential }) {
  const [dialog, setDialog] = useState<"edit" | "status" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const soon = expiresSoon(credential);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-medium text-fg">
            {credentialTitle(credential)}
          </p>
          <p className="text-[0.75rem] text-fg-subtle">
            Issued {day(credential.issuedAt)} · Expires{" "}
            {day(credential.expiresAt)}
          </p>
          {soon ? (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[0.75rem] font-medium text-st-warning">
              <AlertTriangle className="size-3" aria-hidden /> Expires within 30
              days
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={credential.status} />
          <Can permission="credentials:edit">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDialog("status")}
            >
              Change status
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog("edit")}>
              Edit
            </Button>
          </Can>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            <History aria-hidden /> History
          </Button>
        </div>
      </div>
      {showHistory ? <CredentialHistory credentialId={credential.id} /> : null}
      {dialog === "edit" ? (
        <EditCredentialDialog
          credential={credential}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
      {dialog === "status" ? (
        <ChangeStatusDialog
          credential={credential}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
    </li>
  );
}

/** Credentials on a driver's profile (F2.4, plan 20). Rendered behind `credentials:view`. */
export function DriverCredentialsPanel({
  userId,
  driverName,
}: {
  userId: string;
  driverName: string;
}) {
  const { data, isPending, isError, refetch } = useDriverCredentials(userId);
  const [adding, setAdding] = useState(false);

  return (
    <section
      className="rounded-lg border border-border bg-surface p-5 shadow-e1"
      aria-labelledby="driver-credentials-title"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <BadgeCheck className="size-4 text-primary" aria-hidden />
          <h2
            id="driver-credentials-title"
            className="text-[0.9375rem] font-semibold text-fg"
          >
            Credentials
          </h2>
        </div>
        <Can permission="credentials:create">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add credential
          </Button>
        </Can>
      </div>
      {isPending ? (
        <div className="pt-3">
          <LoadingSkeleton rows={3} />
        </div>
      ) : isError ? (
        <div className="pt-3">
          <ErrorState
            title="Credentials could not be loaded"
            onRetry={() => void refetch()}
          />
        </div>
      ) : data.data.length === 0 ? (
        <EmptyState
          className="mt-3"
          icon={BadgeCheck}
          title="No credentials on record"
          description="Add the driver's CDL, medical card and any endorsements to see what expires and when."
        />
      ) : (
        <ul className="divide-y divide-border">
          {data.data.map((credential) => (
            <CredentialRow key={credential.id} credential={credential} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddCredentialDialog
          userId={userId}
          driverName={driverName}
          open
          onOpenChange={(o) => !o && setAdding(false)}
        />
      ) : null}
    </section>
  );
}

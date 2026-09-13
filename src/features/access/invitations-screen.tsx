"use client";

import {
  Ban, Check, ChevronRight, Copy, Inbox, Plus, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { useActiveMembership } from "@/lib/session/hooks";
import type { Invitation, InvitationStatus } from "@/types";
import { PermissionSummary } from "./permission-summary";
import {
  invitationLink,
  mockListInvitations,
  mockResendInvitation,
  mockRevokeInvitation,
} from "./mock-access";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<InvitationStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-st-info-bg text-st-info" },
  accepted: { label: "Accepted", className: "bg-st-success-bg text-st-success" },
  expired: { label: "Expired", className: "bg-st-neutral-bg text-st-neutral" },
  revoked: { label: "Revoked", className: "bg-st-danger-bg text-st-danger" },
};

const FILTERS: Array<{ value: InvitationStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

/** Who has been invited, where it got to, and what to do about it. */
export function InvitationsScreen() {
  const { organization } = useActiveMembership();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [filter, setFilter] = useState<InvitationStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    mockListInvitations(organization.id).then((list) => {
      if (!cancelled) setInvitations(list);
    });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  async function act(id: string, action: "revoke" | "resend") {
    setBusyId(id);
    const updated =
      action === "revoke" ? await mockRevokeInvitation(id) : await mockResendInvitation(id);
    setInvitations((prev) => prev?.map((i) => (i.id === updated.id ? updated : i)) ?? null);
    setBusyId(null);
  }

  async function copy(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(invitationLink(invitation.token));
      setCopiedId(invitation.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setCopiedId(null);
    }
  }

  const visible = (invitations ?? []).filter((i) => filter === "all" || i.status === filter);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Invitations"
        description="Everyone you have invited to work with your organization, and where each invitation got to."
        actions={
          <Button variant="primary" asChild>
            <Link href="/settings/invitations/new">
              <Plus aria-hidden />
              Invite
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => {
          const count =
            f.value === "all"
              ? invitations?.length ?? 0
              : invitations?.filter((i) => i.status === f.value).length ?? 0;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                filter === f.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {invitations === null ? <LoadingSkeleton rows={4} /> : null}

      {invitations !== null && visible.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "all" ? "No invitations yet" : `No ${filter} invitations`}
          description={
            filter === "all"
              ? "When you invite a driver, an employee or a dispatch organization, it will appear here until they accept."
              : "Try another filter to see the rest."
          }
          action={
            filter === "all" ? (
              <Button variant="primary" asChild>
                <Link href="/settings/invitations/new">Send the first invitation</Link>
              </Button>
            ) : null
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((invitation) => {
            const style = STATUS_STYLE[invitation.status];
            const open = expanded === invitation.id;
            const busy = busyId === invitation.id;
            const panelId = `inv-perms-${invitation.id}`;
            const canRevoke = invitation.status === "pending";
            const canResend = invitation.status === "pending" || invitation.status === "expired";
            const canCopy = invitation.status === "pending";

            return (
              <li
                key={invitation.id}
                className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.9375rem] font-semibold text-fg">
                        {invitation.recipientName}
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                          style.className,
                        )}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                      {invitation.recipientEmail}
                    </p>
                    <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
                      {invitation.roleName}
                      {invitation.scopedToCarrierName
                        ? ` · scoped to ${invitation.scopedToCarrierName} only`
                        : ""}
                      {" · "}
                      {invitation.expiresAt
                        ? `expires ${formatDate(invitation.expiresAt)}`
                        : "no expiry"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {canCopy ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copy(invitation)}
                        aria-label={`Copy invitation link for ${invitation.recipientName}`}
                      >
                        {copiedId === invitation.id ? <Check aria-hidden /> : <Copy aria-hidden />}
                        {copiedId === invitation.id ? "Copied" : "Copy link"}
                      </Button>
                    ) : null}
                    {canResend ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => act(invitation.id, "resend")}
                        aria-label={`Resend invitation to ${invitation.recipientName}`}
                      >
                        <RefreshCw aria-hidden />
                        Resend
                      </Button>
                    ) : null}
                    {canRevoke ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => act(invitation.id, "revoke")}
                        aria-label={`Revoke invitation for ${invitation.recipientName}`}
                      >
                        <Ban aria-hidden />
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-border">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setExpanded(open ? null : invitation.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2.5 text-left text-[0.75rem] font-medium text-fg-muted transition-colors",
                      "hover:bg-surface-hover hover:text-fg",
                      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    )}
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn("size-3.5 transition-transform", open && "rotate-90")}
                    />
                    {open ? "Hide" : "View"} assigned permissions
                    <span className="tabular-nums opacity-70">
                      ({invitation.permissions.length})
                    </span>
                  </button>
                  {open ? (
                    <div id={panelId} className="px-4 pb-4">
                      <PermissionSummary permissions={invitation.permissions} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

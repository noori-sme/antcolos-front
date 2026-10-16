"use client";

import {
  Ban, ChevronRight, Inbox, Info, Loader2, Mail, Plus, RefreshCw,
} from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { InvitationRequests, type InvitationRequest } from "./invitation-requests";
import { EmptyState } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";
import type { Invitation, InvitationStatus } from "@/types";
import { PermissionSummary } from "./permission-summary";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Can } from "@/components/auth/can";

type Tab = "invitations" | "requests";

function TabButton({
  id,
  current,
  onSelect,
  icon: Icon,
  label,
  count,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  icon?: any;
  label: string;
  count?: number;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[0.875rem] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-primary text-fg"
          : "border-transparent text-fg-muted hover:text-fg",
      )}
    >
      {Icon && <Icon className="size-4" aria-hidden />}
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-1 rounded-full px-2 py-0.5 text-[0.75rem] tabular-nums",
            selected
              ? "bg-primary/10 text-primary font-semibold"
              : "bg-surface-elevated text-fg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-st-info-bg text-st-info" },
  accepted: { label: "Accepted", className: "bg-st-success-bg text-st-success" },
  expired: { label: "Expired", className: "bg-st-neutral-bg text-st-neutral" },
  revoked: { label: "Revoked", className: "bg-st-danger-bg text-st-danger" },
  declined: { label: "Declined", className: "bg-st-warning-bg text-st-warning" },
  canceled: { label: "Canceled", className: "bg-st-danger-bg text-st-danger" },
  cancelled: { label: "Cancelled", className: "bg-st-danger-bg text-st-danger" },
};

function getStatusStyle(rawStatus?: string): { label: string; className: string } {
  const normalized = (rawStatus || "").toLowerCase();
  if (STATUS_STYLE[normalized]) {
    return STATUS_STYLE[normalized];
  }
  return {
    label: rawStatus
      ? rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase()
      : "Pending",
    className: "bg-st-neutral-bg text-st-neutral",
  };
}

const FILTERS: Array<{ value: InvitationStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
  { value: "declined", label: "Declined" },
];

function formatDate(iso?: string | null): string {
  if (!iso) return "no expiry";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "no expiry";
    return d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return "no expiry";
  }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return "";
  }
}

function RevokedStatusBadge({
  label = "Revoked",
  className,
  updatedAt,
}: {
  label?: string;
  className?: string;
  updatedAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const formattedDate = formatDateTime(updatedAt);

  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-[0.6875rem] font-medium select-none",
            className,
          )}
        >
          <span>{label}</span>
          <TooltipPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label="Revocation details"
              className={cn(
                "inline-flex size-3.5 items-center justify-center rounded-full text-st-danger/80 transition-colors",
                "hover:text-st-danger hover:bg-st-danger/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-danger cursor-help",
              )}
            >
              <Info className="size-3" aria-hidden />
            </button>
          </TooltipPrimitive.Trigger>
        </span>

        <AnimatePresence>
          {open ? (
            <TooltipPrimitive.Portal forceMount>
              <TooltipPrimitive.Content
                forceMount
                side="top"
                align="center"
                sideOffset={8}
                className="z-50 outline-none"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.15, y: 14, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                  exit={{
                    opacity: 0,
                    scale: 0.2,
                    y: 10,
                    filter: "blur(2px)",
                    transition: { duration: 0.15, ease: [0.32, 0, 0.67, 0] },
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 420,
                    damping: 24,
                    mass: 0.6,
                  }}
                  style={{
                    transformOrigin:
                      "var(--radix-tooltip-content-transform-origin, var(--radix-popper-transform-origin, center bottom))",
                  }}
                  className={cn(
                    "relative max-w-[22rem] rounded-lg border border-border bg-surface p-3 text-[0.75rem] leading-relaxed text-fg shadow-lg dark:border-border-strong",
                    "select-none",
                  )}
                >
                  <div className="space-y-1">
                    <p className="font-semibold text-fg text-[0.78125rem]">
                      Invitation Revoked
                    </p>
                    <p className="text-fg-muted font-normal text-[0.75rem]">
                      This invitation has been revoked and can no longer be used to join the organization. The invite link has been invalidated.
                    </p>
                    {formattedDate ? (
                      <p className="pt-1 text-[0.6875rem] text-fg-subtle border-t border-border/50">
                        Revoked on {formattedDate}
                      </p>
                    ) : null}
                  </div>
                  {/* Downward arrow caret pointing directly to the info icon */}
                  <div
                    aria-hidden="true"
                    className="absolute -bottom-[6.5px] left-1/2 -translate-x-1/2 pointer-events-none overflow-visible"
                  >
                    <svg
                      width="14"
                      height="7"
                      viewBox="0 0 14 7"
                      className="block overflow-visible"
                    >
                      <path
                        d="M0 0 L7 7 L14 0 Z"
                        className="fill-surface stroke-border stroke-[1]"
                      />
                      {/* Surface bridge line to open the top of the arrow and merge seamlessly into the card */}
                      <line
                        x1="1"
                        y1="0"
                        x2="13"
                        y2="0"
                        className="stroke-surface stroke-[2]"
                      />
                    </svg>
                  </div>
                </motion.div>
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

function getRecipientName(invitation: Invitation): string {
  const parts = [invitation.firstName, invitation.lastName]
    .filter(Boolean)
    .map((s) => s!.trim())
    .filter(Boolean);

  if (parts.length > 0) {
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  if (invitation.recipientName?.trim()) {
    return invitation.recipientName.trim();
  }

  return invitation.email || invitation.recipientEmail || "Unnamed Invitation";
}

function formatRoleName(role?: string): string {
  if (!role) return "Member";
  const map: Record<string, string> = {
    DISPATCHER: "Dispatcher",
    DISPATCHING_COMPANY: "Dispatch Organization",
    CARRIER: "Carrier",
    DRIVER: "Driver",
    OWNER: "Owner",
    ADMIN: "Admin",
    MEMBER: "Member",
  };
  const key = role.toUpperCase();
  if (map[key]) return map[key];
  if (map[role]) return map[role];
  return role
    .split(/[_\-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Who has been invited, where it got to, and what to do about it. */
export function InvitationsScreen() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [tab, setTabState] = useState<Tab>(() =>
    searchParams.get("tab") === "requests" ? "requests" : "invitations"
  );

  useEffect(() => {
    const currentTabParam = searchParams.get("tab");
    if (currentTabParam === "requests" && tab !== "requests") {
      setTabState("requests");
    } else if (currentTabParam !== "requests" && tab === "requests") {
      setTabState("invitations");
    }
  }, [searchParams]);

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      setTabState(params.get("tab") === "requests" ? "requests" : "invitations");
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const [filter, setFilter] = useState<InvitationStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyState, setBusyState] = useState<{ id: string; action: "revoke" | "resend" } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: invitations,
    isLoading: isInvitationsLoading,
    isFetching: isInvitationsFetching,
    refetch: refetchInvitations,
  } = useQuery({
    queryKey: ["organizations", "invitations"],
    queryFn: async () => {
      const res = await apiClient.get("/organizations/invitations");
      return (res.data?.data || res.data || []) as Invitation[];
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const {
    data: requests,
    refetch: refetchRequests,
  } = useQuery({
    queryKey: ["invitation-requests"],
    queryFn: async () => {
      const res = await apiClient.get("/organizations/invitation-requests");
      return (res.data?.data || []) as InvitationRequest[];
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const showLoading = isInvitationsLoading || isInvitationsFetching;

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (tab === "invitations") {
      refetchInvitations();
      queryClient.invalidateQueries({ queryKey: ["organizations", "invitations"] });
    } else if (tab === "requests") {
      refetchRequests();
      queryClient.invalidateQueries({ queryKey: ["invitation-requests"] });
    }
  }, [tab, queryClient]);

  function setTab(nextTab: Tab) {
    if (nextTab === tab) {
      if (nextTab === "invitations") {
        refetchInvitations();
        queryClient.invalidateQueries({ queryKey: ["organizations", "invitations"] });
      } else {
        refetchRequests();
        queryClient.invalidateQueries({ queryKey: ["invitation-requests"] });
      }
      return;
    }
    setTabState(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextTab === "requests") {
        url.searchParams.set("tab", "requests");
      } else {
        url.searchParams.delete("tab");
      }
      window.history.pushState(null, "", url.toString());
    }
  }

  const pendingRequestsCount = (requests || []).filter(
    (r) => r.status?.toUpperCase() === "PENDING"
  ).length;

  async function act(id: string, action: "revoke" | "resend") {
    setBusyState({ id, action });
    setActionError(null);
    try {
      await apiClient.post(`/organizations/invitations/${id}/${action}`);
      toast.success(
        action === "revoke"
          ? "Invitation revoked successfully."
          : "Invitation resent successfully."
      );
      if (action === "revoke") {
        await queryClient.invalidateQueries({ queryKey: ["organizations", "invitations"] });
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || `Failed to ${action} invitation.`;
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyState(null);
    }
  }

  const visible = (invitations ?? []).filter((i) => {
    if (filter === "all") return true;
    return (i.status || "").toLowerCase() === filter.toLowerCase();
  });

  return (
    <div className="space-y-section">
      <PageHeader
        title="Invitations"
        description="Everyone you have invited to work with your organization, and where each invitation got to."
        actions={
          <Can permission="invitations:create">
            <Button variant="primary" asChild>
              <Link href="/settings/invitations/new">
                <Plus aria-hidden />
                Invite
              </Link>
            </Button>
          </Can>
        }
      />

      <div role="tablist" aria-label="Invitations sections" className="flex gap-1 border-b border-border">
        <TabButton
          id="invitations"
          current={tab}
          onSelect={setTab}
          icon={Mail}
          label="Invitations"
          count={invitations?.length}
        />
        <TabButton
          id="requests"
          current={tab}
          onSelect={setTab}
          icon={Inbox}
          label="Requests"
          count={pendingRequestsCount}
        />
      </div>

      {tab === "requests" ? (
        <InvitationRequests />
      ) : (
        <div className="space-y-section">
          {actionError ? (
            <div
              role="alert"
              className="rounded-lg border border-st-danger/35 bg-st-danger-bg/40 px-4 py-3 text-[0.8125rem] leading-relaxed text-fg"
            >
              {actionError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => {
              const count =
                f.value === "all"
                  ? invitations?.length ?? 0
                  : invitations?.filter((i) => (i.status || "").toLowerCase() === f.value.toLowerCase()).length ?? 0;
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

          {showLoading ? (
            <InvitationSkeletonList count={3} />
          ) : visible.length === 0 ? (
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
                  <Can permission="invitations:create">
                    <Button variant="primary" asChild>
                      <Link href="/settings/invitations/new">Send the first invitation</Link>
                    </Button>
                  </Can>
                ) : null
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {visible.map((invitation) => {
                const normalizedStatus = (invitation.status || "pending").toLowerCase();
                const style = getStatusStyle(invitation.status);
                const open = expanded === invitation.id;
                const isBusy = busyState?.id === invitation.id;
                const isResending = isBusy && busyState?.action === "resend";
                const isRevoking = isBusy && busyState?.action === "revoke";
                const panelId = `inv-perms-${invitation.id}`;
                const canRevoke = normalizedStatus === "pending";
                const canResend = normalizedStatus === "pending" || normalizedStatus === "expired";

                const displayName = getRecipientName(invitation);
                const email = invitation.email || invitation.recipientEmail;
                const roleDisplay = invitation.roleName || formatRoleName(invitation.roleId);

                return (
                  <li
                    key={invitation.id}
                    className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[0.9375rem] font-semibold text-fg">
                            {displayName}
                          </p>
                          {normalizedStatus === "revoked" ? (
                            <RevokedStatusBadge
                              label={style.label}
                              className={style.className}
                              updatedAt={invitation.updatedAt}
                            />
                          ) : (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                                style.className,
                              )}
                            >
                              {style.label}
                            </span>
                          )}
                        </div>
                        {email ? (
                          <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                            {email}
                          </p>
                        ) : null}
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-fg-subtle">
                          <span className="font-medium text-fg-muted">{roleDisplay}</span>
                          {invitation.scopedToCarrierName ? (
                            <span>· scoped to {invitation.scopedToCarrierName} only</span>
                          ) : null}
                          {invitation.createdAt ? (
                            <span>· sent {formatDate(invitation.createdAt)}</span>
                          ) : null}
                          <span>
                            · {invitation.expiresAt
                              ? `expires ${formatDate(invitation.expiresAt)}`
                              : "no expiry"}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {canResend ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => act(invitation.id, "resend")}
                            aria-label={`Resend invitation to ${displayName}`}
                          >
                            <RefreshCw className={cn("size-3.5", isResending && "animate-spin")} aria-hidden />
                            {isResending ? "Resending..." : "Resend"}
                          </Button>
                        ) : null}
                        {canRevoke ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => act(invitation.id, "revoke")}
                            aria-label={`Revoke invitation for ${displayName}`}
                          >
                            {isRevoking ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Ban aria-hidden />
                            )}
                            {isRevoking ? "Revoking..." : "Revoke"}
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
                        {open ? "Hide" : "View"} invitation details & permissions
                        <span className="tabular-nums opacity-70">
                          ({(invitation.permissions || []).length})
                        </span>
                      </button>
                      {open ? (
                        <div id={panelId} className="space-y-3 px-4 pb-4">
                          <div className="grid grid-cols-1 gap-2 rounded-md bg-surface-sunken p-3 text-[0.75rem] sm:grid-cols-2">
                            <div>
                              <span className="text-fg-subtle">Recipient:</span>
                              <span className="ml-1.5 font-medium text-fg">{displayName}</span>
                            </div>
                            {email ? (
                              <div>
                                <span className="text-fg-subtle">Email:</span>
                                <span className="ml-1.5 font-medium text-fg">{email}</span>
                              </div>
                            ) : null}
                            <div>
                              <span className="text-fg-subtle">Assigned Role:</span>
                              <span className="ml-1.5 font-medium text-fg">{roleDisplay}</span>
                            </div>
                            <div>
                              <span className="text-fg-subtle">Status:</span>
                              <span className="ml-1.5 font-medium text-fg">{style.label}</span>
                            </div>
                            {invitation.createdAt ? (
                              <div>
                                <span className="text-fg-subtle">Invited Date:</span>
                                <span className="ml-1.5 text-fg">{formatDate(invitation.createdAt)}</span>
                              </div>
                            ) : null}
                            {invitation.expiresAt ? (
                              <div>
                                <span className="text-fg-subtle">Expires Date:</span>
                                <span className="ml-1.5 text-fg">{formatDate(invitation.expiresAt)}</span>
                              </div>
                            ) : null}
                            {invitation.acceptedAt ? (
                              <div>
                                <span className="text-fg-subtle">Accepted Date:</span>
                                <span className="ml-1.5 text-fg">{formatDate(invitation.acceptedAt)}</span>
                              </div>
                            ) : null}
                            {normalizedStatus === "revoked" && invitation.updatedAt ? (
                              <div>
                                <span className="text-fg-subtle">Revoked Date:</span>
                                <span className="ml-1.5 text-fg">{formatDateTime(invitation.updatedAt)}</span>
                              </div>
                            ) : null}
                          </div>
                          {invitation.permissions && invitation.permissions.length > 0 ? (
                            <PermissionSummary permissions={invitation.permissions} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function InvitationSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading invitations</span>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-36 max-w-[40%]" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3.5 w-52 max-w-[60%]" />
              <Skeleton className="h-3 w-72 max-w-[80%]" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>

          <div className="border-t border-border px-4 py-2.5">
            <Skeleton className="h-3.5 w-56 max-w-[70%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

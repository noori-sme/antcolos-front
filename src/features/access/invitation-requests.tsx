"use client";

import { useEffect, useState } from "react";
import { Check, X, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface InvitationRequest {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  status: string;
  organizationId: string;
  invitedByUserId: string;
  invitedUserId: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  acceptedUserId: string | null;
}

export function InvitationRequests() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: requests, isLoading, isFetching } = useQuery({
    queryKey: ["invitation-requests"],
    queryFn: async () => {
      const res = await apiClient.get("/organizations/invitation-requests");
      return (res.data?.data || []) as InvitationRequest[];
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  async function handleAction(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      if (action === "approve") {
        await apiClient.post(`/organizations/invitation-requests/${id}/approve`);
        toast.success("Request approved.");
      } else {
        await apiClient.post(`/organizations/invitation-requests/${id}/reject`);
        toast.success("Request rejected.");
      }
      queryClient.setQueryData(["invitation-requests"], (old: InvitationRequest[] | undefined) =>
        old?.map((req) =>
          req.id === id ? { ...req, status: action === "approve" ? "APPROVED" : "REJECTED" } : req
        ) || []
      );
      queryClient.invalidateQueries({ queryKey: ["invitation-requests"] });
    } catch (err: any) {
      toast.error(err?.message || `Failed to ${action} request.`);
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading || isFetching) {
    return <LoadingSkeleton rows={3} />;
  }

  const allRequests = requests || [];
  const pendingRequests = allRequests.filter(
    (r) => r.status?.toUpperCase() === "PENDING"
  );
  const displayed = filter === "pending" ? pendingRequests : allRequests;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter requests">
          <button
            type="button"
            aria-pressed={filter === "pending"}
            onClick={() => setFilter("pending")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              filter === "pending"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
            )}
          >
            Pending
            <span className="ml-1.5 tabular-nums opacity-70">{pendingRequests.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              filter === "all"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
            )}
          >
            All
            <span className="ml-1.5 tabular-nums opacity-70">{allRequests.length}</span>
          </button>
        </div>
      </div>

      {isLoading || isFetching ? (
        <LoadingSkeleton rows={3} />
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "pending" ? "No pending requests" : "No invitation requests"}
          description={
            filter === "pending"
              ? "When someone requests to join your organization, their request will appear here for you to approve or reject."
              : "There are no invitation requests on record for your organization."
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {displayed.map((req) => {
            const isPending = req.status?.toUpperCase() === "PENDING";
            const isApproved = req.status?.toUpperCase() === "APPROVED" || req.status?.toUpperCase() === "ACCEPTED";
            const busy = busyId === req.id;

            return (
              <li
                key={req.id}
                className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.9375rem] font-semibold text-fg">
                        {req.firstName} {req.lastName}
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                          isPending && "bg-st-info-bg text-st-info",
                          isApproved && "bg-st-success-bg text-st-success",
                          !isPending && !isApproved && "bg-st-danger-bg text-st-danger"
                        )}
                      >
                        {req.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                      {req.email}
                    </p>
                    <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
                      Role: {req.roleId}
                      {" · "}
                      Requested {new Date(req.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  {isPending ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleAction(req.id, "reject")}
                      >
                        <X className="text-st-danger" aria-hidden />
                        Reject
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleAction(req.id, "approve")}
                      >
                        <Check aria-hidden />
                        Approve
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

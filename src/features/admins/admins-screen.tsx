"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronRight,
  Mail,
  Phone,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";
import { Can } from "@/components/auth/can";
import { cn } from "@/lib/utils";
import { useOrgKeyPrefix } from "@/lib/query/use-org-key";

export interface Admin {
  userId: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  name?: string;
  username?: string;
  email: string;
  phone?: string;
  roleId: string;
  roleName: string;
  joinedAt: string;
  accountStatus: "ACTIVE" | "PENDING" | "SUSPENDED" | "INACTIVE" | string;
  hasPermissionOverrides?: boolean;
}

export interface AdminsResponse {
  data: Admin[];
  meta?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING", label: "Pending" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "INACTIVE", label: "Inactive" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status?: string }) {
  const s = status?.toUpperCase();
  if (s === "ACTIVE") {
    return (
      <span className="rounded-full bg-st-success-bg px-2.5 py-0.5 text-[0.6875rem] font-medium text-st-success border border-st-success/20">
        Active
      </span>
    );
  }
  if (s === "PENDING") {
    return (
      <span className="rounded-full bg-st-info-bg px-2.5 py-0.5 text-[0.6875rem] font-medium text-st-info border border-st-info/20">
        Pending
      </span>
    );
  }
  if (s === "SUSPENDED") {
    return (
      <span className="rounded-full bg-st-danger-bg px-2.5 py-0.5 text-[0.6875rem] font-medium text-st-danger border border-st-danger/20">
        Suspended
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.6875rem] font-medium text-fg-muted border border-border">
      {status || "Inactive"}
    </span>
  );
}

export function AdminsScreen() {
  const orgPrefix = useOrgKeyPrefix();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch } = useQuery<AdminsResponse>({
    queryKey: [...orgPrefix, "organizations", "admins", { page, pageSize, q: debouncedSearch }],
    queryFn: async () => {
      const params: Record<string, any> = {
        page,
        pageSize,
        sortBy: "createdAt",
        sortOrder: "desc",
      };
      if (debouncedSearch) {
        params.q = debouncedSearch;
      }
      const res = await apiClient.get("/organizations/admins", { params });
      return res.data;
    },
  });

  const adminsList = data?.data || [];
  const meta = data?.meta;

  const visibleAdmins = useMemo(() => {
    if (statusFilter === "all") return adminsList;
    return adminsList.filter((a) => a.accountStatus?.toUpperCase() === statusFilter);
  }, [adminsList, statusFilter]);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Admins"
        description="Everyone with administrative privileges for your organization."
        actions={
          <Can permission="invitations:create">
            <Button variant="primary" asChild>
              <Link href="/settings/invitations/new">
                <Plus aria-hidden />
                Invite Admin
              </Link>
            </Button>
          </Can>
        }
      />

      {/* Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
            aria-hidden
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, email, phone, or username…"
            aria-label="Search admins"
            className="pl-9"
          />
        </div>

        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by account status"
        >
          {STATUS_FILTERS.map((f) => {
            const count =
              f.value === "all"
                ? adminsList.length
                : adminsList.filter(
                    (a) => a.accountStatus?.toUpperCase() === f.value
                  ).length;
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
                )}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading && <LoadingSkeleton rows={4} />}

      {/* Error State */}
      {isError && (
        <div
          role="alert"
          className="rounded-lg border border-st-danger/35 bg-st-danger-bg/40 p-4 text-[0.875rem] text-fg"
        >
          <p className="font-semibold text-st-danger">Failed to load administrators</p>
          <p className="mt-1 text-fg-muted">
            {(error as any)?.message || "An unexpected error occurred while contacting the server."}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-3">
            Try again
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && visibleAdmins.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title={
            debouncedSearch || statusFilter !== "all"
              ? "No administrators match your criteria"
              : "No administrators yet"
          }
          description={
            debouncedSearch || statusFilter !== "all"
              ? "Try adjusting your search query or filter options."
              : "Invite administrators to manage organization settings and access."
          }
          action={
            !debouncedSearch && statusFilter === "all" ? (
              <Button variant="primary" asChild>
                <Link href="/settings/invitations/new">Invite Admin</Link>
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchInput("");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </Button>
            )
          }
        />
      )}

      {/* Admin Cards List */}
      {!isLoading && !isError && visibleAdmins.length > 0 && (
        <div className="space-y-4">
          <ul className="space-y-2.5">
            {visibleAdmins.map((admin) => {
              const displayName =
                admin.name ||
                `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
                admin.username ||
                "Administrator";

              return (
                <li key={admin.membershipId || admin.userId}>
                  <Link
                    href={`/people/admins/${admin.userId}`}
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
                      "hover:border-border-strong hover:bg-surface-hover",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Name, Status, Role, Overrides */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.9375rem] font-semibold text-fg">
                          {displayName}
                        </span>
                        <StatusBadge status={admin.accountStatus} />
                        <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.6875rem] font-medium text-fg-muted border border-border">
                          {admin.roleName || admin.roleId || "Admin"}
                        </span>
                        {admin.username && (
                          <span className="text-[0.75rem] text-fg-subtle">
                            @{admin.username}
                          </span>
                        )}
                        {admin.hasPermissionOverrides && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-medium text-primary border border-primary/20">
                            Custom Permissions
                          </span>
                        )}
                      </div>

                      {/* Contact details */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-fg-muted">
                        {admin.email ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="size-3.5 text-fg-subtle" aria-hidden />
                            <span>{admin.email}</span>
                          </span>
                        ) : (
                          <span className="text-fg-subtle italic text-[0.75rem]">
                            Email: Data is not available
                          </span>
                        )}

                        {admin.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="size-3.5 text-fg-subtle" aria-hidden />
                            <span>{admin.phone}</span>
                          </span>
                        ) : (
                          <span className="text-fg-subtle italic text-[0.75rem]">
                            Phone: Data is not available
                          </span>
                        )}

                        {admin.joinedAt ? (
                          <span className="inline-flex items-center gap-1.5 text-fg-subtle">
                            <Calendar className="size-3.5 text-fg-subtle" aria-hidden />
                            <span>Joined {formatDate(admin.joinedAt)}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Pagination Controls */}
          {meta && meta.totalPages > 1 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
              <p className="text-[0.8125rem] text-fg-muted tabular-nums">
                Showing {(meta.page - 1) * meta.pageSize + 1}–
                {Math.min(meta.page * meta.pageSize, meta.totalItems)} of {meta.totalItems} administrators
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="px-2 text-[0.8125rem] font-medium text-fg tabular-nums">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

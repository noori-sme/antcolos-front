"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  IdCard,
  Mail,
  MapPin,
  Phone,
  Shield,
  Truck,
  User,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export interface DispatcherAssignment {
  assignmentId: string;
  truckId?: string;
  unitNumber?: string;
  coverage?: string;
  startAt?: string;
}

export interface DispatcherAddress {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface DispatcherDetail {
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
  currentAssignments?: DispatcherAssignment[];
  address?: DispatcherAddress;
}

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

function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase();
  if (s === "ACTIVE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-success-bg px-2.5 py-0.5 text-[0.75rem] font-medium text-st-success border border-st-success/20">
        <CheckCircle2 className="size-3" />
        Active
      </span>
    );
  }
  if (s === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-info-bg px-2.5 py-0.5 text-[0.75rem] font-medium text-st-info border border-st-info/20">
        <Clock className="size-3" />
        Pending
      </span>
    );
  }
  if (s === "SUSPENDED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-danger-bg px-2.5 py-0.5 text-[0.75rem] font-medium text-st-danger border border-st-danger/20">
        Suspended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.75rem] font-medium text-fg-muted border border-border">
      {status || "Inactive"}
    </span>
  );
}

function InfoRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[0.8125rem]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn("text-right font-medium text-fg", mono && "font-mono")}>
        {children || value || "—"}
      </dd>
    </div>
  );
}

export function DispatcherDetailScreen({ userId }: { userId: string }) {
  const { data: dispatcher, isLoading, isError, error, refetch } = useQuery<DispatcherDetail>({
    queryKey: ["organizations", "dispatchers", userId],
    queryFn: async () => {
      const res = await apiClient.get(`/organizations/dispatchers/${userId}`);
      return (res.data?.data || res.data) as DispatcherDetail;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/people/dispatchers"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All dispatchers
          </Link>
        </div>
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (isError || !dispatcher) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/people/dispatchers"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All dispatchers
          </Link>
        </div>
        <EmptyState
          icon={Users}
          title="Dispatcher not found"
          description={
            (error as any)?.message ||
            "This dispatcher does not exist or you do not have permission to view their details."
          }
          action={
            <Button variant="secondary" asChild>
              <Link href="/people/dispatchers">Back to dispatchers</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const displayName =
    dispatcher.name ||
    `${dispatcher.firstName || ""} ${dispatcher.lastName || ""}`.trim() ||
    dispatcher.username ||
    "Dispatcher";

  const assignments = dispatcher.currentAssignments || [];
  const address = dispatcher.address;

  return (
    <div className="space-y-section">
      {/* Back button */}
      <div>
        <Link
          href="/people/dispatchers"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All dispatchers
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={displayName}
        description={`${dispatcher.roleName || dispatcher.roleId || "Dispatcher"} · Joined ${formatDate(dispatcher.joinedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {dispatcher.email && (
              <Button variant="secondary" asChild>
                <a href={`mailto:${dispatcher.email}`}>
                  <Mail aria-hidden />
                  Email
                </a>
              </Button>
            )}
            {dispatcher.phone && (
              <Button variant="secondary" asChild>
                <a href={`tel:${dispatcher.phone}`}>
                  <Phone aria-hidden />
                  Call
                </a>
              </Button>
            )}
          </div>
        }
      />

      {/* Status banner */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={dispatcher.accountStatus} />
        {dispatcher.username && (
          <span className="text-[0.8125rem] text-fg-muted">
            @{dispatcher.username}
          </span>
        )}
      </div>

      {/* 2-column details layout */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* Profile Details Panel */}
        <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <User className="size-4 text-primary" aria-hidden />
            <h2 className="text-[0.9375rem] font-semibold text-fg">
              Profile & Contact Information
            </h2>
          </div>
          <dl className="divide-y divide-border pt-1">
            <InfoRow label="Full Name" value={displayName} />
            {dispatcher.username && (
              <InfoRow label="Username" value={`@${dispatcher.username}`} />
            )}
            <InfoRow label="Email address">
              {dispatcher.email ? (
                <a
                  href={`mailto:${dispatcher.email}`}
                  className="text-primary hover:underline"
                >
                  {dispatcher.email}
                </a>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="Phone number">
              {dispatcher.phone ? (
                <a
                  href={`tel:${dispatcher.phone}`}
                  className="text-primary hover:underline"
                >
                  {dispatcher.phone}
                </a>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="Role">
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.75rem] font-medium text-fg-muted border border-border">
                {dispatcher.roleName || dispatcher.roleId}
              </span>
            </InfoRow>
            <InfoRow label="Joined Date" value={formatDate(dispatcher.joinedAt)} />
            {dispatcher.membershipId && (
              <InfoRow label="Membership ID" value={dispatcher.membershipId} mono />
            )}
            {dispatcher.userId && (
              <InfoRow label="User ID" value={dispatcher.userId} mono />
            )}
          </dl>
        </section>

        {/* Address & Unit Assignments column */}
        <div className="space-y-6">
          {/* Unit Assignments Panel */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Truck className="size-4 text-primary" aria-hidden />
                <h2 className="text-[0.9375rem] font-semibold text-fg">
                  Current Truck Assignments
                </h2>
              </div>
              <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[0.75rem] tabular-nums font-medium text-fg-muted border border-border">
                {assignments.length}
              </span>
            </div>

            {assignments.length === 0 ? (
              <p className="pt-4 text-[0.8125rem] text-fg-muted">
                This dispatcher has no active unit assignments.
              </p>
            ) : (
              <ul className="divide-y divide-border pt-1">
                {assignments.map((asgn) => (
                  <li
                    key={asgn.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div>
                      <p className="flex items-center gap-2 font-medium text-fg text-[0.875rem]">
                        <Truck className="size-3.5 text-primary" aria-hidden />
                        Unit #{asgn.unitNumber || asgn.truckId || "—"}
                      </p>
                      {asgn.startAt && (
                        <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                          Assigned since {formatDate(asgn.startAt)}
                        </p>
                      )}
                    </div>
                    {asgn.coverage && (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-primary border border-primary/20">
                        {asgn.coverage}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Address Panel */}
          {address && (
            <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <MapPin className="size-4 text-primary" aria-hidden />
                <h2 className="text-[0.9375rem] font-semibold text-fg">
                  Address
                </h2>
              </div>
              <dl className="divide-y divide-border pt-1">
                {address.addressLine1 && (
                  <InfoRow label="Address Line 1" value={address.addressLine1} />
                )}
                {address.addressLine2 && (
                  <InfoRow label="Address Line 2" value={address.addressLine2} />
                )}
                {(address.city || address.state || address.postalCode) && (
                  <InfoRow
                    label="City, State, Postal"
                    value={[address.city, address.state, address.postalCode]
                      .filter(Boolean)
                      .join(", ")}
                  />
                )}
                {address.country && (
                  <InfoRow label="Country" value={address.country} />
                )}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

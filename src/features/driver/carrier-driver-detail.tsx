"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Mail,
  MapPin,
  Phone,
  Truck,
  User,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useOrgKeyPrefix } from "@/lib/query/use-org-key";

export interface DriverTruck {
  assignmentId: string;
  truckId?: string;
  unitNumber?: string;
  startAt?: string;
}

export interface DriverAddress {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface DriverDetail {
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
  currentTruck?: DriverTruck | null;
  address?: DriverAddress | null;
}

function formatDate(iso?: string): string {
  if (!iso) return "Data is not available";
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
      {status || "Data is not available"}
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
        {children || (value ? value : <span className="text-fg-subtle italic">Data is not available</span>)}
      </dd>
    </div>
  );
}

export function CarrierDriverDetail({
  relationshipId,
  userId,
}: {
  relationshipId?: string;
  userId?: string;
}) {
  const orgPrefix = useOrgKeyPrefix();
  const id = userId || relationshipId || "";

  const { data: driver, isLoading, isError, error, refetch } = useQuery<DriverDetail>({
    queryKey: [...orgPrefix, "organizations", "drivers", id],
    queryFn: async () => {
      const res = await apiClient.get(`/organizations/drivers/${id}`);
      return (res.data?.data || res.data) as DriverDetail;
    },
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/people/drivers"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All drivers
          </Link>
        </div>
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (isError || !driver) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/people/drivers"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All drivers
          </Link>
        </div>
        <EmptyState
          icon={Users}
          title="Driver not found"
          description={
            (error as any)?.message ||
            "This driver does not exist or you do not have permission to view their details."
          }
          action={
            <Button variant="secondary" asChild>
              <Link href="/people/drivers">Back to drivers</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const displayName =
    driver.name ||
    `${driver.firstName || ""} ${driver.lastName || ""}`.trim() ||
    driver.username ||
    "Driver";

  const truck = driver.currentTruck;
  const address = driver.address;
  const hasAddress =
    address &&
    Boolean(
      address.addressLine1 ||
        address.addressLine2 ||
        address.city ||
        address.state ||
        address.postalCode ||
        address.country
    );

  return (
    <div className="space-y-section">
      {/* Back button */}
      <div>
        <Link
          href="/people/drivers"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All drivers
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={displayName}
        description={`${driver.roleName || driver.roleId || "Driver"} · Joined ${formatDate(driver.joinedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {driver.email && (
              <Button variant="secondary" asChild>
                <a href={`mailto:${driver.email}`}>
                  <Mail aria-hidden />
                  Email
                </a>
              </Button>
            )}
            {driver.phone && (
              <Button variant="secondary" asChild>
                <a href={`tel:${driver.phone}`}>
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
        <StatusBadge status={driver.accountStatus} />
        {driver.username ? (
          <span className="text-[0.8125rem] text-fg-muted">
            @{driver.username}
          </span>
        ) : null}
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
            <InfoRow
              label="Username"
              value={driver.username ? `@${driver.username}` : undefined}
            />
            <InfoRow label="Email address">
              {driver.email ? (
                <a href={`mailto:${driver.email}`} className="text-primary hover:underline">
                  {driver.email}
                </a>
              ) : (
                <span className="text-fg-subtle italic">Data is not available</span>
              )}
            </InfoRow>
            <InfoRow label="Phone number">
              {driver.phone ? (
                <a href={`tel:${driver.phone}`} className="text-primary hover:underline">
                  {driver.phone}
                </a>
              ) : (
                <span className="text-fg-subtle italic">Data is not available</span>
              )}
            </InfoRow>
            <InfoRow
              label="Role"
              value={
                driver.roleName || driver.roleId ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.75rem] font-medium text-fg-muted border border-border">
                    {driver.roleName || driver.roleId}
                  </span>
                ) : undefined
              }
            />
            <InfoRow label="Joined Date" value={formatDate(driver.joinedAt)} />
            <InfoRow label="Membership ID" value={driver.membershipId} mono />
            <InfoRow label="User ID" value={driver.userId} mono />
          </dl>
        </section>

        {/* Truck Assignment & Address column */}
        <div className="space-y-6">
          {/* Current Truck Assignment Panel */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Truck className="size-4 text-primary" aria-hidden />
                <h2 className="text-[0.9375rem] font-semibold text-fg">
                  Current Truck Assignment
                </h2>
              </div>
              {truck && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-primary border border-primary/20">
                  Assigned
                </span>
              )}
            </div>

            {truck ? (
              <dl className="divide-y divide-border pt-1">
                <InfoRow
                  label="Unit Number"
                  value={truck.unitNumber ? `Unit #${truck.unitNumber}` : "Data is not available"}
                />
                <InfoRow label="Truck ID" value={truck.truckId} mono />
                <InfoRow label="Assignment ID" value={truck.assignmentId} mono />
                <InfoRow label="Assigned Since" value={formatDate(truck.startAt)} />
              </dl>
            ) : (
              <div className="py-6 text-center text-[0.8125rem]">
                <Truck className="mx-auto mb-2 size-6 text-fg-subtle opacity-40" />
                <p className="font-medium text-fg">Data is not available</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  No active truck assigned to this driver.
                </p>
              </div>
            )}
          </section>

          {/* Address Panel */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <MapPin className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">Address</h2>
            </div>
            {hasAddress && address ? (
              <dl className="divide-y divide-border pt-1">
                <InfoRow label="Address Line 1" value={address.addressLine1} />
                <InfoRow label="Address Line 2" value={address.addressLine2} />
                <InfoRow
                  label="City, State, Postal"
                  value={
                    [address.city, address.state, address.postalCode]
                      .filter(Boolean)
                      .join(", ") || undefined
                  }
                />
                <InfoRow label="Country" value={address.country} />
              </dl>
            ) : (
              <div className="py-6 text-center text-[0.8125rem]">
                <MapPin className="mx-auto mb-2 size-6 text-fg-subtle opacity-40" />
                <p className="font-medium text-fg">Data is not available</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  No address information on record.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

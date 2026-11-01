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
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useOrgKeyPrefix } from "@/lib/query/use-org-key";

export interface AdminAddress {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface AdminDetail {
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
  address?: AdminAddress | null;
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

export function AdminDetailScreen({ userId }: { userId: string }) {
  const orgPrefix = useOrgKeyPrefix();
  const { data: admin, isLoading, isError, error, refetch } = useQuery<AdminDetail>({
    queryKey: [...orgPrefix, "organizations", "admins", userId],
    queryFn: async () => {
      const res = await apiClient.get(`/organizations/admins/${userId}`);
      return (res.data?.data || res.data) as AdminDetail;
    },
    enabled: Boolean(userId),
  });

  if (isLoading) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/people/admins"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All admins
          </Link>
        </div>
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (isError || !admin) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/people/admins"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All admins
          </Link>
        </div>
        <EmptyState
          icon={ShieldCheck}
          title="Administrator not found"
          description={
            (error as any)?.message ||
            "This administrator does not exist or you do not have permission to view their details."
          }
          action={
            <Button variant="secondary" asChild>
              <Link href="/people/admins">Back to admins</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const displayName =
    admin.name ||
    `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
    admin.username ||
    "Administrator";

  const address = admin.address;
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
          href="/people/admins"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All admins
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={displayName}
        description={`${admin.roleName || admin.roleId || "Administrator"} · Joined ${formatDate(admin.joinedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {admin.email && (
              <Button variant="secondary" asChild>
                <a href={`mailto:${admin.email}`}>
                  <Mail aria-hidden />
                  Email
                </a>
              </Button>
            )}
            {admin.phone && (
              <Button variant="secondary" asChild>
                <a href={`tel:${admin.phone}`}>
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
        <StatusBadge status={admin.accountStatus} />
        {admin.username ? (
          <span className="text-[0.8125rem] text-fg-muted">
            @{admin.username}
          </span>
        ) : null}
        {admin.hasPermissionOverrides && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[0.75rem] font-medium text-primary border border-primary/20">
            <ShieldAlert className="size-3" />
            Custom Permissions Overridden
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
            <InfoRow
              label="Username"
              value={admin.username ? `@${admin.username}` : undefined}
            />
            <InfoRow label="Email address">
              {admin.email ? (
                <a href={`mailto:${admin.email}`} className="text-primary hover:underline">
                  {admin.email}
                </a>
              ) : (
                <span className="text-fg-subtle italic">Data is not available</span>
              )}
            </InfoRow>
            <InfoRow label="Phone number">
              {admin.phone ? (
                <a href={`tel:${admin.phone}`} className="text-primary hover:underline">
                  {admin.phone}
                </a>
              ) : (
                <span className="text-fg-subtle italic">Data is not available</span>
              )}
            </InfoRow>
            <InfoRow
              label="Role"
              value={
                admin.roleName || admin.roleId ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.75rem] font-medium text-fg-muted border border-border">
                    {admin.roleName || admin.roleId}
                  </span>
                ) : undefined
              }
            />
            <InfoRow label="Joined Date" value={formatDate(admin.joinedAt)} />
            <InfoRow label="Membership ID" value={admin.membershipId} mono />
            <InfoRow label="User ID" value={admin.userId} mono />
          </dl>
        </section>

        {/* Security & Address Column */}
        <div className="space-y-6">
          {/* Permissions & Access Panel */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Shield className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                Permissions & Access
              </h2>
            </div>
            <dl className="divide-y divide-border pt-1">
              <InfoRow label="Access Level">
                <span className="font-semibold text-fg">
                  {admin.roleName || "Organization Administrator"}
                </span>
              </InfoRow>
              <InfoRow label="Permission Overrides">
                {admin.hasPermissionOverrides ? (
                  <span className="text-primary font-medium">Custom permissions applied</span>
                ) : (
                  <span className="text-fg-muted">Inherited from role</span>
                )}
              </InfoRow>
              <InfoRow label="Account Status">
                <StatusBadge status={admin.accountStatus} />
              </InfoRow>
            </dl>
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

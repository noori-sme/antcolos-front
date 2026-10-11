"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  FileCheck,
  Fuel,
  Info,
  MapPin,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Truck as TruckIcon,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export interface TruckAssignment {
  assignmentId: string;
  userId: string;
  name: string;
  startAt?: string;
  coverage?: string;
}

export interface TruckLegalOwner {
  ownershipId?: string;
  ownerType?: string;
  ownerOrganizationId?: string | null;
  ownerUserId?: string | null;
  ownershipType?: string;
  verificationStatus?: string;
  startAt?: string;
  endAt?: string | null;
}

export interface TruckOperating {
  operatingId?: string;
  organizationId?: string;
  unitNumber?: string;
  homeTerminalCity?: string;
  homeTerminalState?: string;
  notes?: string;
  operationalStatus?: string;
  verificationStatus?: string;
  startAt?: string;
  endAt?: string | null;
}

export interface TruckDetail {
  id: string;
  vin: string;
  licensePlate?: string;
  licensePlateState?: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  equipmentType?: string;
  trailerLengthFt?: number;
  trailerNumber?: string;
  payloadLbs?: number;
  gvwrLbs?: number;
  registrationExpiresAt?: string;
  insuranceExpiresAt?: string;
  eldProvider?: string;
  eldDeviceId?: string;
  fuelType?: string;
  axleCount?: number;
  cabType?: string;
  archivedAt?: string | null;
  legalOwner?: TruckLegalOwner | null;
  operating?: TruckOperating | null;
  unitNumber?: string;
  homeTerminalCity?: string;
  homeTerminalState?: string;
  notes?: string;
  ownershipType?: string;
  operationalStatus?: "AVAILABLE" | "UNAVAILABLE" | "MAINTENANCE" | string;
  currentDriver?: TruckAssignment | null;
  currentDispatchers?: TruckAssignment[];
  createdByUserId?: string;
  updatedByUserId?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
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

function formatNumber(num?: number): string {
  if (num === undefined || num === null) return "Data is not available";
  return num.toLocaleString();
}

function OperationalStatusBadge({ status }: { status?: string }) {
  const s = status?.toUpperCase();
  if (s === "AVAILABLE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-success-bg px-2.5 py-0.5 text-[0.75rem] font-medium text-st-success border border-st-success/20">
        <CheckCircle2 className="size-3" />
        Available
      </span>
    );
  }
  if (s === "MAINTENANCE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-danger-bg px-2.5 py-0.5 text-[0.75rem] font-medium text-st-danger border border-st-danger/20">
        <Wrench className="size-3" />
        Maintenance
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.75rem] font-medium text-fg-muted border border-border">
      <Clock className="size-3" />
      {status || "Unavailable"}
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

export function TruckProfileScreen({ truckId }: { truckId: string }) {
  const [copiedVin, setCopiedVin] = useState(false);

  const { data: truck, isLoading, isError, error, refetch } = useQuery<TruckDetail>({
    queryKey: ["trucks", truckId],
    queryFn: async () => {
      const res = await apiClient.get(`/trucks/${truckId}`);
      return (res.data?.data || res.data) as TruckDetail;
    },
    enabled: Boolean(truckId),
  });

  if (isLoading) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/fleet/trucks"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All trucks
          </Link>
        </div>
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (isError || !truck) {
    return (
      <div className="space-y-section">
        <div>
          <Link
            href="/fleet/trucks"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All trucks
          </Link>
        </div>
        <EmptyState
          icon={TruckIcon}
          title="Truck not found"
          description={
            (error as any)?.message ||
            "This truck does not exist or you do not have permission to view its records."
          }
          action={
            <Button variant="secondary" asChild>
              <Link href="/fleet/trucks">Back to trucks</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const unit =
    truck.unitNumber ||
    truck.operating?.unitNumber ||
    "Unit " + truck.id.slice(0, 8);

  const vehicleDesc = [truck.year, truck.make, truck.model]
    .filter(Boolean)
    .join(" ");

  const driver = truck.currentDriver;
  const dispatchers = truck.currentDispatchers || [];
  const legalOwner = truck.legalOwner;
  const operating = truck.operating;

  const copyVin = async () => {
    if (!truck.vin) return;
    try {
      await navigator.clipboard.writeText(truck.vin);
      setCopiedVin(true);
      setTimeout(() => setCopiedVin(false), 2000);
    } catch {}
  };

  return (
    <div className="space-y-section">
      {/* Back button */}
      <div>
        <Link
          href="/fleet/trucks"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All trucks
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={`Unit ${unit}`}
        description={`${vehicleDesc || "Truck"} · ${truck.equipmentType || "Equipment"} · ${truck.ownershipType || "Company"}`}
      />

      {/* Status Badges Row */}
      <div className="flex flex-wrap items-center gap-2">
        <OperationalStatusBadge
          status={truck.operationalStatus || operating?.operationalStatus}
        />
        {truck.ownershipType && (
          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.75rem] font-medium text-fg-muted border border-border">
            {truck.ownershipType}
          </span>
        )}
        {operating?.verificationStatus && (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium border",
              operating.verificationStatus === "VERIFIED"
                ? "bg-st-success-bg text-st-success border-st-success/20"
                : "bg-surface-sunken text-fg-subtle border-border"
            )}
          >
            {operating.verificationStatus}
          </span>
        )}
      </div>

      {/* 2-Column Responsive Layout */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* Left Column: Vehicle & Equipment Specs */}
        <div className="space-y-6">
          {/* Vehicle Specifications */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <TruckIcon className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                Vehicle Specifications
              </h2>
            </div>
            <dl className="divide-y divide-border pt-1">
              <InfoRow label="Year / Make / Model" value={vehicleDesc || undefined} />
              <InfoRow label="Color" value={truck.color} />
              <InfoRow label="VIN Number">
                {truck.vin ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-[0.8125rem]">{truck.vin}</span>
                    <button
                      type="button"
                      onClick={copyVin}
                      className="text-fg-subtle hover:text-fg"
                      aria-label="Copy VIN"
                    >
                      {copiedVin ? (
                        <Check className="size-3 text-st-success" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </span>
                ) : (
                  <span className="text-fg-subtle italic">Data is not available</span>
                )}
              </InfoRow>
              <InfoRow
                label="License Plate"
                value={
                  truck.licensePlate
                    ? `${truck.licensePlate} (${truck.licensePlateState || ""})`
                    : undefined
                }
              />
              <InfoRow label="Cab Type" value={truck.cabType} />
              <InfoRow label="Fuel Type" value={truck.fuelType} />
              <InfoRow
                label="Axle Count"
                value={truck.axleCount ? `${truck.axleCount} axles` : undefined}
              />
              <InfoRow
                label="GVWR (Gross Vehicle Weight)"
                value={truck.gvwrLbs ? `${formatNumber(truck.gvwrLbs)} lbs` : undefined}
              />
              <InfoRow
                label="Max Payload Capacity"
                value={truck.payloadLbs ? `${formatNumber(truck.payloadLbs)} lbs` : undefined}
              />
            </dl>
          </section>

          {/* Trailer & Equipment Details */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Radio className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                Equipment & Trailer
              </h2>
            </div>
            <dl className="divide-y divide-border pt-1">
              <InfoRow label="Equipment Type" value={truck.equipmentType} />
              <InfoRow label="Trailer Number" value={truck.trailerNumber} />
              <InfoRow
                label="Trailer Length"
                value={truck.trailerLengthFt ? `${truck.trailerLengthFt} ft` : undefined}
              />
            </dl>
          </section>

          {/* Registration, Insurance & ELD */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <FileCheck className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                Compliance, Registration & ELD
              </h2>
            </div>
            <dl className="divide-y divide-border pt-1">
              <InfoRow
                label="Registration Expiration"
                value={formatDate(truck.registrationExpiresAt)}
              />
              <InfoRow
                label="Insurance Expiration"
                value={formatDate(truck.insuranceExpiresAt)}
              />
              <InfoRow label="ELD Telematics Provider" value={truck.eldProvider} />
              <InfoRow label="ELD Device ID" value={truck.eldDeviceId} mono />
            </dl>
          </section>
        </div>

        {/* Right Column: Assignments, Operation & Ownership */}
        <div className="space-y-6">
          {/* Driver & Dispatcher Assignments */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <User className="size-4 text-primary" aria-hidden />
                <h2 className="text-[0.9375rem] font-semibold text-fg">
                  Driver & Dispatcher Assignments
                </h2>
              </div>
            </div>

            <div className="pt-3 space-y-4">
              {/* Driver Assignment */}
              <div>
                <h3 className="text-[0.8125rem] font-medium text-fg-muted mb-2">
                  Assigned Driver
                </h3>
                {driver ? (
                  <div className="rounded-md border border-border bg-surface-elevated p-3 text-[0.8125rem]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-fg">{driver.name}</span>
                      {driver.coverage && (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-primary border border-primary/20">
                          {driver.coverage}
                        </span>
                      )}
                    </div>
                    {driver.startAt && (
                      <p className="mt-1 text-xs text-fg-muted">
                        Assigned since {formatDate(driver.startAt)}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="py-4 text-center rounded-md border border-dashed border-border text-[0.8125rem]">
                    <User className="mx-auto mb-1.5 size-5 text-fg-subtle opacity-40" />
                    <p className="font-medium text-fg">Data is not available</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      No active driver assigned to this unit.
                    </p>
                  </div>
                )}
              </div>

              {/* Dispatchers Assignment */}
              <div>
                <h3 className="text-[0.8125rem] font-medium text-fg-muted mb-2">
                  Assigned Dispatchers
                </h3>
                {dispatchers.length > 0 ? (
                  <ul className="space-y-2">
                    {dispatchers.map((disp) => (
                      <li
                        key={disp.assignmentId}
                        className="rounded-md border border-border bg-surface-elevated p-3 text-[0.8125rem]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-fg">{disp.name}</span>
                          {disp.coverage && (
                            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted border border-border">
                              {disp.coverage}
                            </span>
                          )}
                        </div>
                        {disp.startAt && (
                          <p className="mt-1 text-xs text-fg-muted">
                            Assigned since {formatDate(disp.startAt)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="py-4 text-center rounded-md border border-dashed border-border text-[0.8125rem]">
                    <Users className="mx-auto mb-1.5 size-5 text-fg-subtle opacity-40" />
                    <p className="font-medium text-fg">Data is not available</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      No dispatchers assigned to this unit.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Operational & Terminal Information */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <MapPin className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                Operation & Terminal
              </h2>
            </div>
            <dl className="divide-y divide-border pt-1">
              <InfoRow
                label="Home Terminal"
                value={
                  truck.homeTerminalCity || operating?.homeTerminalCity
                    ? `${truck.homeTerminalCity || operating?.homeTerminalCity}, ${truck.homeTerminalState || operating?.homeTerminalState || ""}`
                    : undefined
                }
              />
              <InfoRow
                label="Operational Status"
                value={truck.operationalStatus || operating?.operationalStatus}
              />
              <InfoRow
                label="Operating Notes"
                value={truck.notes || operating?.notes}
              />
              <InfoRow
                label="Operating ID"
                value={operating?.operatingId}
                mono
              />
            </dl>
          </section>

          {/* Legal Ownership */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Shield className="size-4 text-primary" aria-hidden />
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                Legal Ownership & Lease
              </h2>
            </div>
            {legalOwner ? (
              <dl className="divide-y divide-border pt-1">
                <InfoRow label="Owner Type" value={legalOwner.ownerType} />
                <InfoRow label="Ownership Type" value={legalOwner.ownershipType} />
                <InfoRow
                  label="Verification Status"
                  value={legalOwner.verificationStatus}
                />
                <InfoRow
                  label="Effective Start Date"
                  value={formatDate(legalOwner.startAt)}
                />
                {legalOwner.ownerOrganizationId && (
                  <InfoRow
                    label="Owner Organization ID"
                    value={legalOwner.ownerOrganizationId}
                    mono
                  />
                )}
              </dl>
            ) : (
              <div className="py-6 text-center text-[0.8125rem]">
                <Shield className="mx-auto mb-2 size-6 text-fg-subtle opacity-40" />
                <p className="font-medium text-fg">Data is not available</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  No legal ownership record attached.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

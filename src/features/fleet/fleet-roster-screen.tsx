"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronRight,
  Filter,
  Plus,
  Search,
  Truck as TruckIcon,
  User,
  Users,
  MapPin,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";
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

export interface TruckItem {
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

export interface TrucksResponse {
  data: TruckItem[];
  meta?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "AVAILABLE", label: "Available" },
  { value: "UNAVAILABLE", label: "Unavailable" },
  { value: "MAINTENANCE", label: "Maintenance" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const EQUIPMENT_OPTIONS = [
  { value: "all", label: "All equipment" },
  { value: "DRY_VAN", label: "Dry Van" },
  { value: "REEFER", label: "Reefer" },
  { value: "FLATBED", label: "Flatbed" },
  { value: "STEP_DECK", label: "Step Deck" },
  { value: "POWER_ONLY", label: "Power Only" },
  { value: "TANKER", label: "Tanker" },
  { value: "OTHER", label: "Other" },
];

function formatEquipmentType(type?: string): string {
  if (!type) return "Data is not available";
  const found = EQUIPMENT_OPTIONS.find((o) => o.value === type);
  if (found) return found.label;
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function OperationalStatusBadge({ status }: { status?: string }) {
  const s = status?.toUpperCase();
  if (s === "AVAILABLE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-success-bg px-2.5 py-0.5 text-[0.6875rem] font-medium text-st-success border border-st-success/20">
        <CheckCircle2 className="size-3" />
        Available
      </span>
    );
  }
  if (s === "MAINTENANCE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-st-danger-bg px-2.5 py-0.5 text-[0.6875rem] font-medium text-st-danger border border-st-danger/20">
        <Wrench className="size-3" />
        Maintenance
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.6875rem] font-medium text-fg-muted border border-border">
      <Clock className="size-3" />
      {status || "Unavailable"}
    </span>
  );
}

export function FleetRosterScreen() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch } = useQuery<TrucksResponse>({
    queryKey: [
      "trucks",
      {
        page,
        pageSize,
        q: debouncedSearch,
        operationalStatus: statusFilter !== "all" ? statusFilter : undefined,
        equipmentType: equipmentFilter !== "all" ? equipmentFilter : undefined,
      },
    ],
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
      if (statusFilter !== "all") {
        params.operationalStatus = statusFilter;
      }
      if (equipmentFilter !== "all") {
        params.equipmentType = equipmentFilter;
      }
      const res = await apiClient.get("/trucks", { params });
      return res.data;
    },
  });

  const trucksList = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Trucks"
        description="Every truck in your fleet, active assignments, and operational status."
        actions={
          <Button variant="primary" asChild>
            <Link href="/fleet/trucks/new">
              <Plus aria-hidden />
              Add truck
            </Link>
          </Button>
        }
      />

      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
              aria-hidden
            />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search unit, VIN, plate, or notes…"
              aria-label="Search trucks"
              className="pl-9"
            />
          </div>

          <label className="sr-only" htmlFor="equipment-filter">
            Filter by equipment type
          </label>
          <select
            id="equipment-filter"
            value={equipmentFilter}
            onChange={(e) => {
              setEquipmentFilter(e.target.value);
              setPage(1);
            }}
            className="h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            {EQUIPMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Operational Status Filter Chips */}
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by operational status"
        >
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setStatusFilter(f.value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
                )}
              >
                {f.label}
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
          <p className="font-semibold text-st-danger">Failed to load fleet trucks</p>
          <p className="mt-1 text-fg-muted">
            {(error as any)?.message ||
              "An unexpected error occurred while contacting the server."}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            className="mt-3"
          >
            Try again
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && trucksList.length === 0 && (
        <EmptyState
          icon={TruckIcon}
          title={
            debouncedSearch || statusFilter !== "all" || equipmentFilter !== "all"
              ? "No trucks match your criteria"
              : "No trucks in fleet yet"
          }
          description={
            debouncedSearch || statusFilter !== "all" || equipmentFilter !== "all"
              ? "Try adjusting your search keywords, equipment type, or status filters."
              : "Add your first truck to manage equipment, assign drivers, and start dispatching."
          }
          action={
            !debouncedSearch &&
            statusFilter === "all" &&
            equipmentFilter === "all" ? (
              <Button variant="primary" asChild>
                <Link href="/fleet/trucks/new">Add your first truck</Link>
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchInput("");
                  setStatusFilter("all");
                  setEquipmentFilter("all");
                  setPage(1);
                }}
              >
                Reset filters
              </Button>
            )
          }
        />
      )}

      {/* Trucks List */}
      {!isLoading && !isError && trucksList.length > 0 && (
        <div className="space-y-4">
          <ul className="space-y-2.5">
            {trucksList.map((truck) => {
              const unit =
                truck.unitNumber ||
                truck.operating?.unitNumber ||
                "Unnamed Unit";
              const vehicleDesc = [truck.year, truck.make, truck.model]
                .filter(Boolean)
                .join(" ");

              const driver = truck.currentDriver;
              const dispatchers = truck.currentDispatchers || [];
              const terminal =
                truck.homeTerminalCity || truck.operating?.homeTerminalCity
                  ? `${truck.homeTerminalCity || truck.operating?.homeTerminalCity}, ${truck.homeTerminalState || truck.operating?.homeTerminalState || ""}`
                  : null;

              return (
                <li key={truck.id}>
                  <Link
                    href={`/fleet/trucks/${truck.id}`}
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
                      "hover:border-border-strong hover:bg-surface-hover",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    )}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted mt-0.5"
                      >
                        <TruckIcon className="size-[1.125rem]" />
                      </span>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Unit Number, Status, Equipment, Ownership */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.9375rem] font-semibold text-fg">
                            Unit {unit}
                          </span>
                          <OperationalStatusBadge
                            status={
                              truck.operationalStatus ||
                              truck.operating?.operationalStatus
                            }
                          />
                          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.6875rem] font-medium text-fg-muted border border-border">
                            {formatEquipmentType(truck.equipmentType)}
                          </span>
                          {truck.ownershipType && (
                            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-subtle border border-border">
                              {truck.ownershipType}
                            </span>
                          )}
                          {vehicleDesc && (
                            <span className="text-[0.8125rem] text-fg-muted">
                              {vehicleDesc}
                              {truck.color ? ` · ${truck.color}` : ""}
                            </span>
                          )}
                        </div>

                        {/* License, VIN, Terminal */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                          {truck.licensePlate ? (
                            <span>
                              Plate: {truck.licensePlate}{" "}
                              {truck.licensePlateState ? `(${truck.licensePlateState})` : ""}
                            </span>
                          ) : (
                            <span className="text-fg-subtle italic">
                              Plate: Data is not available
                            </span>
                          )}

                          {truck.vin ? (
                            <span className="font-mono text-fg-subtle">
                              VIN: {truck.vin}
                            </span>
                          ) : (
                            <span className="text-fg-subtle italic">
                              VIN: Data is not available
                            </span>
                          )}

                          {terminal ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3 text-fg-subtle" />
                              <span>{terminal}</span>
                            </span>
                          ) : (
                            <span className="text-fg-subtle italic">
                              Terminal: Data is not available
                            </span>
                          )}
                        </div>

                        {/* Driver & Dispatcher Assignment row */}
                        <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem]">
                          {driver ? (
                            <span className="inline-flex items-center gap-1.5 text-fg font-medium">
                              <User className="size-3 text-primary" />
                              <span>Driver: {driver.name}</span>
                              {driver.coverage && (
                                <span className="text-[0.6875rem] text-fg-subtle">
                                  ({driver.coverage})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-fg-subtle italic">
                              Driver: Data is not available
                            </span>
                          )}

                          {dispatchers.length > 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-fg-muted">
                              <Users className="size-3 text-fg-subtle" />
                              <span>
                                Dispatch: {dispatchers.map((d) => d.name).join(", ")}
                              </span>
                            </span>
                          ) : (
                            <span className="text-fg-subtle italic">
                              Dispatch: Data is not available
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <ChevronRight
                      className="mt-1 size-4 shrink-0 text-fg-subtle"
                      aria-hidden
                    />
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
                {Math.min(meta.page * meta.pageSize, meta.totalItems)} of{" "}
                {meta.totalItems} trucks
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

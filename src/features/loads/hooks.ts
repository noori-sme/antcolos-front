"use client";

import {
  keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { services } from "@/lib/api";
import type { LoadFilters, LoadSort } from "@/lib/api/contracts/loads";
import { useServiceContext } from "@/lib/api/use-service-context";
import { fleetKeys, loadExceptionKeys, loadRecordKeys, orgKey } from "@/lib/query/keys";
import { usePeopleList, usePerson } from "@/lib/api/use-org-people";
import { createIntentKeys } from "@/lib/rate-con/intent-key";
import type { ReportExceptionInput, ResolveExceptionInput } from "@/types/load-exception";
import type {
  CancelLoadInput, LoadRecord, LoadRecordQuery, LoadRecordStatus,
} from "@/types/load-record";

export function useLoadsList(filters: LoadFilters, sort: LoadSort) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...orgKey(ctx.organizationId), "loads", ctx.membershipId, filters, sort]
      : ["loads", "no-context"],
    queryFn: () => services.loads.list(ctx!, filters, sort, { limit: 100 }),
    enabled: Boolean(ctx),
  });
}

export function useLoad(loadId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...orgKey(ctx.organizationId), "loads", ctx.membershipId, loadId]
      : ["load", "no-context"],
    queryFn: () => services.loads.get(ctx!, loadId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useLoadEvents(loadId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...orgKey(ctx.organizationId), "loads", ctx.membershipId, loadId, "events"]
      : ["load-events", "no-context"],
    queryFn: () => services.loads.events(ctx!, loadId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useLoadDocuments(loadId: string) {
  const ctx = useServiceContext();
  const enabled = Boolean(ctx?.permissions.has("documents:view"));
  return useQuery({
    queryKey: ctx
      ? [...orgKey(ctx.organizationId), "loads", ctx.membershipId, loadId, "documents"]
      : ["load-documents", "no-context"],
    queryFn: () => services.loads.documents(ctx!, loadId),
    enabled: Boolean(ctx) && enabled,
    retry: false,
  });
}

// ── Live loads on the real API (F1.2, plan 14) ──────────────────────────────

export function useLoadRecords(query: LoadRecordQuery) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? loadRecordKeys.list(ctx.organizationId, query) : ["load-records", "no-context"],
    queryFn: () => services.loadRecords.list(ctx!, query),
    enabled: Boolean(ctx),
    placeholderData: keepPreviousData,
  });
}

export function useLoadRecord(loadId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? loadRecordKeys.detail(ctx.organizationId, loadId) : ["load-record", "no-context"],
    queryFn: () => services.loadRecords.get(ctx!, loadId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

/** Oldest first, 50 a page; "Show more" fetches the next page. */
export function useLoadTimeline(loadId: string) {
  const ctx = useServiceContext();
  return useInfiniteQuery({
    queryKey: ctx ? loadRecordKeys.timeline(ctx.organizationId, loadId) : ["load-timeline", "no-context"],
    queryFn: ({ pageParam }) => services.loadRecords.timeline(ctx!, loadId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: Boolean(ctx),
    retry: false,
  });
}

/** One Idempotency-Key per user intent, kept across re-renders. */
export function useLoadIntentKey() {
  const [keys] = useState(() => createIntentKeys());
  return keys;
}

type LoadAction =
  | { kind: "step"; to: LoadRecordStatus }
  | { kind: "cancel"; input: CancelLoadInput }
  | { kind: "correct"; to: LoadRecordStatus; reason: string }
  // Truck and driver (F1.3, plan 15).
  | { kind: "bookTruck"; truckId: string }
  | { kind: "unbookTruck" }
  | { kind: "assignDriver"; userId: string }
  | { kind: "unassignDriver" }
  | { kind: "acceptForDriver" }
  | { kind: "rejectForDriver"; reason: string };

/**
 * Step, cancel or correct a load. The caller passes the intent's key; on
 * success the detail is replaced with the API's answer, and lists and the
 * timeline refresh. On a conflict the detail refreshes too, so the screen
 * shows what someone else did.
 */
export function useLoadAction(loadId: string) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      action,
      idempotencyKey,
    }: {
      action: LoadAction;
      idempotencyKey: string;
    }): Promise<LoadRecord | null> => {
      const loads = services.loadRecords;
      switch (action.kind) {
        case "step":
          return loads.transition(ctx!, loadId, action.to, idempotencyKey);
        case "cancel":
          return loads.cancel(ctx!, loadId, action.input, idempotencyKey);
        case "correct":
          return loads.correctStatus(ctx!, loadId, action.to, action.reason, idempotencyKey);
        case "bookTruck":
          return loads.bookTruck(ctx!, loadId, action.truckId, idempotencyKey);
        case "unbookTruck":
          return loads.unbookTruck(ctx!, loadId, idempotencyKey);
        case "assignDriver":
          return loads.assignDriver(ctx!, loadId, action.userId, idempotencyKey);
        case "unassignDriver":
          return loads.unassignDriver(ctx!, loadId, idempotencyKey);
        // A driver's answer returns no load; the refetch below brings it.
        case "acceptForDriver":
          await loads.acceptForDriver(ctx!, loadId, idempotencyKey);
          return null;
        case "rejectForDriver":
          await loads.rejectForDriver(ctx!, loadId, action.reason, idempotencyKey);
          return null;
      }
    },
    onSuccess: (load) => {
      if (!ctx || !load) return;
      queryClient.setQueryData(loadRecordKeys.detail(ctx.organizationId, loadId), load);
    },
    onSettled: () => {
      if (!ctx) return;
      void queryClient.invalidateQueries({ queryKey: loadRecordKeys.all(ctx.organizationId) });
      // The load's truck moves with it (plan 31): its status is stale too.
      void queryClient.invalidateQueries({ queryKey: fleetKeys.all(ctx.organizationId) });
    },
  });
}

/** The truck booked for a load, from the fleet API (plan 15). */
export function useLoadTruck(truckId: string | null) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx && truckId ? fleetKeys.detail(ctx.organizationId, truckId) : [...orgKey("none"), "trucks", "no-context"],
    queryFn: () => services.trucks.get(ctx!, truckId!),
    enabled: Boolean(ctx && truckId),
    retry: false,
  });
}

/** This organization's AVAILABLE trucks: the ones a load can book. */
export function useBookableTrucks(enabled: boolean) {
  const ctx = useServiceContext();
  const filters = {
    operationalStatus: "AVAILABLE",
    sortBy: "unitNumber",
    sortOrder: "asc",
    pageSize: 100,
  } as const;
  return useQuery({
    queryKey: ctx ? fleetKeys.list(ctx.organizationId, filters) : [...orgKey("none"), "trucks", "no-context"],
    queryFn: () => services.trucks.list(ctx!, filters),
    enabled: Boolean(ctx) && enabled,
  });
}

/** The driver on a load (people API, members:list_drivers). */
export function useLoadDriver(userId: string | null) {
  return usePerson("drivers", userId ?? "");
}

/** Active drivers to choose from, searched by name. */
export function useDriverOptions(q: string, enabled: boolean) {
  return usePeopleList("drivers", { q: q.trim() || undefined, pageSize: 50 }, enabled);
}

export { loadRecordKeys };

// ── Exceptions beside the load (F1.5) ───────────────────────────────────────

/** The load's exceptions, newest first; needs loads:view (load.read). */
export function useLoadExceptions(loadId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? loadExceptionKeys.forLoad(ctx.organizationId, loadId) : ["load-exceptions", "no-context"],
    queryFn: () => services.loadExceptions.listForLoad(ctx!, loadId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

type ExceptionAction =
  | { kind: "report"; input: ReportExceptionInput }
  | { kind: "acknowledge"; exceptionId: string }
  | { kind: "resolve"; exceptionId: string; input: ResolveExceptionInput };

/** Report, take or resolve an exception; the list and timeline refresh. */
export function useExceptionAction(loadId: string) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, idempotencyKey }: { action: ExceptionAction; idempotencyKey: string }) => {
      const exceptions = services.loadExceptions;
      switch (action.kind) {
        case "report":
          return exceptions.report(ctx!, loadId, action.input, idempotencyKey);
        case "acknowledge":
          return exceptions.acknowledge(ctx!, loadId, action.exceptionId, idempotencyKey);
        case "resolve":
          return exceptions.resolve(ctx!, loadId, action.exceptionId, action.input, idempotencyKey);
      }
    },
    onSettled: () => {
      if (!ctx) return;
      void queryClient.invalidateQueries({ queryKey: loadExceptionKeys.all(ctx.organizationId) });
      void queryClient.invalidateQueries({ queryKey: loadRecordKeys.timeline(ctx.organizationId, loadId) });
    },
  });
}

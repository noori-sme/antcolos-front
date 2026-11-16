"use client";

import {
  keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { services } from "@/lib/api";
import type { LoadFilters, LoadSort } from "@/lib/api/contracts/loads";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import { createIntentKeys } from "@/lib/rate-con/intent-key";
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

/**
 * Keys for the real loads API. A mutation writes the returned load into its
 * detail entry and invalidates the lists and that load's timeline.
 */
export const loadRecordKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "load-records"] as const,
  list: (organizationId: string, query: LoadRecordQuery) =>
    [...orgKey(organizationId), "load-records", "list", query] as const,
  detail: (organizationId: string, loadId: string) =>
    [...orgKey(organizationId), "load-records", loadId, "detail"] as const,
  timeline: (organizationId: string, loadId: string) =>
    [...orgKey(organizationId), "load-records", loadId, "timeline"] as const,
};

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
  | { kind: "correct"; to: LoadRecordStatus; reason: string };

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
    mutationFn: ({ action, idempotencyKey }: { action: LoadAction; idempotencyKey: string }) => {
      const loads = services.loadRecords;
      switch (action.kind) {
        case "step":
          return loads.transition(ctx!, loadId, action.to, idempotencyKey);
        case "cancel":
          return loads.cancel(ctx!, loadId, action.input, idempotencyKey);
        case "correct":
          return loads.correctStatus(ctx!, loadId, action.to, action.reason, idempotencyKey);
      }
    },
    onSuccess: (load: LoadRecord) => {
      if (!ctx) return;
      queryClient.setQueryData(loadRecordKeys.detail(ctx.organizationId, loadId), load);
    },
    onSettled: () => {
      if (!ctx) return;
      void queryClient.invalidateQueries({ queryKey: loadRecordKeys.all(ctx.organizationId) });
    },
  });
}

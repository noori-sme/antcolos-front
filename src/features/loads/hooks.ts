"use client";

import { useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import type { LoadFilters, LoadSort } from "@/lib/api/contracts/loads";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";

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

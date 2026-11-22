"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { usageKeys } from "@/lib/query/keys";
import { useCan } from "@/lib/session/hooks";

/** This organization's usage and estimated costs for `[from, to)` (plan 26). */
export function useOrganizationUsage(range: { from: string; to: string }) {
  const ctx = useServiceContext();
  const allowed = useCan("usage:view");
  return useQuery({
    queryKey: ctx ? usageKeys.organization(ctx.organizationId, range) : ["usage", "no-context"],
    queryFn: () => services.usage.organization(ctx!, range),
    enabled: Boolean(ctx) && allowed,
    placeholderData: keepPreviousData,
  });
}

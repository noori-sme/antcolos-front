"use client";

import { useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";

export function useHomeSummary() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.home(ctx.organizationId, ctx.membershipId)
      : ["home", "no-context"],
    queryFn: () => services.home.summary(ctx!),
    enabled: Boolean(ctx),
  });
}

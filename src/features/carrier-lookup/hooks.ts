"use client";

import { useQuery } from "@tanstack/react-query";
import { CarrierLookupError } from "@/lib/carriers/lookup";
import { orgKey } from "@/lib/query/keys";
import { authApi } from "@/lib/session/auth-api";
import type { CarrierIdentifier } from "@/types/carrier-lookup";

/**
 * The public carrier lookup (plan 09). Public FMCSA data, outside any tenant,
 * so it is keyed under the "public" pseudo-org like onboarding's lookup.
 * Only a network or upstream failure is retried; 400/404/429 answers are final.
 */
export function usePublicCarrierLookup(id: CarrierIdentifier | null) {
  return useQuery({
    queryKey: [...orgKey("public"), "carriers", "lookup", id?.kind ?? "none", id?.value ?? ""],
    queryFn: () => authApi.lookupCarrierPublic(id!),
    enabled: Boolean(id),
    retry: (count, error) =>
      count < 1 && error instanceof CarrierLookupError && error.kind === "unavailable",
    staleTime: 5 * 60 * 1000,
  });
}

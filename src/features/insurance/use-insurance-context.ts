"use client";

import { useMemo } from "react";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  insuranceContextFrom, type InsuranceContext,
} from "@/lib/api/mock/insurance-registry";

/**
 * The insurance registry context for the signed-in membership.
 *
 * Built from the ServiceContext and nowhere else, so the organization a call
 * acts in comes from the active membership rather than from a route param, a
 * prop or a form field. A screen cannot ask the registry to be somebody else.
 */
export function useInsuranceContext(): InsuranceContext | null {
  const ctx = useServiceContext();
  return useMemo(() => (ctx ? insuranceContextFrom(ctx) : null), [ctx]);
}

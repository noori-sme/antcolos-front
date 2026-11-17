import { z } from "zod";
import {
  LOAD_EXCEPTION_SEVERITIES, LOAD_EXCEPTION_TYPES,
  type LoadException, type LoadExceptionType,
} from "@/types/load-exception";

/** What a person sees for each exception type (contract §14). */
export const EXCEPTION_TYPE_LABEL: Record<LoadExceptionType, string> = {
  pickup_delay: "Pickup delay",
  delivery_delay: "Delivery delay",
  facility_issue: "Facility issue",
  truck_breakdown: "Truck breakdown",
  driver_unavailable: "Driver unavailable",
  broker_change: "Broker change",
  missing_document: "Missing document",
  rate_dispute: "Rate dispute",
  payment_dispute: "Payment dispute",
  tracking_failure: "Tracking failure",
  other: "Something else",
};

/** Mirrors ReportExceptionDto: type, severity, notes 1–2000. */
export const reportExceptionSchema = z.object({
  type: z.enum(LOAD_EXCEPTION_TYPES),
  severity: z.enum(LOAD_EXCEPTION_SEVERITIES),
  notes: z.string().trim().min(1, "Say what happened.").max(2000, "Keep it under 2000 characters."),
  stopSequence: z.string(),
});

/** Mirrors ResolveExceptionDto: resolution 1–2000, impact 0 – 999999.99 USD. */
export const resolveExceptionSchema = z.object({
  resolution: z.string().trim().min(1, "Say how it was resolved.").max(2000, "Keep it under 2000 characters."),
  financialImpact: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,6}(\.\d{1,2})?$/.test(v), "Enter an amount like 150.00."),
});

/** Open ones first (critical first), then the rest newest first. */
export function sortExceptions(items: LoadException[]): LoadException[] {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return [...items].sort((a, b) => {
    const aOpen = a.status !== "resolved";
    const bOpen = b.status !== "resolved";
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen && rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return b.openedAt.localeCompare(a.openedAt);
  });
}

/** How many still need someone (open or acknowledged). */
export const unresolvedCount = (items: LoadException[]) =>
  items.filter((e) => e.status !== "resolved").length;

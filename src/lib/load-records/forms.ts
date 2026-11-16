import { z } from "zod";

/** Mirrors the backend's CancelLoadDto (loads-api-contract.md §5). */
export const cancelSchema = z.object({
  reason: z.string().trim().min(1, "Say why the load is cancelled.").max(500, "Keep it under 500 characters."),
  party: z.enum(["", "broker", "shipper", "carrier", "other"]),
  tonuAmount: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,6}(\.\d{1,2})?$/.test(v), "Enter an amount like 150.00."),
});

/** Mirrors CorrectLoadStatusDto (§7). */
export const correctSchema = z.object({
  to: z.string().min(1, "Choose the status to go back to."),
  reason: z.string().trim().min(1, "Say why the status is corrected.").max(500, "Keep it under 500 characters."),
});

/**
 * The intent behind one submit: the same values retried reuse their
 * Idempotency-Key; changed values are a new intent with a new key.
 */
export function intentOf(kind: string, values: Record<string, string>): string {
  return `${kind}:${JSON.stringify(values)}`;
}

import { describe, expect, it } from "vitest";
import type { LoadException } from "@/types/load-exception";
import { canAll } from "@/lib/permissions/can";
import type { PermissionKey } from "@/types/permission";
import {
  MANAGE_EXCEPTION_KEYS, REPORT_EXCEPTION_KEYS, reportExceptionSchema, resolveExceptionSchema, sortExceptions, unresolvedCount,
} from "./forms";

const ex = (extras: Partial<LoadException>): LoadException => ({
  id: "x", loadId: "l", brokerLoadNumber: null, stopSequence: null, type: "other",
  severity: "low", status: "open", notes: "n", occurredAt: "", openedAt: "2026-01-01T00:00:00Z",
  openedByUserId: "u", source: "web", ownerUserId: null, acknowledgedAt: null,
  resolution: null, resolvedAt: null, financialImpact: null, ...extras,
});

describe("load exception forms", () => {
  it("requires notes and refuses what the API refuses", () => {
    expect(reportExceptionSchema.safeParse({ type: "other", severity: "low", notes: "  ", stopSequence: "" }).success).toBe(false);
    expect(reportExceptionSchema.safeParse({ type: "other", severity: "low", notes: "x".repeat(2001), stopSequence: "" }).success).toBe(false);
    expect(reportExceptionSchema.safeParse({ type: "aliens", severity: "low", notes: "x", stopSequence: "" }).success).toBe(false);
    expect(reportExceptionSchema.safeParse({ type: "pickup_delay", severity: "high", notes: "Late", stopSequence: "1" }).success).toBe(true);
  });

  it("accepts an empty or a dollar amount for the cost", () => {
    expect(resolveExceptionSchema.safeParse({ resolution: "Done", financialImpact: "" }).success).toBe(true);
    expect(resolveExceptionSchema.safeParse({ resolution: "Done", financialImpact: "150.00" }).success).toBe(true);
    expect(resolveExceptionSchema.safeParse({ resolution: "Done", financialImpact: "-5" }).success).toBe(false);
    expect(resolveExceptionSchema.safeParse({ resolution: "Done", financialImpact: "1000000" }).success).toBe(false);
    expect(resolveExceptionSchema.safeParse({ resolution: "", financialImpact: "" }).success).toBe(false);
  });

  it("puts unresolved first, most severe first, then newest", () => {
    const sorted = sortExceptions([
      ex({ id: "resolved-new", status: "resolved", openedAt: "2026-03-01T00:00:00Z" }),
      ex({ id: "low", severity: "low" }),
      ex({ id: "critical", severity: "critical", status: "acknowledged" }),
      ex({ id: "resolved-old", status: "resolved", openedAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["critical", "low", "resolved-new", "resolved-old"]);
    expect(unresolvedCount(sorted)).toBe(2);
  });

  it("gates the dispatcher actions as the contract does", () => {
    const seat = (...keys: PermissionKey[]) => new Set<PermissionKey>(keys);
    // A dispatcher holds both: report, take, resolve.
    expect(canAll(seat("loads:edit", "loads:respond"), REPORT_EXCEPTION_KEYS)).toBe(true);
    expect(canAll(seat("loads:edit", "loads:respond"), MANAGE_EXCEPTION_KEYS)).toBe(true);
    // loads:edit alone would get a 403 on report (load.respond is required).
    expect(canAll(seat("loads:edit"), REPORT_EXCEPTION_KEYS)).toBe(false);
    // A driver (loads:respond only) sees none of these; they report from the driver app.
    expect(canAll(seat("loads:respond"), REPORT_EXCEPTION_KEYS)).toBe(false);
    expect(canAll(seat("loads:respond"), MANAGE_EXCEPTION_KEYS)).toBe(false);
  });
});

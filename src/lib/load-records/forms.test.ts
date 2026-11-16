import { describe, expect, it } from "vitest";
import { cancelSchema, correctSchema, intentOf } from "./forms";

describe("load action forms (plan 14)", () => {
  it("needs a cancel reason and accepts what the API accepts", () => {
    expect(cancelSchema.safeParse({ reason: " ", party: "", tonuAmount: "" }).success).toBe(false);
    expect(
      cancelSchema.safeParse({ reason: "Broker", party: "broker", tonuAmount: "150.00" }).success,
    ).toBe(true);
    expect(cancelSchema.safeParse({ reason: "x", party: "", tonuAmount: "" }).success).toBe(true);
  });

  it("refuses a TONU the API would refuse", () => {
    for (const tonuAmount of ["-5", "12.345", "1000000", "abc"]) {
      expect(cancelSchema.safeParse({ reason: "x", party: "", tonuAmount }).success).toBe(false);
    }
    expect(cancelSchema.safeParse({ reason: "x".repeat(501), party: "", tonuAmount: "" }).success).toBe(false);
  });

  it("needs a target and a reason for a correction", () => {
    expect(correctSchema.safeParse({ to: "", reason: "x" }).success).toBe(false);
    expect(correctSchema.safeParse({ to: "loaded", reason: " " }).success).toBe(false);
    expect(correctSchema.safeParse({ to: "loaded", reason: "Pressed too early" }).success).toBe(true);
  });

  it("gives changed values a new intent", () => {
    expect(intentOf("cancel", { reason: "a" })).toBe(intentOf("cancel", { reason: "a" }));
    expect(intentOf("cancel", { reason: "a" })).not.toBe(intentOf("cancel", { reason: "b" }));
  });
});

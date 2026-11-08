import { describe, expect, it } from "vitest";
import { slotForRequest } from "./idempotency-key";

describe("slotForRequest", () => {
  let n = 0;
  const mint = () => `key-${++n}`;

  it("keeps the key for an identical retry", () => {
    const first = slotForRequest(null, { route: "/trucks", body: { vin: "V" } }, mint);
    const retry = slotForRequest(first, { route: "/trucks", body: { vin: "V" } }, mint);
    expect(retry.key).toBe(first.key);
  });

  it("mints a new key when the body changes (a corrected submit after a failure)", () => {
    const first = slotForRequest(null, { route: "/trucks", body: { unitNumber: "104" } }, mint);
    const fixed = slotForRequest(first, { route: "/trucks", body: { unitNumber: "105" } }, mint);
    expect(fixed.key).not.toBe(first.key);
  });

  it("mints a new key when the route changes (another status, another assignment)", () => {
    const first = slotForRequest(null, { route: "/trucks/t1/unavailable" }, mint);
    const other = slotForRequest(first, { route: "/trucks/t1/maintenance" }, mint);
    expect(other.key).not.toBe(first.key);
  });
});

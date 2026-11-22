import { describe, expect, it } from "vitest";
import { credentialTitle, credentialTone, expiresSoon, needsReason, nextStatuses } from "./status";

const DAY = 86_400_000;
const now = new Date();
const inDays = (days: number) => new Date(now.getTime() + days * DAY).toISOString();

describe("driver credential status rules", () => {
  it("offers the backend's transitions", () => {
    expect(nextStatuses({ status: "NOT_HELD", expiresAt: null }, now)).toEqual(["PENDING", "ACTIVE"]);
    expect(nextStatuses({ status: "ACTIVE", expiresAt: inDays(90) }, now)).toEqual(["SUSPENDED", "REVOKED", "EXPIRED"]);
    expect(nextStatuses({ status: "REVOKED", expiresAt: null }, now)).toEqual(["PENDING"]);
  });

  it("does not offer ACTIVE while the expiry date has passed", () => {
    expect(nextStatuses({ status: "EXPIRED", expiresAt: inDays(-1) }, now)).toEqual(["PENDING"]);
    expect(nextStatuses({ status: "EXPIRED", expiresAt: inDays(10) }, now)).toEqual(["PENDING", "ACTIVE"]);
  });

  it("asks a reason for suspend and revoke only", () => {
    expect(needsReason("SUSPENDED")).toBe(true);
    expect(needsReason("REVOKED")).toBe(true);
    expect(needsReason("ACTIVE")).toBe(false);
  });

  it("flags an ACTIVE credential expiring within 30 days", () => {
    expect(expiresSoon({ status: "ACTIVE", expiresAt: inDays(10) }, now)).toBe(true);
    expect(expiresSoon({ status: "ACTIVE", expiresAt: inDays(45) }, now)).toBe(false);
    expect(expiresSoon({ status: "ACTIVE", expiresAt: inDays(-1) }, now)).toBe(false);
    expect(expiresSoon({ status: "PENDING", expiresAt: inDays(10) }, now)).toBe(false);
    expect(expiresSoon({ status: "ACTIVE", expiresAt: null }, now)).toBe(false);
  });

  it("maps tones and titles", () => {
    expect(credentialTone("ACTIVE")).toBe("success");
    expect(credentialTone("REVOKED")).toBe("danger");
    expect(credentialTitle({ type: "CDL", label: "Class A" })).toBe("CDL · Class A");
    expect(credentialTitle({ type: "MEDICAL_CARD", label: "" })).toBe("Medical card");
  });
});

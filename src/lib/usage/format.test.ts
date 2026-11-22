import { describe, expect, it } from "vitest";
import { bytes, notMeteredLabel, rangeFor, usd } from "./format";

describe("usage format", () => {
  it("formats money with more precision under a dollar", () => {
    expect(usd(0.0127)).toBe("$0.0127");
    expect(usd(3.4254)).toBe("$3.43");
    expect(usd(1204.5)).toBe("$1,204.50");
    expect(usd(0)).toBe("$0.00");
  });

  it("formats bytes", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(912345678)).toBe("870 MB");
    expect(bytes(1.2 * 1024 ** 3)).toBe("1.2 GB");
  });

  it("builds UTC day ranges that include today", () => {
    expect(rangeFor("7d", new Date("2026-11-22T15:30:00.000Z"))).toEqual({
      from: "2026-11-16T00:00:00.000Z",
      to: "2026-11-23T00:00:00.000Z",
    });
  });

  it("names what is not metered", () => {
    expect(notMeteredLabel("fmcsa_lookups")).toBe("FMCSA lookups");
    expect(notMeteredLabel("sms_messages")).toBe("sms messages");
  });
});

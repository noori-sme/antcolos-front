import { describe, expect, it } from "vitest";
import { checkCorrection, fieldLabel, inputKindFor, stopLabel } from "./fields";

describe("fieldLabel", () => {
  it("names top-level fields", () => {
    expect(fieldLabel("totalRate")).toBe("Total rate");
    expect(fieldLabel("brokerMcNumber")).toBe("Broker MC");
    expect(fieldLabel("loadNumber")).toBe("Load number");
  });

  it("numbers stops and lists from 1", () => {
    expect(fieldLabel("pickups.0.address.city")).toBe("Pickup 1 · City");
    expect(fieldLabel("deliveries.1.windowStart")).toBe("Delivery 2 · Window start");
    expect(fieldLabel("additionalStops.0.kind")).toBe("Extra stop 1 · Kind");
    expect(fieldLabel("accessorials.2.amount")).toBe("Accessorial 3 · Amount");
    expect(fieldLabel("referenceNumbers.0")).toBe("Reference number 1");
    expect(fieldLabel("brokerAddress.line1")).toBe("Broker address · Street");
  });

  it("falls back to the path for something it does not know", () => {
    expect(fieldLabel("someFutureField")).toBe("someFutureField");
  });
});

describe("stopLabel", () => {
  it("names draft stops", () => {
    expect(stopLabel("stops[0].scheduledDate")).toBe("Stop 1 · Date");
    expect(stopLabel("rateTotal")).toBe("Rate");
    expect(stopLabel("stops.delivery")).toBe("A delivery stop");
  });
});

describe("inputKindFor", () => {
  it("picks the editor from the path, as the backend formats do", () => {
    expect(inputKindFor("totalRate")).toBe("money");
    expect(inputKindFor("accessorials.0.amount")).toBe("money");
    expect(inputKindFor("pickups.0.date")).toBe("date");
    expect(inputKindFor("deliveries.0.windowEnd")).toBe("time");
    expect(inputKindFor("currency")).toBe("currency");
    expect(inputKindFor("brokerMcNumber")).toBe("mc");
    expect(inputKindFor("brokerName")).toBe("text");
  });
});

describe("checkCorrection", () => {
  it("trims, and an empty value means not on the document", () => {
    expect(checkCorrection("brokerName", "  Acme  ")).toEqual({ ok: true, value: "Acme" });
    expect(checkCorrection("totalRate", "   ")).toEqual({ ok: true, value: null });
  });

  it("checks money and writes two decimals", () => {
    expect(checkCorrection("totalRate", "2500")).toEqual({ ok: true, value: "2500.00" });
    expect(checkCorrection("totalRate", "75.5")).toEqual({ ok: true, value: "75.50" });
    // Kept as a string: no float rounding on large amounts.
    expect(checkCorrection("totalRate", "90071992547409931.99")).toEqual({
      ok: true,
      value: "90071992547409931.99",
    });
    for (const bad of ["2,500", "$2500", "-10", "12.345", "abc"]) {
      expect(checkCorrection("linehaulRate", bad).ok).toBe(false);
    }
  });

  it("checks calendar dates, 24-hour times, currency and broker MC", () => {
    expect(checkCorrection("pickups.0.date", "2026-11-20")).toEqual({ ok: true, value: "2026-11-20" });
    expect(checkCorrection("pickups.0.date", "2026-02-30").ok).toBe(false);
    expect(checkCorrection("pickups.0.windowStart", "08:00").ok).toBe(true);
    expect(checkCorrection("pickups.0.windowStart", "8:00").ok).toBe(false);
    expect(checkCorrection("currency", "usd")).toEqual({ ok: true, value: "USD" });
    expect(checkCorrection("brokerMcNumber", "MC-1").ok).toBe(false);
    expect(checkCorrection("brokerMcNumber", "123456").ok).toBe(true);
  });

  it("limits text to 500 characters", () => {
    expect(checkCorrection("specialInstructions", "a".repeat(500)).ok).toBe(true);
    expect(checkCorrection("specialInstructions", "a".repeat(501)).ok).toBe(false);
  });
});

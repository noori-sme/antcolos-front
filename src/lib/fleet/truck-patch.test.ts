import { describe, expect, it } from "vitest";
import { buildTruckPatch } from "./truck-patch";

const before = {
  unitNumber: "104",
  homeTerminalCity: "Fresno",
  homeTerminalState: "CA",
  notes: "Prefers West Coast lanes",
  year: "2022",
  make: "Freightliner",
};

describe("buildTruckPatch (fleet contract §4)", () => {
  const fields = Object.keys(before);

  it("sends nothing when nothing changed", () => {
    expect(buildTruckPatch(before, { ...before }, fields)).toEqual({});
  });

  it("sends only changed fields, clears with null, uppercases states, numbers the year", () => {
    expect(
      buildTruckPatch(
        before,
        { ...before, unitNumber: "105", notes: "", homeTerminalState: "tx", year: "2023" },
        fields,
      ),
    ).toEqual({ unitNumber: "105", notes: null, homeTerminalState: "TX", year: 2023 });
  });

  it("ignores fields the caller may not edit", () => {
    expect(
      buildTruckPatch(before, { ...before, make: "Volvo", unitNumber: "9" }, ["unitNumber"]),
    ).toEqual({ unitNumber: "9" });
  });

  it("sets a previously empty optional field", () => {
    expect(
      buildTruckPatch({ ...before, make: "" }, { ...before, make: "Kenworth" }, fields),
    ).toEqual({ make: "Kenworth" });
  });

  it("sends capability numbers as numbers and yes/no/unknown as true/false/null (plan 46)", () => {
    const capBefore = { strapCount: "", hasLiftgate: "", hasPalletJack: "yes", reeferMinTempF: "-10" };
    expect(
      buildTruckPatch(
        capBefore,
        { strapCount: "12", hasLiftgate: "no", hasPalletJack: "", reeferMinTempF: "-20" },
        Object.keys(capBefore),
      ),
    ).toEqual({ strapCount: 12, hasLiftgate: false, hasPalletJack: null, reeferMinTempF: -20 });
  });
});

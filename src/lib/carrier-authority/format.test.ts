import { describe, expect, it } from "vitest";
import { authorityAgeText, authorityList } from "./format";

describe("authorityAgeText", () => {
  it("reads years and months, rounding down", () => {
    expect(authorityAgeText(2420)).toBe("6 years 7 months");
    expect(authorityAgeText(365)).toBe("1 year");
    expect(authorityAgeText(400)).toBe("1 year 1 month");
    expect(authorityAgeText(45)).toBe("1 month");
    expect(authorityAgeText(10)).toBe("10 days");
    expect(authorityAgeText(1)).toBe("1 day");
  });

  it("says unknown when FMCSA gave no start date", () => {
    expect(authorityAgeText(null)).toBe("Age unknown");
  });
});

it("lists authorities as FMCSA reports them", () => {
  expect(authorityList([{ docketNumber: "MC123456", type: "COMMON", status: "A" }])).toBe("MC123456 · Common · Active");
  expect(authorityList([{ docketNumber: "MC1", type: "BROKER", status: "I" }, { docketNumber: "MC2", type: "CONTRACT", status: "X" }])).toBe(
    "MC1 · Broker · Inactive; MC2 · Contract · X",
  );
  expect(authorityList([])).toBe("None on record");
});

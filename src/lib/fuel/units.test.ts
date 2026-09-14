import { describe, expect, it } from "vitest";
import {
  averagePriceMills, costPerMileMills, deemedGallonsThousandths, formatCostPerMile,
  formatGallons, formatMpg, formatPricePerGallon, mpgHundredths, parseCents,
  parseGallons, parseMiles, parsePriceMills, ratio, roundHalfUp,
} from "./units";

describe("fixed-point fuel arithmetic", () => {
  it("rounds half away from zero, not to even", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(3.5)).toBe(4);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  it("returns zero rather than infinity when there is nothing to divide by", () => {
    expect(ratio(100, 0, 100)).toBe(0);
    expect(mpgHundredths(1000, 0)).toBe(0);
    expect(costPerMileMills(10_000, 0)).toBe(0);
    expect(averagePriceMills(10_000, 0)).toBe(0);
    expect(deemedGallonsThousandths(1000, 0)).toBe(0);
  });

  it("computes MPG in hundredths from whole miles and thousandths of a gallon", () => {
    // 1,000 miles on 153.400 gallons = 6.5189… → 6.52
    expect(mpgHundredths(1_000, 153_400)).toBe(652);
    // A round number stays round.
    expect(mpgHundredths(600, 100_000)).toBe(600);
  });

  it("computes cost per mile in mills", () => {
    // $1,204.11 over 2,066 miles = $0.58282… → 583 mills
    expect(costPerMileMills(120_411, 2_066)).toBe(583);
  });

  it("computes an average pump price in mills", () => {
    // $328.51 for 84.219 gal = $3.9006… → 3901 mills
    expect(averagePriceMills(32_851, 84_219)).toBe(3901);
  });

  it("deems gallons burned from taxable miles and fleet MPG", () => {
    // 1,000 taxable miles at 6.52 MPG = 153.374 gallons
    expect(deemedGallonsThousandths(1_000, 652)).toBe(153_374);
  });

  it("never loses a third decimal on gallons or pump price", () => {
    expect(formatGallons(84_219)).toBe("84.219 gal");
    expect(formatGallons(84_219, { unit: false })).toBe("84.219");
    expect(formatPricePerGallon(3_899)).toBe("$3.899");
    expect(formatCostPerMile(583)).toBe("$0.583/mi");
    expect(formatMpg(652)).toBe("6.52 MPG");
  });

  it("renders an absent MPG as a dash rather than zero", () => {
    expect(formatMpg(0)).toBe("—");
  });

  describe("parsing", () => {
    it("accepts what a receipt actually carries", () => {
      expect(parseGallons("84.219")).toBe(84_219);
      expect(parseGallons(" 84 ")).toBe(84_000);
      expect(parsePriceMills("$3.899")).toBe(3_899);
      expect(parseCents("1,204.11")).toBe(120_411);
      expect(parseMiles("2,066")).toBe(2_066);
    });

    it("rejects anything that is not a number, rather than guessing", () => {
      expect(parseGallons("84.2194")).toBeNull();
      expect(parseGallons("-84")).toBeNull();
      expect(parseGallons("eighty")).toBeNull();
      expect(parsePriceMills("3.8991")).toBeNull();
      expect(parseCents("12.345")).toBeNull();
      expect(parseMiles("20.5")).toBeNull();
    });
  });
});

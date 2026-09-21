import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFreeEmailDomain, nameSimilarity, normalizeAddressKey, normalizeCompanyName,
  normalizeDotNumber, normalizeEmail, normalizeEmailDomain, normalizeLocalityKey,
  normalizeMcNumber, normalizePersonName, normalizePhone, normalizePostalCode,
  normalizeScac, normalizeState, normalizeStreet,
} from "../src/lib/directory/normalize";

/**
 * Normalization is where a wrong answer does the most damage: a key that is too
 * loose merges two companies, and the merge shows up weeks later as a load
 * billed to the wrong broker. So these tests care as much about what the
 * functions REFUSE to produce as about what they produce.
 */

describe("normalizeMcNumber", () => {
  it("reduces every printed form to the same digits", () => {
    for (const printed of ["MC-612884", "mc 612884", "MC612884", "612884", " 612884 "]) {
      assert.equal(normalizeMcNumber(printed), "612884");
    }
  });

  it("drops leading zeros so a padded number still matches", () => {
    assert.equal(normalizeMcNumber("MC-0612884"), "612884");
  });

  it("refuses implausible numbers rather than returning a partial one", () => {
    assert.equal(normalizeMcNumber("MC-12"), undefined);
    assert.equal(normalizeMcNumber("123456789012"), undefined);
    assert.equal(normalizeMcNumber(""), undefined);
    assert.equal(normalizeMcNumber(undefined), undefined);
  });
});

describe("normalizeDotNumber", () => {
  it("normalizes a USDOT number", () => {
    assert.equal(normalizeDotNumber("USDOT 2884110"), "2884110");
    assert.equal(normalizeDotNumber("2884110"), "2884110");
  });

  it("refuses anything shorter than five digits", () => {
    assert.equal(normalizeDotNumber("1234"), undefined);
  });
});

describe("normalizeScac", () => {
  it("accepts exactly four letters", () => {
    assert.equal(normalizeScac("abcd"), "ABCD");
    assert.equal(normalizeScac("ABC"), undefined);
    assert.equal(normalizeScac("ABCDE"), undefined);
  });
});

describe("normalizeCompanyName", () => {
  it("strips a suffix that another suffix was hiding", () => {
    // Regression. These two rules used to run once each, in order, so a
    // spelled-out "L.L.C." was dropped and the "Group" behind it was not —
    // giving one company two keys, which is the exact failure this module
    // exists to prevent.
    const expected = "cornerstone freight";
    for (const printed of [
      "Cornerstone Freight Group LLC",
      "Cornerstone Freight Group, L.L.C.",
      "CORNERSTONE FREIGHT GROUP, L.L.C.",
      "Cornerstone Freight Holdings Inc",
      "Cornerstone Freight International Corp",
    ]) {
      assert.equal(normalizeCompanyName(printed), expected, printed);
    }
  });

  it("never strips a name down to nothing", () => {
    // A name made only of suffixes keeps its first word rather than vanishing.
    assert.equal(normalizeCompanyName("Group LLC"), "group");
  });

  it("folds the ways one company gets printed into one key", () => {
    const expected = "apex logistics";
    for (const printed of [
      "Apex Logistics LLC",
      "APEX LOGISTICS, LLC",
      "Apex Logistics, L.L.C.",
      "  apex   logistics inc  ",
      "The Apex Logistics Company",
    ]) {
      assert.equal(normalizeCompanyName(printed), expected, printed);
    }
  });

  it("strips a suffix only at the end, never mid-name", () => {
    assert.equal(normalizeCompanyName("Corporate Freight Systems"), "corporate freight systems");
  });

  it("refuses a key too generic to be safe", () => {
    // Two letters and a suffix would match a hundred companies.
    assert.equal(normalizeCompanyName("A&B LLC"), undefined);
    assert.equal(normalizeCompanyName("Co"), undefined);
    assert.equal(normalizeCompanyName(""), undefined);
  });

  it("keeps distinct companies distinct", () => {
    assert.notEqual(
      normalizeCompanyName("Tandem Freight Partners Inc."),
      normalizeCompanyName("Tandem Freight Services LLC"),
    );
  });
});

describe("normalizePersonName", () => {
  it("drops honorifics and suffixes", () => {
    assert.equal(normalizePersonName("Mr. Dana Wells Jr."), "dana wells");
  });

  it("keeps a single first name rather than discarding it", () => {
    assert.equal(normalizePersonName("Dave"), "dave");
  });
});

describe("normalizePhone", () => {
  it("folds every printed form to ten digits", () => {
    for (const printed of [
      "(312) 555-0110", "312-555-0110", "312.555.0110", "+1 312 555 0110", "13125550110",
    ]) {
      assert.equal(normalizePhone(printed), "3125550110", printed);
    }
  });

  it("refuses anything that is not a plausible number", () => {
    assert.equal(normalizePhone("555-0110"), undefined);
    assert.equal(normalizePhone("1125550110"), undefined); // area code cannot start with 1
    assert.equal(normalizePhone(""), undefined);
  });
});

describe("email", () => {
  it("normalizes a whole address", () => {
    assert.equal(normalizeEmail("  Dana@ApexLog.Example "), "dana@apexlog.example");
    assert.equal(normalizeEmail("not-an-email"), undefined);
  });

  it("treats a company domain as a signal", () => {
    assert.equal(normalizeEmailDomain("dana@apexlog.example"), "apexlog.example");
  });

  it("refuses a free provider as a company signal", () => {
    // Two dispatchers at gmail.com are not colleagues.
    assert.equal(normalizeEmailDomain("dana@gmail.com"), undefined);
    assert.equal(normalizeEmailDomain("someone@yahoo.com"), undefined);
    assert.equal(isFreeEmailDomain("dana@gmail.com"), true);
    assert.equal(isFreeEmailDomain("dana@apexlog.example"), false);
  });
});

describe("addresses", () => {
  it("folds street types and directionals", () => {
    assert.equal(normalizeStreet("5600 W 73rd Street"), normalizeStreet("5600 West 73rd St"));
    assert.equal(normalizeStreet("3300 N Main St"), normalizeStreet("3300 North Main Street"));
  });

  it("strips the suite, because a facility is a building", () => {
    assert.equal(
      normalizeStreet("400 W Monroe St, Suite 1800"),
      normalizeStreet("400 W Monroe Street"),
    );
  });

  it("builds one key from the printed variants of one address", () => {
    const a = normalizeAddressKey({
      line1: "2900 Charter St", city: "Columbus", state: "OH", postalCode: "43228",
    });
    const b = normalizeAddressKey({
      line1: "2900 Charter Street", city: "COLUMBUS", state: "oh", postalCode: "43228-1140",
    });
    assert.ok(a);
    assert.equal(a, b);
  });

  it("refuses a key without a street, rather than keying on a city", () => {
    // A city-only key would match every facility in Dallas.
    assert.equal(normalizeAddressKey({ city: "Dallas", state: "TX" }), undefined);
    assert.equal(normalizeAddressKey(undefined), undefined);
  });

  it("still offers the weak locality signal separately", () => {
    assert.equal(normalizeLocalityKey({ city: "Elkhart", state: "IN" }), "elkhart|IN");
  });

  it("normalizes postal codes and states", () => {
    assert.equal(normalizePostalCode("60606-1234"), "60606");
    assert.equal(normalizePostalCode("606"), undefined);
    assert.equal(normalizeState("il"), "IL");
    assert.equal(normalizeState("Illinois"), undefined);
  });
});

describe("nameSimilarity", () => {
  it("is 1 for identical keys and 0 when either side is missing", () => {
    assert.equal(nameSimilarity("apex logistics", "apex logistics"), 1);
    assert.equal(nameSimilarity(undefined, "apex logistics"), 0);
  });

  it("sits in between for overlapping names", () => {
    const score = nameSimilarity("tandem freight", "tandem freight partners");
    assert.ok(score > 0 && score < 1, `expected a partial score, got ${score}`);
  });
});

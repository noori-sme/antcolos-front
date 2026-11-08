import { describe, expect, it } from "vitest";
import {
  carrierLookupErrorKind, formatAddress, formatPhone, parseCarrierIdentifier,
  toCarrierLookupResult, type CarrierLookupDto,
} from "./lookup";

// From ../antcolos/docs/requirements/carrier-lookup.md §8.2.
const FULL: CarrierLookupDto = {
  dotNumber: "44110",
  mcNumber: "MC1515",
  legalName: "GREYHOUND LINES INC",
  dbaName: "BOLT BUS",
  phone: "2147776005",
  email: null,
  active: true,
  address: { street: "350 N SAINT PAUL ST", city: "DALLAS", state: "TX", zip: "75201", country: "US" },
  mailingAddress: { street: null, city: null, state: null, zip: null },
  sources: { identity: "qcmobile", email: "company-census", mailingAddress: "company-census" } as CarrierLookupDto["sources"],
};

const PARTIAL: CarrierLookupDto = {
  ...FULL,
  dbaName: null,
  sources: { identity: "qcmobile", email: "company-census", mailingAddress: "company-census", census: "unavailable" } as CarrierLookupDto["sources"],
};

describe("parseCarrierIdentifier (contract §8.1)", () => {
  it.each([
    ["mc", "1515", "1515"],
    ["mc", "MC1515", "1515"],
    ["mc", "mc1515", "1515"],
    ["mc", "  MC001515 ", "001515"],
    ["dot", "44110", "44110"],
    ["dot", "044110", "044110"],
  ] as const)("accepts %s %j", (kind, raw, value) => {
    expect(parseCarrierIdentifier(kind, raw)).toEqual({ kind, value });
  });

  it.each([
    ["mc", "MC-1515"],
    ["mc", "MC 1515"],
    ["mc", "1515A"],
    ["mc", "123456789"],
    ["mc", ""],
    ["dot", "MC1515"],
    ["dot", "12a"],
    ["dot", "123456789"],
  ] as const)("refuses %s %j", (kind, raw) => {
    expect(parseCarrierIdentifier(kind, raw)).toBeNull();
  });
});

describe("toCarrierLookupResult", () => {
  it("maps the contract example", () => {
    expect(toCarrierLookupResult(FULL)).toEqual({
      dotNumber: "44110",
      mcNumber: "MC1515",
      legalName: "GREYHOUND LINES INC",
      dbaName: "BOLT BUS",
      phone: "2147776005",
      email: null,
      active: true,
      address: { street: "350 N SAINT PAUL ST", city: "DALLAS", state: "TX", zip: "75201", country: "US" },
      mailingAddress: { street: null, city: null, state: null, zip: null },
      censusUnavailable: false,
    });
  });

  it("flags a partial profile when the census was unavailable", () => {
    expect(toCarrierLookupResult(PARTIAL).censusUnavailable).toBe(true);
  });

  it("turns blank strings into null and never invents data", () => {
    const r = toCarrierLookupResult({ ...FULL, email: "  ", dbaName: "", address: { ...FULL.address, street: " " } });
    expect(r.email).toBeNull();
    expect(r.dbaName).toBeNull();
    expect(r.address.street).toBeNull();
  });
});

describe("carrierLookupErrorKind", () => {
  it.each([
    [400, "invalid_identifier"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "not_configured"],
    [502, "unavailable"],
    [undefined, "unavailable"],
  ] as const)("%s → %s", (status, kind) => {
    expect(carrierLookupErrorKind(status)).toBe(kind);
  });
});

describe("formatting", () => {
  it("formats 10-digit phones and leaves others alone", () => {
    expect(formatPhone("2147776005")).toBe("(214) 777-6005");
    expect(formatPhone("12147776005")).toBe("(214) 777-6005");
    expect(formatPhone("4412")).toBe("4412");
    expect(formatPhone(null)).toBeNull();
  });

  it("joins an address and returns null when nothing is on file", () => {
    expect(formatAddress(FULL.address as never)).toBe("350 N SAINT PAUL ST, DALLAS, TX 75201");
    expect(formatAddress({ street: null, city: null, state: null, zip: null })).toBeNull();
  });
});

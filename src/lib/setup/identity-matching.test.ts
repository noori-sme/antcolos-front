import { describe, expect, it } from "vitest";
import { rank, scorePerson, scoreTruck, type PersonRecord, type TruckRecord } from "./identity-matching";
import type { PersonClaim, TruckClaim } from "@/types";

/**
 * ★ WHAT MAY AND MAY NOT BE CALLED THE SAME PERSON ★
 *
 * These are the rules a fifty-driver import stands on. Getting one wrong either
 * creates a second permanent professional profile for somebody who already has
 * one, or attaches a carrier to a stranger's licence and medical card — and
 * both are the kind of mistake nobody finds for months.
 *
 * Nothing here touches a store. The module ranks, explains, and refuses.
 */

const person = (over: Partial<PersonClaim> = {}): PersonClaim =>
  ({ kind: "person", fullName: "Maria Santos", ...over });

const record = (over: Partial<PersonRecord> = {}): PersonRecord =>
  ({ entityId: "dp_1", legalName: "Maria Santos", ...over });

describe("a licence number is the one thing that identifies a driver", () => {
  it("matches exactly on CDL and state together", () => {
    const candidate = scorePerson(
      person({ cdlNumber: "K447-118-2993", cdlState: "il" }),
      record({ cdlNumber: "K4471182993", cdlState: "IL" }),
    );
    expect(candidate.confidence).toBe("exact");
    expect(candidate.signals.some((s) => s.decisive)).toBe(true);
    expect(rank([candidate]).outcome).toBe("matched");
  });

  it("does not match on the number alone, because states reuse them", () => {
    // Same digits, different issuing state: two licences, two people.
    const candidate = scorePerson(
      person({ cdlNumber: "K4471182993", cdlState: "IL" }),
      record({ cdlNumber: "K4471182993", cdlState: "TX" }),
    );
    expect(candidate.confidence).not.toBe("exact");
    expect(candidate.conflicts.map((c) => c.code)).toContain("cdl_conflict");
  });

  it("treats a different licence as PROOF of two people, not weak evidence", () => {
    // Everything else agrees — same name, same phone, same mailbox. A licence
    // is issued to one holder, so this is still two people.
    const candidate = scorePerson(
      person({
        cdlNumber: "AAA111", cdlState: "IL",
        email: "m.santos@example.com", phone: "+1 (312) 555-0134",
      }),
      record({
        cdlNumber: "BBB222", cdlState: "IL",
        email: "m.santos@example.com", phone: "3125550134",
      }),
    );
    expect(candidate.score).toBe(0);
    expect(candidate.confidence).toBe("none");
    expect(rank([candidate]).outcome).toBe("new");
  });
});

describe("no accumulation of soft signals links anybody", () => {
  it("stops for a person on a name and a mailbox", () => {
    const candidate = scorePerson(
      person({ email: "maria@northline.example" }),
      record({ email: "maria@northline.example" }),
    );
    // Strong — and strong asks rather than links. A shared family or recycled
    // company address plus a matching name is not proof of one person.
    expect(candidate.confidence).toBe("strong");
    const ranking = rank([candidate]);
    expect(ranking.outcome).toBe("needs_decision");
    expect(ranking.rationale).toMatch(/confirm/i);
  });

  it("never reaches strong on one signal alone", () => {
    for (const [claim, rec] of [
      [person({ email: "x@y.example" }), record({ legalName: "Someone Else", email: "x@y.example" })],
      [person({ phone: "3125550134" }), record({ legalName: "Someone Else", phone: "3125550134" })],
      [person(), record()],
    ] as const) {
      expect(scorePerson(claim, rec).confidence).not.toBe("strong");
    }
  });

  it("asks when two records fit about equally well", () => {
    const ranking = rank([
      scorePerson(person({ email: "shared@family.example" }), record({ email: "shared@family.example" })),
      scorePerson(person({ email: "shared@family.example" }),
        record({ entityId: "dp_2", legalName: "Maria Santos", email: "shared@family.example" })),
    ]);
    expect(ranking.outcome).toBe("needs_decision");
    expect(ranking.rationale).toMatch(/about equally well|guess/i);
  });

  it("refuses to choose between two records that BOTH match decisively", () => {
    // The registry already holds a duplicate. An importer picking one of them
    // would bury the problem under a link.
    const ranking = rank([
      scorePerson(person({ cdlNumber: "K1", cdlState: "IL" }), record({ cdlNumber: "K1", cdlState: "IL" })),
      scorePerson(person({ cdlNumber: "K1", cdlState: "IL" }),
        record({ entityId: "dp_2", cdlNumber: "K1", cdlState: "IL" })),
    ]);
    expect(ranking.outcome).toBe("needs_decision");
    expect(ranking.rationale).toMatch(/should be unique/i);
  });

  it("says new when nothing looks like it", () => {
    const ranking = rank([scorePerson(person({ fullName: "Ade Okafor" }), record())]);
    expect(ranking.outcome).toBe("new");
  });
});

/* -------------------------------------------------------------------------- */
/* Trucks                                                                      */
/* -------------------------------------------------------------------------- */

const VIN = "1FUJGLDR9CLBP8834";

const truck = (over: Partial<TruckClaim> = {}): TruckClaim => ({ kind: "truck", ...over });
const truckRecord = (over: Partial<TruckRecord> = {}): TruckRecord =>
  ({ entityId: "trk_1", vin: VIN, ...over });

describe("a VIN is the one thing that identifies a truck", () => {
  it("matches exactly, ignoring spacing and case", () => {
    const candidate = scoreTruck(truck({ vin: VIN.toLowerCase() }), truckRecord());
    expect(candidate.confidence).toBe("exact");
    expect(rank([candidate]).outcome).toBe("matched");
  });

  it("treats a different VIN as proof of two trucks", () => {
    const candidate = scoreTruck(
      truck({ vin: "1XPWD40X1ED215307", plateNumber: "ABC123", plateState: "IL" }),
      truckRecord({ plateNumber: "ABC123", plateState: "IL" }),
    );
    expect(candidate.score).toBe(0);
    expect(candidate.conflicts.map((c) => c.code)).toContain("vin_conflict");
  });

  it("★ never matches on a unit number ★", () => {
    /*
     * The rule most likely to be "helpfully" added back by somebody later.
     * Carriers reuse unit numbers constantly — "101" is the newest tractor at
     * half the fleets in America — so it identifies a truck within ONE
     * carrier's list at ONE moment, which is exactly what a permanent record
     * must not be keyed on.
     */
    const candidate = scoreTruck(truck({ unitNumber: "101" }), truckRecord({ detail: "Unit 101" }));
    expect(candidate.score).toBe(0);
    expect(candidate.signals).toHaveLength(0);
    expect(rank([candidate]).outcome).toBe("new");
  });

  it("treats a plate as strong and not decisive, because plates move", () => {
    const candidate = scoreTruck(
      truck({ plateNumber: "P-889-221", plateState: "il" }),
      truckRecord({ plateNumber: "P889221", plateState: "IL" }),
    );
    expect(candidate.confidence).not.toBe("exact");
    expect(rank([candidate]).outcome).toBe("needs_decision");
  });
});

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
    // Same digits, different issuing state. Two states DO reuse numbers, so
    // this is not an identity — and a driver who moves is issued a new licence,
    // so it is not proof of two people either. It is a question.
    const candidate = scorePerson(
      person({ cdlNumber: "K4471182993", cdlState: "IL" }),
      record({ cdlNumber: "K4471182993", cdlState: "TX" }),
    );
    expect(candidate.confidence).not.toBe("exact");
    expect(candidate.conflicts.map((c) => c.code)).toContain("cdl_state_change");
    expect(rank([candidate]).outcome).toBe("needs_decision");
  });

  it("★ does not treat a different licence as proof of two people ★", () => {
    /*
     * THE RULE THIS FILE GOT WRONG THE FIRST TIME.
     *
     * It said a licence is issued to one holder, so two numbers are two people,
     * and it dropped the candidate. But people move states and get new numbers,
     * and rosters are typed by hand. Dropping the candidate left nothing
     * plausible, so the row was called new — and the import created a second
     * engagement for somebody already on the roster, with nobody asked.
     *
     * Same name, same phone, same mailbox, different licence is not an answer.
     * It is the case where a person has to look.
     */
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

    expect(candidate.score).toBeGreaterThan(0);
    expect(candidate.confidence).not.toBe("none");
    // Never linkable on its own, whatever the soft signals add up to.
    expect(candidate.confidence).not.toBe("exact");
    expect(candidate.conflicts.map((c) => c.code)).toContain("cdl_conflict");

    const ranking = rank([candidate]);
    expect(ranking.outcome).toBe("needs_decision");
    expect(ranking.outcome).not.toBe("new");
    expect(ranking.outcome).not.toBe("matched");
  });

  it("reads one wrong character as a typing error, not a second driver", () => {
    // K4471182993 → K447118299**4**. Nothing else in common at all: the
    // near-miss alone is enough to stop, because that is what a typo looks like.
    const candidate = scorePerson(
      person({ fullName: "Someone Else", cdlNumber: "K4471182994", cdlState: "IL" }),
      record({ legalName: "Marisol Santos", cdlNumber: "K4471182993", cdlState: "IL" }),
    );
    expect(candidate.conflicts.map((c) => c.code)).toContain("cdl_near_miss");
    expect(rank([candidate]).outcome).toBe("needs_decision");
  });

  it("still lets an unrelated person be new, so the common case stays quiet", () => {
    /*
     * The other side of the rule, and the reason it is not simply "never say
     * new". A different name, a different mailbox and a licence that is not a
     * near miss is not a contest — it is a different person, and stopping on
     * every row would make the queue useless and the import unusable.
     */
    const candidate = scorePerson(
      person({
        fullName: "Wendell Achebe", cdlNumber: "A7781093322", cdlState: "OH",
        email: "wendell@example.com",
      }),
      record({
        legalName: "Marisol Santos", cdlNumber: "K4471182993", cdlState: "IL",
        email: "m.santos@example.com",
      }),
    );
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

  it("★ does not treat a different VIN as proof of two trucks ★", () => {
    /*
     * The same correction as the licence rule above, for the same reason. This
     * carrier's own plate, on a VIN that does not match: either the seventeen
     * characters were copied wrong, or the plate was moved to another truck.
     * Those are opposite facts about the fleet and nothing here can tell which.
     */
    const candidate = scoreTruck(
      truck({ vin: "1XPWD40X1ED215307", plateNumber: "ABC123", plateState: "IL" }),
      truckRecord({ plateNumber: "ABC123", plateState: "IL" }),
    );
    expect(candidate.score).toBeGreaterThan(0);
    expect(candidate.confidence).not.toBe("exact");
    expect(candidate.conflicts.map((c) => c.code)).toContain("vin_conflict");
    expect(candidate.conflicts.map((c) => c.code)).toContain("plate_matches_vin_differs");

    const ranking = rank([candidate]);
    expect(ranking.outcome).toBe("needs_decision");
    expect(ranking.outcome).not.toBe("new");
  });

  it("reads one wrong character in a VIN as a transcription error", () => {
    // Seventeen characters copied off a doorframe, one of them wrong.
    const mistyped = `${VIN.slice(0, 16)}${VIN[16] === "7" ? "8" : "7"}`;
    const candidate = scoreTruck(truck({ vin: mistyped }), truckRecord());
    expect(candidate.conflicts.map((c) => c.code)).toContain("vin_near_miss");
    expect(candidate.confidence).not.toBe("exact");
    expect(rank([candidate]).outcome).toBe("needs_decision");
  });

  it("still lets an unrelated truck be new", () => {
    const candidate = scoreTruck(truck({ vin: "1XPWD40X1ED215307" }), truckRecord());
    expect(candidate.confidence).toBe("none");
    expect(rank([candidate]).outcome).toBe("new");
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

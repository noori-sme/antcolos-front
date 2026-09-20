import { beforeEach, describe, expect, it } from "vitest";
import type { ExtractedParty, RateConfirmationExtraction } from "@/types";
import { isAutoIndexedUnclaimed } from "@/types";
import { allParties, autoIndexBrokers, loadLinksFor, resetPartyRegistry } from "./party-registry";

const ORG = "org_northline";

/** A broker nothing in the seeded directory resembles. */
const UNKNOWN_BROKER: ExtractedParty = {
  name: "Cornerstone Freight Group LLC",
  mcNumber: "MC-774411",
  address: { line1: "55 Dock St", city: "Erie", state: "PA", postalCode: "16501", country: "US" },
  phone: "+1 (814) 555-0190",
  email: "Dispatch@CornerstoneFG.example.com",
};

function extraction(
  blocks: RateConfirmationExtraction["blocks"],
): RateConfirmationExtraction {
  return {
    documentId: "doc_rc_1",
    loadId: "load_1",
    customerReference: "CFG-88120",
    blocks,
    reviewedBy: {
      userId: "usr_sam", membershipId: "mem_northline_owner",
      displayNameSnapshot: "Sam Murtaza", source: "web",
    },
    reviewedAt: "2026-09-20T00:00:00.000Z",
  };
}

const brokerBlock = (
  party: ExtractedParty = UNKNOWN_BROKER,
): RateConfirmationExtraction["blocks"][number] => ({ role: "broker", party, contacts: [] });

beforeEach(() => {
  resetPartyRegistry();
});

describe("indexing a broker nobody has seen before", () => {
  it("creates one profile, with the MC number it was indexed on", () => {
    const before = allParties().length;
    const report = autoIndexBrokers(ORG, extraction([brokerBlock()]));

    expect(report.created).toHaveLength(1);
    expect(allParties()).toHaveLength(before + 1);
    expect(report.created[0]).toMatchObject({
      legalName: "Cornerstone Freight Group LLC",
      roles: ["broker"],
      identifiers: { mcNumber: "774411" },
    });
  });

  it("is born unverified, unclaimed and unconfirmed — all three", () => {
    const [party] = autoIndexBrokers(ORG, extraction([brokerBlock()])).created;

    expect(party.verification.state).toBe("unverified");
    expect(party.claim.state).toBe("unclaimed");
    expect(party.status).toBe("provisional");
    expect(party.provenance.kind).toBe("rate_confirmation_auto");
    expect(isAutoIndexedUnclaimed(party)).toBe(true);
  });

  it("keeps the paperwork it came off, so the record can be traced", () => {
    const [party] = autoIndexBrokers(ORG, extraction([brokerBlock()])).created;
    expect(party.provenance.documentId).toBe("doc_rc_1");
    expect(party.provenance.loadId).toBe("load_1");
    expect(party.provenance.recordedBy.source).toBe("system");
    expect(party.identifiers.asPrinted?.mcNumber).toBe("MC-774411");
  });

  it("creates nothing carrier-private — no link, no standing, no note", () => {
    const [party] = autoIndexBrokers(ORG, extraction([brokerBlock()])).created;
    expect(loadLinksFor(party.partyId)).toHaveLength(0);
  });

  it("records an event saying a machine did it", () => {
    const [party] = autoIndexBrokers(ORG, extraction([brokerBlock()])).created;
    // Re-indexing the same document must not produce a second profile either.
    const again = autoIndexBrokers(ORG, extraction([brokerBlock()]));
    expect(again.created).toHaveLength(0);
    expect(allParties().filter((p) => p.partyId === party.partyId)).toHaveLength(1);
  });
});

describe("what it refuses to index", () => {
  it("leaves a shipper and a receiver alone", () => {
    const report = autoIndexBrokers(ORG, extraction([
      { role: "shipper", party: { name: "Joliet Distribution Center" }, contacts: [] },
      { role: "receiver", party: { name: "Rockford Receiving" }, contacts: [] },
    ]));

    expect(report.created).toHaveLength(0);
    expect(report.skipped.map((s) => s.role)).toEqual(["shipper", "receiver"]);
    for (const skip of report.skipped) expect(skip.detail).toContain("Only brokers");
  });

  it("leaves a broker with no MC number to the review queue", () => {
    const report = autoIndexBrokers(ORG, extraction([
      brokerBlock({ ...UNKNOWN_BROKER, mcNumber: undefined }),
    ]));
    expect(report.created).toHaveLength(0);
    expect(report.skipped[0].detail).toContain("No MC number");
  });

  it("never mints a second profile for a broker already in the directory", () => {
    const known = allParties().find((p) => p.identifiers.mcNumber === "612884");
    expect(known, "Apex Logistics is seeded with MC 612884").toBeDefined();

    const report = autoIndexBrokers(ORG, extraction([
      brokerBlock({ ...UNKNOWN_BROKER, name: "Apex Logistics", mcNumber: "MC-612884" }),
    ]));

    expect(report.created).toHaveLength(0);
    expect(report.skipped[0].detail).toContain("already resembles");
    expect(allParties().filter((p) => p.identifiers.mcNumber === "612884")).toHaveLength(1);
  });

  it("stops on a resemblance that is not an identifier match at all", () => {
    // "Harbor Point Freight" is seeded with no MC number. A rate confirmation
    // for the same company WITH one must not create a twin — the name alone is
    // enough to hand it to a person.
    const report = autoIndexBrokers(ORG, extraction([
      brokerBlock({ ...UNKNOWN_BROKER, name: "Harbor Point Freight", mcNumber: "MC-999888" }),
    ]));
    expect(report.created).toHaveLength(0);
    expect(report.skipped[0].detail).toContain("already resembles");
  });
});

describe("a confirmation with several blocks", () => {
  it("indexes the broker and reports on every block it did not", () => {
    const report = autoIndexBrokers(ORG, extraction([
      brokerBlock(),
      { role: "shipper", party: { name: "Joliet Distribution Center" }, contacts: [] },
      { role: "receiver", party: { name: "Rockford Receiving" }, contacts: [] },
    ]));

    expect(report.created).toHaveLength(1);
    expect(report.skipped).toHaveLength(2);
    // Every skip names the company, so a projection can say what it passed over.
    expect(report.skipped.map((s) => s.name)).toEqual([
      "Joliet Distribution Center", "Rockford Receiving",
    ]);
  });

  it("creates one profile when one brokerage appears twice on one document", () => {
    const report = autoIndexBrokers(ORG, extraction([
      brokerBlock(),
      brokerBlock({ ...UNKNOWN_BROKER, name: "Cornerstone Freight Group", mcNumber: "774411" }),
    ]));
    expect(report.created).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
  });
});

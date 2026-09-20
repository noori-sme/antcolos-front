import { describe, expect, it } from "vitest";
import type { ExtractedPartyBlock, Party, PartyRole } from "@/types";
import {
  AUTO_INDEXED_BADGE, decideAutoIndex, decideAutoIndexForBlocks,
} from "./auto-broker";

function block(
  role: PartyRole,
  party: Partial<ExtractedPartyBlock["party"]> & { name: string },
): ExtractedPartyBlock {
  return { role, party: { ...party }, contacts: [] };
}

function party(overrides: Partial<Party> & { legalName: string }): Party {
  return {
    partyId: overrides.partyId ?? `pty_${overrides.legalName}`,
    roles: ["broker"],
    identifiers: {},
    status: "active",
    verification: { state: "dispatcher_confirmed" },
    claim: { state: "unclaimed" },
    provenance: {
      kind: "rate_confirmation",
      recordedAt: "2026-01-01T00:00:00.000Z",
      recordedBy: {
        userId: "u", membershipId: "m", displayNameSnapshot: "Someone", source: "web",
      },
      recordedByOrganizationId: "org_a",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdByOrganizationId: "org_a",
    ...overrides,
  };
}

describe("only brokers are indexed automatically", () => {
  it("indexes a broker carrying an MC number", () => {
    const decision = decideAutoIndex(
      block("broker", { name: "Apex Logistics LLC", mcNumber: "MC-889321" }),
      [],
    );
    expect(decision).toEqual({
      outcome: "index",
      mcNumber: "889321",
      legalName: "Apex Logistics LLC",
    });
  });

  it("refuses a shipper and a receiver however complete the block is", () => {
    for (const role of ["shipper", "receiver"] as const) {
      const decision = decideAutoIndex(
        block(role, {
          name: "Blue Ridge Foods",
          mcNumber: "MC-889321",
          address: { line1: "1200 Industrial Blvd", city: "Roanoke", state: "VA", country: "US" },
        }),
        [],
      );
      expect(decision).toMatchObject({ outcome: "skip", reason: "not_a_broker" });
    }
  });
});

describe("creating needs decisive evidence", () => {
  it("refuses a broker with no MC number, however good the name is", () => {
    const decision = decideAutoIndex(
      block("broker", {
        name: "Total Quality Logistics",
        phone: "+18005551212",
        email: "ops@tql.example.com",
        address: { line1: "4289 Ivy Pointe Blvd", city: "Cincinnati", state: "OH", country: "US" },
      }),
      [],
    );
    expect(decision).toMatchObject({ outcome: "skip", reason: "no_decisive_identifier" });
  });

  it("refuses an MC number that normalizes to nothing", () => {
    for (const printed of ["MC-", "  ", "MC", "abc"]) {
      expect(decideAutoIndex(block("broker", { name: "Apex Logistics", mcNumber: printed }), []))
        .toMatchObject({ outcome: "skip", reason: "no_decisive_identifier" });
    }
  });

  it("accepts an MC number in whatever form it was printed", () => {
    for (const printed of ["889321", "MC-889321", "mc 889321", "MC889321"]) {
      expect(decideAutoIndex(block("broker", { name: "Apex Logistics", mcNumber: printed }), []))
        .toMatchObject({ outcome: "index", mcNumber: "889321" });
    }
  });

  it("refuses a name it could not put on a profile", () => {
    expect(decideAutoIndex(block("broker", { name: "  ", mcNumber: "889321" }), []))
      .toMatchObject({ outcome: "skip", reason: "unusable_name" });
  });
});

describe("abstaining takes only the weakest evidence", () => {
  it("stops on an exact MC match rather than creating a twin", () => {
    const existing = [party({ legalName: "Apex Logistics LLC", identifiers: { mcNumber: "889321" } })];
    const decision = decideAutoIndex(
      block("broker", { name: "Apex Logistics", mcNumber: "MC-889321" }),
      existing,
    );
    expect(decision).toMatchObject({
      outcome: "skip",
      reason: "already_resembled",
      resembledPartyId: existing[0].partyId,
    });
  });

  it("stops on a mere resemblance, well below a strong match", () => {
    // Same name, no shared identifier — a `possible` tier, not a `strong` one.
    // The existing resolution flow would still ask a person about this, so
    // auto-indexing must not pre-empt them.
    const existing = [party({ legalName: "Apex Logistics LLC" })];
    const decision = decideAutoIndex(
      block("broker", { name: "Apex Logistics LLC", mcNumber: "889321" }),
      existing,
    );
    expect(decision).toMatchObject({ outcome: "skip", reason: "already_resembled" });
  });

  it("still creates when nothing in the directory resembles it at all", () => {
    const existing = [
      party({ legalName: "Harbor Point Distribution", identifiers: { mcNumber: "112233" } }),
      party({ legalName: "Tandem Freight Partners", identifiers: { mcNumber: "445566" } }),
    ];
    expect(decideAutoIndex(block("broker", { name: "Apex Logistics", mcNumber: "889321" }), existing))
      .toMatchObject({ outcome: "index" });
  });

  it("does not let one carrier's load history change the answer", () => {
    // The stats callback is fixed at zero inside the module. A broker record is
    // shared, so who happened to book the load must not decide whether a
    // profile is created.
    const existing = [party({ legalName: "Apex Logistics LLC", identifiers: { mcNumber: "889321" } })];
    const first = decideAutoIndex(block("broker", { name: "Apex", mcNumber: "889321" }), existing);
    const second = decideAutoIndex(block("broker", { name: "Apex", mcNumber: "889321" }), existing);
    expect(first).toEqual(second);
  });
});

describe("a whole confirmation", () => {
  it("indexes the broker and reports on everything it skipped", () => {
    const decisions = decideAutoIndexForBlocks([
      block("broker", { name: "Apex Logistics LLC", mcNumber: "MC-889321" }),
      block("shipper", { name: "Blue Ridge Foods" }),
      block("receiver", { name: "Harbor Point DC" }),
    ], []);

    expect(decisions.map((d) => d.outcome)).toEqual(["index", "skip", "skip"]);
    expect(decisions.filter((d) => d.outcome === "skip").every((d) => "detail" in d && d.detail))
      .toBe(true);
  });

  it("never creates two profiles for one MC number on one document", () => {
    // A confirmation that names the same brokerage twice — as the broker and
    // again in a "bill to" block parsed as one — must produce one record.
    const decisions = decideAutoIndexForBlocks([
      block("broker", { name: "Apex Logistics LLC", mcNumber: "MC-889321" }),
      block("broker", { name: "Apex Logistics", mcNumber: "889321" }),
    ], []);

    expect(decisions[0]).toMatchObject({ outcome: "index" });
    expect(decisions[1]).toMatchObject({ outcome: "skip", reason: "already_resembled" });
  });

  it("indexes two genuinely different brokers on one document", () => {
    const decisions = decideAutoIndexForBlocks([
      block("broker", { name: "Apex Logistics LLC", mcNumber: "889321" }),
      block("broker", { name: "Cornerstone Freight Group", mcNumber: "774411" }),
    ], []);
    expect(decisions.map((d) => d.outcome)).toEqual(["index", "index"]);
  });

  it("returns one decision per block, in order, always", () => {
    const blocks = [
      block("shipper", { name: "A" }),
      block("broker", { name: "Cornerstone Freight Group", mcNumber: "774411" }),
      block("receiver", { name: "C" }),
    ];
    expect(decideAutoIndexForBlocks(blocks, [])).toHaveLength(blocks.length);
  });
});

describe("the badge", () => {
  it("names both facts it is claiming", () => {
    expect(AUTO_INDEXED_BADGE.toLowerCase()).toContain("auto-generated");
    expect(AUTO_INDEXED_BADGE.toLowerCase()).toContain("unclaimed");
  });
});

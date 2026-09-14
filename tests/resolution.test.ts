import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type {
  ConfirmedResolution, PartyRole, RateConfirmationExtraction, PermissionKey,
} from "../src/types/index";
import {
  addNote, commitResolution, getPartyProfile, listDirectory, planResolution,
  resetPartyRegistry, setStanding, PartyPermissionError, PartyNotFoundError,
  type PartyContext,
} from "../src/lib/api/mock/party-registry";
import { mockExtraction } from "../src/lib/api/mock/rate-con-extractions";

/**
 * The rules this module exists to enforce, tested as rules rather than as code
 * paths. Each of these corresponds to something that goes wrong in a real
 * dispatch office when it is missing: a second profile per load, a broker
 * silently merged into the wrong one, one carrier reading another's opinion, or
 * a load's history rewritten by an edit made months later.
 */

const ALL_PERMISSIONS: PermissionKey[] = [
  "customers:view", "customers:create", "customers:edit",
  "customers:private:manage", "customers:resolve",
];

function contextFor(organizationId: string, permissions: PermissionKey[] = ALL_PERMISSIONS): PartyContext {
  return {
    organizationId,
    membershipId: `mem_${organizationId}`,
    actorName: "Test Dispatcher",
    userId: "usr_test",
    permissions: new Set(permissions),
  };
}

const northline = () => contextFor("org_northline");
const baxter = () => contextFor("org_baxter");

function extraction(documentId: string, loadId?: string): RateConfirmationExtraction {
  const found = mockExtraction(documentId);
  assert.ok(found, `missing fixture ${documentId}`);
  return { ...found, loadId };
}

function confirm(
  planId: string,
  documentId: string,
  decisions: ConfirmedResolution["decisions"],
): ConfirmedResolution {
  return {
    planId,
    documentId,
    decisions,
    confirmedBy: {
      userId: "usr_test",
      membershipId: "mem_test",
      displayNameSnapshot: "Test Dispatcher",
      source: "web",
    },
    confirmedAt: new Date().toISOString(),
  };
}

/** Link every block to whatever the resolver recommended. */
function acceptRecommendations(
  proposals: { role: PartyRole; recommendedPartyId?: string; facility?: { recommendedFacilityId?: string } }[],
): ConfirmedResolution["decisions"] {
  return proposals.map((p) => ({
    role: p.role,
    choice: p.recommendedPartyId ? ("link" as const) : ("create" as const),
    partyId: p.recommendedPartyId,
    facilityId: p.facility?.recommendedFacilityId,
    applyExtractedUpdates: true,
  }));
}

beforeEach(() => resetPartyRegistry());

/* -------------------------------------------------------------------------- */

describe("matching a broker", () => {
  it("matches on the MC number even when the name is printed differently", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_apex"));
    const broker = plan.proposals.find((p) => p.role === "broker")!;

    assert.equal(broker.candidates[0].confidence, "exact");
    assert.equal(broker.candidates[0].mcNumber, "612884");
    assert.equal(broker.recommendation, "link_existing");
    assert.ok(
      broker.candidates[0].signals.some((s) => s.code === "mc_number" && s.decisive),
      "the MC number should be the decisive signal",
    );
  });

  it("eliminates a company whose MC number is different, however well the name matches", async () => {
    const ctx = northline();
    const apex = extraction("doc_rcon_demo_apex");
    // The same name and address as Apex on file, a different authority.
    const impostor: RateConfirmationExtraction = {
      ...apex,
      documentId: "doc_test_impostor",
      blocks: [
        {
          ...apex.blocks[0],
          party: { ...apex.blocks[0].party, mcNumber: "MC-999111" },
        },
      ],
    };

    const plan = await planResolution(ctx, impostor);
    const broker = plan.proposals[0];
    assert.equal(
      broker.candidates.length, 0,
      "a different MC number is evidence against a match, not weak evidence for one",
    );
    assert.notEqual(broker.recommendation, "link_existing");
  });

  it("refuses to choose between two equally plausible profiles", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_tandem"));
    const broker = plan.proposals.find((p) => p.role === "broker")!;

    assert.ok(broker.candidates.length >= 2, "both Tandem profiles should be offered");
    assert.equal(broker.recommendation, "choose_between");
    assert.equal(broker.recommendedPartyId, undefined, "nothing should be pre-picked");
  });

  it("flags a broker with no MC number as needing review", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_midwest"));
    const shipper = plan.proposals.find((p) => p.role === "shipper")!;
    assert.equal(shipper.recommendation, "create_new");

    // The thin document: a shipper with only a city and state.
    const thin = await planResolution(ctx, extraction("doc_rcon_demo_thin"));
    const thinShipper = thin.proposals.find((p) => p.role === "shipper")!;
    assert.equal(thinShipper.recommendation, "create_provisional");
    assert.match(thinShipper.reviewReason ?? "", /address/i);
  });

  it("always asks for confirmation, whatever it found", async () => {
    const ctx = northline();
    for (const documentId of [
      "doc_rcon_demo_apex", "doc_rcon_demo_tandem", "doc_rcon_demo_midwest", "doc_rcon_demo_thin",
    ]) {
      const plan = await planResolution(ctx, extraction(documentId));
      for (const proposal of plan.proposals) {
        assert.equal(
          proposal.requiresDispatcherConfirmation, true,
          `${documentId} / ${proposal.role} must require confirmation`,
        );
      }
    }
  });
});

describe("planning writes nothing", () => {
  it("leaves the directory untouched however many times it runs", async () => {
    const ctx = northline();
    const before = await listDirectory(ctx);

    await planResolution(ctx, extraction("doc_rcon_demo_midwest"));
    await planResolution(ctx, extraction("doc_rcon_demo_midwest"));
    await planResolution(ctx, extraction("doc_rcon_demo_tandem"));

    const after = await listDirectory(ctx);
    assert.equal(after.length, before.length, "a plan must never create a profile");
  });
});

describe("committing a confirmed resolution", () => {
  it("links to the existing profile instead of creating a second one", async () => {
    const ctx = northline();
    const before = await listDirectory(ctx);

    const plan = await planResolution(ctx, extraction("doc_rcon_demo_apex", "ld_test_1"));
    const result = await commitResolution(
      ctx, plan, confirm(plan.planId, plan.documentId, acceptRecommendations(plan.proposals)),
    );

    const broker = result.outcomes.find((o) => o.role === "broker")!;
    assert.equal(broker.createdParty, false, "Apex is already on file");

    const after = await listDirectory(ctx);
    assert.equal(after.length, before.length, "no new company should appear");
  });

  it("does not duplicate a profile when the same rate confirmation runs twice", async () => {
    const ctx = northline();

    const first = await planResolution(ctx, extraction("doc_rcon_demo_midwest", "ld_test_a"));
    await commitResolution(
      ctx, first, confirm(first.planId, first.documentId, acceptRecommendations(first.proposals)),
    );
    const afterFirst = await listDirectory(ctx);

    // Same document, a second load. The companies now exist, so the second run
    // must find them rather than make another set.
    const second = await planResolution(ctx, extraction("doc_rcon_demo_midwest", "ld_test_b"));
    const brokerProposal = second.proposals.find((p) => p.role === "broker")!;
    assert.equal(brokerProposal.recommendation, "link_existing");

    await commitResolution(
      ctx, second, confirm(second.planId, second.documentId, acceptRecommendations(second.proposals)),
    );
    const afterSecond = await listDirectory(ctx);

    assert.equal(
      afterSecond.length, afterFirst.length,
      "a second load must not create a second profile per company",
    );
  });

  it("creates an uncertain profile as provisional, and says why", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_thin", "ld_test_2"));
    const shipper = plan.proposals.find((p) => p.role === "shipper")!;

    const result = await commitResolution(ctx, plan, confirm(plan.planId, plan.documentId, [
      { role: "broker", choice: "link", partyId: plan.proposals[0].recommendedPartyId },
      { role: shipper.role, choice: "create" },
    ]));

    const created = result.outcomes.find((o) => o.role === "shipper")!;
    assert.equal(created.createdParty, true);
    assert.equal(created.partyStatus, "provisional");
    assert.ok(
      result.needsReview.some((n) => n.partyId === created.partyId),
      "a provisional profile must be surfaced for review, not buried",
    );
  });

  it("never marks rate confirmation data as externally verified", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_midwest", "ld_test_3"));
    const result = await commitResolution(
      ctx, plan, confirm(plan.planId, plan.documentId, acceptRecommendations(plan.proposals)),
    );

    for (const outcome of result.outcomes) {
      const { party } = await getPartyProfile(ctx, outcome.partyId);
      assert.notEqual(
        party.verification.state, "externally_verified",
        "a broker's own paperwork can never verify itself",
      );
      assert.equal(party.verification.authority, undefined);
    }
  });

  it("preserves the rate confirmation as the source on every record it writes", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_midwest", "ld_test_4"));
    const result = await commitResolution(
      ctx, plan, confirm(plan.planId, plan.documentId, acceptRecommendations(plan.proposals)),
    );

    const broker = result.outcomes.find((o) => o.role === "broker")!;
    const { party, loadLinks } = await getPartyProfile(ctx, broker.partyId);

    assert.equal(party.provenance.kind, "rate_confirmation");
    assert.equal(party.provenance.documentId, "doc_rcon_demo_midwest");

    const link = loadLinks.find((l) => l.loadId === "ld_test_4");
    assert.ok(link, "the load must be linked");
    assert.equal(link.rateConfirmationDocumentId, "doc_rcon_demo_midwest");
  });

  it("leaves an unconfirmed block alone rather than inventing a profile for it", async () => {
    const ctx = northline();
    const before = await listDirectory(ctx);
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_midwest", "ld_test_5"));

    // Only the broker is confirmed. The shipper and receiver are not.
    const result = await commitResolution(ctx, plan, confirm(plan.planId, plan.documentId, [
      { role: "broker", choice: "create" },
    ]));

    assert.equal(result.outcomes.length, 1);
    assert.equal(result.needsReview.length, 2, "both undecided blocks should be reported");
    const after = await listDirectory(ctx);
    assert.equal(after.length, before.length + 1, "only the confirmed company was created");
  });

  it("refuses a confirmation belonging to a different plan", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_apex", "ld_test_6"));
    await assert.rejects(
      () => commitResolution(ctx, plan, confirm("plan_somethingelse", plan.documentId, [])),
      /different plan/i,
    );
  });
});

describe("the historical snapshot", () => {
  it("keeps what the paperwork said, even after the profile is corrected", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_midwest", "ld_test_7"));
    const result = await commitResolution(
      ctx, plan, confirm(plan.planId, plan.documentId, acceptRecommendations(plan.proposals)),
    );

    const broker = result.outcomes.find((o) => o.role === "broker")!;
    const snapshotName = broker.snapshot.legalName;
    const snapshotPhone = broker.snapshot.phone;
    assert.ok(snapshotName);

    // The profile moves on: a later rate confirmation gives a new phone number.
    const laterPlan = await planResolution(ctx, {
      ...extraction("doc_rcon_demo_midwest", "ld_test_8"),
      documentId: "doc_rcon_later",
      blocks: [
        {
          role: "broker",
          party: {
            name: "Midwest Lane Logistics LLC",
            mcNumber: "MC-1044219",
            phone: "(317) 555-0999",
          },
          contacts: [],
        },
      ],
    });
    await commitResolution(ctx, laterPlan, confirm(laterPlan.planId, laterPlan.documentId, [
      { role: "broker", choice: "link", partyId: broker.partyId, applyExtractedUpdates: true },
    ]));

    const { loadLinks } = await getPartyProfile(ctx, broker.partyId);
    const original = loadLinks.find((l) => l.loadId === "ld_test_7")!;
    assert.equal(
      original.snapshot.legalName, snapshotName,
      "the first load must still show what its own rate confirmation said",
    );
    assert.equal(original.snapshot.phone, snapshotPhone);
  });

  it("snapshots what the document said, not what the matched profile says", async () => {
    const ctx = northline();
    // "APEX LOGISTICS, LLC" on the document; "Apex Logistics LLC" on file.
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_apex", "ld_test_9"));
    const result = await commitResolution(
      ctx, plan, confirm(plan.planId, plan.documentId, acceptRecommendations(plan.proposals)),
    );
    const broker = result.outcomes.find((o) => o.role === "broker")!;
    assert.equal(broker.snapshot.legalName, "APEX LOGISTICS, LLC");
  });
});

describe("filling gaps on a confirmed match", () => {
  it("never overwrites an identifier already on file with one off a document", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_apex", "ld_test_10"));
    const brokerProposal = plan.proposals.find((p) => p.role === "broker")!;
    const partyId = brokerProposal.recommendedPartyId!;
    const before = await getPartyProfile(ctx, partyId);

    // A document claiming a different MC number for a broker we matched by
    // other means must not be able to rewrite the number on file.
    const conflicting = await planResolution(ctx, {
      ...extraction("doc_rcon_demo_thin", "ld_test_11"),
      blocks: [
        {
          role: "broker",
          party: { name: "Apex Logistics", mcNumber: "MC-777000", phone: "(312) 555-0110" },
          contacts: [],
        },
      ],
    });
    await commitResolution(ctx, conflicting, confirm(conflicting.planId, conflicting.documentId, [
      { role: "broker", choice: "link", partyId, applyExtractedUpdates: true },
    ]));

    const after = await getPartyProfile(ctx, partyId);
    assert.equal(
      after.party.identifiers.mcNumber, before.party.identifiers.mcNumber,
      "the stronger source wins; the document does not overwrite it",
    );
  });

  it("does fill a gap the profile did not have", async () => {
    const ctx = northline();
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_tandem", "ld_test_12"));
    const receiver = plan.proposals.find((p) => p.role === "receiver")!;
    const result = await commitResolution(ctx, plan, confirm(plan.planId, plan.documentId, [
      { role: "receiver", choice: "create", applyExtractedUpdates: true },
    ]));
    const created = result.outcomes.find((o) => o.role === "receiver")!;
    const { party } = await getPartyProfile(ctx, created.partyId);
    assert.equal(party.legalName, receiver.extracted.party.name);
    assert.equal(party.primaryAddress?.city, "Memphis");
  });
});

describe("carrier isolation", () => {
  it("does not serve one carrier's standing or notes to another", async () => {
    const nl = northline();
    const bx = baxter();

    const plan = await planResolution(nl, extraction("doc_rcon_demo_apex"));
    const apexId = plan.proposals[0].recommendedPartyId!;

    const northlineView = await getPartyProfile(nl, apexId);
    const baxterView = await getPartyProfile(bx, apexId);

    // The same company, two completely separate opinions of it.
    assert.equal(northlineView.party.partyId, baxterView.party.partyId);
    assert.equal(northlineView.relationship.standing, "preferred");
    assert.equal(baxterView.relationship.standing, "blocked");

    for (const note of northlineView.notes) {
      assert.equal(note.carrierOrganizationId, "org_northline");
    }
    for (const note of baxterView.notes) {
      assert.equal(note.carrierOrganizationId, "org_baxter");
    }
    assert.ok(
      !northlineView.notes.some((n) => n.body.includes("Do not accept loads")),
      "Baxter's private note must not reach Northline",
    );
  });

  it("keeps a new private note inside the organization that wrote it", async () => {
    const nl = northline();
    const bx = baxter();
    const plan = await planResolution(nl, extraction("doc_rcon_demo_apex"));
    const apexId = plan.proposals[0].recommendedPartyId!;

    await addNote(nl, { partyId: apexId }, "Northline only: call Dana, never email.", true);
    await setStanding(bx, apexId, "watch", "Baxter only: re-evaluating.");

    const northlineView = await getPartyProfile(nl, apexId);
    const baxterView = await getPartyProfile(bx, apexId);

    assert.ok(northlineView.notes.some((n) => n.body.includes("Northline only")));
    assert.ok(!baxterView.notes.some((n) => n.body.includes("Northline only")));
    assert.equal(northlineView.relationship.standing, "preferred", "Baxter's change must not touch Northline");
    assert.equal(baxterView.relationship.standing, "watch");
  });

  it("keeps private history out of another carrier's view", async () => {
    const nl = northline();
    const bx = baxter();
    const plan = await planResolution(nl, extraction("doc_rcon_demo_apex"));
    const apexId = plan.proposals[0].recommendedPartyId!;

    const northlineView = await getPartyProfile(nl, apexId);
    const baxterView = await getPartyProfile(bx, apexId);

    for (const e of northlineView.history) {
      if (e.private) assert.equal(e.carrierOrganizationId, "org_northline");
    }
    for (const e of baxterView.history) {
      if (e.private) assert.equal(e.carrierOrganizationId, "org_baxter");
    }
  });

  it("does not list a company the carrier has no relationship with", async () => {
    const cascade = contextFor("org_cascade");
    const listing = await listDirectory(cascade);
    assert.ok(listing.length > 0, "Cascade should see its own companies");
    assert.ok(
      !listing.some((l) => l.legalName.includes("Apex")),
      "Northline's broker must not appear in Cascade's directory",
    );
  });

  it("treats another carrier's company as not found rather than forbidden", async () => {
    const cascade = contextFor("org_cascade");
    const nl = northline();
    const plan = await planResolution(nl, extraction("doc_rcon_demo_apex"));
    const apexId = plan.proposals[0].recommendedPartyId!;

    await assert.rejects(
      () => getPartyProfile(cascade, apexId),
      (error: unknown) => error instanceof PartyNotFoundError,
      "a 403 would confirm the record exists",
    );
  });
});

describe("permissions", () => {
  it("refuses to read the directory without customers:view", async () => {
    const ctx = contextFor("org_northline", []);
    await assert.rejects(() => listDirectory(ctx), (e: unknown) => e instanceof PartyPermissionError);
  });

  it("refuses to commit a resolution without customers:resolve", async () => {
    const reader = contextFor("org_northline", ["customers:view"]);
    const plan = await planResolution(reader, extraction("doc_rcon_demo_apex", "ld_test_13"));
    await assert.rejects(
      () => commitResolution(reader, plan, confirm(plan.planId, plan.documentId, [])),
      (e: unknown) => e instanceof PartyPermissionError,
    );
  });

  it("refuses to write a private note without customers:private:manage", async () => {
    const ctx = contextFor("org_northline", ["customers:view", "customers:resolve"]);
    const plan = await planResolution(ctx, extraction("doc_rcon_demo_apex"));
    const apexId = plan.proposals[0].recommendedPartyId!;
    await assert.rejects(
      () => addNote(ctx, { partyId: apexId }, "should not be written"),
      (e: unknown) => e instanceof PartyPermissionError,
    );
  });
});

describe("load history without ownership", () => {
  it("reaches loads through links rather than storing them", async () => {
    const ctx = northline();
    const listing = await listDirectory(ctx);
    const apex = listing.find((l) => l.legalName.includes("Apex"))!;
    const { loadLinks } = await getPartyProfile(ctx, apex.partyId);

    assert.ok(loadLinks.length > 0, "Apex should have load history from the fixtures");
    for (const link of loadLinks) {
      assert.equal(link.carrierOrganizationId, "org_northline");
      assert.ok(link.loadId, "a link carries a load id, not a load");
      assert.ok(link.snapshot.legalName, "and a frozen snapshot of the party");
      assert.ok(
        !("load" in link),
        "the directory must not carry a copy of the load record",
      );
    }
  });
});

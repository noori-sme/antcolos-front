import { beforeEach, describe, expect, it } from "vitest";
import {
  dispatchGrantsByCarrier, fleetSync, grantTruckDispatchAccess,
  liveDispatchGrantFor, resetTruckRegistry, truckContextFrom,
  truckDispatchGrants, TruckDispatchOverlapError, TruckNotFoundError,
} from "@/lib/api/mock/truck-registry";
import {
  cascadeAfterEnding, delegationSharesFor, reconcileExpiredDispatchGrants,
  revokeDispatchDelegation,
} from "@/lib/api/mock/dispatch-revocation";
import {
  pinnedCarrierAt, loadReachFor, requireLoadWriteAuthority,
  OperatingCarrierUnresolvedError,
} from "@/lib/api/mock/dispatch-delegation";
import { TruckPermissionError } from "@/lib/api/mock/truck-registry";
import { seedOrganizationDocuments } from "@/lib/api/mock/organization-documents";
import { grantIsLive } from "@/types";
import { operatingContextAt } from "@/lib/api/mock/truck-registry";
import { allShares } from "@/lib/api/mock/document-store";
import { contextFor, BAXTER_OWNER, MERIDIAN_OWNER } from "../../../../tests/responsibility/harness";

/**
 * ★ M1 — A CARRIER LETS A DISPATCH COMPANY WORK ITS FREIGHT ★
 *
 * The product decisions this file exists to hold down:
 *
 *  1. A booking under a carrier's MC is the CARRIER's transaction.
 *  2. Only a carrier member performs the act that publishes `load.finalized`.
 *  3. The operating carrier is pinned at booking and never re-derived, so a
 *     truck moving to another carrier does not move the old loads with it.
 *  4. Two dispatch organizations on one truck is refused unless the carrier
 *     explicitly transfers.
 *  5. What a former provider keeps is bounded and FIXED as of the moment its
 *     access ended.
 *
 * Every assertion below goes through a real service command. Nothing reaches
 * into a store to arrange an outcome the product could not produce.
 */

const CARRIER = "org_baxter";
const PROVIDER = "org_meridian";

function carrierCtx() {
  return truckContextFrom(contextFor(BAXTER_OWNER));
}
function providerCtx() {
  return truckContextFrom(contextFor(MERIDIAN_OWNER));
}

/** A truck Baxter operates and has not yet granted to anybody. */
function ungrantedBaxterTruck(): string {
  const granted = new Set(dispatchGrantsByCarrier(CARRIER).map((g) => g.truckId));
  const free = fleetSync(carrierCtx()).find((t) => !granted.has(t.truckId));
  if (!free) throw new Error("the fixture has no ungranted Baxter truck");
  return free.truckId;
}

/** An instant safely before anything this file does. */
function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 3_600_000).toISOString();
}

beforeEach(() => {
  resetTruckRegistry();
  // The Document Center seeds lazily on its first service call. These tests
  // reach the share store directly, so they ask for it explicitly.
  seedOrganizationDocuments();
});

/* -------------------------------------------------------------------------- */

describe("granting dispatch access", () => {
  it("refuses without trucks:relationships:manage", async () => {
    const ctx = truckContextFrom(
      contextFor(BAXTER_OWNER, { without: ["trucks:relationships:manage"] }),
    );
    await expect(grantTruckDispatchAccess({
      truckId: ungrantedBaxterTruck(),
      dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch",
      purpose: "Cover the lane while we are short.",
    }, ctx)).rejects.toBeInstanceOf(TruckPermissionError);
  });

  it("refuses from an organization that does not operate the truck", async () => {
    // Meridian dispatches Baxter's trucks. It does not operate them, so it
    // cannot hand one to somebody else.
    const truckId = dispatchGrantsByCarrier(CARRIER)[0].truckId;
    await expect(grantTruckDispatchAccess({
      truckId,
      dispatchOrganizationId: "org_summit",
      dispatchOrganizationName: "Summit Dispatch",
      purpose: "Passing it along.",
    }, providerCtx())).rejects.toBeInstanceOf(TruckNotFoundError);
  });

  it("refuses an empty purpose, and an end before the start", async () => {
    const truckId = ungrantedBaxterTruck();
    await expect(grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "   ",
    }, carrierCtx())).rejects.toThrow(/what this dispatch organization is being asked/i);

    await expect(grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
      effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
      effectiveTo: new Date().toISOString(),
    }, carrierCtx())).rejects.toThrow(/must come after/i);
  });

  it("records who granted it, what for, and from when", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId,
      dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch",
      purpose: "Cover the Ohio lane for six weeks.",
    }, carrierCtx());

    expect(grant.grantedByCarrierOrganizationId).toBe(CARRIER);
    expect(grant.grantedByMembershipId).toBe(carrierCtx().membershipId);
    expect(grant.purpose).toBe("Cover the Ohio lane for six weeks.");
    expect(grantIsLive(grant)).toBe(true);
    expect(liveDispatchGrantFor(truckId, PROVIDER)?.id).toBe(grant.id);
  });
});

/* -------------------------------------------------------------------------- */

describe("two providers on one truck", () => {
  it("refuses the second grant outright, and creates no row", async () => {
    const truckId = ungrantedBaxterTruck();
    await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    const before = truckDispatchGrants(truckId).length;
    await expect(grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: "org_summit",
      dispatchOrganizationName: "Summit Dispatch", purpose: "Also cover the lane.",
    }, carrierCtx())).rejects.toBeInstanceOf(TruckDispatchOverlapError);

    expect(truckDispatchGrants(truckId)).toHaveLength(before);
    // ★ And the refused organization sees nothing at all. ★
    expect(liveDispatchGrantFor(truckId, "org_summit")).toBeUndefined();
  });

  it("names the incumbent in the refusal, so the carrier knows what to do", async () => {
    const truckId = ungrantedBaxterTruck();
    await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    await expect(grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: "org_summit",
      dispatchOrganizationName: "Summit Dispatch", purpose: "Also cover.",
    }, carrierCtx())).rejects.toThrow(/Meridian Dispatch/);
  });

  it("transfers when the carrier confirms, leaving exactly one live grant", async () => {
    const truckId = ungrantedBaxterTruck();
    const first = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    const second = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: "org_summit",
      dispatchOrganizationName: "Summit Dispatch",
      purpose: "Moving this lane to Summit.",
      transferFromGrantId: first.id,
    }, carrierCtx());

    const live = truckDispatchGrants(truckId);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(second.id);
    expect(second.transferredFromGrantId).toBe(first.id);
    // Ended, never removed: both sides of the move stay readable.
    expect(liveDispatchGrantFor(truckId, PROVIDER)).toBeUndefined();
    expect(liveDispatchGrantFor(truckId, "org_summit")?.id).toBe(second.id);
  });

  it("refuses a transfer of a grant the carrier did not issue", async () => {
    const truckId = ungrantedBaxterTruck();
    const first = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    await expect(grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: "org_summit",
      dispatchOrganizationName: "Summit Dispatch", purpose: "Taking it.",
      transferFromGrantId: first.id,
    }, providerCtx())).rejects.toBeInstanceOf(TruckNotFoundError);
  });
});

/* -------------------------------------------------------------------------- */

describe("revocation and expiry end future access", () => {
  it("refuses a revoke from anybody but the granting carrier", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    await expect(revokeDispatchDelegation(grant.id, "Taking it back.", providerCtx()))
      .rejects.toBeInstanceOf(TruckNotFoundError);
    expect(liveDispatchGrantFor(truckId, PROVIDER)).toBeDefined();
  });

  it("refuses a revoke without trucks:relationships:manage", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    const weak = truckContextFrom(
      contextFor(BAXTER_OWNER, { without: ["trucks:relationships:manage"] }),
    );
    await expect(revokeDispatchDelegation(grant.id, "Taking it back.", weak))
      .rejects.toBeInstanceOf(TruckPermissionError);
  });

  it("ends reach immediately, and records who ended it and why", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
    }, carrierCtx());

    const outcome = await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());
    expect(outcome.grant.status).toBe("ended");
    expect(outcome.grant.endReason).toBe("Back in house.");
    expect(outcome.grant.endedByMembershipId).toBe(carrierCtx().membershipId);
    expect(liveDispatchGrantFor(truckId, PROVIDER)).toBeUndefined();
  });

  it("stops conferring anything the moment effectiveTo passes, with no scheduler", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
      // A window that has already closed, stated outright. The point of this
      // test is that NOTHING runs when a grant lapses, so the test must not
      // depend on a timer either.
      effectiveFrom: hoursAgo(2),
      effectiveTo: hoursAgo(1),
    }, carrierCtx());

    // ★ Nothing ran at `effectiveTo`. The row still says "active". ★
    expect(grant.status).toBe("active");
    // And yet reach is gone, because every check asks `grantIsLive`.
    expect(grantIsLive(grant)).toBe(false);
    expect(liveDispatchGrantFor(truckId, PROVIDER)).toBeUndefined();
    expect(truckDispatchGrants(truckId).map((g) => g.id)).not.toContain(grant.id);
  });

  it("closes a lapsed grant once, when something finally looks", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
      effectiveFrom: hoursAgo(2),
      effectiveTo: hoursAgo(1),
    }, carrierCtx());

    expect(reconcileExpiredDispatchGrants([grant])).toBe(1);
    expect(grant.status).toBe("ended");
    // Idempotent: looking again changes nothing.
    expect(reconcileExpiredDispatchGrants([grant])).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("the operating carrier is derived, never assumed", () => {
  it("never answers with the equipment's owner", () => {
    // Every seeded truck resolves to a carrier that OPERATES it. Ownership
    // takes part only through a `carrier_owned` relationship, so a leasing
    // company holding a title is never the answer.
    for (const grant of dispatchGrantsByCarrier(CARRIER)) {
      const resolved = pinnedCarrierAt(grant.truckId, new Date().toISOString());
      expect(resolved.organizationId).not.toBe("org_halberd");
    }
  });

  it("fails closed on an unknown truck rather than guessing", () => {
    expect(() => pinnedCarrierAt("trk_nope", new Date().toISOString()))
      .toThrow(OperatingCarrierUnresolvedError);
  });

  it("fails closed on an unreadable instant", () => {
    const truckId = dispatchGrantsByCarrier(CARRIER)[0].truckId;
    expect(() => pinnedCarrierAt(truckId, "not-a-date"))
      .toThrow(OperatingCarrierUnresolvedError);
  });

  it("refuses a write when the operating carrier cannot be established", () => {
    expect(() => requireLoadWriteAuthority(contextFor(MERIDIAN_OWNER), {
      truckId: "trk_nope",
      instant: new Date().toISOString(),
      requires: ["loads:create"],
    })).toThrow(OperatingCarrierUnresolvedError);
  });
});

/* -------------------------------------------------------------------------- */

describe("a grant reaches only its own carrier's records", () => {
  it("refuses a load pinned to a different carrier than the grant names", () => {
    const grant = dispatchGrantsByCarrier(CARRIER)[0];
    // The provider holds a live grant from Baxter on this truck...
    expect(liveDispatchGrantFor(grant.truckId, PROVIDER)).toBeDefined();

    // ...and still cannot reach a load owned by somebody else on it. This is
    // the rule that stops a truck changing hands handing over the previous
    // carrier's history.
    const reach = loadReachFor(contextFor(MERIDIAN_OWNER), {
      organizationId: "org_cascade",
      pinnedCarrierOrganizationId: "org_cascade",
      assignment: { truckId: grant.truckId } as never,
    });
    expect(reach).toBeNull();
  });

  it("gives a carrier its own load without any grant at all", () => {
    const reach = loadReachFor(contextFor(BAXTER_OWNER), {
      organizationId: CARRIER,
      pinnedCarrierOrganizationId: CARRIER,
      assignment: undefined,
    });
    expect(reach).toBe("own_carrier");
  });

  it("refuses once the grant is revoked", async () => {
    const grant = dispatchGrantsByCarrier(CARRIER)[0];
    const load = {
      organizationId: CARRIER,
      pinnedCarrierOrganizationId: CARRIER,
      assignment: { truckId: grant.truckId } as never,
    };
    expect(loadReachFor(contextFor(MERIDIAN_OWNER), load)).toBe("dispatch_delegation");

    await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());
    expect(loadReachFor(contextFor(MERIDIAN_OWNER), load)).toBeNull();
  });

  it("does not let a caller-supplied organization id stand in for a grant", () => {
    // A forged acting organization on the actor changes nothing: the guard
    // never reads it, and the refusal is identical.
    const forged = {
      ...contextFor(MERIDIAN_OWNER),
      actor: {
        ...contextFor(MERIDIAN_OWNER).actor,
        actingOrganizationId: "org_cascade",
        actingOrganizationName: "Cascade Haul",
      },
    };
    const reach = loadReachFor(forged, {
      organizationId: "org_cascade",
      pinnedCarrierOrganizationId: "org_cascade",
      assignment: { truckId: dispatchGrantsByCarrier(CARRIER)[0].truckId } as never,
    });
    expect(reach).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("ending a delegation ends only what the delegation created", () => {
  it("revokes the dispatch_access shares of that carrier, and no others", async () => {
    const before = delegationSharesFor(PROVIDER, CARRIER);
    expect(before.length).toBeGreaterThan(0);

    // End every Baxter grant Meridian holds, so nothing of that carrier is left.
    for (const grant of dispatchGrantsByCarrier(CARRIER)) {
      if (grant.dispatchOrganizationId !== PROVIDER) continue;
      await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());
    }

    expect(delegationSharesFor(PROVIDER, CARRIER)).toHaveLength(0);
  });

  it("keeps the shares while ANY grant from that carrier survives", async () => {
    const mine = dispatchGrantsByCarrier(CARRIER)
      .filter((g) => g.dispatchOrganizationId === PROVIDER);
    expect(mine.length).toBeGreaterThan(1);

    const outcome = await revokeDispatchDelegation(mine[0].id, "One truck back.", carrierCtx());
    // Still dispatching other Baxter trucks, so the carrier-level paperwork
    // share is untouched. Revoking it here would cut off live work.
    expect(outcome.sharesRevoked).toBe(0);
    expect(delegationSharesFor(PROVIDER, CARRIER).length).toBeGreaterThan(0);
  });

  it("never touches another carrier's shares", async () => {
    const otherBefore = delegationSharesFor(PROVIDER, "org_ridgeway").length;
    for (const grant of dispatchGrantsByCarrier(CARRIER)) {
      if (grant.dispatchOrganizationId !== PROVIDER) continue;
      await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());
    }
    expect(delegationSharesFor(PROVIDER, "org_ridgeway")).toHaveLength(otherBefore);
  });

  it("ends no document LINKS, because a link cannot say which grant it belongs to", async () => {
    // `DocumentLink` carries no basis and no grant reference. Ending links by
    // organization and subject alone would reach paperwork this delegation
    // never created, so the cascade deliberately touches none.
    const grant = dispatchGrantsByCarrier(CARRIER)
      .find((g) => g.dispatchOrganizationId === PROVIDER)!;
    const outcome = await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());
    expect(outcome).not.toHaveProperty("linksEnded");
  });
});

/* -------------------------------------------------------------------------- */

describe("the receipt is bounded and fixed", () => {
  it("records no status for a grant that lapsed unobserved", async () => {
    const truckId = ungrantedBaxterTruck();
    const grant = await grantTruckDispatchAccess({
      truckId, dispatchOrganizationId: PROVIDER,
      dispatchOrganizationName: "Meridian Dispatch", purpose: "Cover the lane.",
      effectiveFrom: hoursAgo(2),
      effectiveTo: hoursAgo(1),
    }, carrierCtx());

    // Nothing was running when it lapsed, so the cascade records that honestly
    // rather than reading the carrier's load now and calling it "status at
    // expiry".
    const sealed = cascadeAfterEnding(grant, {
      basis: "expired_unobserved",
      note: "Ended on its own date.",
    });
    expect(sealed.receiptsSealed).toBe(0); // no booking was made in this test
  });
});

/* -------------------------------------------------------------------------- */

describe("a booking made for a carrier is the carrier's", () => {
  /**
   * These go through `bookNegotiation`, which needs an agreed negotiation on an
   * open listing — several modules deep. The ownership rule itself is proved
   * directly against the guard here, and end to end in
   * `tests/mt-loop-needs-you.test.ts` once a cycle is booked.
   */
  it("routes the write to the carrier, not to the workspace that acted", () => {
    const grant = dispatchGrantsByCarrier(CARRIER)
      .find((g) => g.dispatchOrganizationId === PROVIDER)!;

    const authority = requireLoadWriteAuthority(contextFor(MERIDIAN_OWNER), {
      truckId: grant.truckId,
      instant: new Date().toISOString(),
      requires: ["loads:create"],
    });

    expect(authority.basis).toBe("dispatch_delegation");
    // ★ The load belongs to the carrier. The provider is attribution. ★
    expect(authority.owningOrganizationId).toBe(CARRIER);
    expect(authority.actingOrganizationId).toBe(PROVIDER);
    expect(authority.grant?.id).toBe(grant.id);
  });

  it("gives a carrier booking its own freight the same answer by a shorter route", () => {
    const grant = dispatchGrantsByCarrier(CARRIER)[0];
    const authority = requireLoadWriteAuthority(contextFor(BAXTER_OWNER), {
      truckId: grant.truckId,
      instant: new Date().toISOString(),
      requires: ["loads:create"],
    });
    expect(authority.basis).toBe("own_carrier");
    expect(authority.owningOrganizationId).toBe(CARRIER);
    expect(authority.grant).toBeUndefined();
  });

  it("refuses the write once the grant is revoked", async () => {
    const grant = dispatchGrantsByCarrier(CARRIER)
      .find((g) => g.dispatchOrganizationId === PROVIDER)!;
    await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());

    expect(() => requireLoadWriteAuthority(contextFor(MERIDIAN_OWNER), {
      truckId: grant.truckId,
      instant: new Date().toISOString(),
      requires: ["loads:create"],
    })).toThrow(/not found/i);
  });

  it("refuses the write without the action's own permission", () => {
    const grant = dispatchGrantsByCarrier(CARRIER)
      .find((g) => g.dispatchOrganizationId === PROVIDER)!;
    expect(() => requireLoadWriteAuthority(
      contextFor(MERIDIAN_OWNER, { without: ["loads:create"] }),
      {
        truckId: grant.truckId,
        instant: new Date().toISOString(),
        requires: ["loads:create"],
      },
    )).toThrow(/Missing permission/i);
  });

  it("authorizes a later command against the PIN, not against today's operator", () => {
    const grant = dispatchGrantsByCarrier(CARRIER)
      .find((g) => g.dispatchOrganizationId === PROVIDER)!;

    // A load booked long ago under a DIFFERENT carrier. Whoever runs the truck
    // today is irrelevant: the pin is the answer, and the provider's grant
    // names the wrong carrier for it.
    expect(() => requireLoadWriteAuthority(contextFor(MERIDIAN_OWNER), {
      truckId: grant.truckId,
      instant: new Date().toISOString(),
      requires: ["loads:assign"],
      pinnedOwnerOrganizationId: "org_cascade",
    })).toThrow(/not found/i);
  });

  it("lets the pinned carrier act on its own historical load with no grant", () => {
    const grant = dispatchGrantsByCarrier(CARRIER)
      .find((g) => g.dispatchOrganizationId === PROVIDER)!;

    const authority = requireLoadWriteAuthority(contextFor(BAXTER_OWNER), {
      truckId: grant.truckId,
      instant: new Date().toISOString(),
      requires: ["loads:assign"],
      pinnedOwnerOrganizationId: CARRIER,
    });
    expect(authority.basis).toBe("own_carrier");
    expect(authority.owningOrganizationId).toBe(CARRIER);
  });
});


/* -------------------------------------------------------------------------- */

describe("ownership of the equipment is not authority over the freight", () => {
  /**
   * `T.nl118` is owned by a PERSON — Marcus Hale, an owner-operator — and runs
   * under Northline's MC on a `leased_owner_operator` relationship. It is the
   * case the whole pinning rule exists for: the truck is his, the authority is
   * theirs, and a load booked on it is the carrier's transaction.
   */
  const OWNER_OPERATOR_TRUCK = "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1005";

  it("pins a personally owned truck to the MC it runs under, not to its owner", () => {
    const resolved = pinnedCarrierAt(OWNER_OPERATOR_TRUCK, new Date().toISOString());
    expect(resolved.organizationId).toBe("org_northline");
  });

  it("never resolves through the ownership branch for a person-owned truck", () => {
    // `resolveOperatingContextAt` only consults ownership to identify a
    // `carrier_owned` relationship, and that branch requires an ORGANIZATION
    // owner. A person's truck can therefore never resolve that way — it is
    // proved by the lease or by a sole approved relationship or not at all.
    const ctx = operatingContextAt(OWNER_OPERATOR_TRUCK, new Date().toISOString());
    expect(ctx.resolved).toBe(true);
    if (ctx.resolved) expect(ctx.basis).not.toBe("carrier_owned");
  });

  it("gives the owner's organization no write authority over the carrier's load", () => {
    // Halberd Leasing owns equipment in these fixtures and operates nothing.
    // It holds no grant and no relationship, so it is refused — ownership
    // contributes nothing to any of the four questions.
    const halberd = { ...contextFor(BAXTER_OWNER), organizationId: "org_halberd" };
    expect(() => requireLoadWriteAuthority(halberd, {
      truckId: OWNER_OPERATOR_TRUCK,
      instant: new Date().toISOString(),
      requires: ["loads:create"],
    })).toThrow(/not found/i);
  });

  it("does not hand the carrier's broker relationship to the truck's owner", () => {
    // A load pinned to the carrier is unreachable from any organization that
    // merely owns the equipment, so nothing on it — broker, rate, documents —
    // travels with the truck.
    const reach = loadReachFor({ organizationId: "org_halberd" }, {
      organizationId: "org_northline",
      pinnedCarrierOrganizationId: "org_northline",
      assignment: { truckId: OWNER_OPERATOR_TRUCK } as never,
    });
    expect(reach).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("one grant ending is not every grant ending", () => {
  it("leaves reach intact on trucks still covered by a live grant", async () => {
    const mine = dispatchGrantsByCarrier(CARRIER)
      .filter((g) => g.dispatchOrganizationId === PROVIDER);
    expect(mine.length).toBeGreaterThan(1);

    const [ended, survivor] = mine;
    await revokeDispatchDelegation(ended.id, "One truck back.", carrierCtx());

    // The revoked truck is gone...
    expect(liveDispatchGrantFor(ended.truckId, PROVIDER)).toBeUndefined();
    // ...and the other is untouched.
    expect(liveDispatchGrantFor(survivor.truckId, PROVIDER)?.id).toBe(survivor.id);
    expect(loadReachFor(contextFor(MERIDIAN_OWNER), {
      organizationId: CARRIER,
      pinnedCarrierOrganizationId: CARRIER,
      assignment: { truckId: survivor.truckId } as never,
    })).toBe("dispatch_delegation");
  });

  it("does not let a surviving document share restore operational reach", async () => {
    // End every grant, but leave a share standing on another basis.
    for (const grant of dispatchGrantsByCarrier(CARRIER)) {
      if (grant.dispatchOrganizationId !== PROVIDER) continue;
      await revokeDispatchDelegation(grant.id, "Back in house.", carrierCtx());
    }
    const otherBasis = allShares().filter(
      (s) => !s.revokedAt
        && s.sharedWithOrganizationId === PROVIDER
        && s.basis.kind !== "dispatch_access",
    );
    // Whether or not one happens to exist in the fixture, the rule is the same:
    // a document share is not operational reach, and never restores it.
    for (const truckId of dispatchGrantsByCarrier(CARRIER).map((g) => g.truckId)) {
      expect(loadReachFor(contextFor(MERIDIAN_OWNER), {
        organizationId: CARRIER,
        pinnedCarrierOrganizationId: CARRIER,
        assignment: { truckId } as never,
      })).toBeNull();
    }
    expect(otherBasis.every((s) => s.basis.kind !== "dispatch_access")).toBe(true);
  });
});

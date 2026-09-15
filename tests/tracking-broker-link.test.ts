import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  addTrackingRecipient, approveTrackingUpdate, closeTrackingSession,
  discardTrackingUpdate, draftTrackingUpdate, openTrackingSession, reissueTrackingLink,
  revokeTrackingLink, sessionForLoadSync, setUpdatePolicy, trackingAudit,
} from "@/lib/api/mock/tracking-registry";
import { publicTracking } from "@/lib/api/mock/tracking-board";
import { defaultVisibility, NEVER_DISCLOSED } from "@/lib/tracking";
import {
  endCarrierRelationship, getTruckProfile, truckContextFrom,
} from "@/lib/api/mock/truck-registry";
import { mockStore } from "@/lib/api/mock/store";
import type { TrackingSession } from "@/types";
import {
  MERIDIAN_DISPATCHER, NORTHLINE_OWNER, rejects, resetWorld, trackingContextFor, without,
} from "./tracking-harness";

/**
 * Load-scoped tracking sessions and the links they mint.
 *
 * The important assertions here are the negative ones: what a link holder
 * cannot reach, and what a closed link does instead of quietly working.
 */

const HOUR_MS = 3_600_000;

function northlineLoad(reference: string) {
  return mockStore.org("org_northline").loads.find((l) => l.reference === reference)!;
}

async function sessionWithBroker(): Promise<{
  ctx: ReturnType<typeof trackingContextFor>;
  session: TrackingSession;
  token: string;
}> {
  const ctx = trackingContextFor(NORTHLINE_OWNER);
  const load = northlineLoad("NL-24817");
  const session = await openTrackingSession(ctx, { loadId: load.id });
  const recipient = await addTrackingRecipient(ctx, {
    sessionId: session.id,
    audience: "broker",
    partyName: "Apex Logistics",
    contactName: "Dana Wells",
    contactEmail: "dana@example.test",
  });
  return { ctx, session, token: recipient.link.token };
}

describe("one session per load", () => {
  beforeEach(resetWorld);

  it("returns the same session when tracking is opened twice", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = northlineLoad("NL-24817");
    const first = await openTrackingSession(ctx, { loadId: load.id });
    const second = await openTrackingSession(ctx, { loadId: load.id });
    assert.equal(first.id, second.id);
  });

  it("refuses to open one without tracking:share", async () => {
    const ctx = without(trackingContextFor(NORTHLINE_OWNER), "tracking:share");
    await rejects(
      () => openTrackingSession(ctx, { loadId: northlineLoad("NL-24817").id }),
      "PermissionDeniedError",
    );
  });

  it("is invisible to another organization", async () => {
    const { session } = await sessionWithBroker();
    const other = trackingContextFor(MERIDIAN_DISPATCHER);
    assert.equal(sessionForLoadSync(other, session.loadId), undefined);
  });
});

describe("what a link holder is shown", () => {
  beforeEach(resetWorld);

  it("resolves a live broker link to a small, redacted view", async () => {
    const { token } = await sessionWithBroker();
    const result = publicTracking(token);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const view = result.view;
    assert.equal(view.audience, "broker");
    assert.ok(view.stops.length > 0);
    assert.ok(view.expiresAt);
    assert.match(view.disclosure, /not a MacroPoint/i);
    assert.match(view.disclosure, /mock/i);
  });

  it("never carries a rate, a driver, hours of service or an internal note", async () => {
    const { token } = await sessionWithBroker();
    const result = publicTracking(token);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Serialized, because a leak would arrive as a nested field rather than a
    // top-level key somebody remembered to check.
    const json = JSON.stringify(result.view).toLowerCase();
    for (const forbidden of [
      "linehaul", "ratepermile", "totalrate", "cents", "financials",
      "dmitri", "driver", "hoursofservice", "dutystatus", "internalnote",
      "vin", "plate",
    ]) {
      assert.equal(json.includes(forbidden), false, `the public view leaked "${forbidden}"`);
    }
    // And the list of what is never disclosed is a real list, not a comment.
    assert.ok(NEVER_DISCLOSED.length >= 8);
  });

  it("never mentions another load", async () => {
    const { token } = await sessionWithBroker();
    const result = publicTracking(token);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const json = JSON.stringify(result.view);
    for (const load of mockStore.org("org_northline").loads) {
      if (load.reference === "NL-24817") continue;
      assert.equal(json.includes(load.reference), false, `${load.reference} leaked`);
      assert.equal(json.includes(load.id), false, `${load.id} leaked`);
    }
  });

  it("shows a shipper the pickup and withholds the delivery", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const session = await openTrackingSession(ctx, { loadId: northlineLoad("NL-24817").id });
    const shipper = await addTrackingRecipient(ctx, {
      sessionId: session.id,
      audience: "shipper",
      partyName: "Rivet Supply Co.",
    });

    const result = publicTracking(shipper.link.token);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(result.view.stops.some((s) => s.kind === "pickup"));
    assert.equal(result.view.stops.some((s) => s.kind === "delivery"), false);
    // A shipper is not given the truck's position by default either.
    assert.equal(result.view.truckLocation, undefined);
  });

  it("shows a receiver the delivery and withholds the pickup", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const session = await openTrackingSession(ctx, { loadId: northlineLoad("NL-24817").id });
    const receiver = await addTrackingRecipient(ctx, {
      sessionId: session.id,
      audience: "receiver",
      partyName: "Rivet DC Columbus",
    });

    const result = publicTracking(receiver.link.token);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(result.view.stops.some((s) => s.kind === "delivery"));
    assert.equal(result.view.stops.some((s) => s.kind === "pickup"), false);
  });

  it("refuses to give a shipper the delivery even when asked to", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const session = await openTrackingSession(ctx, { loadId: northlineLoad("NL-24817").id });
    const shipper = await addTrackingRecipient(ctx, {
      sessionId: session.id,
      audience: "shipper",
      partyName: "Rivet Supply Co.",
      visibility: { ...defaultVisibility("shipper"), deliveryProgress: true },
    });
    assert.equal(shipper.visibility.deliveryProgress, false);
  });

  it("withholds the carrier's name unless it is deliberately switched on", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    const first = publicTracking(token);
    assert.equal(first.ok && first.view.carrierName, undefined);

    const recipient = sessionForLoadSync(ctx, session.loadId)!.recipients[0];
    assert.equal(recipient.visibility.carrierName, false);
  });
});

describe("links expire, are revoked, and close by themselves", () => {
  beforeEach(resetWorld);

  it("always mints a link with an expiry", async () => {
    const { ctx, session } = await sessionWithBroker();
    const recipient = sessionForLoadSync(ctx, session.loadId)!.recipients[0];
    assert.ok(recipient.link.expiresAt);
    assert.ok(Date.parse(recipient.link.expiresAt) > Date.now());
  });

  it("refuses a revoked link, and says it was withdrawn", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    const recipient = sessionForLoadSync(ctx, session.loadId)!.recipients[0];
    await revokeTrackingLink(ctx, session.id, recipient.id, "The broker re-brokered the load.");

    const result = publicTracking(token);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal, "revoked");
    assert.match(result.message, /withdrawn/i);
  });

  it("refuses an expired link", async () => {
    const { token } = await sessionWithBroker();
    const wellPastExpiry = new Date(Date.now() + 400 * HOUR_MS);
    const result = publicTracking(token, wellPastExpiry);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal, "expired");
  });

  it("closes after delivery plus the configured grace", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    // NL-24812 delivered a day or so ago in the fixtures.
    const load = northlineLoad("NL-24812");
    const session = await openTrackingSession(ctx, {
      loadId: load.id,
      postDeliveryGraceHours: 1,
    });
    const recipient = await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Tandem Freight Partners",
    });

    const result = publicTracking(recipient.link.token);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal, "completed");
    assert.match(result.message, /delivered/i);
  });

  it("closes when the load is cancelled", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = northlineLoad("NL-24817");
    const session = await openTrackingSession(ctx, { loadId: load.id });
    const recipient = await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Apex Logistics",
    });

    load.status = "cancelled";
    const result = publicTracking(recipient.link.token);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal, "cancelled");
  });

  it("closes when the carrier relationship behind it ends", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = northlineLoad("NL-24817");
    const session = await openTrackingSession(ctx, { loadId: load.id });
    const recipient = await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Apex Logistics",
    });
    assert.equal(publicTracking(recipient.link.token).ok, true);

    // End it for real, through the truck registry that owns the relationship.
    // Nothing in the tracking layer is told; the link closes because the
    // question is asked of the registry every time it is resolved.
    const truckCtx = truckContextFrom(ctx);
    const profile = await getTruckProfile(session.truckId!, truckCtx);
    await endCarrierRelationship(
      profile.myRelationship!.id,
      "The carrier moved the truck to another agency.",
      truckCtx,
    );

    const result = publicTracking(recipient.link.token);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal, "relationship_ended");
  });

  it("closes every link when the session is closed", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    await closeTrackingSession(ctx, session.id, "Load was covered elsewhere.");
    const result = publicTracking(token);
    assert.equal(result.ok, false);
  });

  it("refuses a token nobody ever minted", () => {
    const result = publicTracking("not-a-real-token");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal, "unknown_token");
  });

  it("mints a NEW token on reissue and kills the old one", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    const recipient = sessionForLoadSync(ctx, session.loadId)!.recipients[0];
    await revokeTrackingLink(ctx, session.id, recipient.id, "Sent to the wrong address.");

    const reissued = await reissueTrackingLink(ctx, session.id, recipient.id);
    assert.ok(reissued);
    assert.notEqual(reissued!.link.token, token);
    assert.equal(publicTracking(token).ok, false, "the old token stays dead");
    assert.equal(publicTracking(reissued!.link.token).ok, true);
  });
});

describe("the update policy", () => {
  beforeEach(resetWorld);

  it("holds an update as a draft until a dispatcher approves it", async () => {
    const { ctx, session } = await sessionWithBroker();
    const update = await draftTrackingUpdate(ctx, {
      sessionId: session.id,
      kind: "in_transit",
      message: "In transit near Dayton, OH.",
    });
    assert.equal(update?.state, "draft");

    const approved = await approveTrackingUpdate(ctx, session.id, update!.id);
    assert.equal(approved?.state, "approved");
    assert.equal(approved?.approvedByName, "Sam Murtaza");
    assert.match(approved!.handoffNote, /Nothing was transmitted/i);
  });

  it("queues automatically when the policy says so, with nobody in the loop", async () => {
    const { ctx, session } = await sessionWithBroker();
    await setUpdatePolicy(ctx, session.id, "automatic_mock_handoff");

    const update = await draftTrackingUpdate(ctx, {
      sessionId: session.id,
      kind: "eta_changed",
      message: "ETA moved to 18:40.",
    });
    assert.equal(update?.state, "queued");
    assert.equal(update?.createdByName, "Antcolos");
  });

  it("will not let a membership without tracking:update:send approve one", async () => {
    const { ctx, session } = await sessionWithBroker();
    const update = await draftTrackingUpdate(ctx, {
      sessionId: session.id, kind: "delay", message: "Running about an hour late.",
    });
    const limited = without(ctx, "tracking:update:send");
    await rejects(
      () => approveTrackingUpdate(limited, session.id, update!.id),
      "PermissionDeniedError",
    );
  });

  it("keeps a discarded update with its reason rather than deleting it", async () => {
    const { ctx, session } = await sessionWithBroker();
    const update = await draftTrackingUpdate(ctx, {
      sessionId: session.id, kind: "delay", message: "Running about an hour late.",
    });
    const discarded = await discardTrackingUpdate(ctx, session.id, update!.id, "Driver made the time up.");
    assert.equal(discarded?.state, "discarded");
    assert.equal(discarded?.discardReason, "Driver made the time up.");
    assert.equal(sessionForLoadSync(ctx, session.loadId)!.updates.length, 1);
  });

  it("shows a link holder only approved or queued updates", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    const draft = await draftTrackingUpdate(ctx, {
      sessionId: session.id, kind: "delay", message: "SECRET-DRAFT",
    });
    const shown = await draftTrackingUpdate(ctx, {
      sessionId: session.id, kind: "in_transit", message: "PUBLISHED-LINE",
    });
    await approveTrackingUpdate(ctx, session.id, shown!.id);

    const result = publicTracking(token);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const messages = result.view.status.map((s) => s.message);
    assert.ok(messages.includes("PUBLISHED-LINE"));
    assert.equal(messages.includes("SECRET-DRAFT"), false);
    assert.ok(draft);
  });
});

describe("the audit history", () => {
  beforeEach(resetWorld);

  it("records the session, the recipient, the link and every access", async () => {
    const { ctx, token } = await sessionWithBroker();
    publicTracking(token);
    publicTracking(token);

    const actions = trackingAudit(ctx).map((e) => e.action);
    for (const expected of ["session_opened", "recipient_added", "link_issued", "link_accessed"]) {
      assert.ok(actions.includes(expected as never), `missing ${expected} in the history`);
    }
    assert.equal(actions.filter((a) => a === "link_accessed").length, 2);
  });

  it("records a refused attempt as well as a successful one", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    const recipient = sessionForLoadSync(ctx, session.loadId)!.recipients[0];
    await revokeTrackingLink(ctx, session.id, recipient.id, "Withdrawn.");
    publicTracking(token);

    const actions = trackingAudit(ctx).map((e) => e.action);
    assert.ok(actions.includes("link_access_refused"));
  });

  it("counts accesses on the link itself", async () => {
    const { ctx, session, token } = await sessionWithBroker();
    publicTracking(token);
    publicTracking(token);
    publicTracking(token);
    const recipient = sessionForLoadSync(ctx, session.loadId)!.recipients[0];
    assert.equal(recipient.link.accessCount, 3);
    assert.ok(recipient.link.lastAccessedAt);
  });

  it("is not readable from another organization", async () => {
    await sessionWithBroker();
    const other = trackingContextFor(MERIDIAN_DISPATCHER);
    const leaked = trackingAudit(other).filter((e) => e.summary.includes("NL-24817"));
    assert.equal(leaked.length, 0);
  });
});

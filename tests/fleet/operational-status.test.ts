import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRESHNESS_HOURS, EXPIRY_WARNING_DAYS, TRAILER_FRESHNESS_HOURS,
  aggregateUtilization, deriveAuthorityLock, deriveOperationalStatus, deriveReadiness,
  deriveUtilization, telemetrySnapshot,
} from "@/lib/fleet/operational-status";
import type { FleetStatusFacts } from "@/lib/fleet/operational-status";
import type { FleetTelemetryReading } from "@/types";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const truckFacts = (over: Partial<FleetStatusFacts> = {}): FleetStatusFacts => ({
  assetKind: "truck",
  recordStatus: "available",
  hasLiveLease: false,
  leaseIsMine: false,
  ...over,
});

const trailerFacts = (over: Partial<FleetStatusFacts> = {}): FleetStatusFacts => ({
  assetKind: "trailer",
  recordStatus: "available",
  hasLiveLease: false,
  leaseIsMine: false,
  ...over,
});

describe("deriveOperationalStatus — rule order", () => {
  it("puts maintenance above everything, lease included", () => {
    const d = deriveOperationalStatus(
      truckFacts({ recordStatus: "maintenance", hasLiveLease: true, leaseIsMine: true, leaseStatus: "active" }),
      NOW,
    );
    // A truck on a lift is on a lift. No paperwork makes it drivable.
    expect(d.status).toBe("maintenance");
    expect(d.decidedBy).toBe("truck_record");
  });

  it("treats a truck's `unavailable` and a trailer's `out_of_service` as one thing", () => {
    expect(deriveOperationalStatus(truckFacts({ recordStatus: "unavailable" }), NOW).status)
      .toBe("out_of_service");
    expect(deriveOperationalStatus(trailerFacts({ recordStatus: "out_of_service" }), NOW).status)
      .toBe("out_of_service");
  });

  it("reads a live lease as assigned, and a loaded one as in transit", () => {
    expect(deriveOperationalStatus(
      truckFacts({ hasLiveLease: true, leaseIsMine: true, leaseStatus: "active" }), NOW,
    ).status).toBe("assigned");

    const moving = deriveOperationalStatus(
      truckFacts({ recordStatus: "loaded", hasLiveLease: true, leaseIsMine: true, leaseStatus: "active" }),
      NOW,
    );
    expect(moving.status).toBe("in_transit");
    expect(moving.decidedBy).toBe("operating_lease");
  });

  it("reports a reservation as committed, not as moving", () => {
    const d = deriveOperationalStatus(
      truckFacts({ hasLiveLease: true, leaseIsMine: true, leaseStatus: "reserved" }), NOW,
    );
    expect(d.status).toBe("assigned");
    expect(d.reason).toMatch(/has not started/);
  });

  it("never names the holder when the lease is somebody else's", () => {
    const d = deriveOperationalStatus(
      truckFacts({ hasLiveLease: true, leaseIsMine: false }), NOW,
    );
    expect(d.status).toBe("assigned");
    const leaseInput = d.inputs.find((i) => i.source === "operating_lease")!;
    expect(leaseInput.label).toBe("An operating lease is live on this equipment");
    expect(JSON.stringify(d)).not.toMatch(/your/i);
  });

  it("treats an attached trailer as committed even with no lease", () => {
    expect(deriveOperationalStatus(
      trailerFacts({ recordStatus: "attached", attachmentState: "attached" }), NOW,
    ).status).toBe("assigned");

    expect(deriveOperationalStatus(
      trailerFacts({ attachmentState: "in_active_movement" }), NOW,
    ).status).toBe("in_transit");

    expect(deriveOperationalStatus(
      trailerFacts({ attachmentState: "reserved_for_attachment" }), NOW,
    ).status).toBe("assigned");
  });

  it("falls to expected_available only when nothing holds it", () => {
    const future = deriveOperationalStatus(
      truckFacts({ expectedAvailableAt: at(6 * HOUR) }), NOW,
    );
    expect(future.status).toBe("expected_available");
    expect(future.decidedBy).toBe("availability_record");

    // A past expected-free time is not a claim about the future.
    expect(deriveOperationalStatus(
      truckFacts({ expectedAvailableAt: at(-6 * HOUR) }), NOW,
    ).status).toBe("available");
  });

  it("does not report the trailer's own status back as an attachment fact", () => {
    // `attachmentStateFor` reflects the trailer record when the equipment is
    // down. Listing it as a second input would make one fact look like two
    // records independently agreeing.
    const d = deriveOperationalStatus(
      trailerFacts({ recordStatus: "out_of_service", attachmentState: "out_of_service" }), NOW,
    );
    expect(d.status).toBe("out_of_service");
    expect(d.inputs.map((i) => i.source)).toEqual(["trailer_record"]);
  });

  it("always reports the records it consulted", () => {
    const d = deriveOperationalStatus(
      trailerFacts({
        recordStatus: "loaded", attachmentState: "attached",
        hasLiveLease: true, leaseIsMine: true, leaseStatus: "active",
        expectedAvailableAt: at(DAY),
      }),
      NOW,
    );
    expect(d.inputs.map((i) => i.source)).toEqual([
      "trailer_record", "operating_lease", "trailer_attachment", "availability_record",
    ]);
  });
});

describe("deriveAuthorityLock — separate from status", () => {
  it("blocks without naming another carrier when none was disclosed", () => {
    const lock = deriveAuthorityLock("locked_by_other", "assigned");
    expect(lock.availableToOrganization).toBe(false);
    expect(lock.lockedByOtherAuthority).toBe(true);
    expect(lock.blockedReason).toBe("Held under another carrier's active operating authority.");
    expect(lock.operatingCarrierName).toBeUndefined();
  });

  it("names the carrier only when the caller already had the name", () => {
    const lock = deriveAuthorityLock("locked_by_other", "assigned", "Baxter Transit LLC");
    expect(lock.blockedReason).toContain("Baxter Transit LLC");
  });

  it("leaves the org's own live lease available — busy for you is not blocked", () => {
    for (const state of ["available_for_activation", "activation_reserved", "active_operating_lease", "pending_release"] as const) {
      expect(deriveAuthorityLock(state, "assigned").availableToOrganization).toBe(true);
    }
  });

  it("blocks an unapproved, suspended or ended relationship", () => {
    for (const state of ["onboarding", "pending_approval", "suspended", "ended"] as const) {
      const lock = deriveAuthorityLock(state, "available");
      expect(lock.availableToOrganization).toBe(false);
      expect(lock.lockedByOtherAuthority).toBe(false);
      expect(lock.blockedReason).toBeTruthy();
    }
  });

  it("blocks on maintenance without calling it somebody else's lock", () => {
    const lock = deriveAuthorityLock("available_for_activation", "maintenance");
    expect(lock.availableToOrganization).toBe(false);
    expect(lock.lockedByOtherAuthority).toBe(false);
    expect(lock.blockedReason).toMatch(/maintenance/);
  });
});

describe("telemetrySnapshot", () => {
  const reading = (hoursOld: number): FleetTelemetryReading => ({
    id: "r1", assetKind: "truck", assetId: "a", organizationId: "org",
    source: "manual_entry", observedAt: at(-hoursOld * HOUR), recordedAt: at(-hoursOld * HOUR),
  });

  it("treats a missing reading as stale, not as fresh and empty", () => {
    const s = telemetrySnapshot(undefined, "truck", NOW);
    expect(s.stale).toBe(true);
    expect(s.ageHours).toBeUndefined();
    expect(s.reading).toBeUndefined();
  });

  it("gives trailers a longer rope than power units", () => {
    expect(telemetrySnapshot(reading(24), "truck", NOW).stale).toBe(true);
    expect(telemetrySnapshot(reading(24), "trailer", NOW).stale).toBe(false);
    expect(telemetrySnapshot(reading(1), "truck", NOW).freshnessExpectationHours)
      .toBe(DEFAULT_FRESHNESS_HOURS);
    expect(telemetrySnapshot(reading(1), "trailer", NOW).freshnessExpectationHours)
      .toBe(TRAILER_FRESHNESS_HOURS);
  });

  it("measures age against the observation, not the paperwork", () => {
    const late: FleetTelemetryReading = {
      ...reading(20),
      // Written up an hour ago, but it was true twenty hours ago.
      recordedAt: at(-HOUR),
    };
    const s = telemetrySnapshot(late, "truck", NOW);
    expect(Math.round(s.ageHours!)).toBe(20);
    expect(s.stale).toBe(true);
  });
});

describe("deriveReadiness", () => {
  it("never claims anything about IFTA", () => {
    const ifta = deriveReadiness({ assetKind: "truck" }, NOW).items.find((i) => i.kind === "ifta")!;
    expect(ifta.state).toBe("not_tracked");
    expect(ifta.source).toBe("not_connected");
    expect(ifta.detail).toMatch(/no state or fuel-card integration is connected/i);
  });

  it("counts a missing registration and plate as blocking, not as unknown", () => {
    const r = deriveReadiness({ assetKind: "truck" }, NOW);
    expect(r.items.find((i) => i.kind === "registration")!.state).toBe("missing");
    expect(r.items.find((i) => i.kind === "plate")!.state).toBe("missing");
    // IFTA and the trailer permit are `not_tracked` and never count as blocking.
    expect(r.blocking).toBe(3); // registration, plate, cab card
  });

  it("grades a plate by its expiry", () => {
    const grade = (days: number) => deriveReadiness({
      assetKind: "truck", plateNumber: "IL-1", plateState: "IL",
      plateExpiresAt: at(days * DAY),
    }, NOW).items.find((i) => i.kind === "plate")!.state;

    expect(grade(-1)).toBe("expired");
    expect(grade(EXPIRY_WARNING_DAYS - 1)).toBe("expiring_soon");
    expect(grade(EXPIRY_WARNING_DAYS + 10)).toBe("ready");
  });

  it("distinguishes not recorded from not held", () => {
    const items = deriveReadiness({
      assetKind: "truck", plateNumber: "IL-1", plateState: "IL", // no expiry
    }, NOW).items;
    expect(items.find((i) => i.kind === "plate")!.state).toBe("unknown");
    expect(items.find((i) => i.kind === "ifta")!.state).toBe("not_tracked");
  });

  it("does not invent a permit requirement for trailers", () => {
    const permit = deriveReadiness({ assetKind: "trailer" }, NOW).items
      .find((i) => i.kind === "permit")!;
    expect(permit.state).toBe("not_tracked");
    expect(permit.source).toBe("not_connected");
  });

  it("treats a rejected document as missing rather than present", () => {
    const r = deriveReadiness({
      assetKind: "truck",
      registrationDocument: { status: "rejected" },
    }, NOW).items.find((i) => i.kind === "registration")!;
    expect(r.state).toBe("missing");
    expect(r.detail).toMatch(/rejected/);
  });
});

describe("deriveUtilization", () => {
  it("never counts an hour twice when leases overlap", () => {
    const u = deriveUtilization({
      leaseIntervals: [
        { startAt: at(-10 * DAY), endAt: at(-8 * DAY) },
        { startAt: at(-9 * DAY), endAt: at(-7 * DAY) },
      ],
      currentlyDown: false,
      recordsBeginAt: at(-90 * DAY),
    }, 30, NOW);
    // Three distinct days, not four.
    expect(u.operatingHours).toBe(72);
    // And the number says what it does not count, so it is not read as a
    // measure of how busy the equipment actually was.
    expect(u.basis).toMatch(/Work recorded without a lease is not counted/);
  });

  it("clips an open interval at now and a long one at the window", () => {
    const u = deriveUtilization({
      leaseIntervals: [{ startAt: at(-200 * DAY) }],
      currentlyDown: false,
      recordsBeginAt: at(-300 * DAY),
    }, 30, NOW);
    expect(u.operatingHours).toBe(30 * 24);
    expect(u.utilizationPct).toBe(100);
  });

  it("says so when the asset is down and nothing records since when", () => {
    const u = deriveUtilization({
      leaseIntervals: [], currentlyDown: true, recordsBeginAt: at(-90 * DAY),
    }, 30, NOW);
    expect(u.downtimeHours).toBe(0);
    expect(u.fullyDerived).toBe(false);
    expect(u.basis).toMatch(/no timeline entry records when that began/);
  });

  it("says so when the records start inside the window", () => {
    const u = deriveUtilization({
      leaseIntervals: [], currentlyDown: false, recordsBeginAt: at(-10 * DAY),
    }, 30, NOW);
    expect(u.fullyDerived).toBe(false);
    expect(u.basis).toMatch(/begin inside the window/);
  });

  it("excludes downtime from the hours an asset could have been used", () => {
    const u = deriveUtilization({
      leaseIntervals: [{ startAt: at(-20 * DAY), endAt: at(-10 * DAY) }],
      currentlyDown: true,
      downSince: at(-10 * DAY),
      recordsBeginAt: at(-90 * DAY),
    }, 30, NOW);
    expect(u.downtimeHours).toBe(10 * 24);
    expect(u.operatingHours).toBe(10 * 24);
    // 240 operating out of (720 - 240) usable.
    expect(u.utilizationPct).toBe(50);
    expect(u.availabilityPct).toBe(66.7);
    expect(u.fullyDerived).toBe(true);
  });
});

describe("aggregateUtilization", () => {
  it("sums hours instead of averaging percentages", () => {
    const busy = deriveUtilization({
      leaseIntervals: [{ startAt: at(-30 * DAY) }], currentlyDown: false,
      recordsBeginAt: at(-90 * DAY),
    }, 30, NOW);
    const idle = deriveUtilization({
      leaseIntervals: [], currentlyDown: false, recordsBeginAt: at(-90 * DAY),
    }, 30, NOW);

    const agg = aggregateUtilization([busy, idle], 30, NOW);
    expect(agg.operatingHours).toBe(720);
    expect(agg.utilizationPct).toBe(50);
    expect(agg.fullyDerived).toBe(true);
  });

  it("reports an empty fleet honestly rather than as zero per cent", () => {
    const agg = aggregateUtilization([], 30, NOW);
    expect(agg.fullyDerived).toBe(false);
    expect(agg.basis).toBe("No equipment to report on.");
  });
});

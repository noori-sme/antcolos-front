import type {
  AssetActivationState, FleetAssetKind, FleetOperationalStatus, FleetReadinessItem,
  FleetReadinessState, FleetReadinessSummary, FleetStatusDerivation, FleetStatusInput,
  FleetTelemetryReading, FleetTelemetrySnapshot, FleetUtilizationSummary,
  OperatingLeaseStatus, TrailerAttachmentState, TrailerOperatingStatus,
  TruckOperatingStatus, FleetAuthorityLock,
} from "@/types";

/**
 * Deriving the operational picture from the permanent records.
 *
 * Every function here is pure: facts in, answer out, no reads and no writes.
 * That is deliberate. The reconciliation rules are the part of this layer most
 * likely to be argued about, and they belong somewhere they can be read in one
 * sitting and tested without a registry, a session or a network.
 *
 * The ordering of the rules is the design. A truck in the shop is in the shop
 * whatever its lease says, and a truck committed to a movement is committed
 * whatever its availability record says. Getting that order wrong is how a
 * dispatcher ends up sending a driver to a truck on a lift.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How old a location reading may get before this layer stops trusting it. */
export const DEFAULT_FRESHNESS_HOURS = 12;
/** A parked trailer does not move on its own; it is given more rope. */
export const TRAILER_FRESHNESS_HOURS = 48;
/** How close an expiry has to be before it is worth interrupting somebody. */
export const EXPIRY_WARNING_DAYS = 30;
/** The reporting window for utilization. */
export const UTILIZATION_WINDOW_DAYS = 30;

export function freshnessExpectationFor(assetKind: FleetAssetKind): number {
  return assetKind === "trailer" ? TRAILER_FRESHNESS_HOURS : DEFAULT_FRESHNESS_HOURS;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the reconciliation is allowed to look at.
 *
 * Note what is absent: there is no `status` field of the fleet layer's own to
 * pass in, because it does not have one. These are the authoritative records
 * and nothing else.
 */
export interface FleetStatusFacts {
  assetKind: FleetAssetKind;
  /** Straight off the Truck or the Trailer. The physical state. */
  recordStatus: TruckOperatingStatus | TrailerOperatingStatus;
  /** Off the availability record. */
  expectedAvailableAt?: string;
  /** Trailers only: off the attachment record. */
  attachmentState?: TrailerAttachmentState;
  /** Whether ANY operating lease holds the asset — this carrier's or another's. */
  hasLiveLease: boolean;
  /** Whether the live lease is this organization's. */
  leaseIsMine: boolean;
  leaseStatus?: OperatingLeaseStatus;
}

const TRUCK_STATUS_TEXT: Record<TruckOperatingStatus, string> = {
  available: "available",
  loaded: "loaded",
  expected_available: "expected available",
  unavailable: "unavailable",
  maintenance: "in maintenance",
};

const TRAILER_STATUS_TEXT: Record<TrailerOperatingStatus, string> = {
  available: "available",
  attached: "attached to a power unit",
  loaded: "loaded",
  expected_available: "expected available",
  maintenance: "in maintenance",
  out_of_service: "out of service",
};

function recordStatusText(facts: FleetStatusFacts): string {
  return facts.assetKind === "truck"
    ? TRUCK_STATUS_TEXT[facts.recordStatus as TruckOperatingStatus]
    : TRAILER_STATUS_TEXT[facts.recordStatus as TrailerOperatingStatus];
}

function statusInputs(facts: FleetStatusFacts): FleetStatusInput[] {
  const inputs: FleetStatusInput[] = [
    {
      source: facts.assetKind === "truck" ? "truck_record" : "trailer_record",
      value: facts.recordStatus,
      label: `Equipment record says ${recordStatusText(facts)}`,
    },
  ];
  if (facts.hasLiveLease) {
    inputs.push({
      source: "operating_lease",
      value: facts.leaseStatus ?? "active",
      // Whose lease it is stays out of the label when it is not this carrier's.
      label: facts.leaseIsMine
        ? `Your operating lease is ${(facts.leaseStatus ?? "active").replace(/_/g, " ")}`
        : "An operating lease is live on this equipment",
    });
  }
  // `out_of_service` is not an attachment fact: the attachment helper reflects
  // the trailer record's own status back when the equipment is down. Listing it
  // here would make one fact look like two records independently agreeing.
  if (facts.attachmentState && facts.attachmentState !== "out_of_service") {
    inputs.push({
      source: "trailer_attachment",
      value: facts.attachmentState,
      label: `Attachment record says ${facts.attachmentState.replace(/_/g, " ")}`,
    });
  }
  if (facts.expectedAvailableAt) {
    inputs.push({
      source: "availability_record",
      value: facts.expectedAvailableAt,
      label: "Availability record carries an expected-free time",
    });
  }
  return inputs;
}

/**
 * The one reconciliation rule set, for power units and trailers alike.
 *
 * Read top to bottom; the first rule that matches wins, and the rule that won
 * is reported as `decidedBy` so the answer can be traced to a record.
 */
export function deriveOperationalStatus(
  facts: FleetStatusFacts,
  nowMs: number = Date.now(),
): FleetStatusDerivation {
  const inputs = statusInputs(facts);
  const recordSource = facts.assetKind === "truck" ? "truck_record" : "trailer_record";
  const decide = (
    status: FleetOperationalStatus,
    decidedBy: FleetStatusDerivation["decidedBy"],
    reason: string,
  ): FleetStatusDerivation => ({ status, decidedBy, reason, inputs });

  // 1. The shop wins over everything. A truck on a lift is on a lift whatever
  //    paperwork says about it, and no lease makes it drivable.
  if (facts.recordStatus === "maintenance") {
    return decide("maintenance", recordSource, "The equipment record has it in maintenance.");
  }

  // 2. Out of service, the same way. `unavailable` is the power unit's spelling
  //    of it and `out_of_service` the trailer's; they mean the same thing here.
  if (facts.recordStatus === "unavailable" || facts.recordStatus === "out_of_service") {
    return decide("out_of_service", recordSource, "The equipment record has it out of service.");
  }

  // 3. A live operating lease means the equipment is committed to a movement —
  //    whether the movement has started is a different question, answered by
  //    the equipment record rather than by the lease.
  if (facts.hasLiveLease) {
    const loaded = facts.recordStatus === "loaded";
    const moving = facts.attachmentState === "in_active_movement";
    if (loaded || moving) {
      return decide(
        "in_transit", "operating_lease",
        loaded
          ? "An operating lease is live and the equipment record says it is loaded."
          : "An operating lease is live and the attachment record has it in movement.",
      );
    }
    return decide(
      "assigned", "operating_lease",
      facts.leaseStatus === "reserved"
        ? "An operating lease is reserved on this equipment; it is committed but has not started."
        : "An operating lease is live on this equipment.",
    );
  }

  // 4. A trailer hooked to a power unit with no lease is still committed to
  //    that power unit, and taking it for something else means unhooking it.
  if (facts.attachmentState === "in_active_movement") {
    return decide("in_transit", "trailer_attachment", "The attachment record has it in movement.");
  }
  if (
    facts.attachmentState === "attached"
    || facts.attachmentState === "reserved_for_attachment"
    || facts.attachmentState === "pending_detachment"
  ) {
    return decide(
      "assigned", "trailer_attachment",
      facts.attachmentState === "reserved_for_attachment"
        ? "The trailer is reserved for a power unit."
        : "The trailer is on a power unit.",
    );
  }

  // 5. Nothing holds it, but somebody has said when it comes free. That is a
  //    weaker claim than a lease and is reported as such.
  const expectedMs = facts.expectedAvailableAt ? Date.parse(facts.expectedAvailableAt) : NaN;
  if (facts.recordStatus === "expected_available"
    || (Number.isFinite(expectedMs) && expectedMs > nowMs)) {
    return decide(
      "expected_available", "availability_record",
      "Nothing holds the equipment and the availability record says when it comes free.",
    );
  }

  // 6. Free, and nobody has said otherwise.
  return decide("available", recordSource, "Nothing holds the equipment and it is free to use.");
}

/**
 * Whether this organization may actually operate the equipment.
 *
 * Kept apart from the status on purpose. A truck held by another carrier reads
 * `assigned`, which is true — it is assigned to an operation — and separately
 * `availableToOrganization: false`, which is the fact the viewer needs. One
 * field carrying both would have to lie about one of them.
 */
export function deriveAuthorityLock(
  activationState: AssetActivationState,
  status: FleetOperationalStatus,
  operatingCarrierName?: string,
): FleetAuthorityLock {
  const base = { activationState, operatingCarrierName };

  if (activationState === "locked_by_other") {
    return {
      ...base,
      availableToOrganization: false,
      lockedByOtherAuthority: true,
      // Names nobody unless the viewer was already entitled to the name.
      blockedReason: operatingCarrierName
        ? `Held under ${operatingCarrierName}'s active operating authority.`
        : "Held under another carrier's active operating authority.",
    };
  }
  if (activationState === "onboarding" || activationState === "pending_approval") {
    return {
      ...base,
      availableToOrganization: false,
      lockedByOtherAuthority: false,
      blockedReason: "Your relationship with this equipment is not approved yet.",
    };
  }
  if (activationState === "suspended" || activationState === "ended") {
    return {
      ...base,
      availableToOrganization: false,
      lockedByOtherAuthority: false,
      blockedReason: activationState === "suspended"
        ? "Your relationship with this equipment is suspended."
        : "Your relationship with this equipment has ended.",
    };
  }
  if (status === "maintenance" || status === "out_of_service") {
    return {
      ...base,
      availableToOrganization: false,
      lockedByOtherAuthority: false,
      blockedReason: status === "maintenance"
        ? "The equipment is in maintenance."
        : "The equipment is out of service.",
    };
  }
  // Reserved, active or releasing under THIS organization's own lease: it is
  // busy, but it is busy for you, which is not a block.
  return { ...base, availableToOrganization: true, lockedByOtherAuthority: false };
}

/* -------------------------------------------------------------------------- */
/* Telemetry freshness                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The newest reading and how old it is.
 *
 * No reading at all is reported as stale rather than as fresh-and-empty: an
 * asset nobody has ever reported on is exactly the asset a dispatcher needs to
 * be told about, and rendering a blank cell hides it.
 */
export function telemetrySnapshot(
  reading: FleetTelemetryReading | undefined,
  assetKind: FleetAssetKind,
  nowMs: number = Date.now(),
): FleetTelemetrySnapshot {
  const freshnessExpectationHours = freshnessExpectationFor(assetKind);
  if (!reading) return { stale: true, freshnessExpectationHours };
  const observedMs = Date.parse(reading.observedAt);
  if (!Number.isFinite(observedMs)) return { reading, stale: true, freshnessExpectationHours };
  const ageHours = Math.max(0, (nowMs - observedMs) / HOUR_MS);
  return {
    reading,
    ageHours,
    stale: ageHours > freshnessExpectationHours,
    freshnessExpectationHours,
  };
}

/* -------------------------------------------------------------------------- */
/* Readiness                                                                   */
/* -------------------------------------------------------------------------- */

function expiryState(
  expiresAt: string | undefined,
  nowMs: number,
): { state: FleetReadinessState; detail: string } {
  if (!expiresAt) return { state: "unknown", detail: "No expiry date has been recorded." };
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return { state: "unknown", detail: "The recorded expiry date is not readable." };
  const days = Math.floor((ms - nowMs) / DAY_MS);
  if (days < 0) return { state: "expired", detail: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.` };
  if (days <= EXPIRY_WARNING_DAYS) return { state: "expiring_soon", detail: `Expires in ${days} day${days === 1 ? "" : "s"}.` };
  return { state: "ready", detail: `Expires in ${days} days.` };
}

/** The facts a readiness summary is built from. All from permanent records. */
export interface FleetReadinessFacts {
  assetKind: FleetAssetKind;
  /** Off the registration record on the Truck or Trailer. */
  plateNumber?: string;
  plateState?: string;
  plateExpiresAt?: string;
  /** The registration document, when one has been attached. */
  registrationDocument?: { status: string; expiresAt?: string };
  /** Power units only: the cab card, which is what a permit check asks for. */
  permitDocument?: { status: string; expiresAt?: string };
}

const DOC_PRESENT = new Set(["approved", "pending_review", "selected_local", "expiring_soon"]);

function documentReadiness(
  kind: FleetReadinessItem["kind"],
  label: string,
  doc: { status: string; expiresAt?: string } | undefined,
  nowMs: number,
  absentDetail: string,
): FleetReadinessItem {
  if (!doc) {
    return { kind, label, state: "missing", detail: absentDetail, source: "document_record" };
  }
  if (doc.status === "expired") {
    return {
      kind, label, state: "expired", expiresAt: doc.expiresAt,
      detail: "The document on file has expired.", source: "document_record",
    };
  }
  if (doc.status === "rejected") {
    return {
      kind, label, state: "missing", expiresAt: doc.expiresAt,
      detail: "The document on file was rejected and has not been replaced.",
      source: "document_record",
    };
  }
  if (!DOC_PRESENT.has(doc.status)) {
    return {
      kind, label, state: "missing", detail: absentDetail, source: "document_record",
    };
  }
  const { state, detail } = expiryState(doc.expiresAt, nowMs);
  return { kind, label, state, detail, expiresAt: doc.expiresAt, source: "document_record" };
}

/**
 * Registration, plate, permit and IFTA, answered honestly.
 *
 * IFTA is always `not_tracked`. Antcolos holds no fuel purchases, no
 * jurisdiction mileage and no filing history, and there is no state
 * integration; reporting anything else — even "ready" — would be a claim that
 * somebody's quarterly return is in hand when nobody has looked.
 */
export function deriveReadiness(
  facts: FleetReadinessFacts,
  nowMs: number = Date.now(),
): FleetReadinessSummary {
  const items: FleetReadinessItem[] = [];

  items.push(documentReadiness(
    "registration", "Registration", facts.registrationDocument, nowMs,
    "No registration document has been attached to this equipment.",
  ));

  if (facts.plateNumber) {
    const { state, detail } = expiryState(facts.plateExpiresAt, nowMs);
    items.push({
      kind: "plate",
      label: "Plate",
      state,
      detail: `${facts.plateNumber}${facts.plateState ? ` (${facts.plateState})` : ""}. ${detail}`,
      expiresAt: facts.plateExpiresAt,
      source: "registration_record",
    });
  } else {
    items.push({
      kind: "plate", label: "Plate", state: "missing",
      detail: "No plate number is recorded on the registration.",
      source: "registration_record",
    });
  }

  if (facts.assetKind === "truck") {
    items.push(documentReadiness(
      "permit", "Cab card / permit", facts.permitDocument, nowMs,
      "No cab card has been attached. Antcolos cannot confirm an apportioned permit without one.",
    ));
  } else {
    items.push({
      kind: "permit", label: "Permit", state: "not_tracked",
      detail: "Antcolos does not hold permits for trailers.",
      source: "not_connected",
    });
  }

  items.push({
    kind: "ifta", label: "IFTA", state: "not_tracked",
    detail:
      "Not tracked. Antcolos holds no fuel purchases, no jurisdiction mileage and "
      + "no filing history, and no state or fuel-card integration is connected.",
    source: "not_connected",
  });

  return {
    items,
    blocking: items.filter((i) => i.state === "expired" || i.state === "missing").length,
    warning: items.filter((i) => i.state === "expiring_soon").length,
  };
}

/* -------------------------------------------------------------------------- */
/* Utilization                                                                 */
/* -------------------------------------------------------------------------- */

/** A dated interval from a permanent record. Open-ended while it is still live. */
export interface FleetInterval {
  startAt: string;
  endAt?: string;
}

function overlapHours(interval: FleetInterval, fromMs: number, toMs: number): number {
  const start = Date.parse(interval.startAt);
  if (!Number.isFinite(start)) return 0;
  const end = interval.endAt ? Date.parse(interval.endAt) : toMs;
  const lo = Math.max(start, fromMs);
  const hi = Math.min(Number.isFinite(end) ? end : toMs, toMs);
  return hi > lo ? (hi - lo) / HOUR_MS : 0;
}

/** Merges overlapping intervals so an hour is never counted twice. */
function mergedHours(intervals: FleetInterval[], fromMs: number, toMs: number): number {
  const spans = intervals
    .map((i) => {
      const start = Math.max(Date.parse(i.startAt), fromMs);
      const rawEnd = i.endAt ? Date.parse(i.endAt) : toMs;
      const end = Math.min(Number.isFinite(rawEnd) ? rawEnd : toMs, toMs);
      return [start, end] as const;
    })
    .filter(([s, e]) => Number.isFinite(s) && e > s)
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let cursor = -Infinity;
  let openStart = 0;
  for (const [s, e] of spans) {
    if (s > cursor) {
      if (cursor > -Infinity) total += cursor - openStart;
      openStart = s;
      cursor = e;
    } else if (e > cursor) {
      cursor = e;
    }
  }
  if (cursor > -Infinity) total += cursor - openStart;
  return total / HOUR_MS;
}

export interface FleetUtilizationFacts {
  /** Operating-lease intervals. The only dated record of committed time. */
  leaseIntervals: FleetInterval[];
  /**
   * When the current maintenance or out-of-service spell began, when the
   * timeline records it. Absent means we know the asset is down and do NOT
   * know since when — which is reported rather than assumed to be zero.
   */
  downSince?: string;
  /** True when the asset is down right now. */
  currentlyDown: boolean;
  /** The earliest moment we hold records for. Usually the relationship start. */
  recordsBeginAt?: string;
}

/**
 * How the window was spent, from dated records only.
 *
 * `fullyDerived` is the honest part. It is false when the window reaches back
 * before the records begin, or when the asset is down and nothing says since
 * when — and a screen that reports a percentage without saying so is inviting
 * somebody to plan against arithmetic on missing data.
 */
export function deriveUtilization(
  facts: FleetUtilizationFacts,
  windowDays: number = UTILIZATION_WINDOW_DAYS,
  nowMs: number = Date.now(),
): FleetUtilizationSummary {
  const toMs = nowMs;
  const fromMs = toMs - windowDays * DAY_MS;
  const windowHours = windowDays * 24;

  const operatingHours = Math.min(windowHours, mergedHours(facts.leaseIntervals, fromMs, toMs));

  let downtimeHours = 0;
  let downtimeKnown = true;
  if (facts.currentlyDown) {
    if (facts.downSince) {
      downtimeHours = overlapHours({ startAt: facts.downSince }, fromMs, toMs);
    } else {
      downtimeKnown = false;
    }
  }

  const recordsBeginMs = facts.recordsBeginAt ? Date.parse(facts.recordsBeginAt) : fromMs;
  const coveredFromMs = Number.isFinite(recordsBeginMs) ? Math.max(fromMs, recordsBeginMs) : fromMs;
  const coveredHours = Math.max(0, (toMs - coveredFromMs) / HOUR_MS);
  const windowFullyCovered = coveredHours >= windowHours - 1;

  const usableHours = Math.max(0, windowHours - downtimeHours);
  const idleHours = Math.max(0, usableHours - operatingHours);

  const pct = (n: number, d: number) => (d <= 0 ? 0 : Math.round((n / d) * 1000) / 10);

  const basis = [
    `Operating hours are the dated operating-lease intervals overlapping the last ${windowDays} days.`,
    "Work recorded without a lease is not counted, so this is a floor rather than an estimate.",
    downtimeKnown
      ? "Downtime is the current maintenance or out-of-service spell, from the timeline entry that began it."
      : "The equipment is down now, but no timeline entry records when that began, so downtime is not counted.",
    windowFullyCovered
      ? undefined
      : `Records for this equipment begin inside the window, so only ${Math.round(coveredHours)} of ${windowHours} hours are covered.`,
  ].filter(Boolean).join(" ");

  return {
    windowDays,
    windowStartAt: new Date(fromMs).toISOString(),
    windowEndAt: new Date(toMs).toISOString(),
    operatingHours: Math.round(operatingHours * 10) / 10,
    idleHours: Math.round(idleHours * 10) / 10,
    downtimeHours: Math.round(downtimeHours * 10) / 10,
    utilizationPct: pct(operatingHours, usableHours),
    availabilityPct: pct(usableHours, windowHours),
    fullyDerived: downtimeKnown && windowFullyCovered,
    basis,
  };
}

/**
 * One utilization figure for a whole fleet.
 *
 * Hours are summed rather than percentages averaged: averaging percentages
 * would let a truck that was onboarded yesterday count as much as one that ran
 * all month, and the resulting number would describe nothing.
 */
export function aggregateUtilization(
  summaries: FleetUtilizationSummary[],
  windowDays: number = UTILIZATION_WINDOW_DAYS,
  nowMs: number = Date.now(),
): FleetUtilizationSummary {
  const toMs = nowMs;
  const fromMs = toMs - windowDays * DAY_MS;
  const empty = summaries.length === 0;

  const operatingHours = summaries.reduce((n, s) => n + s.operatingHours, 0);
  const idleHours = summaries.reduce((n, s) => n + s.idleHours, 0);
  const downtimeHours = summaries.reduce((n, s) => n + s.downtimeHours, 0);
  const windowHours = summaries.length * windowDays * 24;
  const usableHours = Math.max(0, windowHours - downtimeHours);
  const pct = (n: number, d: number) => (d <= 0 ? 0 : Math.round((n / d) * 1000) / 10);

  return {
    windowDays,
    windowStartAt: new Date(fromMs).toISOString(),
    windowEndAt: new Date(toMs).toISOString(),
    operatingHours: Math.round(operatingHours * 10) / 10,
    idleHours: Math.round(idleHours * 10) / 10,
    downtimeHours: Math.round(downtimeHours * 10) / 10,
    utilizationPct: pct(operatingHours, usableHours),
    availabilityPct: pct(usableHours, windowHours),
    fullyDerived: !empty && summaries.every((s) => s.fullyDerived),
    basis: empty
      ? "No equipment to report on."
      : `Summed across ${summaries.length} asset${summaries.length === 1 ? "" : "s"} over ${windowDays} days, from dated operating-lease intervals. `
        + "Work recorded without a lease is not counted, so this is a floor rather than an estimate.",
  };
}

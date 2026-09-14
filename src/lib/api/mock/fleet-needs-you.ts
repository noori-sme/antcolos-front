import type {
  FleetAssignmentTriad, FleetEquipmentRow, NeedsYouEntityRef, NeedsYouItem,
  NeedsYouSeverity, PermissionKey,
} from "@/types";

/**
 * ███ DERIVED — NOT A SEPARATE QUEUE ███
 *
 * Operational exceptions, computed from the equipment rows the fleet layer
 * already assembled.
 *
 * Every item below is a real inconsistency between records somebody can go and
 * fix, not a reminder invented to fill a list. That matters more than it
 * sounds: a Needs You queue padded with items nobody can act on is a queue
 * people stop reading, and the genuinely urgent item then sits in it unread.
 *
 * The ids are stable and derived from the asset and the rule, so the same
 * exception on the same asset is the same item across a reload — it keeps its
 * assignee, its snooze and its history instead of reappearing as a new row
 * every time somebody opens the page.
 *
 * Nothing here is dressed up as coming from an ELD or a tracker: the source is
 * `system`, because a rule in this file is what produced it.
 */

const HOUR_MS = 3_600_000;

/** The four rules this layer knows how to spot. */
type FleetRule =
  | "stale_location"
  | "invalid_assignment"
  | "equipment_unavailable"
  | "operational_blocker";

function entityFor(row: FleetEquipmentRow): NeedsYouEntityRef {
  return row.assetKind === "truck"
    ? { kind: "truck", id: row.assetId, label: `Unit ${row.unit}`, href: `/fleet/trucks/${row.assetId}` }
    : { kind: "trailer", id: row.assetId, label: `Trailer ${row.unit}`, href: `/fleet/trailers/${row.assetId}` };
}

function fleetLink(row: FleetEquipmentRow): string {
  return `/fleet/equipment/${row.assetKind}/${row.assetId}`;
}

interface ItemInput {
  rule: FleetRule;
  row: FleetEquipmentRow;
  organizationId: string;
  severity: NeedsYouSeverity;
  title: string;
  reason: string;
  detail?: string;
  action: { kind: NeedsYouItem["recommendedAction"]["kind"]; label: string; requires: PermissionKey[] };
  requires: PermissionKey[];
  dueAt?: string;
  createdAt: string;
  related?: NeedsYouEntityRef[];
}

function item(input: ItemInput): NeedsYouItem {
  return {
    // Stable across reloads: same organization + same asset + same rule = same
    // item. The organization is part of the id because equipment is shared —
    // a carrier and the dispatch organizations it grants access to all see the
    // same asset, and without it they would mint one id between them.
    id: `ny_fleet_${input.organizationId}_${input.rule}_${input.row.assetKind}_${input.row.assetId}`,
    organizationId: input.organizationId,
    category: input.rule,
    severity: input.severity,
    status: "open",
    title: input.title,
    reason: input.reason,
    detail: input.detail,
    entity: entityFor(input.row),
    relatedEntities: [
      { kind: input.row.assetKind, id: input.row.assetId, label: "Operational view", href: fleetLink(input.row) },
      ...(input.related ?? []),
    ],
    recommendedAction: {
      kind: input.action.kind,
      label: input.action.label,
      requires: input.action.requires,
    },
    dueAt: input.dueAt,
    // A rule in this file spotted it. Not a device, not a person, not a feed.
    source: "system",
    requires: input.requires,
    createdAt: input.createdAt,
    history: [],
  };
}

function assetPermission(row: FleetEquipmentRow): PermissionKey {
  return row.assetKind === "truck" ? "trucks:view" : "trailers:view";
}

function hours(n: number): string {
  return new Date(Date.now() + n * HOUR_MS).toISOString();
}

/* -------------------------------------------------------------------------- */
/* The rules                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Nobody has said where this equipment is for longer than is reasonable.
 *
 * Raised only for equipment that is committed to something — assigned, in
 * transit, or carrying a driver. A spare trailer sitting in the yard with no
 * reading is not an exception, it is a spare trailer, and raising it would
 * teach people to ignore the category.
 */
function staleLocationItems(rows: FleetEquipmentRow[], organizationId: string): NeedsYouItem[] {
  return rows.flatMap((row) => {
    const committed = row.derivation.status === "assigned"
      || row.derivation.status === "in_transit"
      || Boolean(row.driver);
    if (!committed || !row.telemetry.stale) return [];
    // Another carrier's equipment is not yours to chase for a location.
    if (row.authority.lockedByOtherAuthority) return [];

    const never = !row.telemetry.reading;
    const age = row.telemetry.ageHours ?? 0;
    const expectation = row.telemetry.freshnessExpectationHours;

    return [item({
      rule: "stale_location",
      row,
      organizationId,
      severity: never || age > expectation * 4 ? "high" : "medium",
      title: never
        ? `No location has ever been recorded for ${row.unit}`
        : `${row.unit} has not been located in ${Math.round(age)} hours`,
      reason: never
        ? "This equipment is committed to an operation and nobody has ever recorded where it is."
        : `The newest reading is ${Math.round(age)} hours old; anything past ${expectation} hours is not worth planning against.`,
      detail: row.telemetry.reading
        ? `Last reading: ${[row.telemetry.reading.location?.city, row.telemetry.reading.location?.state].filter(Boolean).join(", ") || "no place recorded"}`
          + `, recorded by ${row.telemetry.reading.recordedByName ?? "the seeded mock adapter"}.`
          + " No GPS, ELD or telematics feed is connected, so the only way this updates is somebody recording it."
        : "No GPS, ELD or telematics feed is connected. Location is only ever as fresh as the last person to record it.",
      action: {
        kind: "record_location",
        label: "Record a location",
        requires: ["fleet:telemetry:record"],
      },
      requires: ["fleet:view", assetPermission(row)],
      dueAt: hours(never ? 4 : 12),
      createdAt: row.telemetry.reading?.observedAt ?? new Date(Date.now() - HOUR_MS).toISOString(),
    })];
  });
}

/**
 * Two records that cannot both be right.
 *
 * These are the ones worth interrupting somebody for, because they mean a
 * screen somewhere is showing a plan that will not happen:
 *
 *   a truck committed to an operation with nobody on it
 *   a driver on a truck the organization is no longer approved to run
 *   a trailer hooked to a power unit that is in the shop or out of service
 */
function invalidAssignmentItems(
  rows: FleetEquipmentRow[],
  triads: FleetAssignmentTriad[],
  organizationId: string,
): NeedsYouItem[] {
  const byTruckId = new Map(rows.filter((r) => r.assetKind === "truck").map((r) => [r.assetId, r]));
  const items: NeedsYouItem[] = [];

  for (const row of rows) {
    if (row.assetKind !== "truck") continue;

    // Committed, and nobody is going to drive it.
    const committed = row.derivation.status === "assigned" || row.derivation.status === "in_transit";
    if (committed && !row.driver && !row.authority.lockedByOtherAuthority) {
      items.push(item({
        rule: "invalid_assignment",
        row,
        organizationId,
        severity: "critical",
        title: `Unit ${row.unit} is committed with no driver assigned`,
        reason:
          "An operating lease is live on this truck but no driver assignment is open for it. "
          + "Somebody is expecting this load to move and nobody is going to move it.",
        detail: row.derivation.reason,
        action: {
          kind: "fix_assignment",
          label: "Assign a driver",
          requires: ["trucks:assignments:manage"],
        },
        requires: ["fleet:view", "trucks:view"],
        dueAt: hours(2),
        createdAt: new Date(Date.now() - HOUR_MS).toISOString(),
      }));
    }

    // A driver on a truck this organization may no longer operate.
    if (row.driver && !row.authority.availableToOrganization && !row.authority.lockedByOtherAuthority
      && row.derivation.status !== "maintenance" && row.derivation.status !== "out_of_service") {
      items.push(item({
        rule: "invalid_assignment",
        row,
        organizationId,
        severity: "high",
        title: `${row.driver.driverName} is assigned to a truck you cannot operate`,
        reason: row.authority.blockedReason
          ?? "The carrier relationship behind this assignment is no longer in force.",
        detail:
          "The assignment is still open. Ending it leaves the history intact — the dated record "
          + "of who was on this truck and when is never removed.",
        action: {
          kind: "fix_assignment",
          label: "End the assignment",
          requires: ["trucks:assignments:manage"],
        },
        requires: ["fleet:view", "trucks:view"],
        related: [{
          kind: "driver", id: row.driver.driverProfileId, label: row.driver.driverName,
          href: row.links.driver?.href,
        }],
        dueAt: hours(8),
        createdAt: row.driver.since,
      }));
    }
  }

  // A trailer hooked to a power unit that cannot pull it today.
  for (const triad of triads) {
    if (!triad.trailer?.trailerId) continue;
    const truck = byTruckId.get(triad.truckId);
    const trailerRow = rows.find((r) => r.assetKind === "trailer" && r.assetId === triad.trailer?.trailerId);
    if (!truck || !trailerRow) continue;
    if (truck.derivation.status !== "maintenance" && truck.derivation.status !== "out_of_service") continue;

    items.push(item({
      rule: "invalid_assignment",
      row: trailerRow,
      organizationId,
      severity: "high",
      title: `Trailer ${trailerRow.unit} is on a power unit that is ${truck.derivation.status === "maintenance" ? "in maintenance" : "out of service"}`,
      reason:
        `The attachment record has this trailer on unit ${truck.unit}, and the truck record has that `
        + "power unit unusable. The trailer is not going anywhere until one of the two changes.",
      detail: truck.derivation.reason,
      action: {
        kind: "fix_assignment",
        label: "Move the trailer to another power unit",
        requires: ["trailers:attachments:manage"],
      },
      requires: ["fleet:view", "trailers:view", "trucks:view"],
      related: [{
        kind: "truck", id: truck.assetId, label: `Unit ${truck.unit}`,
        href: `/fleet/trucks/${truck.assetId}`,
      }],
      dueAt: hours(12),
      createdAt: triad.trailer.effectiveFrom,
    }));
  }

  return items;
}

/**
 * Equipment that is committed but cannot be used.
 *
 * A lease running on a truck in the shop is a load somebody is planning around
 * that is not going to happen, and the sooner the person who booked it knows,
 * the cheaper it is.
 */
function unavailableEquipmentItems(rows: FleetEquipmentRow[], organizationId: string): NeedsYouItem[] {
  return rows.flatMap((row) => {
    const down = row.derivation.status === "maintenance" || row.derivation.status === "out_of_service";
    if (!down) return [];
    // Only when this organization has actually committed the asset to something.
    const committed = row.authority.activationState === "active_operating_lease"
      || row.authority.activationState === "activation_reserved"
      || row.authority.activationState === "pending_release"
      || Boolean(row.driver);
    if (!committed) return [];

    return [item({
      rule: "equipment_unavailable",
      row,
      organizationId,
      severity: row.derivation.status === "out_of_service" ? "critical" : "high",
      title: `${row.assetKind === "truck" ? `Unit ${row.unit}` : `Trailer ${row.unit}`} is committed but unusable`,
      reason: `${row.derivation.reason} Your organization still has it committed to an operation.`,
      detail: row.myLoadReference
        ? `Your reference on it: ${row.myLoadReference}. Release it or move the work to other equipment.`
        : "Release the commitment or move the work to other equipment.",
      action: {
        kind: "review_equipment",
        label: "Review the equipment",
        requires: [row.assetKind === "truck" ? "trucks:view" : "trailers:view"],
      },
      requires: ["fleet:view", assetPermission(row)],
      dueAt: hours(4),
      createdAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
    })];
  });
}

/**
 * Paperwork that stops the equipment at a scale house.
 *
 * Only expired and missing registration, plate and permit records count.
 * Expiring-soon is a compliance reminder and belongs to the compliance module;
 * duplicating it here would put the same warning in two queues.
 *
 * IFTA never raises an item. Antcolos does not track it and does not know
 * whether a return was filed, and an item implying otherwise would be a claim
 * about somebody's tax position that nobody checked.
 */
function operationalBlockerItems(rows: FleetEquipmentRow[], organizationId: string): NeedsYouItem[] {
  return rows.flatMap((row) => {
    const blocking = row.readiness.items.filter(
      (i) => i.state === "expired" || i.state === "missing",
    );
    if (!blocking.length) return [];
    if (row.authority.lockedByOtherAuthority) return [];

    const worst = blocking.find((i) => i.state === "expired") ?? blocking[0];
    const inUse = row.derivation.status !== "out_of_service" && row.derivation.status !== "maintenance";

    return [item({
      rule: "operational_blocker",
      row,
      organizationId,
      severity: worst.state === "expired" && inUse ? "critical" : "high",
      title: `${row.assetKind === "truck" ? `Unit ${row.unit}` : `Trailer ${row.unit}`}: ${worst.label.toLowerCase()} ${worst.state === "expired" ? "has expired" : "is missing"}`,
      reason: blocking.map((i) => `${i.label}: ${i.detail}`).join(" "),
      detail:
        "Antcolos holds what somebody typed in and what somebody attached. It has not "
        + "checked any of it with a state — no registration lookup is connected.",
      action: {
        kind: "request_document",
        label: "Sort out the paperwork",
        requires: [row.assetKind === "truck" ? "trucks:documents:manage" : "trailers:documents:manage"],
      },
      requires: ["fleet:view", assetPermission(row)],
      dueAt: hours(worst.state === "expired" ? 6 : 48),
      createdAt: worst.expiresAt ?? new Date(Date.now() - 3 * HOUR_MS).toISOString(),
    })];
  });
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every operational exception this layer can see, most urgent first.
 *
 * The rows handed in have already been through the registries' access rules, so
 * nothing can be raised about equipment the caller may not see — an item is
 * itself a disclosure, and one naming another carrier's truck would leak the
 * truck.
 */
export function fleetNeedsYouItems(
  rows: FleetEquipmentRow[],
  triads: FleetAssignmentTriad[],
  organizationId: string,
): NeedsYouItem[] {
  return [
    ...invalidAssignmentItems(rows, triads, organizationId),
    ...unavailableEquipmentItems(rows, organizationId),
    ...operationalBlockerItems(rows, organizationId),
    ...staleLocationItems(rows, organizationId),
  ];
}

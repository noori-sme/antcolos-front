import type {
  EldConnection, EldDeviceView, EquipmentTelemetrySnapshot, NeedsYouCategory,
  NeedsYouEntityRef, NeedsYouItem, NeedsYouSeverity, PermissionKey,
} from "@/types";

/**
 * ███ DERIVED — NOT A SECOND QUEUE ███
 *
 * The five things this module can spot that somebody actually has to go and do
 * something about. Nothing here is a reminder invented to fill a list, and that
 * restraint is the point: a Needs You queue padded with rows nobody can action
 * is a queue people stop reading, and the genuinely urgent row then sits in it
 * unread.
 *
 *   telemetry_stale                a bound device has stopped saying where it is
 *   telemetry_binding_broken       a binding points somewhere that no longer holds
 *   telemetry_device_disconnected  a link went down with equipment still on it
 *   telemetry_odometer_conflict    two honest sources disagree about one truck
 *   telematics_diagnostic          equipment is reporting a critical fault
 *
 * Ids are stable and derived from the organization, the rule and the subject,
 * so the same exception is the same item across a reload — it keeps its
 * assignee, its snooze and its history instead of reappearing as a new row
 * every time somebody opens the page. The organization is part of the id
 * because equipment is shared, and without it two workspaces looking at one
 * truck would mint a single item between them.
 *
 * `source` is `"system"`, never `"eld"`. A rule in this file spotted it. The
 * device did not raise it, and saying otherwise would be the same category
 * error the rest of this module exists to avoid.
 */

const HOUR_MS = 3_600_000;

type EldRule =
  | "telemetry_stale"
  | "telemetry_binding_broken"
  | "telemetry_device_disconnected"
  | "telemetry_odometer_conflict"
  | "telematics_diagnostic";

interface ItemInput {
  rule: EldRule;
  category: NeedsYouCategory;
  organizationId: string;
  subjectId: string;
  severity: NeedsYouSeverity;
  title: string;
  reason: string;
  detail?: string;
  entity: NeedsYouEntityRef;
  related?: NeedsYouEntityRef[];
  action: NeedsYouItem["recommendedAction"];
  requires: PermissionKey[];
  createdAt: string;
  dueAt?: string;
}

function item(input: ItemInput): NeedsYouItem {
  return {
    id: `ny_eld_${input.organizationId}_${input.rule}_${input.subjectId}`,
    organizationId: input.organizationId,
    category: input.category,
    severity: input.severity,
    status: "open",
    title: input.title,
    reason: input.reason,
    detail: input.detail,
    entity: input.entity,
    relatedEntities: input.related,
    recommendedAction: input.action,
    dueAt: input.dueAt,
    source: "system",
    requires: input.requires,
    createdAt: input.createdAt,
    history: [],
  };
}

const truckEntity = (truckId: string, unit: string): NeedsYouEntityRef => ({
  kind: "truck", id: truckId, label: `Unit ${unit}`, href: `/fleet/trucks/${truckId}`,
});

const deviceEntity = (deviceId: string, serial: string): NeedsYouEntityRef => ({
  kind: "eld_device", id: deviceId, label: serial, href: `/eld/devices/${deviceId}`,
});

/** Two independent readings of one truck's odometer, and how far apart they are. */
export interface OdometerConflict {
  truckId: string;
  truckUnit: string;
  readings: {
    deviceId: string;
    deviceSerial: string;
    providerName: string;
    miles: number;
    sourceAt: string;
  }[];
  differenceMiles: number;
}

export interface EldNeedsYouInput {
  organizationId: string;
  devices: readonly EldDeviceView[];
  connections: readonly EldConnection[];
  snapshots: readonly EquipmentTelemetrySnapshot[];
  odometerConflicts: readonly OdometerConflict[];
  /** Truck ids the caller may currently see. A binding outside it is broken. */
  visibleTruckIds: ReadonlySet<string>;
  nowMs?: number;
}

export function eldNeedsYouItems(input: EldNeedsYouInput): NeedsYouItem[] {
  const now = input.nowMs ?? Date.now();
  const createdAt = new Date(now).toISOString();
  const items: NeedsYouItem[] = [];
  const org = input.organizationId;
  const connectionById = new Map(input.connections.map((c) => [c.id, c]));

  /* ---- 1. Stale telemetry --------------------------------------------- */
  for (const snapshot of input.snapshots) {
    // A truck nobody has ever reported on is not "stale" — there is nothing to
    // be stale. That is a device problem, and it is raised below as one.
    if (snapshot.location.quality === "missing" || !snapshot.location.stale) continue;
    if (!snapshot.deviceId) continue;
    // A link somebody took down, or one that errored, already has its own row
    // below. Raising staleness on top of it would tell the same person the same
    // thing twice and bury the reason under the symptom.
    if (snapshot.connectionState === "disconnected" || snapshot.connectionState === "error"
      || snapshot.connectionState === "offline") continue;
    const ageHours = snapshot.location.ageHours ?? 0;
    items.push(item({
      rule: "telemetry_stale",
      category: "telemetry_stale",
      organizationId: org,
      subjectId: snapshot.truckId,
      severity: ageHours >= 48 ? "high" : "medium",
      title: `Unit ${snapshot.truckUnit} has stopped reporting`,
      reason:
        `The device on this truck last reported a position ${Math.round(ageHours)} hours ago, `
        + "which is past what its connection expects.",
      detail:
        "The link is not down and nobody disconnected it — the data simply stopped. "
        + "Usually the unit lost power or the device came loose.",
      entity: truckEntity(snapshot.truckId, snapshot.truckUnit),
      related: [deviceEntity(snapshot.deviceId, snapshot.deviceSerial ?? snapshot.deviceId)],
      action: {
        kind: "check_device",
        label: "Look at the device",
        requires: ["eld:view"],
      },
      requires: ["eld:view"],
      createdAt,
    }));
  }

  /* ---- 2. Broken bindings ---------------------------------------------- */
  for (const view of input.devices) {
    const binding = view.vehicleBinding;

    // A device that is reporting and is bound to nothing. Its events are real
    // and they are about no piece of equipment Antcolos knows.
    if (!binding && view.eventsLast24h > 0) {
      items.push(item({
        rule: "telemetry_binding_broken",
        category: "telemetry_binding_broken",
        organizationId: org,
        subjectId: view.device.id,
        severity: "high",
        title: `${view.device.serialNumber} is reporting and is bound to nothing`,
        reason:
          `${view.eventsLast24h} signals arrived from this device in the last 24 hours and `
          + "none of them can be attributed to a truck.",
        detail:
          "The signals are kept and flagged rather than discarded, but nothing derived from "
          + "them will appear anywhere until the device is bound to the equipment it is on.",
        entity: deviceEntity(view.device.id, view.device.serialNumber),
        action: {
          kind: "fix_binding",
          label: "Bind it to a truck",
          requires: ["eld:bindings:manage"],
        },
        requires: ["eld:view"],
        createdAt,
      }));
      continue;
    }

    if (!binding) continue;

    // A binding that points at a truck this organization can no longer see.
    // The relationship ended, the lease moved, the truck was released — and the
    // binding stayed behind.
    if (!input.visibleTruckIds.has(binding.truckId)) {
      items.push(item({
        rule: "telemetry_binding_broken",
        category: "telemetry_binding_broken",
        organizationId: org,
        subjectId: binding.id,
        severity: "high",
        title: `${view.device.serialNumber} is bound to equipment you no longer operate`,
        reason:
          `This device is still bound to unit ${binding.truckUnitSnapshot}, which is no longer `
          + "in this organization's fleet.",
        detail:
          "Ending the binding closes the interval and changes nothing about the events already "
          + "attributed to it. Nothing historical is rewritten.",
        entity: deviceEntity(view.device.id, view.device.serialNumber),
        action: {
          kind: "fix_binding",
          label: "End the binding",
          requires: ["eld:bindings:manage"],
        },
        requires: ["eld:view"],
        createdAt,
      }));
    }
  }

  /* ---- 3. Disconnected and errored links still carrying equipment ------ */
  for (const view of input.devices) {
    const connection = connectionById.get(view.device.connectionId);
    if (!connection) continue;
    const state = view.connectionState;
    if (state !== "disconnected" && state !== "error" && state !== "offline") continue;
    // A device nobody bound to anything on a dead link is not an exception —
    // it is a device in a drawer, which is where a spare belongs.
    if (!view.vehicleBinding) continue;

    items.push(item({
      rule: "telemetry_device_disconnected",
      category: "telemetry_device_disconnected",
      organizationId: org,
      subjectId: view.device.id,
      severity: state === "error" ? "high" : "medium",
      title: state === "disconnected"
        ? `Unit ${view.truckUnit} is on a link somebody took down`
        : `${view.device.serialNumber} is not reporting`,
      reason: state === "disconnected"
        ? `"${connection.label}" was disconnected deliberately, and unit ${view.truckUnit} `
          + "is still bound to a device on it."
        : `"${connection.label}" is ${state}. Nothing is arriving from the equipment on it.`,
      detail: connection.disconnectedReason ?? connection.stateReason
        ?? "No reason was recorded for the link's state.",
      entity: deviceEntity(view.device.id, view.device.serialNumber),
      related: view.vehicleBinding
        ? [truckEntity(view.vehicleBinding.truckId, view.vehicleBinding.truckUnitSnapshot)]
        : undefined,
      action: {
        kind: "check_device",
        label: "Review the connection",
        requires: ["eld:devices:manage"],
      },
      requires: ["eld:view"],
      createdAt,
    }));
  }

  /* ---- 4. Odometers that disagree -------------------------------------- */
  for (const conflict of input.odometerConflicts) {
    items.push(item({
      rule: "telemetry_odometer_conflict",
      category: "telemetry_odometer_conflict",
      organizationId: org,
      subjectId: conflict.truckId,
      severity: "medium",
      title: `Two sources disagree about unit ${conflict.truckUnit}'s odometer`,
      reason:
        `${conflict.readings.map((r) => `${r.providerName} reads ${Math.round(r.miles).toLocaleString()} mi`)
          .join(", ")} — ${Math.round(conflict.differenceMiles).toLocaleString()} miles apart.`,
      detail:
        "Both readings are kept. Antcolos does not pick a winner: mileage-based service and "
        + "jurisdiction mileage are decided by Maintenance and by Fuel/IFTA from their own "
        + "records, and a guess made here would quietly become a number somebody files.",
      entity: truckEntity(conflict.truckId, conflict.truckUnit),
      related: conflict.readings.map((r) => deviceEntity(r.deviceId, r.deviceSerial)),
      action: {
        kind: "reconcile_odometer",
        label: "Reconcile the readings",
        requires: ["eld:view"],
      },
      requires: ["eld:view"],
      createdAt,
    }));
  }

  /* ---- 5. Critical diagnostics ----------------------------------------- */
  for (const snapshot of input.snapshots) {
    for (const diagnostic of snapshot.diagnostics) {
      if (diagnostic.severity !== "critical" || !diagnostic.active) continue;
      items.push(item({
        rule: "telematics_diagnostic",
        category: "telematics_diagnostic",
        organizationId: org,
        subjectId: `${snapshot.truckId}_${diagnostic.code}`,
        severity: "critical",
        title: `Unit ${snapshot.truckUnit} is reporting ${diagnostic.code}`,
        reason: diagnostic.description
          ? `The provider reports "${diagnostic.description}" and marked it critical.`
          : "The provider marked this fault critical and sent no description.",
        detail:
          "Antcolos carries fault codes and does not interpret them. Whether this needs a "
          + "service, a repair order or nothing at all is a Maintenance decision, and the "
          + "signal has been queued for that module rather than acted on here.",
        entity: truckEntity(snapshot.truckId, snapshot.truckUnit),
        related: snapshot.deviceId
          ? [deviceEntity(snapshot.deviceId, snapshot.deviceSerial ?? snapshot.deviceId)]
          : undefined,
        action: {
          kind: "review_diagnostic",
          label: "Review the fault",
          requires: ["eld:diagnostics:view"],
        },
        requires: ["eld:view", "eld:diagnostics:view"],
        createdAt,
        dueAt: new Date(now + 24 * HOUR_MS).toISOString(),
      }));
    }
  }

  return items;
}

/** True for an id this module minted. Used by the queue to route writes back. */
export function isEldNeedsYouId(id: string): boolean {
  return id.startsWith("ny_eld_");
}

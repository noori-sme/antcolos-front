import type {
  IsoDateTime, LocationSignal, LocationSignalTransport, TrackingSignalSourceDescriptor,
} from "@/types";

/**
 * The location-signal boundary.
 *
 * Antcolos already has an ELD & Telematics boundary — `FLEET_INTEGRATIONS` and
 * its adapters in `@/lib/fleet/integrations`, with readings stored by the
 * fleet telemetry layer. This module does NOT replace it and does not start a
 * second store of positions. What it adds is the shape of the *other* ways a
 * position can arrive — a phone, a Telegram message, a partner API, an email,
 * an SMS — normalized into the one `LocationSignal` everything downstream
 * reads.
 *
 * Every descriptor below reports `not_connected`, and the only adapter that
 * exists is the mock one. That is the honest position: no ELD, no GPS tracker,
 * no telematics provider, no Telegram bot, no mail parser and no SMS gateway
 * is wired to this build. A screen reading this list can say so precisely,
 * field by field, instead of implying a feed because a row moved.
 */

export const TRACKING_SIGNAL_SOURCES: readonly TrackingSignalSourceDescriptor[] = [
  {
    transport: "fleet_telemetry",
    label: "Fleet telemetry readings",
    description:
      "Location readings already held by the fleet layer — what a dispatcher or a driver "
      + "called in, plus anything a future ELD or GPS integration writes there. This is the "
      + "only source with data in it today, and every row of it is mock or hand-entered.",
    status: "not_connected",
    wouldPopulate: ["Current location", "Last update", "Signal source"],
    ownedBy: "Fleet Management (already merged)",
  },
  {
    transport: "eld",
    label: "Electronic logging device",
    description:
      "Position and engine state straight from the device in the cab, at the cadence the "
      + "provider pushes rather than when somebody remembers to ring in.",
    status: "not_connected",
    wouldPopulate: ["Current location", "Movement", "Route progress", "Geofence crossings"],
    ownedBy: "ELD & Telematics boundary",
  },
  {
    transport: "mobile_gps",
    label: "Driver phone GPS",
    description:
      "The driver app reporting its own position while a trip is running. Consent-based and "
      + "scoped to the trip — it stops when the trip does.",
    status: "not_connected",
    wouldPopulate: ["Current location", "Movement", "ETA"],
    ownedBy: "Driver Trip Workflow",
  },
  {
    transport: "telegram_location",
    label: "Telegram location sharing",
    description:
      "A location a driver shares in the Telegram chat, treated as a driver report rather "
      + "than a device reading — because that is what it is.",
    status: "not_connected",
    wouldPopulate: ["Current location", "Last update"],
    ownedBy: "Notifications / Telegram",
  },
  {
    transport: "api",
    label: "Partner tracking API",
    description:
      "A carrier's or broker's own system pushing positions in. Normalized on arrival so it "
      + "reads exactly like every other source, with its provenance intact.",
    status: "not_connected",
    wouldPopulate: ["Current location", "ETA", "Arrival signals"],
    ownedBy: "Integrations",
  },
  {
    transport: "email",
    label: "Check-call email",
    description:
      "A position parsed out of an inbound check-call email. Extraction is a guess, so "
      + "anything from here would arrive with a confidence and stay inferred.",
    status: "not_connected",
    wouldPopulate: ["Current location", "Last update"],
    ownedBy: "Email / OCR",
  },
  {
    transport: "sms",
    label: "Check-call SMS",
    description:
      "The same, from a text message. Same caveat: parsed, not measured.",
    status: "not_connected",
    wouldPopulate: ["Current location", "Last update"],
    ownedBy: "SMS gateway",
  },
] as const;

const BY_TRANSPORT = new Map(TRACKING_SIGNAL_SOURCES.map((d) => [d.transport, d]));

export function signalSourceDescriptor(
  transport: LocationSignalTransport,
): TrackingSignalSourceDescriptor | undefined {
  return BY_TRANSPORT.get(transport);
}

/** True for every transport today. A function, so callers read honestly. */
export function transportIsConnected(transport: LocationSignalTransport): boolean {
  return signalSourceDescriptor(transport)?.status === "connected";
}

/* -------------------------------------------------------------------------- */
/* The adapter contract                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What every location-signal adapter implements.
 *
 * Narrow by design. An adapter reports positions; it has no method that could
 * assert a milestone, a driver action or an availability state, because those
 * are conclusions and conclusions are drawn on this side of the boundary,
 * where they can be recorded as inferences.
 */
export interface LocationSignalAdapter {
  readonly transport: LocationSignalTransport;
  describe(): TrackingSignalSourceDescriptor;
  /**
   * Positions for one truck, oldest first. `sinceAt` is a lower bound on
   * `observedAt`, not on arrival time, so a batch of old positions arriving
   * late is not silently skipped.
   */
  positionsFor(input: {
    organizationId: string;
    truckId: string;
    loadId?: string;
    sinceAt?: IsoDateTime;
  }): Promise<LocationSignal[]>;
}

export class LocationSourceNotConnectedError extends Error {
  constructor(readonly transport: LocationSignalTransport) {
    super(
      `No ${transport} location source is connected. Antcolos will not invent a position, `
      + "and a page that showed one would be lying about where a truck is.",
    );
    this.name = "LocationSourceNotConnectedError";
  }
}

/**
 * A registered-but-absent adapter, one per planned transport.
 *
 * Real objects rather than `null` so that call sites can be written and
 * reviewed now, and so the failure a screen hits is the honest sentence above
 * rather than a crash on an undefined property.
 */
export function unconnectedAdapter(transport: LocationSignalTransport): LocationSignalAdapter {
  return {
    transport,
    describe: () => signalSourceDescriptor(transport)!,
    positionsFor: () => Promise.reject(new LocationSourceNotConnectedError(transport)),
  };
}

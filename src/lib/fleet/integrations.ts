import type {
  FleetIntegrationDescriptor, FleetIntegrationKind, FleetLocationReading,
  FleetTelemetryReading,
} from "@/types";

/**
 * Typed extension points for the outside systems a fleet eventually connects.
 *
 * Nothing here is connected, and nothing here returns data. Every adapter
 * method throws `FleetIntegrationNotConnectedError`, which is the whole point:
 * a seam that returned a plausible fixture would put invented engine hours and
 * invented fuel spend in front of somebody making a dispatch decision, and they
 * would have no way to tell. Throwing is the honest failure.
 *
 * What this file DOES provide is the shape. When a real ELD is wired up, it
 * implements `EldAdapter`, registers itself, and the fleet layer consumes it
 * without a single type changing — because the reading it produces is already
 * the reading the layer reads, complete with `source`, `observedAt` and the
 * provider's name.
 */

export class FleetIntegrationNotConnectedError extends Error {
  constructor(readonly kind: FleetIntegrationKind, readonly method: string) {
    super(
      `No ${kind} integration is connected. ${method} cannot be answered, and ` +
      `Antcolos will not guess at a value it has not been told.`,
    );
    this.name = "FleetIntegrationNotConnectedError";
  }
}

/** What every adapter can be asked about itself, connected or not. */
export interface FleetIntegrationAdapter {
  readonly kind: FleetIntegrationKind;
  describe(): FleetIntegrationDescriptor;
}

/* -------------------------------------------------------------------------- */
/* Electronic logging                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hours of service and engine data from an ELD.
 *
 * Deliberately NOT modelled as a driver status field on the driver record: an
 * ELD reports what the device observed, and turning that into "this driver is
 * available" is an operational judgement that belongs to dispatch, not to the
 * device.
 */
export interface EldDutyStatusReading {
  driverProfileId: string;
  truckId?: string;
  dutyStatus: "off_duty" | "sleeper" | "driving" | "on_duty_not_driving";
  drivingSecondsRemaining?: number;
  onDutySecondsRemaining?: number;
  cycleSecondsRemaining?: number;
  observedAt: string;
  providerLabel: string;
}

export interface EldAdapter extends FleetIntegrationAdapter {
  readonly kind: "eld";
  dutyStatus(driverProfileId: string): Promise<EldDutyStatusReading>;
  engineReading(truckId: string): Promise<FleetTelemetryReading>;
}

/* -------------------------------------------------------------------------- */
/* Position                                                                    */
/* -------------------------------------------------------------------------- */

export interface GpsAdapter extends FleetIntegrationAdapter {
  readonly kind: "gps";
  currentPosition(assetId: string): Promise<FleetLocationReading & { observedAt: string }>;
}

/**
 * Vehicle telematics: odometer, engine hours, faults.
 *
 * Fault codes are typed but not interpreted. Translating a J1939 SPN into "this
 * truck needs a service" is a maintenance decision, and this layer does not
 * make maintenance decisions.
 */
export interface TelematicsFaultCode {
  code: string;
  description?: string;
  severity?: "info" | "warning" | "critical";
  observedAt: string;
}

export interface TelematicsAdapter extends FleetIntegrationAdapter {
  readonly kind: "telematics";
  odometerAndHours(truckId: string): Promise<FleetTelemetryReading>;
  faultCodes(truckId: string): Promise<TelematicsFaultCode[]>;
}

/* -------------------------------------------------------------------------- */
/* Spend                                                                       */
/* -------------------------------------------------------------------------- */

export interface FuelPurchaseRecord {
  id: string;
  truckId?: string;
  driverProfileId?: string;
  gallons: number;
  totalCents: number;
  /** The jurisdiction the fuel was bought in — what an IFTA return needs. */
  state?: string;
  purchasedAt: string;
  providerLabel: string;
}

export interface FuelCardAdapter extends FleetIntegrationAdapter {
  readonly kind: "fuel_card";
  purchases(truckId: string, sinceIso: string): Promise<FuelPurchaseRecord[]>;
}

export interface TollTransactionRecord {
  id: string;
  truckId?: string;
  plazaName?: string;
  state?: string;
  amountCents: number;
  occurredAt: string;
  providerLabel: string;
}

export interface TollAdapter extends FleetIntegrationAdapter {
  readonly kind: "toll";
  transactions(truckId: string, sinceIso: string): Promise<TollTransactionRecord[]>;
}

/* -------------------------------------------------------------------------- */
/* Government records                                                          */
/* -------------------------------------------------------------------------- */

/**
 * State registration, plate and permit verification.
 *
 * Antcolos holds what somebody typed in and what somebody attached. It has
 * never asked a state whether any of it is true, and this adapter is where that
 * question would one day be asked — not a claim that it has been.
 */
export interface StateRegistrationLookup {
  plateNumber: string;
  plateState: string;
  registeredOwnerName?: string;
  expiresAt?: string;
  verifiedAt: string;
  providerLabel: string;
}

export interface StateRegistrationAdapter extends FleetIntegrationAdapter {
  readonly kind: "state_registration";
  verifyPlate(plateNumber: string, plateState: string): Promise<StateRegistrationLookup>;
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

export const FLEET_INTEGRATIONS: readonly FleetIntegrationDescriptor[] = [
  {
    kind: "eld",
    label: "Electronic logging device",
    description:
      "Hours of service and engine data straight from the device in the cab, "
      + "instead of asking the driver what their clock says.",
    status: "not_connected",
    wouldPopulate: ["Engine hours", "Duty status", "Last known location"],
    telemetrySource: "eld_integration",
  },
  {
    kind: "gps",
    label: "GPS tracking",
    description:
      "Position reported by a tracker on the equipment, so the last known "
      + "location stops depending on somebody remembering to call it in.",
    status: "not_connected",
    wouldPopulate: ["Last known location", "Location freshness"],
    telemetrySource: "gps_integration",
  },
  {
    kind: "telematics",
    label: "Vehicle telematics",
    description:
      "Odometer, engine hours and fault codes read from the vehicle itself.",
    status: "not_connected",
    wouldPopulate: ["Mileage", "Engine hours", "Fault codes"],
    telemetrySource: "telematics_integration",
  },
  {
    kind: "fuel_card",
    label: "Fuel card",
    description:
      "Fuel purchases with the gallons and the state they were bought in — the "
      + "record an IFTA return is built from.",
    status: "not_connected",
    wouldPopulate: ["Fuel purchases", "Fuel spend by jurisdiction"],
  },
  {
    kind: "toll",
    label: "Toll transponder",
    description: "Toll transactions matched back to the equipment that ran them.",
    status: "not_connected",
    wouldPopulate: ["Toll transactions", "Toll spend"],
  },
  {
    kind: "state_registration",
    label: "State registration lookup",
    description:
      "Checking a plate and registration against the issuing state, rather than "
      + "trusting what was typed into the form.",
    status: "not_connected",
    wouldPopulate: ["Registration verification", "Plate expiry"],
  },
] as const;

const BY_KIND = new Map(FLEET_INTEGRATIONS.map((d) => [d.kind, d]));

export function integrationDescriptor(kind: FleetIntegrationKind): FleetIntegrationDescriptor {
  const found = BY_KIND.get(kind);
  if (!found) throw new Error(`Unknown fleet integration: ${kind}`);
  return found;
}

/**
 * Every adapter, as it stands today: described, typed, and not connected.
 *
 * These are real objects rather than `null` so that calling code can be written
 * and reviewed now, and so the failure a screen would hit is the honest one
 * ("nothing is connected") rather than a crash on an undefined property.
 */
function unconnected(kind: FleetIntegrationKind, method: string): never {
  throw new FleetIntegrationNotConnectedError(kind, method);
}

export const eldAdapter: EldAdapter = {
  kind: "eld",
  describe: () => integrationDescriptor("eld"),
  dutyStatus: () => unconnected("eld", "dutyStatus"),
  engineReading: () => unconnected("eld", "engineReading"),
};

export const gpsAdapter: GpsAdapter = {
  kind: "gps",
  describe: () => integrationDescriptor("gps"),
  currentPosition: () => unconnected("gps", "currentPosition"),
};

export const telematicsAdapter: TelematicsAdapter = {
  kind: "telematics",
  describe: () => integrationDescriptor("telematics"),
  odometerAndHours: () => unconnected("telematics", "odometerAndHours"),
  faultCodes: () => unconnected("telematics", "faultCodes"),
};

export const fuelCardAdapter: FuelCardAdapter = {
  kind: "fuel_card",
  describe: () => integrationDescriptor("fuel_card"),
  purchases: () => unconnected("fuel_card", "purchases"),
};

export const tollAdapter: TollAdapter = {
  kind: "toll",
  describe: () => integrationDescriptor("toll"),
  transactions: () => unconnected("toll", "transactions"),
};

export const stateRegistrationAdapter: StateRegistrationAdapter = {
  kind: "state_registration",
  describe: () => integrationDescriptor("state_registration"),
  verifyPlate: () => unconnected("state_registration", "verifyPlate"),
};

export const FLEET_ADAPTERS: readonly FleetIntegrationAdapter[] = [
  eldAdapter, gpsAdapter, telematicsAdapter,
  fuelCardAdapter, tollAdapter, stateRegistrationAdapter,
] as const;

/** True for every kind today. Kept as a function so callers read honestly. */
export function isConnected(kind: FleetIntegrationKind): boolean {
  return integrationDescriptor(kind).status !== "not_connected";
}

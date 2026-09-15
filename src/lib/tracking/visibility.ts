import type { TrackingAudience, TrackingVisibility } from "@/types";

/**
 * What each audience may be shown, and what nobody may be shown.
 *
 * Two separate ideas live here and they must not be confused:
 *
 *  1. WHAT IS CONFIGURABLE. A dispatcher decides, per recipient, whether to
 *     include the truck's city, the ETA, the arrival signals and so on. The
 *     defaults below differ by audience because a receiver's interest in the
 *     pickup is nil and a shipper's interest in the delivery appointment is
 *     the broker's business, not theirs.
 *
 *  2. WHAT IS NEVER CONFIGURABLE. Rates, driver names and phone numbers, hours
 *     of service, internal notes, any other load, any other carrier, and any
 *     position history. There is no flag for these — they are absent from
 *     `TrackingVisibility` and absent from `PublicTrackingView`, so the only
 *     way to leak one would be to add a field, which is a code review, not a
 *     configuration mistake.
 *
 * `NEVER_DISCLOSED` exists so a test can assert the second list rather than
 * trusting it, and so a screen can tell a dispatcher exactly what a recipient
 * cannot see however the switches are set.
 */

export const NEVER_DISCLOSED: readonly { key: string; label: string; why: string }[] = [
  { key: "rates", label: "Rates and money", why: "What a load pays is between the carrier and its customer." },
  { key: "driver_identity", label: "Driver name and contact details", why: "A driver is a person, not a shipment attribute." },
  { key: "hos", label: "Hours of service", why: "Duty status belongs to the driver and the carrier's safety file." },
  { key: "internal_notes", label: "Internal notes", why: "Written for colleagues, never for customers." },
  { key: "other_loads", label: "Any other load", why: "A tracking link is scoped to one load and resolves to nothing else." },
  { key: "other_carriers", label: "Any other carrier's data", why: "One carrier's operations are not another's to read." },
  { key: "location_history", label: "Position history", why: "A link shows where the truck is now, never where it has been." },
  { key: "permanent_tracking", label: "Tracking beyond this load", why: "Every link expires, and nothing survives the load it was issued for." },
  { key: "equipment_identity", label: "Unit number, plate or VIN", why: "The equipment type is enough to plan a dock around." },
] as const;

/**
 * The default switches for an audience.
 *
 * Every default is the SMALLEST useful set for that audience, not the largest
 * permissible one. A dispatcher widening it is a decision with a name and a
 * timestamp on it; a dispatcher forgetting to narrow it should not be.
 */
export function defaultVisibility(audience: TrackingAudience): TrackingVisibility {
  switch (audience) {
    case "broker":
      // The broker is answerable to the customer for the whole shipment, so
      // they get the fullest view — which is still a small one.
      return {
        pickupProgress: true,
        deliveryProgress: true,
        truckLocation: true,
        etaAndFreshness: true,
        arrivalSignals: true,
        exceptionStatus: true,
        equipmentType: true,
        carrierName: false,
      };
    case "shipper":
      // The shipper cares that it left. Where it is afterwards is the broker's
      // conversation, not theirs.
      return {
        pickupProgress: true,
        deliveryProgress: false,
        truckLocation: false,
        etaAndFreshness: false,
        arrivalSignals: true,
        exceptionStatus: true,
        equipmentType: true,
        carrierName: false,
      };
    case "receiver":
      // The receiver is planning a door. They need when, not where it has been.
      return {
        pickupProgress: false,
        deliveryProgress: true,
        truckLocation: false,
        etaAndFreshness: true,
        arrivalSignals: true,
        exceptionStatus: true,
        equipmentType: true,
        carrierName: false,
      };
  }
}

/** Nothing at all. The base every recipient view is built up from. */
export const NOTHING_VISIBLE: TrackingVisibility = {
  pickupProgress: false,
  deliveryProgress: false,
  truckLocation: false,
  etaAndFreshness: false,
  arrivalSignals: false,
  exceptionStatus: false,
  equipmentType: false,
  carrierName: false,
};

export const VISIBILITY_LABEL: Record<keyof TrackingVisibility, string> = {
  pickupProgress: "Pickup progress",
  deliveryProgress: "Delivery progress",
  truckLocation: "Truck location (city and state)",
  etaAndFreshness: "ETA and last update",
  arrivalSignals: "Arrived and departed signals",
  exceptionStatus: "Delay and tracking-interrupted status",
  equipmentType: "Equipment type",
  carrierName: "Carrier name",
};

/**
 * Narrow a requested visibility to what the audience may ever hold.
 *
 * Applied in the service on every write, so a recipient cannot be given a
 * switch that their audience has no business holding even if a caller asks for
 * it. Today the only such rule is that a shipper is never given the delivery
 * appointment — the rest are dispatcher's choice — but the function is where
 * the next one goes, rather than an `if` somewhere in a screen.
 */
export function clampVisibility(
  audience: TrackingAudience,
  requested: TrackingVisibility,
): TrackingVisibility {
  if (audience === "shipper") {
    return { ...requested, deliveryProgress: false };
  }
  return { ...requested };
}

/** The sentence every public page carries, whatever the switches say. */
export const PUBLIC_DISCLOSURE =
  "This page shows mock tracking data from Antcolos. It is not a MacroPoint, "
  + "Project44 or FourKites feed, there is no live GPS, ELD or telematics "
  + "connection behind it, and no position here was reported by a real device. "
  + "It shows one load, it expires, and it can be withdrawn at any time.";

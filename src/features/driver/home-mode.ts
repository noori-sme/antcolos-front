import type { CarrierRelationship, DriverProfile } from "@/types";

export type DriverHomeMode = "carrier" | "unattached";

/**
 * Which driver home this driver gets.
 *
 * A driver who signed up on their own has a profile and no carrier, and there
 * is nothing honest to put on a carrier dashboard for them: no loads, no
 * paperwork anybody is waiting on, no organization. They get the unattached
 * home — their own profile and documents — until a carrier invites them and
 * they accept.
 *
 * An ended relationship does not count. Leaving a carrier takes their work off
 * this screen; it does not take the driver's profile away.
 */
export function driverHomeMode(
  profile: DriverProfile | null,
  relationships: readonly CarrierRelationship[],
): DriverHomeMode {
  if (!profile) return "carrier";
  return relationships.some((r) => r.status !== "ended") ? "carrier" : "unattached";
}

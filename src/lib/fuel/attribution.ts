import type { CarrierAttribution } from "@/types";

/**
 * Who was responsible, at a moment in the past.
 *
 * This is the rule the whole module hangs on: mileage and fuel belong to the
 * carrier whose operating authority was live WHEN THE TRAVEL OR PURCHASE
 * HAPPENED. Not the carrier that owns the truck today, not the carrier the
 * driver works for now, not whoever is looking at the screen.
 *
 * The function is pure and takes the authority history as an argument, so it
 * can be reasoned about and tested without a registry: the caller assembles
 * the windows from operating leases and approved carrier relationships, and
 * this decides which one covers the instant in question.
 */

export interface AuthorityWindow {
  carrierOrganizationId: string;
  /** The carrier's name as it reads now; snapshotted into the attribution. */
  carrierNameSnapshot: string;
  /** How the authority arose. A lease always beats a bare relationship. */
  kind: "operating_lease" | "carrier_relationship";
  startedAt: string;
  /** Open-ended when absent. */
  endedAt?: string;
  operatingLeaseId?: string;
  relationshipId?: string;
}

function covers(window: AuthorityWindow, at: number): boolean {
  const from = Date.parse(window.startedAt);
  if (Number.isNaN(from) || at < from) return false;
  if (!window.endedAt) return true;
  const to = Date.parse(window.endedAt);
  return Number.isNaN(to) ? true : at <= to;
}

/**
 * Resolves attribution for one instant.
 *
 * Precedence, and the reason for each step:
 *
 *  1. An operating lease that covers the instant. Only one lease can hold a
 *     truck at a time, so this is unambiguous by construction, and it is the
 *     strongest possible statement of who was running the truck.
 *  2. Exactly ONE approved carrier relationship covering the instant. Several
 *     carriers can be approved on a truck at once; if more than one covers the
 *     moment, nothing here can tell them apart and guessing would be worse
 *     than admitting it.
 *  3. Unresolved. The record is written anyway, flagged, and put in front of a
 *     person — a fuel purchase that happened is not deleted because Antcolos
 *     cannot work out whose it was.
 */
export function resolveAttribution(
  windows: readonly AuthorityWindow[],
  occurredAt: string,
  resolvedAt: string,
): CarrierAttribution {
  const at = Date.parse(occurredAt);
  const covering = windows.filter((w) => covers(w, at));

  const lease = covering.find((w) => w.kind === "operating_lease");
  if (lease) {
    return {
      carrierOrganizationId: lease.carrierOrganizationId,
      carrierNameSnapshot: lease.carrierNameSnapshot,
      basis: "operating_lease",
      operatingLeaseId: lease.operatingLeaseId,
      relationshipId: lease.relationshipId,
      resolvedAt,
    };
  }

  const relationships = covering.filter((w) => w.kind === "carrier_relationship");
  const carriers = new Set(relationships.map((w) => w.carrierOrganizationId));
  if (carriers.size === 1) {
    const only = relationships[0];
    return {
      carrierOrganizationId: only.carrierOrganizationId,
      carrierNameSnapshot: only.carrierNameSnapshot,
      basis: "carrier_relationship",
      relationshipId: only.relationshipId,
      resolvedAt,
    };
  }

  return {
    carrierOrganizationId: "",
    carrierNameSnapshot: "Not established",
    basis: "unresolved",
    resolvedAt,
  };
}

/**
 * A person stating the answer, when the history could not.
 *
 * Kept as its own basis so a return can always distinguish "the system knew"
 * from "somebody said so" — the two are not the same evidence in an audit.
 */
export function declareAttribution(
  carrierOrganizationId: string,
  carrierNameSnapshot: string,
  resolvedAt: string,
): CarrierAttribution {
  return {
    carrierOrganizationId,
    carrierNameSnapshot,
    basis: "manual_declaration",
    resolvedAt,
  };
}

/**
 * Whether a correction may change attribution.
 *
 * It may not. A correction fixes what was recorded — gallons, odometer, the
 * jurisdiction somebody typed wrong. Moving responsibility to a different
 * carrier after the fact is exactly the rewriting of history this module
 * exists to prevent, so the revision keeps the original's snapshot and the
 * service refuses anything else.
 */
export function carryForwardAttribution(original: CarrierAttribution): CarrierAttribution {
  return { ...original };
}

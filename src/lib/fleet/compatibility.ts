import type {
  CompatibilityResult, CompatibilityVerdict, Trailer, TrailerHitchType, Truck,
} from "@/types";
import { HITCH_LABEL, TYPICAL_HITCH } from "./trailer-equipment";
import { EQUIPMENT_LABEL } from "./equipment";

/**
 * Can this power unit pull this trailer?
 *
 * The function answers only the MECHANICAL half of that question: coupling,
 * type and weight. Whether the carrier is approved, whether either asset is
 * already spoken for, and whether anybody has permission are relationship
 * questions, and they are decided in the registry where the relationships live.
 *
 * The important behaviour here is that "we do not know" is a distinct answer.
 * Antcolos often has no tow rating for a pickup and no coupling recorded for a
 * trailer; returning "compatible" on that basis would be a claim nobody made.
 * So `fullyChecked` says whether every fact needed was actually present, and
 * `missing` names what was not.
 */

/** Which couplings each kind of power unit can offer. */
const TRUCK_COUPLINGS: Record<Truck["equipmentType"], TrailerHitchType[]> = {
  // A van or a straight truck is not a tow vehicle in this product. It can be
  // fitted with a hitch in the real world, but Antcolos will not assume one.
  cargo_van: [],
  sprinter_van: [],
  box_truck: [],
  hotshot: ["gooseneck_ball", "bumper_pull", "pintle"],
  tractor: ["fifth_wheel"],
};

/** Trailer types a given power unit is built to pull at all. */
const TRUCK_TRAILER_TYPES: Record<Truck["equipmentType"], Trailer["trailerType"][]> = {
  cargo_van: [],
  sprinter_van: [],
  box_truck: [],
  hotshot: ["gooseneck", "car_hauler", "flatbed", "other"],
  tractor: ["dry_van", "reefer", "flatbed", "step_deck", "car_hauler", "other"],
};

export interface MechanicalCheck {
  verdict: Extract<CompatibilityVerdict, "compatible" | "incompatible" | "missing_required_data">;
  reasons: string[];
  missing: string[];
  fullyChecked: boolean;
}

export function checkMechanicalCompatibility(truck: Truck, trailer: Trailer): MechanicalCheck {
  const reasons: string[] = [];
  const missing: string[] = [];

  const truckLabel = EQUIPMENT_LABEL[truck.equipmentType];
  const trailerCouplings = TRUCK_COUPLINGS[truck.equipmentType];
  const pullableTypes = TRUCK_TRAILER_TYPES[truck.equipmentType];

  /* ---- Is this power unit a tow vehicle at all? ---- */
  if (trailerCouplings.length === 0) {
    return {
      verdict: "incompatible",
      reasons: [`A ${truckLabel} carries its own freight and does not pull a trailer.`],
      missing: [],
      fullyChecked: true,
    };
  }

  /* ---- Coupling ---- */
  const recordedHitch = trailer.configuration.hitchType;
  const hitch = recordedHitch ?? TYPICAL_HITCH[trailer.trailerType];
  if (!hitch) {
    missing.push("the trailer's coupling type");
  } else if (!trailerCouplings.includes(hitch)) {
    reasons.push(
      `This trailer couples with a ${HITCH_LABEL[hitch].toLowerCase()}, and a ${truckLabel} offers ${
        trailerCouplings.map((c) => HITCH_LABEL[c].toLowerCase()).join(" or ")
      }.`,
    );
  } else if (!recordedHitch) {
    // It fits the type's usual coupling, but nobody wrote it down for this one.
    missing.push(`this trailer's own coupling (assumed ${HITCH_LABEL[hitch].toLowerCase()} from its type)`);
  }

  /* ---- Trailer type ---- */
  if (!pullableTypes.includes(trailer.trailerType)) {
    reasons.push(`A ${truckLabel} is not set up to pull this kind of trailer.`);
  }

  /* ---- Weight ----
     Payload is what a truck carries, not what it tows; using it here would
     rule out every hotshot in the country. Only a recorded towing rating
     counts, and its absence is reported rather than guessed around. */
  const towCapacity = truck.specs.maxTowableWeightLbs;
  const loadedWeight = trailer.specs.gvwrLbs;
  if (towCapacity === undefined) {
    missing.push(`the ${truckLabel.toLowerCase()}'s towing capacity`);
  } else if (loadedWeight === undefined) {
    missing.push("the trailer's GVWR");
  } else if (loadedWeight > towCapacity) {
    reasons.push(
      `The trailer's GVWR of ${loadedWeight.toLocaleString()} lb is more than the power unit's ${towCapacity.toLocaleString()} lb rating.`,
    );
  }

  /* ---- Gooseneck coupler rating, when the trailer records one ---- */
  const coupler = trailer.configuration.couplerRatingLbs;
  if (coupler !== undefined && loadedWeight !== undefined && loadedWeight > coupler) {
    reasons.push(
      `The trailer's coupler is rated to ${coupler.toLocaleString()} lb, below its own GVWR of ${loadedWeight.toLocaleString()} lb.`,
    );
  }

  if (reasons.length > 0) {
    return { verdict: "incompatible", reasons, missing, fullyChecked: missing.length === 0 };
  }
  if (missing.length > 0) {
    return {
      verdict: "missing_required_data",
      reasons: ["Nothing rules this pairing out, but Antcolos has not been given enough to check it."],
      missing,
      fullyChecked: false,
    };
  }
  return {
    verdict: "compatible",
    reasons: [`Coupling, trailer type and weight all check out against this ${truckLabel.toLowerCase()}.`],
    missing: [],
    fullyChecked: true,
  };
}

/** Convenience for callers that just want the full shape back. */
export function toCompatibilityResult(check: MechanicalCheck): CompatibilityResult {
  return { ...check };
}

export const COMPATIBILITY_LABEL: Record<CompatibilityVerdict, string> = {
  compatible: "Compatible",
  incompatible: "Not compatible",
  missing_required_data: "Not enough information",
  already_attached: "Already attached",
  reserved: "Reserved",
  locked_by_other_carrier: "Locked by another carrier",
  carrier_not_approved: "Carrier not approved",
  power_unit_unavailable: "Power unit unavailable",
  trailer_unavailable: "Trailer unavailable",
  unauthorized: "Not permitted",
};

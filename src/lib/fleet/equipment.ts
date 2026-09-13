import type { TruckDocumentRequirement, TruckEquipmentType } from "@/types";

/**
 * What each kind of power unit is, and what it can sensibly be asked about.
 *
 * A cargo van has no axle count worth recording and no sleeper; a tractor has
 * no cargo box. Asking every truck every question is how good data turns into
 * guesses, so the form is driven from here.
 */
export const EQUIPMENT_LABEL: Record<TruckEquipmentType, string> = {
  cargo_van: "Cargo Van",
  sprinter_van: "Sprinter Van",
  box_truck: "Straight / Box Truck",
  hotshot: "Pickup / Hotshot Power Unit",
  tractor: "Tractor",
};

export const EQUIPMENT_DESCRIPTION: Record<TruckEquipmentType, string> = {
  cargo_van: "Standard cargo van. Expedite and small LTL freight.",
  sprinter_van: "High-roof sprinter. Longer cargo area than a standard van.",
  box_truck: "Straight truck with its own cargo box.",
  hotshot: "Pickup power unit pulling a gooseneck or bumper-pull trailer.",
  tractor: "Road tractor. Pulls a separate trailer.",
};

export const EQUIPMENT_TYPES: TruckEquipmentType[] = [
  "cargo_van", "sprinter_van", "box_truck", "hotshot", "tractor",
];

/** Spec fields that make sense for a given power unit. */
export type SpecField =
  | "gvwrLbs" | "emptyWeightLbs" | "maxPayloadLbs"
  | "cargoLengthIn" | "cargoWidthIn" | "cargoHeightIn"
  | "doorWidthIn" | "doorHeightIn"
  | "palletCapacity" | "axleCount" | "fuelType"
  | "hasSleeper" | "hasLiftgate" | "isDockHeight" | "hasReefer" | "hazmatCapable";

const CARGO_BOX: SpecField[] = [
  "cargoLengthIn", "cargoWidthIn", "cargoHeightIn",
  "doorWidthIn", "doorHeightIn", "palletCapacity",
];

const SPEC_FIELDS: Record<TruckEquipmentType, SpecField[]> = {
  cargo_van: ["gvwrLbs", "emptyWeightLbs", "maxPayloadLbs", ...CARGO_BOX, "fuelType", "hasLiftgate", "hazmatCapable"],
  sprinter_van: ["gvwrLbs", "emptyWeightLbs", "maxPayloadLbs", ...CARGO_BOX, "fuelType", "hasLiftgate", "hazmatCapable"],
  box_truck: ["gvwrLbs", "emptyWeightLbs", "maxPayloadLbs", ...CARGO_BOX, "axleCount", "fuelType", "hasLiftgate", "isDockHeight", "hasReefer", "hazmatCapable"],
  hotshot: ["gvwrLbs", "emptyWeightLbs", "maxPayloadLbs", "axleCount", "fuelType", "hazmatCapable"],
  tractor: ["gvwrLbs", "emptyWeightLbs", "axleCount", "fuelType", "hasSleeper", "hazmatCapable"],
};

export function specFieldsFor(type: TruckEquipmentType): SpecField[] {
  return SPEC_FIELDS[type];
}

export const SPEC_LABEL: Record<SpecField, string> = {
  gvwrLbs: "GVWR",
  emptyWeightLbs: "Empty weight",
  maxPayloadLbs: "Maximum payload",
  cargoLengthIn: "Cargo length",
  cargoWidthIn: "Cargo width",
  cargoHeightIn: "Cargo height",
  doorWidthIn: "Door opening width",
  doorHeightIn: "Door opening height",
  palletCapacity: "Pallet capacity",
  axleCount: "Axles",
  fuelType: "Fuel type",
  hasSleeper: "Sleeper berth",
  hasLiftgate: "Liftgate",
  isDockHeight: "Dock height",
  hasReefer: "Refrigerated",
  hazmatCapable: "Hazmat capable",
};

export const SPEC_UNIT: Partial<Record<SpecField, string>> = {
  gvwrLbs: "lb",
  emptyWeightLbs: "lb",
  maxPayloadLbs: "lb",
  cargoLengthIn: "in",
  cargoWidthIn: "in",
  cargoHeightIn: "in",
  doorWidthIn: "in",
  doorHeightIn: "in",
};

export const BOOLEAN_SPEC_FIELDS: SpecField[] = [
  "hasSleeper", "hasLiftgate", "isDockHeight", "hasReefer", "hazmatCapable",
];

export function isBooleanSpec(field: SpecField): boolean {
  return BOOLEAN_SPEC_FIELDS.includes(field);
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const ALL_DOCUMENTS: TruckDocumentRequirement[] = [
  { kind: "registration", label: "Registration", description: "Current vehicle registration for the plate on this truck.", required: true, expires: true },
  { kind: "title", label: "Title or ownership evidence", description: "Proof of who legally owns the vehicle.", required: true, expires: false },
  { kind: "insurance", label: "Insurance evidence", description: "Certificate showing the truck is covered.", required: true, expires: true },
  { kind: "annual_inspection", label: "Annual inspection", description: "The most recent federal annual inspection report.", required: true, expires: true },
  { kind: "cab_card", label: "Cab card", description: "IRP cab card. Applies to apportioned power units.", required: false, expires: true, equipmentTypes: ["tractor", "box_truck"] },
  { kind: "lease_agreement", label: "Lease or operating agreement", description: "Needed when a carrier operates a truck it does not own.", required: false, expires: false },
];

export function documentRequirementsFor(type: TruckEquipmentType): TruckDocumentRequirement[] {
  return ALL_DOCUMENTS.filter((d) => !d.equipmentTypes || d.equipmentTypes.includes(type));
}

export const DOCUMENT_LABEL: Record<string, string> = Object.fromEntries(
  ALL_DOCUMENTS.map((d) => [d.kind, d.label]),
);

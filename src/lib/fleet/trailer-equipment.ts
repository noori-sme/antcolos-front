import type {
  TrailerConfiguration, TrailerDocumentRequirement, TrailerHitchType,
  TrailerSuspension, TrailerType,
} from "@/types";

/**
 * What each kind of trailer is, and what it can sensibly be asked about.
 *
 * A dry van has no deck length and a flatbed has no pallet capacity. Asking
 * every trailer every question is how good data turns into guesses, so the
 * forms and the profile are both driven from here rather than from a single
 * flat list with half the fields greyed out.
 */
export const TRAILER_TYPE_LABEL: Record<TrailerType, string> = {
  dry_van: "Dry Van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  step_deck: "Step Deck",
  gooseneck: "Gooseneck",
  car_hauler: "Car Hauler",
  other: "Other",
};

export const TRAILER_TYPE_DESCRIPTION: Record<TrailerType, string> = {
  dry_van: "Enclosed box for general freight. No temperature control.",
  reefer: "Insulated and refrigerated. Temperature-controlled freight.",
  flatbed: "Open deck. Freight is secured with straps, chains and tarps.",
  step_deck: "Two deck heights for loads too tall for a flatbed.",
  gooseneck: "Couples over the rear axle of a pickup rather than to a fifth wheel.",
  car_hauler: "Built to carry vehicles, open or enclosed.",
  other: "Anything the list above does not cover.",
};

export const TRAILER_TYPES: TrailerType[] = [
  "dry_van", "reefer", "flatbed", "step_deck", "gooseneck", "car_hauler", "other",
];

/**
 * How each type normally couples.
 *
 * A default, not a fact about any particular trailer — a trailer's own
 * `configuration.hitchType` always wins when it is recorded. This exists so the
 * compatibility service can say "probably a fifth wheel, but nobody recorded
 * it" rather than silently assuming.
 */
export const TYPICAL_HITCH: Record<TrailerType, TrailerHitchType | undefined> = {
  dry_van: "fifth_wheel",
  reefer: "fifth_wheel",
  flatbed: "fifth_wheel",
  step_deck: "fifth_wheel",
  gooseneck: "gooseneck_ball",
  car_hauler: undefined,
  other: undefined,
};

export const HITCH_LABEL: Record<TrailerHitchType, string> = {
  fifth_wheel: "Fifth wheel",
  gooseneck_ball: "Gooseneck ball",
  pintle: "Pintle hook",
  bumper_pull: "Bumper pull",
};

export const SUSPENSION_LABEL: Record<TrailerSuspension, string> = {
  air_ride: "Air ride",
  spring: "Spring",
  torsion: "Torsion",
  walking_beam: "Walking beam",
};

/* -------------------------------------------------------------------------- */
/* General specifications                                                      */
/* -------------------------------------------------------------------------- */

export type TrailerSpecField =
  | "overallLengthIn" | "overallWidthIn" | "overallHeightIn"
  | "interiorLengthIn" | "interiorWidthIn" | "interiorHeightIn"
  | "rearDoorWidthIn" | "rearDoorHeightIn"
  | "sideDoorWidthIn" | "sideDoorHeightIn"
  | "gvwrLbs" | "emptyWeightLbs" | "maxPayloadLbs"
  | "axleCount" | "suspension" | "tireSize";

const OVERALL: TrailerSpecField[] = ["overallLengthIn", "overallWidthIn", "overallHeightIn"];
const WEIGHTS: TrailerSpecField[] = ["gvwrLbs", "emptyWeightLbs", "maxPayloadLbs"];
const RUNNING_GEAR: TrailerSpecField[] = ["axleCount", "suspension", "tireSize"];
const ENCLOSED: TrailerSpecField[] = [
  "interiorLengthIn", "interiorWidthIn", "interiorHeightIn",
  "rearDoorWidthIn", "rearDoorHeightIn", "sideDoorWidthIn", "sideDoorHeightIn",
];

const SPEC_FIELDS: Record<TrailerType, TrailerSpecField[]> = {
  dry_van: [...OVERALL, ...ENCLOSED, ...WEIGHTS, ...RUNNING_GEAR],
  reefer: [...OVERALL, ...ENCLOSED, ...WEIGHTS, ...RUNNING_GEAR],
  flatbed: [...OVERALL, ...WEIGHTS, ...RUNNING_GEAR],
  step_deck: [...OVERALL, ...WEIGHTS, ...RUNNING_GEAR],
  gooseneck: [...OVERALL, ...WEIGHTS, ...RUNNING_GEAR],
  car_hauler: [...OVERALL, ...WEIGHTS, ...RUNNING_GEAR],
  other: [...OVERALL, ...WEIGHTS, ...RUNNING_GEAR],
};

export function trailerSpecFieldsFor(type: TrailerType): TrailerSpecField[] {
  return SPEC_FIELDS[type];
}

export const TRAILER_SPEC_LABEL: Record<TrailerSpecField, string> = {
  overallLengthIn: "Overall length",
  overallWidthIn: "Overall width",
  overallHeightIn: "Overall height",
  interiorLengthIn: "Interior cargo length",
  interiorWidthIn: "Interior cargo width",
  interiorHeightIn: "Interior cargo height",
  rearDoorWidthIn: "Rear door opening width",
  rearDoorHeightIn: "Rear door opening height",
  sideDoorWidthIn: "Side door width",
  sideDoorHeightIn: "Side door height",
  gvwrLbs: "GVWR",
  emptyWeightLbs: "Empty weight",
  maxPayloadLbs: "Maximum payload",
  axleCount: "Axles",
  suspension: "Suspension",
  tireSize: "Tire size",
};

/** Which spec fields are lengths in inches, so they can be shown as feet. */
export const TRAILER_SPEC_UNIT: Partial<Record<TrailerSpecField, "in" | "lb">> = {
  overallLengthIn: "in", overallWidthIn: "in", overallHeightIn: "in",
  interiorLengthIn: "in", interiorWidthIn: "in", interiorHeightIn: "in",
  rearDoorWidthIn: "in", rearDoorHeightIn: "in",
  sideDoorWidthIn: "in", sideDoorHeightIn: "in",
  gvwrLbs: "lb", emptyWeightLbs: "lb", maxPayloadLbs: "lb",
};

/* -------------------------------------------------------------------------- */
/* Type-specific configuration                                                 */
/* -------------------------------------------------------------------------- */

export type ConfigField = keyof TrailerConfiguration;

const CONFIG_FIELDS: Record<TrailerType, ConfigField[]> = {
  dry_van: [
    "rearDoorStyle", "hasSideDoor", "hasETrack", "hasLogisticPosts",
    "hasAirRide", "hasLiftgate", "palletCapacity", "hitchType",
  ],
  reefer: [
    "reeferUnitMake", "reeferUnitModel", "reeferFuelType",
    "minTemperatureF", "maxTemperatureF", "multiTemperature",
    "reeferUnitStatus", "reeferLastServicedAt", "airflow",
    "palletCapacity", "hasLiftgate", "hitchType",
  ],
  flatbed: [
    "deckLengthIn", "deckWidthIn", "hasTarps", "strapCount", "chainCount",
    "binderCount", "hasCoilRacks", "hasDunnage", "hasHeadacheRack", "hitchType",
  ],
  step_deck: [
    "upperDeckLengthIn", "lowerDeckLengthIn", "upperDeckHeightIn", "lowerDeckHeightIn",
    "hasRamps", "hasLoadLevelers", "securementNotes", "hasTarps", "strapCount",
    "chainCount", "binderCount", "hitchType",
  ],
  gooseneck: [
    "deckLengthIn", "deckWidthIn", "hitchType", "couplerRatingLbs",
    "rampType", "hasWinch", "hasTarps", "strapCount", "chainCount", "binderCount",
  ],
  car_hauler: [
    "vehicleCapacity", "deckConfiguration", "rampType", "hasWinch",
    "maxVehicleLengthIn", "maxVehicleHeightIn", "enclosed", "hitchType",
  ],
  other: ["hitchType"],
};

export function configFieldsFor(type: TrailerType): ConfigField[] {
  return CONFIG_FIELDS[type];
}

export const CONFIG_LABEL: Record<ConfigField, string> = {
  rearDoorStyle: "Rear door",
  hasSideDoor: "Side door",
  hasETrack: "E-track",
  hasLogisticPosts: "Logistic posts",
  hasAirRide: "Air ride",
  hasLiftgate: "Liftgate",
  palletCapacity: "Pallet capacity",
  reeferUnitMake: "Reefer unit make",
  reeferUnitModel: "Reefer unit model",
  reeferFuelType: "Reefer fuel",
  minTemperatureF: "Minimum temperature",
  maxTemperatureF: "Maximum temperature",
  multiTemperature: "Multi-temperature",
  reeferUnitStatus: "Reefer unit status",
  reeferLastServicedAt: "Reefer last serviced",
  airflow: "Airflow",
  deckLengthIn: "Deck length",
  deckWidthIn: "Deck width",
  hasTarps: "Tarps",
  strapCount: "Straps",
  chainCount: "Chains",
  binderCount: "Binders",
  hasCoilRacks: "Coil racks",
  hasDunnage: "Dunnage",
  hasHeadacheRack: "Headache rack",
  upperDeckLengthIn: "Upper deck length",
  lowerDeckLengthIn: "Lower deck length",
  upperDeckHeightIn: "Upper deck height",
  lowerDeckHeightIn: "Lower deck height",
  hasRamps: "Ramps",
  hasLoadLevelers: "Load levelers",
  securementNotes: "Securement equipment",
  hitchType: "Coupling",
  couplerRatingLbs: "Coupler rating",
  rampType: "Ramp type",
  hasWinch: "Winch",
  vehicleCapacity: "Vehicle capacity",
  deckConfiguration: "Deck configuration",
  maxVehicleLengthIn: "Maximum vehicle length",
  maxVehicleHeightIn: "Maximum vehicle height",
  enclosed: "Enclosed",
};

export const CONFIG_UNIT: Partial<Record<ConfigField, string>> = {
  minTemperatureF: "°F",
  maxTemperatureF: "°F",
  deckLengthIn: "in",
  deckWidthIn: "in",
  upperDeckLengthIn: "in",
  lowerDeckLengthIn: "in",
  upperDeckHeightIn: "in",
  lowerDeckHeightIn: "in",
  couplerRatingLbs: "lb",
  maxVehicleLengthIn: "in",
  maxVehicleHeightIn: "in",
};

const BOOLEAN_CONFIG: ConfigField[] = [
  "hasSideDoor", "hasETrack", "hasLogisticPosts", "hasAirRide", "hasLiftgate",
  "multiTemperature", "hasTarps", "hasCoilRacks", "hasDunnage", "hasHeadacheRack",
  "hasRamps", "hasLoadLevelers", "hasWinch", "enclosed",
];

export function isBooleanConfig(field: ConfigField): boolean {
  return BOOLEAN_CONFIG.includes(field);
}

/** Config fields that are a fixed choice rather than free text or a number. */
export const CONFIG_CHOICES: Partial<Record<ConfigField, Array<[string, string]>>> = {
  rearDoorStyle: [["swing", "Swing doors"], ["roll_up", "Roll-up door"]],
  reeferFuelType: [["diesel", "Diesel"], ["electric", "Electric"], ["hybrid", "Hybrid"]],
  reeferUnitStatus: [
    ["operational", "Operational"], ["needs_service", "Needs service"], ["down", "Down"],
  ],
  airflow: [["air_chute", "Air chute"], ["floor_channels", "Floor channels"], ["none", "None"]],
  rampType: [
    ["slide_in", "Slide-in"], ["fold_down", "Fold-down"],
    ["beavertail", "Beavertail"], ["none", "None"],
  ],
  deckConfiguration: [["single", "Single level"], ["double", "Double deck"], ["stinger", "Stinger"]],
  hitchType: [
    ["fifth_wheel", "Fifth wheel"], ["gooseneck_ball", "Gooseneck ball"],
    ["pintle", "Pintle hook"], ["bumper_pull", "Bumper pull"],
  ],
};

const DATE_CONFIG: ConfigField[] = ["reeferLastServicedAt"];
export function isDateConfig(field: ConfigField): boolean {
  return DATE_CONFIG.includes(field);
}

const TEXT_CONFIG: ConfigField[] = [
  "reeferUnitMake", "reeferUnitModel", "securementNotes",
];
export function isTextConfig(field: ConfigField): boolean {
  return TEXT_CONFIG.includes(field);
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const ALL_DOCUMENTS: TrailerDocumentRequirement[] = [
  { kind: "registration", label: "Registration", description: "Current registration for the plate on this trailer.", required: true, expires: true },
  { kind: "title", label: "Title or ownership evidence", description: "Proof of who legally owns the trailer.", required: true, expires: false },
  { kind: "insurance", label: "Insurance evidence", description: "Certificate showing the trailer is covered.", required: true, expires: true },
  { kind: "annual_inspection", label: "Annual inspection", description: "The most recent federal annual inspection report.", required: true, expires: true },
  { kind: "lease_agreement", label: "Lease or operating agreement", description: "Needed when a carrier runs a trailer it does not own.", required: false, expires: false },
  {
    kind: "reefer_service_record", label: "Reefer service record",
    description: "Most recent service on the refrigeration unit.",
    required: true, expires: true, trailerTypes: ["reefer"],
  },
  {
    kind: "tarp_securement_inventory", label: "Tarp and securement inventory",
    description: "What securement equipment travels with the trailer.",
    required: false, expires: false,
    trailerTypes: ["flatbed", "step_deck", "gooseneck", "car_hauler"],
  },
];

export function trailerDocumentRequirementsFor(type: TrailerType): TrailerDocumentRequirement[] {
  return ALL_DOCUMENTS.filter((d) => !d.trailerTypes || d.trailerTypes.includes(type));
}

export const TRAILER_DOCUMENT_LABEL: Record<string, string> = Object.fromEntries(
  ALL_DOCUMENTS.map((d) => [d.kind, d.label]),
);

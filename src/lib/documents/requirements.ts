import { documentRequirementsFor } from "@/lib/fleet/equipment";
import { trailerDocumentRequirementsFor } from "@/lib/fleet/trailer-equipment";
import type {
  DocumentApplicability, DocumentRequirement, DocumentTypeKey,
  EngagementType, RequirementSet, RequirementSetId, TrailerDocumentKind,
  TrailerType, TruckDocumentKind, TruckEquipmentType, WorkspaceKind,
} from "@/types";
import { documentType } from "./catalog";

/**
 * WHAT EACH WORKSPACE IS ASKED FOR.
 *
 * A carrier organization, a dispatch organization and an individual dispatch
 * workspace are three different businesses with three different obligations.
 * They are NOT the same checklist with rows hidden.
 *
 * The matrix below is deliberately exhaustive: every workspace type has an
 * explicit answer for every candidate document type, including
 * "not_applicable". Saying "not applicable" out loud is what stops a
 * carrier-only requirement leaking into a dispatcher's checklist by accident —
 * a missing row would be a silent bug, whereas a wrong cell is a visible one,
 * and can be tested.
 *
 * The document TYPE stays reusable. A W-9 is one type; it is required of all
 * three, and the reason differs. That is the whole point of separating types
 * from requirements.
 */
interface WorkspaceRule {
  applicability: DocumentApplicability;
  /** Why this workspace is asked for it. Empty for "not_applicable". */
  reason: string;
  /** Overrides the catalog label where a workspace calls it something else. */
  label?: string;
}

interface WorkspaceMatrixRow {
  typeKey: DocumentTypeKey;
  carrier_organization: WorkspaceRule;
  dispatch_organization: WorkspaceRule;
  individual_dispatcher: WorkspaceRule;
}

const NOT_APPLICABLE: WorkspaceRule = { applicability: "not_applicable", reason: "" };

export const WORKSPACE_DOCUMENT_MATRIX: readonly WorkspaceMatrixRow[] = [
  {
    typeKey: "w9",
    carrier_organization: { applicability: "required", reason: "Brokers will not pay a carrier they cannot report." },
    dispatch_organization: { applicability: "required", reason: "Carriers pay your dispatch fee and have to report it." },
    individual_dispatcher: { applicability: "required", reason: "You are paid as a business of one, and it still has to be reported." },
  },
  {
    typeKey: "operating_authority",
    carrier_organization: { applicability: "required", reason: "Nothing can be hauled for hire without it." },
    // A dispatcher never holds authority. This is the clearest carrier-only row.
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "mc_authority_letter",
    carrier_organization: { applicability: "required", reason: "Brokers ask for the MC certificate as issued, not a screenshot." },
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "certificate_of_insurance",
    carrier_organization: { applicability: "required", label: "Certificate of insurance (liability and cargo)", reason: "Liability and cargo coverage, with the broker named as certificate holder." },
    // A dispatcher carries no cargo, so cargo insurance is meaningless here.
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "errors_omissions_insurance",
    // Carriers are not asked for E&O; dispatchers are, because the exposure is
    // professional rather than physical.
    carrier_organization: NOT_APPLICABLE,
    dispatch_organization: { applicability: "required", reason: "Carriers increasingly require E&O cover before signing a dispatch agreement." },
    individual_dispatcher: { applicability: "optional", reason: "Some carriers ask a solo dispatcher for it; many do not. Supply it if you carry it." },
  },
  {
    typeKey: "business_registration",
    carrier_organization: { applicability: "required", reason: "The legal entity the authority is held by." },
    dispatch_organization: { applicability: "required", reason: "The legal entity carriers contract with." },
    // The distinction that makes an individual workspace its own thing: there
    // may be no company yet, and pretending otherwise would block the person.
    individual_dispatcher: { applicability: "optional", reason: "Only if you have formed a company. Working as yourself is a valid answer." },
  },
  {
    typeKey: "government_id",
    // A company proves itself by its registration, not by a director's passport.
    carrier_organization: NOT_APPLICABLE,
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: { applicability: "required", reason: "With no company behind the workspace, the carrier is contracting with you personally." },
  },
  {
    typeKey: "dispatch_service_agreement",
    carrier_organization: NOT_APPLICABLE,
    dispatch_organization: { applicability: "required", reason: "The agreement every carrier you book for signs." },
    individual_dispatcher: { applicability: "required", reason: "The agreement every carrier you book for signs." },
  },
  {
    typeKey: "voided_check",
    carrier_organization: { applicability: "required", reason: "Where freight payments are sent." },
    dispatch_organization: { applicability: "required", reason: "Where dispatch fees are sent." },
    individual_dispatcher: { applicability: "required", reason: "Where dispatch fees are sent." },
  },
  {
    typeKey: "ifta_license",
    carrier_organization: { applicability: "required", reason: "Required to run interstate and file fuel tax." },
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "drug_alcohol_policy",
    carrier_organization: { applicability: "required", reason: "Every driver you run must be in a testing consortium." },
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "safety_policy",
    carrier_organization: { applicability: "optional", reason: "Asked for by larger shippers during onboarding." },
    dispatch_organization: NOT_APPLICABLE,
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "workers_compensation",
    carrier_organization: { applicability: "optional", reason: "Required once you have employees rather than contractors." },
    dispatch_organization: { applicability: "optional", reason: "Required once you have employees rather than contractors." },
    // One person cannot employ themselves.
    individual_dispatcher: NOT_APPLICABLE,
  },
  {
    typeKey: "carrier_packet",
    carrier_organization: { applicability: "optional", reason: "Kept to hand so a broker's packet can be answered the same day." },
    dispatch_organization: { applicability: "optional", reason: "Kept to hand so a carrier's packet can be completed on their behalf." },
    individual_dispatcher: { applicability: "optional", reason: "Kept to hand so a carrier's packet can be completed on their behalf." },
  },
] as const;

const WORKSPACE_SET_ID: Record<WorkspaceKind, RequirementSetId> = {
  carrier_organization: "carrier_organization",
  dispatch_organization: "dispatch_organization",
  individual_dispatcher: "individual_dispatcher",
};

const WORKSPACE_SET_META: Record<WorkspaceKind, { label: string; description: string }> = {
  carrier_organization: {
    label: "Carrier organization documents",
    description:
      "What this carrier has to hold to haul for hire and to be onboarded by brokers.",
  },
  dispatch_organization: {
    label: "Dispatch organization documents",
    description:
      "What this dispatch company has to hold to contract with carriers. A dispatcher holds no operating authority, so carrier authority and cargo insurance are not asked for here.",
  },
  individual_dispatcher: {
    label: "Individual dispatch workspace documents",
    description:
      "What you have to hold to book freight as one person. This is your personal workspace, not a dispatch organization, and the two are never mixed.",
  },
};

/** Requirement keys are namespaced by set, so no two sets can ever collide. */
const WORKSPACE_KEY_PREFIX: Record<WorkspaceKind, string> = {
  carrier_organization: "carrier_org",
  dispatch_organization: "dispatch_org",
  individual_dispatcher: "solo_dispatch",
};

export function workspaceRequirementKey(kind: WorkspaceKind, typeKey: DocumentTypeKey): string {
  return `${WORKSPACE_KEY_PREFIX[kind]}:${typeKey}`;
}

/**
 * The checklist for one workspace.
 *
 * "not_applicable" rows are dropped here and never reach a caller: a dispatch
 * organization must not be shown a carrier's requirements even greyed out,
 * because a greyed-out row still reads as "something you are missing".
 */
export function workspaceRequirements(kind: WorkspaceKind): DocumentRequirement[] {
  const setId = WORKSPACE_SET_ID[kind];
  return WORKSPACE_DOCUMENT_MATRIX.flatMap((row) => {
    const rule = row[kind];
    if (rule.applicability === "not_applicable") return [];
    const meta = documentType(row.typeKey);
    return [{
      key: workspaceRequirementKey(kind, row.typeKey),
      setId,
      typeKey: row.typeKey,
      subjectKind: "organization" as const,
      label: rule.label ?? meta.label,
      description: meta.description,
      applicability: rule.applicability,
      expires: meta.expires,
      reason: rule.reason,
    }];
  });
}

export function workspaceRequirementSet(kind: WorkspaceKind): RequirementSet {
  return {
    id: WORKSPACE_SET_ID[kind],
    ...WORKSPACE_SET_META[kind],
    requirements: workspaceRequirements(kind),
  };
}

/** What a workspace type is explicitly NOT asked for. Used by the upgrade path. */
export function workspaceApplicability(
  kind: WorkspaceKind,
  typeKey: DocumentTypeKey,
): DocumentApplicability {
  const row = WORKSPACE_DOCUMENT_MATRIX.find((r) => r.typeKey === typeKey);
  return row ? row[kind].applicability : "not_applicable";
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The driver checklist, canonical at last.
 *
 * These keys are the ones the driver screens have always used, kept exactly so
 * a driver's existing paperwork is the same paperwork after unification — not a
 * migration, not a re-upload.
 */
interface DriverRow {
  key: string;
  typeKey: DocumentTypeKey;
  label: string;
  description: string;
  applicability: DocumentApplicability;
  expires: boolean;
  reason: string;
}

const DRIVER_ROWS: readonly DriverRow[] = [
  { key: "cdl_front", typeKey: "cdl", label: "Driver license / CDL — front", description: "A clear photo of the front of your licence. All four corners visible.", applicability: "required", expires: true, reason: "The carrier cannot put you on a truck without a licence on file." },
  { key: "cdl_back", typeKey: "cdl", label: "Driver license / CDL — back", description: "The back of the same licence.", applicability: "required", expires: false, reason: "Endorsements and restrictions are printed on the back." },
  { key: "medical_front", typeKey: "medical_card", label: "Medical card — front", description: "Your current DOT medical examiner's certificate.", applicability: "required", expires: true, reason: "A lapsed medical card puts the driver and the carrier out of service." },
  { key: "medical_back", typeKey: "medical_card", label: "Medical card — back", description: "The back of the medical card, if it has anything printed on it.", applicability: "optional", expires: false, reason: "Only some examiners print on the back." },
] as const;

const OWNER_OPERATOR_ROWS: readonly DriverRow[] = [
  { key: "business_info", typeKey: "business_registration", label: "Business information", description: "Your legal business name, structure and address.", applicability: "required", expires: false, reason: "You are contracting as a business, not as an employee." },
  { key: "w9", typeKey: "w9", label: "W-9", description: "So the carrier can pay you and report it correctly.", applicability: "required", expires: false, reason: "Settlement payments to a business have to be reported." },
  { key: "coi", typeKey: "certificate_of_insurance", label: "Certificate of Insurance", description: "Proof of your own coverage, with the carrier listed.", applicability: "required", expires: true, reason: "Your truck runs under their authority; their insurer needs yours named." },
  { key: "vehicle_registration", typeKey: "vehicle_registration", label: "Vehicle registration", description: "Registration for the truck you will run.", applicability: "required", expires: true, reason: "The carrier is responsible for the equipment it dispatches." },
  { key: "lease_agreement", typeKey: "lease_agreement", label: "Lease or operating agreement", description: "The agreement between you and this carrier.", applicability: "optional", expires: false, reason: "Required by some carriers before the first load, optional for others." },
] as const;

function toRequirement(row: DriverRow, setId: RequirementSetId): DocumentRequirement {
  return {
    key: row.key,
    setId,
    typeKey: row.typeKey,
    subjectKind: "driver",
    label: row.label,
    description: row.description,
    applicability: row.applicability,
    expires: row.expires,
    reason: row.reason,
  };
}

/**
 * A company driver and an owner-operator are asked for different things, and
 * the carrier decides which, not the driver.
 */
export function driverRequirements(engagement: EngagementType): DocumentRequirement[] {
  const base = DRIVER_ROWS.map((r) => toRequirement(r, "driver"));
  return engagement === "owner_operator"
    ? [...base, ...OWNER_OPERATOR_ROWS.map((r) => toRequirement(r, "owner_operator"))]
    : base;
}

/* -------------------------------------------------------------------------- */
/* Equipment                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Truck and trailer checklists come from the fleet module rather than being
 * restated here, so a change to what a reefer needs happens in exactly one
 * place. This converts them into the shared shape; it does not fork them.
 */
export function truckRequirementKey(kind: TruckDocumentKind): string {
  return `truck:${kind}`;
}

export function trailerRequirementKey(kind: TrailerDocumentKind): string {
  return `trailer:${kind}`;
}

const TRUCK_TYPE_KEYS: Record<TruckDocumentKind, DocumentTypeKey> = {
  registration: "vehicle_registration",
  title: "vehicle_title",
  insurance: "vehicle_insurance",
  annual_inspection: "annual_inspection",
  cab_card: "cab_card",
  lease_agreement: "lease_agreement",
  other: "other",
};

const TRAILER_TYPE_KEYS: Record<TrailerDocumentKind, DocumentTypeKey> = {
  registration: "vehicle_registration",
  title: "vehicle_title",
  insurance: "vehicle_insurance",
  annual_inspection: "annual_inspection",
  lease_agreement: "lease_agreement",
  reefer_service_record: "reefer_service_record",
  tarp_securement_inventory: "tarp_securement_inventory",
  other: "other",
};

export function truckDocumentTypeKey(kind: TruckDocumentKind): DocumentTypeKey {
  return TRUCK_TYPE_KEYS[kind];
}

export function trailerDocumentTypeKey(kind: TrailerDocumentKind): DocumentTypeKey {
  return TRAILER_TYPE_KEYS[kind];
}

export function truckRequirements(equipment: TruckEquipmentType): DocumentRequirement[] {
  return documentRequirementsFor(equipment).map((d) => ({
    key: truckRequirementKey(d.kind),
    setId: "truck" as const,
    typeKey: truckDocumentTypeKey(d.kind),
    subjectKind: "truck" as const,
    label: d.label,
    description: d.description,
    applicability: d.required ? ("required" as const) : ("optional" as const),
    expires: d.expires,
    reason: d.description,
  }));
}

export function trailerRequirements(type: TrailerType): DocumentRequirement[] {
  return trailerDocumentRequirementsFor(type).map((d) => ({
    key: trailerRequirementKey(d.kind),
    setId: "trailer" as const,
    typeKey: trailerDocumentTypeKey(d.kind),
    subjectKind: "trailer" as const,
    label: d.label,
    description: d.description,
    applicability: d.required ? ("required" as const) : ("optional" as const),
    expires: d.expires,
    reason: d.description,
  }));
}

/* -------------------------------------------------------------------------- */
/* Lookup                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every requirement that exists anywhere, by key.
 *
 * Equipment requirements are registered for every equipment type, so a lookup
 * by key works without knowing which truck it came from. Conditional ones stay
 * conditional where they are *listed*; this map is only for resolving a key
 * back to its label and type.
 */
const ALL_BY_KEY = new Map<string, DocumentRequirement>();

/** Written as a Record so adding an equipment type is a compile error until listed. */
const EVERY_TRUCK_EQUIPMENT: Record<TruckEquipmentType, true> = {
  cargo_van: true, sprinter_van: true, box_truck: true, hotshot: true, tractor: true,
};
const EVERY_TRAILER_TYPE: Record<TrailerType, true> = {
  dry_van: true, reefer: true, flatbed: true, step_deck: true,
  gooseneck: true, car_hauler: true, other: true,
};
const EVERY_WORKSPACE_KIND: Record<WorkspaceKind, true> = {
  carrier_organization: true, dispatch_organization: true, individual_dispatcher: true,
};

for (const kind of Object.keys(EVERY_WORKSPACE_KIND) as WorkspaceKind[]) {
  for (const r of workspaceRequirements(kind)) ALL_BY_KEY.set(r.key, r);
}
for (const r of driverRequirements("owner_operator")) ALL_BY_KEY.set(r.key, r);
for (const equipment of Object.keys(EVERY_TRUCK_EQUIPMENT) as TruckEquipmentType[]) {
  for (const r of truckRequirements(equipment)) ALL_BY_KEY.set(r.key, r);
}
for (const type of Object.keys(EVERY_TRAILER_TYPE) as TrailerType[]) {
  for (const r of trailerRequirements(type)) ALL_BY_KEY.set(r.key, r);
}

export function requirementByKey(key: string): DocumentRequirement | undefined {
  return ALL_BY_KEY.get(key);
}

export function requirementLabel(key: string, fallback: string): string {
  return ALL_BY_KEY.get(key)?.label ?? fallback;
}

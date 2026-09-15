import type {
  ComplianceRequirementDefinition, ComplianceRequirementKey,
} from "@/types";

/**
 * THE compliance requirement catalog.
 *
 * Adding a definition here is the only way a requirement can exist. Nothing
 * anywhere else invents one, and no screen hardcodes a label, a due interval or
 * a severity.
 *
 * Two rules every entry obeys:
 *
 *  1. `applicability` is declarative data, never a function. The rules have to
 *     be inspectable and testable, and eventually editable by a safety manager
 *     who is not going to write a predicate.
 *  2. `authority` says where the obligation comes from *in the operator's
 *     words*, and never implies that Antcolos checked it with anybody. Nothing
 *     in this build talks to FMCSA, the Clearinghouse, a state agency, an
 *     insurer, an ELD or any monitoring service. Every date below is a date
 *     somebody recorded in Antcolos.
 */

type Definition = ComplianceRequirementDefinition;

/* -------------------------------------------------------------------------- */
/* Carrier — organization-level                                                */
/* -------------------------------------------------------------------------- */

const CARRIER: Definition[] = [
  {
    key: "carrier.operating_authority_record",
    subjectKind: "carrier",
    label: "Operating authority on record",
    description:
      "The DOT and MC numbers this carrier runs under, recorded in Antcolos with a copy of the authority letter.",
    authority: "Carrier record — entered by the carrier, not verified by Antcolos",
    severity: "critical",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: {
      organizationTypes: ["CARRIER"],
      requiresOwnOperatingAuthority: true,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
    extensionPoints: ["audit_preparation"],
  },
  {
    key: "carrier.mcs150_biennial_update",
    subjectKind: "carrier",
    label: "Biennial carrier census update filed",
    description:
      "Record of the last biennial update of the carrier's census information, and when the next one falls due.",
    authority: "Federal filing the carrier makes itself — Antcolos records the date only",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 24, warnWithinDays: 60 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: {
      organizationTypes: ["CARRIER"],
      requiresOwnOperatingAuthority: true,
      interstateOnly: true,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
  {
    key: "carrier.ucr_registration",
    subjectKind: "carrier",
    label: "Unified Carrier Registration for the current year",
    description:
      "Proof that this year's UCR registration has been paid, for a carrier operating across state lines.",
    authority: "Annual state-administered registration — the carrier files it, Antcolos records it",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["document_center"],
    applicability: {
      organizationTypes: ["CARRIER"],
      requiresOwnOperatingAuthority: true,
      interstateOnly: true,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
  {
    key: "carrier.process_agent_designation",
    subjectKind: "carrier",
    label: "Process agent designation on file",
    description:
      "The designation of process agents for every state the carrier operates in.",
    authority: "One-time federal filing — Antcolos holds the carrier's copy",
    severity: "medium",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["document_center"],
    applicability: {
      organizationTypes: ["CARRIER"],
      requiresOwnOperatingAuthority: true,
      interstateOnly: true,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
  {
    key: "carrier.bipd_insurance",
    subjectKind: "carrier",
    label: "Public liability insurance in force",
    description:
      "Current bodily injury and property damage coverage for the whole operation, with the certificate on file.",
    authority: "Insurance the carrier buys — Antcolos holds the certificate the carrier uploaded",
    severity: "critical",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["document_center"],
    applicability: {
      organizationTypes: ["CARRIER"],
      requiresOwnOperatingAuthority: true,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
    extensionPoints: ["insurance_claim"],
  },
  {
    key: "carrier.cargo_insurance",
    subjectKind: "carrier",
    label: "Cargo insurance in force",
    description:
      "Current cargo coverage, with the certificate brokers ask for on file.",
    authority: "Insurance the carrier buys — Antcolos holds the certificate the carrier uploaded",
    severity: "high",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["document_center"],
    applicability: { organizationTypes: ["CARRIER"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
    extensionPoints: ["insurance_claim"],
  },
  {
    key: "carrier.workers_compensation",
    subjectKind: "carrier",
    label: "Workers' compensation coverage recorded",
    description:
      "Coverage, or a recorded exemption, for the people this carrier employs.",
    authority: "State requirement that varies by state — Antcolos records what the carrier holds",
    severity: "high",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: { organizationTypes: ["CARRIER"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
  {
    key: "carrier.drug_alcohol_program",
    subjectKind: "carrier",
    label: "Drug and alcohol testing programme on file",
    description:
      "The written testing policy and the consortium or administrator the carrier uses.",
    authority: "Carrier's own programme — Antcolos is not connected to the Clearinghouse or any testing provider",
    severity: "critical",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: {
      organizationTypes: ["CARRIER"],
      requiresOwnOperatingAuthority: true,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
    extensionPoints: ["audit_preparation"],
  },
  {
    key: "carrier.driver_qualification_policy",
    subjectKind: "carrier",
    label: "Driver qualification file policy",
    description:
      "The written rule for what goes into every driver's qualification file, and who keeps it current.",
    authority: "Carrier policy",
    severity: "medium",
    renewal: { basis: "fixed_interval", intervalMonths: 24, warnWithinDays: 60 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: { organizationTypes: ["CARRIER"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
    extensionPoints: ["audit_preparation"],
  },
  {
    key: "carrier.accident_register",
    subjectKind: "carrier",
    label: "Accident register maintained",
    description:
      "A register of recordable accidents, kept for the retention period the carrier operates under.",
    authority: "Carrier record-keeping obligation",
    severity: "medium",
    // Driven by accidents, which are a later milestone. Nothing computes a due
    // date from this basis today; the requirement is tracked, not scheduled.
    renewal: { basis: "event_driven", warnWithinDays: 30 },
    satisfiedBy: ["recorded_attestation"],
    applicability: { organizationTypes: ["CARRIER"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
    extensionPoints: ["accident", "audit_preparation"],
  },
];

/* -------------------------------------------------------------------------- */
/* Dispatch organization — organization-level                                  */
/* -------------------------------------------------------------------------- */

/**
 * A dispatch organization is a service provider, not a motor carrier. It has no
 * operating authority, no equipment and no drivers, so none of the carrier
 * requirements above reach it — which is exactly the "do not show irrelevant
 * requirements" rule doing its job rather than a gap.
 */
const DISPATCH: Definition[] = [
  {
    key: "dispatch.carrier_service_agreement",
    subjectKind: "carrier",
    label: "Signed dispatch service agreement",
    description:
      "A current signed agreement with every carrier this organization dispatches for.",
    authority: "Commercial agreement between the two organizations",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 30 },
    satisfiedBy: ["document_center"],
    applicability: { organizationTypes: ["DISPATCH_AGENCY"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
  {
    key: "dispatch.errors_omissions_insurance",
    subjectKind: "carrier",
    label: "Errors and omissions coverage in force",
    description:
      "Professional liability coverage for the dispatch service itself.",
    authority: "Insurance the dispatch organization buys — Antcolos holds the certificate it uploaded",
    severity: "medium",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["document_center"],
    applicability: { organizationTypes: ["DISPATCH_AGENCY"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
  {
    key: "dispatch.w9_on_file",
    subjectKind: "carrier",
    label: "W-9 on file",
    description: "So the carriers this organization works for can pay it and report it.",
    authority: "Tax paperwork between the two organizations",
    severity: "low",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["document_center"],
    applicability: { organizationTypes: ["DISPATCH_AGENCY"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view"],
  },
];

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

const DRIVER: Definition[] = [
  {
    key: "driver.commercial_licence",
    subjectKind: "driver",
    label: "Driving licence current",
    description:
      "The licence the driver runs on, current and on file with the carrier.",
    authority: "State licence — Antcolos reads the expiry the driver supplied, and checks it with nobody",
    severity: "critical",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["driver_document"],
    applicability: {},
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.medical_certificate",
    subjectKind: "driver",
    label: "Medical examiner's certificate current",
    description:
      "The DOT medical card, current and on file. A driver cannot be dispatched once it lapses.",
    authority: "Medical examiner's certificate — Antcolos records the expiry the driver supplied",
    severity: "critical",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["driver_document"],
    applicability: {},
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.employment_application",
    subjectKind: "driver",
    label: "Driver application on file",
    description:
      "The completed application covering the driver's employment history.",
    authority: "Driver qualification file — carrier record-keeping",
    severity: "medium",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["driver_document", "document_center"],
    applicability: {},
    defaultResponsibility: "membership",
    requires: ["compliance:view", "drivers:view"],
    extensionPoints: ["audit_preparation"],
  },
  {
    key: "driver.motor_vehicle_record_review",
    subjectKind: "driver",
    label: "Annual driving record review",
    description:
      "The yearly review of the driver's motor vehicle record, signed by whoever did it.",
    authority: "Carrier's annual review — Antcolos does not pull records from any state agency",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: {},
    defaultResponsibility: "membership",
    requires: ["compliance:view", "drivers:view"],
    extensionPoints: ["violation", "audit_preparation"],
  },
  {
    key: "driver.road_test_certificate",
    subjectKind: "driver",
    label: "Road test or equivalent on file",
    description:
      "The road test certificate, or the accepted equivalent the carrier recorded instead.",
    authority: "Driver qualification file — carrier record-keeping",
    severity: "medium",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["driver_document", "document_center"],
    applicability: {},
    defaultResponsibility: "membership",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.pre_employment_drug_test",
    subjectKind: "driver",
    label: "Pre-employment drug test result recorded",
    description:
      "The result the carrier received before the driver's first dispatch.",
    authority: "Carrier's testing programme — Antcolos is not connected to any testing provider or the Clearinghouse",
    severity: "critical",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: {},
    defaultResponsibility: "membership",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.clearinghouse_query_record",
    subjectKind: "driver",
    label: "Annual query record on file",
    description:
      "The carrier's record of the annual query it ran, and the driver's consent for it.",
    authority: "Query the carrier runs itself — Antcolos holds the carrier's record of it and is not connected to the Clearinghouse",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["document_center", "recorded_attestation"],
    applicability: {},
    defaultResponsibility: "membership",
    requires: ["compliance:view", "drivers:view"],
    extensionPoints: ["audit_preparation"],
  },
  {
    key: "driver.hazmat_endorsement",
    subjectKind: "driver",
    label: "Hazmat endorsement current",
    description:
      "Only for drivers running placarded loads for this carrier.",
    authority: "Licence endorsement — Antcolos records the expiry the driver supplied",
    severity: "critical",
    renewal: { basis: "document_expiry", warnWithinDays: 60 },
    satisfiedBy: ["driver_document"],
    applicability: { requiresHazmat: true },
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.handbook_acknowledgement",
    subjectKind: "driver",
    label: "Signed carrier handbook",
    description:
      "The carrier's own handbook, signed. Company drivers only — an owner-operator runs under an agreement instead.",
    authority: "Carrier policy",
    severity: "low",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["driver_document"],
    applicability: { engagementTypes: ["company_driver"] },
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.owner_operator_agreement",
    subjectKind: "driver",
    label: "Owner-operator lease agreement signed",
    description:
      "The agreement between the carrier and the owner-operator. Not asked of a company driver.",
    authority: "Agreement between the two parties",
    severity: "high",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["driver_document", "document_center"],
    applicability: { engagementTypes: ["owner_operator"] },
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.owner_operator_w9",
    subjectKind: "driver",
    label: "Owner-operator W-9 on file",
    description: "So the carrier can pay the owner-operator and report it correctly.",
    authority: "Tax paperwork between the two parties",
    severity: "medium",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["driver_document"],
    applicability: { engagementTypes: ["owner_operator"] },
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
  },
  {
    key: "driver.owner_operator_insurance",
    subjectKind: "driver",
    label: "Owner-operator's own coverage in force",
    description:
      "The owner-operator's certificate of insurance with this carrier listed.",
    authority: "Insurance the owner-operator buys — Antcolos holds the certificate they uploaded",
    severity: "high",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["driver_document"],
    applicability: { engagementTypes: ["owner_operator"] },
    defaultResponsibility: "driver",
    requires: ["compliance:view", "drivers:view"],
    extensionPoints: ["insurance_claim"],
  },
];

/* -------------------------------------------------------------------------- */
/* Truck                                                                       */
/* -------------------------------------------------------------------------- */

const TRUCK: Definition[] = [
  {
    key: "truck.registration",
    subjectKind: "truck",
    label: "Registration current",
    description: "The cab card or registration for this power unit, current and on file.",
    authority: "State registration — Antcolos records the expiry from the document",
    severity: "critical",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["truck_document"],
    applicability: {},
    defaultResponsibility: "equipment_owner",
    requires: ["compliance:view", "trucks:view"],
  },
  {
    key: "truck.annual_inspection",
    subjectKind: "truck",
    label: "Annual inspection current",
    description:
      "The last annual inspection report for this power unit, and when the next is due.",
    authority: "Annual inspection the carrier arranges — Antcolos records the date and the report",
    severity: "critical",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["truck_document"],
    applicability: {},
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
    extensionPoints: ["roadside_inspection", "violation"],
  },
  {
    key: "truck.insurance_evidence",
    subjectKind: "truck",
    label: "Insurance evidence for this relationship",
    description:
      "The coverage evidence this carrier holds for this truck. Per relationship — it is never shared with another carrier onboarded on the same truck.",
    authority: "Insurance the carrier or the owner buys — Antcolos holds the evidence uploaded against this relationship",
    severity: "critical",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["truck_document"],
    applicability: {},
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
    extensionPoints: ["insurance_claim"],
  },
  {
    key: "truck.lease_agreement",
    subjectKind: "truck",
    label: "Lease agreement on file",
    description:
      "The agreement letting this carrier run a truck it does not own. Not asked for a carrier-owned truck.",
    authority: "Agreement between the carrier and the owner",
    severity: "high",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["truck_document"],
    applicability: { carrierRelationshipTypes: ["leased_owner_operator"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
  },
  {
    key: "truck.ifta_credentials",
    subjectKind: "truck",
    label: "Fuel tax credentials current",
    description:
      "This year's IFTA licence and decals for a qualified vehicle crossing state lines.",
    authority: "Credentials the carrier files for — Antcolos records the year and the document",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["truck_document", "document_center"],
    applicability: {
      interstateOnly: true,
      truckEquipmentTypes: ["tractor", "box_truck"],
      minGrossWeightPounds: 26001,
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
  },
  {
    key: "truck.heavy_vehicle_use_tax",
    subjectKind: "truck",
    label: "Heavy vehicle use tax receipt on file",
    description:
      "The stamped return for a vehicle at or above 55,000 lb gross weight. Light units never see this.",
    authority: "Federal return the carrier files — Antcolos holds the receipt it uploaded",
    severity: "medium",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["truck_document", "document_center"],
    applicability: { minGrossWeightPounds: 55000 },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
  },
  {
    key: "truck.eld_device_record",
    subjectKind: "truck",
    label: "Electronic logging device recorded",
    description:
      "Which device is fitted to this truck, and its registration details, recorded by the carrier.",
    authority:
      "A record the carrier keeps. Antcolos is NOT connected to any ELD and reads no logs — see the hours-of-service extension point.",
    severity: "high",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["recorded_attestation"],
    applicability: {
      interstateOnly: true,
      truckEquipmentTypes: ["tractor", "box_truck"],
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
    extensionPoints: ["hours_of_service"],
  },
  {
    key: "truck.periodic_maintenance_record",
    subjectKind: "truck",
    label: "Periodic maintenance recorded",
    description:
      "The systematic maintenance record for this power unit, kept on the carrier's own interval.",
    authority: "Carrier maintenance programme",
    severity: "medium",
    renewal: { basis: "fixed_interval", intervalMonths: 6, warnWithinDays: 30 },
    satisfiedBy: ["truck_document", "recorded_attestation"],
    applicability: {},
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trucks:view"],
    extensionPoints: ["roadside_inspection"],
  },
];

/* -------------------------------------------------------------------------- */
/* Trailer                                                                     */
/* -------------------------------------------------------------------------- */

const TRAILER: Definition[] = [
  {
    key: "trailer.registration",
    subjectKind: "trailer",
    label: "Registration current",
    description: "The registration for this trailer, current and on file.",
    authority: "State registration — Antcolos records the expiry from the document",
    severity: "high",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["trailer_document"],
    applicability: {},
    defaultResponsibility: "equipment_owner",
    requires: ["compliance:view", "trailers:view"],
  },
  {
    key: "trailer.annual_inspection",
    subjectKind: "trailer",
    label: "Annual inspection current",
    description: "The last annual inspection for this trailer, and when the next is due.",
    authority: "Annual inspection the carrier arranges — Antcolos records the date and the report",
    severity: "critical",
    renewal: { basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45 },
    satisfiedBy: ["trailer_document"],
    applicability: {},
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trailers:view"],
    extensionPoints: ["roadside_inspection", "violation"],
  },
  {
    key: "trailer.insurance_evidence",
    subjectKind: "trailer",
    label: "Insurance evidence for this relationship",
    description:
      "The coverage evidence this carrier holds for this trailer. Per relationship, never shared with another carrier.",
    authority: "Insurance the carrier or owner buys — Antcolos holds the evidence uploaded against this relationship",
    severity: "high",
    renewal: { basis: "document_expiry", warnWithinDays: 45 },
    satisfiedBy: ["trailer_document"],
    applicability: {},
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trailers:view"],
    extensionPoints: ["insurance_claim"],
  },
  {
    key: "trailer.lease_agreement",
    subjectKind: "trailer",
    label: "Lease agreement on file",
    description:
      "The agreement letting this carrier run a trailer it does not own. Not asked for a carrier-owned trailer.",
    authority: "Agreement between the carrier and the owner",
    severity: "medium",
    renewal: { basis: "none", warnWithinDays: 0 },
    satisfiedBy: ["trailer_document"],
    applicability: { carrierRelationshipTypes: ["leased_owner_operator"] },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trailers:view"],
  },
  {
    key: "trailer.reefer_unit_service_record",
    subjectKind: "trailer",
    label: "Refrigeration unit service record",
    description:
      "Service history for the reefer unit, on the carrier's own interval. Only trailers that actually carry a unit are asked.",
    authority: "Carrier maintenance programme",
    severity: "high",
    renewal: { basis: "fixed_interval", intervalMonths: 6, warnWithinDays: 30 },
    satisfiedBy: ["trailer_document", "recorded_attestation"],
    applicability: { requiresReeferUnit: true },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trailers:view"],
  },
  {
    key: "trailer.securement_equipment_inventory",
    subjectKind: "trailer",
    label: "Securement equipment inventory",
    description:
      "Straps, chains and binders counted and inspected. Open-deck equipment only — a dry van carries none of it.",
    authority: "Carrier maintenance programme",
    severity: "medium",
    renewal: { basis: "fixed_interval", intervalMonths: 3, warnWithinDays: 21 },
    satisfiedBy: ["recorded_attestation"],
    applicability: {
      trailerTypes: ["flatbed", "step_deck", "gooseneck", "car_hauler"],
    },
    defaultResponsibility: "organization",
    requires: ["compliance:view", "trailers:view"],
    extensionPoints: ["roadside_inspection"],
  },
];

export const COMPLIANCE_CATALOG: readonly ComplianceRequirementDefinition[] = [
  ...CARRIER, ...DISPATCH, ...DRIVER, ...TRUCK, ...TRAILER,
];

const BY_KEY = new Map<ComplianceRequirementKey, ComplianceRequirementDefinition>(
  COMPLIANCE_CATALOG.map((d) => [d.key, d]),
);

export function requirementDefinition(
  key: ComplianceRequirementKey,
): ComplianceRequirementDefinition {
  const found = BY_KEY.get(key);
  // A key that is not in the catalog cannot exist: the union makes it a compile
  // error, and this guard catches data that came in from outside the type.
  if (!found) throw new Error(`Unknown compliance requirement: ${key}`);
  return found;
}

export function definitionsForSubjectKind(
  kind: ComplianceRequirementDefinition["subjectKind"],
): ComplianceRequirementDefinition[] {
  return COMPLIANCE_CATALOG.filter((d) => d.subjectKind === kind);
}

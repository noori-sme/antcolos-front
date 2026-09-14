import type { ComplianceExtensionPoint } from "@/types";

/**
 * The seams later milestones land in.
 *
 * Inspections, violations, accidents, claims, hours-of-service and CSA/SMS
 * monitoring are NOT built, and full audit preparation is not built. They are
 * declared here so that when they are built they extend this module instead of
 * growing a second compliance system beside it.
 *
 * `available` is `false` on every entry, and the compliance screens render them
 * as "not built yet" rather than as empty data. Nothing reads a record of these
 * kinds, because no record of these kinds exists.
 */
export const COMPLIANCE_EXTENSION_POINTS: readonly ComplianceExtensionPoint[] = [
  {
    kind: "roadside_inspection",
    label: "Roadside inspections",
    description:
      "Inspection reports, their levels and their outcomes, attached to the equipment and the driver they concern.",
    available: false,
    attachesTo: [
      "truck.annual_inspection",
      "truck.periodic_maintenance_record",
      "trailer.annual_inspection",
      "trailer.securement_equipment_inventory",
    ],
    subjectKinds: ["truck", "trailer", "driver"],
  },
  {
    kind: "violation",
    label: "Violations",
    description:
      "Violations recorded against a driver or a unit, and what was done about each one.",
    available: false,
    attachesTo: [
      "driver.motor_vehicle_record_review",
      "truck.annual_inspection",
      "trailer.annual_inspection",
    ],
    subjectKinds: ["driver", "truck", "trailer"],
  },
  {
    kind: "accident",
    label: "Accidents",
    description:
      "The accident register as real records rather than a requirement to keep one.",
    available: false,
    attachesTo: ["carrier.accident_register"],
    subjectKinds: ["carrier", "driver", "truck", "trailer"],
  },
  {
    kind: "insurance_claim",
    label: "Insurance claims",
    description: "Claims made against the policies compliance already tracks.",
    available: false,
    attachesTo: [
      "carrier.bipd_insurance",
      "carrier.cargo_insurance",
      "truck.insurance_evidence",
      "trailer.insurance_evidence",
      "driver.owner_operator_insurance",
    ],
    subjectKinds: ["carrier", "truck", "trailer", "driver"],
  },
  {
    kind: "hours_of_service",
    label: "Hours-of-service monitoring",
    description:
      "Duty status and available hours. Antcolos is not connected to any ELD today and reads no logs.",
    available: false,
    attachesTo: ["truck.eld_device_record"],
    subjectKinds: ["driver", "truck"],
  },
  {
    kind: "csa_sms_monitoring",
    label: "CSA and SMS monitoring",
    description:
      "Safety measurement scores and BASIC percentiles. Antcolos is not connected to any federal system.",
    available: false,
    attachesTo: ["carrier.operating_authority_record"],
    subjectKinds: ["carrier"],
  },
  {
    kind: "audit_preparation",
    label: "Audit preparation",
    description:
      "Assembling the evidence pack an audit asks for, from the requirements tracked here.",
    available: false,
    attachesTo: [
      "carrier.drug_alcohol_program",
      "carrier.driver_qualification_policy",
      "carrier.accident_register",
      "driver.employment_application",
      "driver.motor_vehicle_record_review",
      "driver.clearinghouse_query_record",
    ],
    subjectKinds: ["carrier", "driver"],
  },
];

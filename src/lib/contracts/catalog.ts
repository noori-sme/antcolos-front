import type {
  AgreementType, CompensationKind, ContractPartyRole, DocumentTypeKey,
  RelationshipRefKind, ResponsibilityArea, TerminationStepKey,
} from "@/types";

/**
 * THE agreement-type catalog.
 *
 * One entry per kind of business relationship Antcolos can paper. Adding an
 * entry here is what makes a type appear in the new-contract form, the
 * dashboard groupings and the requirement seeds — there is nowhere else to
 * register one.
 *
 * Every entry states, explicitly, which canonical relationships it may
 * REFERENCE. That list is the reason the catalog is data rather than a union of
 * strings: a carrier–driver agreement must not be able to reference an
 * Operating Authority lease, because a contract that can point at an authority
 * lease is one release away from looking like it controls the authority. The
 * service layer refuses a reference the catalog does not allow.
 */

export interface AgreementTypeMeta {
  type: AgreementType;
  label: string;
  /** Written for a carrier owner, not an engineer. */
  description: string;
  /**
   * The two roles the agreement is between. The first is the party that
   * normally owns the record; both must exist before a version can be issued.
   */
  partyRoles: [ContractPartyRole, ContractPartyRole];
  /**
   * Which canonical relationship kinds a contract of this type may point at.
   *
   * Empty would mean "papers nothing", which no supported type does.
   */
  allowedRelationshipKinds: readonly RelationshipRefKind[];
  /** Compensation shapes that make sense here. The form offers only these. */
  allowedCompensationKinds: readonly CompensationKind[];
  /** Responsibility areas the parties are normally asked to divide. */
  responsibilityAreas: readonly ResponsibilityArea[];
  /** Documents this kind of agreement usually asks for, and of whom. */
  documentTerms: readonly {
    documentTypeKey: DocumentTypeKey;
    owedByRole: ContractPartyRole;
    reason: string;
    blocking: boolean;
  }[];
  /** Closeout steps a termination of this type normally owes. */
  closeoutSteps: readonly { key: TerminationStepKey; owedByRole: ContractPartyRole }[];
  /**
   * True when the counterparty is a person signing for themselves rather than
   * an organization signing through an owner. It decides which signer
   * authorities are offered, and nothing else.
   */
  counterpartySignsForSelf: boolean;
}

export const AGREEMENT_TYPE_CATALOG: readonly AgreementTypeMeta[] = [
  {
    type: "carrier_driver",
    label: "Carrier – company driver",
    description:
      "A carrier engaging a driver it employs. The carrier's equipment, the carrier's authority, the driver's licence and medical card.",
    partyRoles: ["carrier", "driver"],
    // A company driver's paperwork papers their engagement and their access.
    // It may NOT reference an operating lease: a company driver does not bring
    // authority, and the truck's authority is the truck registry's business.
    allowedRelationshipKinds: [
      "invitation", "membership", "driver_carrier_relationship",
    ],
    allowedCompensationKinds: [
      "percentage_of_revenue", "rate_per_loaded_mile", "rate_per_all_mile",
      "flat_per_period", "flat_per_load", "hourly", "deduction", "accessorial", "other",
    ],
    responsibilityAreas: ["fuel", "maintenance", "compliance", "paperwork", "claims", "other"],
    documentTerms: [
      { documentTypeKey: "cdl", owedByRole: "driver", reason: "The carrier must hold the licence of every driver it dispatches.", blocking: true },
      { documentTypeKey: "medical_card", owedByRole: "driver", reason: "A current DOT medical certificate is required to drive.", blocking: true },
      { documentTypeKey: "employment_application", owedByRole: "driver", reason: "The DOT application covering the last three years of employment.", blocking: false },
      { documentTypeKey: "signed_handbook", owedByRole: "driver", reason: "The company handbook, signed by the driver it applies to.", blocking: false },
      { documentTypeKey: "mvr", owedByRole: "carrier", reason: "The carrier pulls the driving record from the licensing state.", blocking: false },
    ],
    closeoutSteps: [
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "return_equipment", owedByRole: "driver" },
      { key: "revoke_access", owedByRole: "carrier" },
      { key: "end_relationship", owedByRole: "carrier" },
    ],
    counterpartySignsForSelf: true,
  },
  {
    type: "carrier_owner_operator",
    label: "Carrier – owner-operator",
    description:
      "A carrier engaging a driver who brings their own truck. Two things at once: the person's engagement and the equipment they run under the carrier's authority.",
    partyRoles: ["carrier", "owner_operator"],
    // The one driver-side type that may reference equipment and authority,
    // because an owner-operator genuinely brings both. Still only a reference.
    allowedRelationshipKinds: [
      "invitation", "membership", "driver_carrier_relationship",
      "truck_carrier_relationship", "trailer_carrier_relationship",
      "truck_operating_lease", "trailer_operating_lease",
    ],
    allowedCompensationKinds: [
      "percentage_of_revenue", "rate_per_loaded_mile", "rate_per_all_mile",
      "flat_per_load", "deduction", "accessorial", "other",
    ],
    responsibilityAreas: [
      "fuel", "maintenance", "insurance", "tolls", "permits", "trailer",
      "compliance", "paperwork", "claims", "taxes", "other",
    ],
    documentTerms: [
      { documentTypeKey: "cdl", owedByRole: "owner_operator", reason: "The carrier must hold the licence of every driver it dispatches.", blocking: true },
      { documentTypeKey: "medical_card", owedByRole: "owner_operator", reason: "A current DOT medical certificate is required to drive.", blocking: true },
      { documentTypeKey: "w9", owedByRole: "owner_operator", reason: "An owner-operator is paid as a business and reported as one.", blocking: true },
      { documentTypeKey: "certificate_of_insurance", owedByRole: "owner_operator", reason: "Coverage naming the carrier, for the equipment being run.", blocking: true },
      { documentTypeKey: "vehicle_registration", owedByRole: "owner_operator", reason: "Current registration for the unit being leased on.", blocking: true },
      { documentTypeKey: "lease_agreement", owedByRole: "carrier", reason: "The equipment lease covering the unit run under the carrier's authority.", blocking: false },
    ],
    closeoutSteps: [
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "release_operating_authority", owedByRole: "carrier" },
      { key: "return_equipment", owedByRole: "carrier" },
      { key: "revoke_access", owedByRole: "carrier" },
      { key: "end_relationship", owedByRole: "carrier" },
    ],
    counterpartySignsForSelf: true,
  },
  {
    type: "carrier_dispatch_organization",
    label: "Carrier – dispatch organization",
    description:
      "A carrier retaining a dispatch company to find and book its freight. The dispatcher gets access to named trucks and nothing else.",
    partyRoles: ["carrier", "dispatch_organization"],
    allowedRelationshipKinds: [
      "invitation", "membership", "truck_dispatch_access",
    ],
    allowedCompensationKinds: [
      "percentage_of_revenue", "flat_per_period", "flat_per_load", "other",
    ],
    responsibilityAreas: ["dispatch", "paperwork", "compliance", "insurance", "other"],
    documentTerms: [
      { documentTypeKey: "dispatch_service_agreement", owedByRole: "dispatch_organization", reason: "The service agreement between the dispatcher and the carrier.", blocking: true },
      { documentTypeKey: "w9", owedByRole: "dispatch_organization", reason: "The dispatch organization is paid as a business.", blocking: true },
      { documentTypeKey: "business_registration", owedByRole: "dispatch_organization", reason: "Proof the dispatch organization is a registered company.", blocking: false },
      { documentTypeKey: "errors_omissions_insurance", owedByRole: "dispatch_organization", reason: "Professional liability coverage for dispatch work.", blocking: false },
      { documentTypeKey: "certificate_of_insurance", owedByRole: "carrier", reason: "The carrier's coverage, so the dispatcher can answer broker packets.", blocking: false },
    ],
    closeoutSteps: [
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "return_documents", owedByRole: "dispatch_organization" },
      // Dispatch access is ended in the truck registry, which is what
      // `end_relationship` names. `revoke_access` is the membership side.
      { key: "revoke_access", owedByRole: "carrier" },
      { key: "end_relationship", owedByRole: "carrier" },
    ],
    counterpartySignsForSelf: false,
  },
  {
    type: "carrier_individual_dispatcher",
    label: "Carrier – individual dispatcher",
    description:
      "A carrier retaining one self-employed dispatcher, with no company behind them. A different workspace shape from a dispatch organization, and different paperwork.",
    partyRoles: ["carrier", "individual_dispatcher"],
    allowedRelationshipKinds: [
      "invitation", "membership", "truck_dispatch_access",
    ],
    allowedCompensationKinds: [
      "percentage_of_revenue", "flat_per_period", "flat_per_load", "hourly", "other",
    ],
    responsibilityAreas: ["dispatch", "paperwork", "compliance", "other"],
    documentTerms: [
      { documentTypeKey: "dispatch_service_agreement", owedByRole: "individual_dispatcher", reason: "The service agreement between the dispatcher and the carrier.", blocking: true },
      { documentTypeKey: "w9", owedByRole: "individual_dispatcher", reason: "An individual dispatcher is paid and reported as a contractor.", blocking: true },
      { documentTypeKey: "government_id", owedByRole: "individual_dispatcher", reason: "Identity for the person behind the workspace. A company registration does not exist here.", blocking: false },
    ],
    closeoutSteps: [
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "return_documents", owedByRole: "individual_dispatcher" },
      { key: "revoke_access", owedByRole: "carrier" },
    ],
    counterpartySignsForSelf: true,
  },
  {
    type: "equipment_lease",
    label: "Equipment lease",
    description:
      "An owner leasing a truck or trailer to a carrier. The terms of the lease only — the equipment record, its UUID and its ownership history are untouched.",
    partyRoles: ["carrier", "equipment_owner"],
    allowedRelationshipKinds: [
      "truck_carrier_relationship", "trailer_carrier_relationship",
    ],
    allowedCompensationKinds: [
      "flat_per_period", "rate_per_all_mile", "rate_per_loaded_mile",
      "percentage_of_revenue", "deduction", "other",
    ],
    responsibilityAreas: ["maintenance", "insurance", "permits", "taxes", "trailer", "other"],
    documentTerms: [
      { documentTypeKey: "lease_agreement", owedByRole: "equipment_owner", reason: "The lease covering the unit.", blocking: true },
      { documentTypeKey: "vehicle_title", owedByRole: "equipment_owner", reason: "Proof of legal ownership of the unit being leased.", blocking: true },
      { documentTypeKey: "vehicle_registration", owedByRole: "equipment_owner", reason: "Current registration for the unit.", blocking: true },
      { documentTypeKey: "vehicle_insurance", owedByRole: "carrier", reason: "Coverage naming the unit while the carrier runs it.", blocking: false },
    ],
    closeoutSteps: [
      { key: "return_equipment", owedByRole: "carrier" },
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "end_relationship", owedByRole: "carrier" },
    ],
    counterpartySignsForSelf: false,
  },
  {
    type: "operating_authority_lease",
    label: "Operating Authority lease terms",
    description:
      "What two carriers agreed about running an asset under one of their authorities. Whether it may legally run is the Operating Authority lease's answer, not this record's.",
    partyRoles: ["carrier", "carrier"],
    allowedRelationshipKinds: [
      "truck_operating_lease", "trailer_operating_lease",
      "truck_carrier_relationship", "trailer_carrier_relationship",
    ],
    allowedCompensationKinds: [
      "percentage_of_revenue", "flat_per_period", "flat_per_load", "deduction", "other",
    ],
    responsibilityAreas: ["insurance", "compliance", "permits", "maintenance", "claims", "other"],
    documentTerms: [
      { documentTypeKey: "lease_agreement", owedByRole: "carrier", reason: "The written lease the authority is run under.", blocking: true },
      { documentTypeKey: "operating_authority", owedByRole: "carrier", reason: "The authority letter of the carrier whose authority is used.", blocking: true },
      { documentTypeKey: "certificate_of_insurance", owedByRole: "carrier", reason: "Coverage in force for the period of the lease.", blocking: true },
    ],
    closeoutSteps: [
      { key: "release_operating_authority", owedByRole: "carrier" },
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "end_relationship", owedByRole: "carrier" },
    ],
    counterpartySignsForSelf: false,
  },
  {
    type: "other_business_relationship",
    label: "Other business relationship",
    description:
      "Any other agreement between this organization and somebody else, named by the parties. No relationship is assumed and none may be referenced until somebody says which.",
    partyRoles: ["carrier", "other"],
    // Nothing is assumed: an "other" agreement may reference a membership or an
    // invitation, which are the two relationships any organization can have
    // with anybody. Equipment, authority and dispatch access need a type that
    // says so.
    allowedRelationshipKinds: ["invitation", "membership"],
    allowedCompensationKinds: [
      "flat_per_period", "flat_per_load", "hourly", "percentage_of_revenue",
      "deduction", "accessorial", "other",
    ],
    responsibilityAreas: ["paperwork", "compliance", "other"],
    documentTerms: [],
    closeoutSteps: [
      { key: "final_settlement", owedByRole: "carrier" },
      { key: "other", owedByRole: "other" },
    ],
    counterpartySignsForSelf: false,
  },
] as const;

const BY_TYPE = new Map(AGREEMENT_TYPE_CATALOG.map((m) => [m.type, m]));

export function agreementTypeMeta(type: AgreementType): AgreementTypeMeta {
  const meta = BY_TYPE.get(type);
  if (!meta) throw new Error(`Unknown agreement type: ${type}`);
  return meta;
}

export function agreementTypeLabel(type: AgreementType): string {
  return agreementTypeMeta(type).label;
}

/** The counterparty role for an agreement type — the side that is not us. */
export function counterpartyRole(type: AgreementType): ContractPartyRole {
  return agreementTypeMeta(type).partyRoles[1];
}

/**
 * Whether a contract of this type may point at this kind of relationship.
 *
 * The service layer calls this before attaching any reference. Refusing here is
 * what stops a driver agreement from acquiring an authority lease reference and
 * then looking, on a screen, as though it governs one.
 */
export function relationshipKindAllowed(
  type: AgreementType,
  kind: RelationshipRefKind,
): boolean {
  return agreementTypeMeta(type).allowedRelationshipKinds.includes(kind);
}

export function compensationKindAllowed(
  type: AgreementType,
  kind: CompensationKind,
): boolean {
  return agreementTypeMeta(type).allowedCompensationKinds.includes(kind);
}

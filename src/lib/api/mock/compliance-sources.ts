import {
  CARRIER_DRIVERS_ORGANIZATION_ID, carrierDriversSync, type CarrierDriver,
} from "@/features/driver/mock-carrier-drivers";
import {
  driverDocumentsSync, driverProfileSync, driverRelationshipsSync,
} from "@/features/driver/mock-driver";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import type {
  ComplianceEvidenceRef, ComplianceEvidenceState, ComplianceRequirementKey,
  ComplianceResponsibleParty, ComplianceSubjectContext, ComplianceSubjectRef,
  Document, DocumentLifecycleStatus, DocumentStatus, Organization,
  OperatingAuthorityProfile, VerificationState,
} from "@/types";
import { ORG_DOCUMENT_IDS } from "./seed";
import { mockStore } from "./store";
import {
  truckDocumentsFor, truckOwnerName, truckRecord, truckRelationshipsFor,
} from "./truck-registry";
import {
  trailerDocumentsFor, trailerOwnerName, trailerRecord, trailerRelationshipsFor,
} from "./trailer-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Where compliance subjects come from.
 *
 * Compliance owns no people, no equipment, no organizations and no documents.
 * This file is the adapter that reads the systems that DO own them — the
 * organization record, the driver relationships, the truck registry, the
 * trailer registry and the Document Center — and turns them into the facts a
 * requirement's applicability rule is allowed to branch on.
 *
 * Two consequences that matter, and are the point of doing it this way:
 *
 *  - Nothing here invents a driver, a truck, a trailer or a document. End a
 *    relationship in the system that owns it and the subject stops being live
 *    here on the next read, with no compliance-side bookkeeping.
 *  - Evidence is a POINTER. A requirement points at the document another system
 *    holds; it never copies the file, and it survives that document being
 *    replaced, rejected or removed.
 *
 * Nothing in this file contacts FMCSA, the Clearinghouse, a state agency, an
 * insurer, an ELD or any monitoring service. Every date below was recorded in
 * Antcolos by a person or carried on a document somebody uploaded.
 */

/* -------------------------------------------------------------------------- */
/* Evidence mapping                                                            */
/* -------------------------------------------------------------------------- */

/** Document Center verification state, read through rather than re-decided. */
function fromVerificationState(state: VerificationState): ComplianceEvidenceState {
  switch (state) {
    case "verified": return "approved";
    case "pending": return "pending_review";
    case "rejected": return "rejected";
    case "superseded": return "superseded";
    // "not_required" means the Document Center never needed a human to accept
    // it, so the file standing there is the whole story.
    case "not_required": return "approved";
  }
}

/** Truck and trailer document lifecycle, read through from the registries. */
function fromLifecycleStatus(status: DocumentLifecycleStatus): ComplianceEvidenceState {
  switch (status) {
    case "missing": return "missing";
    // A file the browser told us about is not a file anybody has reviewed.
    case "selected_local":
    case "pending_review": return "pending_review";
    case "approved": return "approved";
    case "rejected": return "rejected";
    case "expiring_soon": return "expiring_soon";
    case "expired": return "expired";
    case "superseded": return "superseded";
  }
}

/** Driver document status, read through from the driver's own checklist. */
function fromDriverDocumentStatus(status: DocumentStatus): ComplianceEvidenceState {
  switch (status) {
    case "not_started": return "missing";
    case "uploading":
    case "uploaded":
    case "under_review": return "pending_review";
    case "approved": return "approved";
    case "rejected": return "rejected";
    case "expired": return "expired";
    case "expiring_soon": return "expiring_soon";
  }
}

/* -------------------------------------------------------------------------- */
/* Subject seeds                                                               */
/* -------------------------------------------------------------------------- */

/** Evidence already held by another system, mapped to the requirement it answers. */
export interface EvidenceLink {
  key: ComplianceRequirementKey;
  evidence: ComplianceEvidenceRef;
  /** When the evidence was accepted, for requirements on a fixed interval. */
  satisfiedAt?: string;
}

/**
 * Everything compliance needs about one subject, assembled from the systems
 * that own it. Deliberately flat and serializable: a real backend returns this
 * shape from a join, not from five round trips.
 */
export interface ComplianceSubjectSeed {
  subject: ComplianceSubjectRef;
  context: ComplianceSubjectContext;
  /** False once the relationship that produced this subject has ended. */
  live: boolean;
  endedAt?: string;
  endedReason?: string;
  /** Deliberately paused — a suspended driver, a unit withdrawn from service. */
  suspended?: boolean;
  suspendedReason?: string;
  /** Who answers for this subject, per responsibility kind. */
  responsible: Partial<Record<
    ComplianceResponsibleParty["kind"], ComplianceResponsibleParty
  >>;
  evidence: EvidenceLink[];
}

/* -------------------------------------------------------------------------- */
/* Organizations                                                               */
/* -------------------------------------------------------------------------- */

function organization(organizationId: string): Organization | undefined {
  return MOCK_ORGANIZATIONS.find((o) => o.id === organizationId);
}

/**
 * What the organization has recorded about its own authority.
 *
 * A carrier with an MC number on record is treated as running interstate; one
 * with only a DOT number is treated as intrastate. That is the carrier's own
 * record read literally, not a lookup — an intrastate carrier is simply never
 * shown the interstate filings, which is the "do not show irrelevant
 * requirements" rule doing its job.
 */
export function operatingAuthorityFor(org: Organization): OperatingAuthorityProfile {
  const hasOwnAuthority = org.type === "CARRIER" && Boolean(org.dotNumber);
  return {
    hasOwnAuthority,
    dotNumber: org.dotNumber,
    mcNumber: org.mcNumber,
    interstate: hasOwnAuthority && Boolean(org.mcNumber),
    recordedAt: org.createdAt,
  };
}

function organizationParty(org: Organization): ComplianceResponsibleParty {
  return {
    kind: "organization",
    displayName: org.displayName,
    organizationId: org.id,
    href: "/settings/organization",
  };
}

/** The Document Center document behind a carrier-level requirement, if any. */
function documentEvidence(
  organizationId: string,
  documentId: string,
  label: string,
): EvidenceLink["evidence"] | undefined {
  const found = mockStore
    .org(organizationId)
    .documents.find((d: Document) => d.id === documentId);
  if (!found) return undefined;
  return {
    system: "document_center",
    id: found.id,
    label,
    href: "/documents",
    state: fromVerificationState(found.verification.state),
    fileName: found.fileName,
    expiresAt: found.expiresAt,
    capturedAt: found.uploadedAt,
    rejectionReason: found.verification.rejectionReason,
  };
}

/** Carrier-level requirement keys and the organization document that answers each. */
const ORG_EVIDENCE: Record<string, Array<[ComplianceRequirementKey, string, string]>> = {
  org_northline: [
    ["carrier.operating_authority_record", ORG_DOCUMENT_IDS.northlineAuthority, "Operating authority letter"],
    ["carrier.bipd_insurance", ORG_DOCUMENT_IDS.northlineBipd, "Public liability certificate"],
    ["carrier.cargo_insurance", ORG_DOCUMENT_IDS.northlineCargo, "Cargo certificate"],
    ["carrier.ucr_registration", ORG_DOCUMENT_IDS.northlineUcr, "UCR receipt"],
    ["carrier.workers_compensation", ORG_DOCUMENT_IDS.northlineWorkersComp, "Workers' compensation certificate"],
    ["carrier.process_agent_designation", ORG_DOCUMENT_IDS.northlineProcessAgent, "Process agent designation"],
  ],
  org_baxter: [
    ["carrier.operating_authority_record", ORG_DOCUMENT_IDS.baxterAuthority, "Operating authority letter"],
    ["carrier.bipd_insurance", ORG_DOCUMENT_IDS.baxterBipd, "Public liability certificate"],
    ["carrier.cargo_insurance", ORG_DOCUMENT_IDS.baxterCargo, "Cargo certificate"],
  ],
  org_meridian: [
    ["dispatch.carrier_service_agreement", ORG_DOCUMENT_IDS.meridianAgreement, "Dispatch service agreement — Baxter Transit"],
    ["dispatch.errors_omissions_insurance", ORG_DOCUMENT_IDS.meridianEando, "Errors and omissions certificate"],
    ["dispatch.w9_on_file", ORG_DOCUMENT_IDS.meridianW9, "W-9"],
  ],
  org_cascade: [
    ["carrier.bipd_insurance", ORG_DOCUMENT_IDS.cascadeBipd, "Public liability certificate"],
    ["carrier.cargo_insurance", ORG_DOCUMENT_IDS.cascadeCargo, "Cargo certificate"],
  ],
};

/**
 * Things a person recorded in Antcolos with no file behind them.
 *
 * These are compliance's OWN records — "our safety manager ran the annual
 * review on this date" — which is why they live here and not in the Document
 * Center. The evidence says so in as many words, and never implies a file.
 */
const ATTESTATIONS: Record<string, Array<[ComplianceRequirementKey, string, number]>> = {
  org_northline: [
    ["carrier.drug_alcohol_program", "Testing programme recorded with the consortium administrator", 120],
    ["carrier.driver_qualification_policy", "Driver qualification file policy signed off", 400],
    ["carrier.accident_register", "Accident register confirmed current", 60],
  ],
  org_baxter: [
    ["carrier.drug_alcohol_program", "Testing programme recorded with the consortium administrator", 30],
    ["carrier.driver_qualification_policy", "Driver qualification file policy signed off", 90],
    ["carrier.accident_register", "Accident register confirmed current", 45],
    ["carrier.workers_compensation", "Coverage recorded by the office manager", 100],
  ],
  org_cascade: [
    ["carrier.driver_qualification_policy", "Driver qualification file policy signed off", 60],
  ],
};

const DAY_MS = 86_400_000;
const daysAgoIso = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

function attestation(
  key: ComplianceRequirementKey,
  label: string,
  daysAgo: number,
): EvidenceLink {
  const at = daysAgoIso(daysAgo);
  return {
    key,
    satisfiedAt: at,
    evidence: {
      system: "recorded_attestation",
      id: `att_${key}_${daysAgo}`,
      label,
      state: "approved",
      capturedAt: at,
    },
  };
}

function carrierSubject(organizationId: string): ComplianceSubjectSeed | null {
  const org = organization(organizationId);
  if (!org) return null;
  const authority = operatingAuthorityFor(org);

  const evidence: EvidenceLink[] = [];
  for (const [key, documentId, label] of ORG_EVIDENCE[organizationId] ?? []) {
    const found = documentEvidence(organizationId, documentId, label);
    if (found) evidence.push({ key, evidence: found, satisfiedAt: found.capturedAt });
  }
  for (const [key, label, daysAgo] of ATTESTATIONS[organizationId] ?? []) {
    // An attestation never overrides a real document on the same requirement.
    if (evidence.some((e) => e.key === key)) continue;
    evidence.push(attestation(key, label, daysAgo));
  }

  return {
    subject: {
      kind: "carrier",
      id: org.id,
      label: org.displayName,
      detail: org.dotNumber ? `DOT ${org.dotNumber}` : "No operating authority recorded",
      href: "/settings/organization",
    },
    context: {
      kind: "carrier",
      organizationId: org.id,
      organizationType: org.type,
      operatingAuthority: authority,
      interstate: authority.interstate,
      hazmat: false,
    },
    live: true,
    responsible: { organization: organizationParty(org) },
    evidence,
  };
}

/* -------------------------------------------------------------------------- */
/* Drivers                                                                     */
/* -------------------------------------------------------------------------- */

/** Which requirement a shared driver document answers. */
const DRIVER_DOCUMENT_KEYS: Record<string, ComplianceRequirementKey> = {
  cdl_front: "driver.commercial_licence",
  medical_front: "driver.medical_certificate",
  w9: "driver.owner_operator_w9",
  coi: "driver.owner_operator_insurance",
  lease_agreement: "driver.owner_operator_agreement",
  northline_handbook: "driver.handbook_acknowledgement",
};

const DRIVER_RELATIONSHIP_LIVE = new Set(["invited", "onboarding", "active", "suspended"]);

function driverSubjectFromRelationship(
  driver: CarrierDriver,
  org: Organization,
): ComplianceSubjectSeed {
  const authority = operatingAuthorityFor(org);
  const live = DRIVER_RELATIONSHIP_LIVE.has(driver.status);

  const evidence: EvidenceLink[] = driver.sharedDocuments
    .map((shared): EvidenceLink | null => {
      const key = DRIVER_DOCUMENT_KEYS[shared.key];
      if (!key) return null;
      // The licence and the medical card carry their expiry on the driver
      // record; the shared snapshot may predate the latest renewal.
      const expiresAt =
        key === "driver.commercial_licence"
          ? driver.cdlExpiresAt || shared.expiresAt
          : key === "driver.medical_certificate"
            ? driver.medicalExpiresAt ?? shared.expiresAt
            : shared.expiresAt;
      return {
        key,
        satisfiedAt: shared.sharedAt,
        evidence: {
          system: "driver_document",
          id: `${driver.id}:${shared.key}`,
          label: shared.label,
          href: `/people/drivers/${driver.id}`,
          state: fromDriverDocumentStatus(shared.status),
          fileName: shared.fileName,
          expiresAt: expiresAt || undefined,
          capturedAt: shared.sharedAt,
        },
      };
    })
    .filter((e): e is EvidenceLink => e !== null);

  // Recorded by the carrier's safety team, not fetched from anywhere.
  if (driver.status === "active" || driver.status === "ended") {
    evidence.push(
      attestation("driver.pre_employment_drug_test", "Result recorded before first dispatch", 215),
      attestation("driver.motor_vehicle_record_review", "Annual driving record review completed", 400),
      attestation("driver.employment_application", "Application received and filed", 218),
      attestation("driver.road_test_certificate", "Road test completed", 216),
    );
  }
  if (driver.status === "active") {
    evidence.push(
      attestation("driver.clearinghouse_query_record", "Annual query recorded by the safety team", 200),
    );
  }

  return {
    subject: {
      kind: "driver",
      id: driver.driverProfileId,
      label: driver.name,
      detail:
        driver.engagementType === "owner_operator" ? "Owner-operator" : "Company driver",
      href: `/people/drivers/${driver.id}`,
    },
    context: {
      kind: "driver",
      organizationId: org.id,
      organizationType: org.type,
      operatingAuthority: authority,
      interstate: authority.interstate,
      engagementType: driver.engagementType,
      hazmat: false,
    },
    live,
    endedAt: driver.endedAt,
    endedReason: driver.endReason,
    suspended: driver.status === "suspended",
    suspendedReason:
      driver.status === "suspended"
        ? "This driver is suspended and cannot be dispatched."
        : undefined,
    responsible: {
      organization: organizationParty(org),
      driver: {
        kind: "driver",
        displayName: driver.name,
        driverProfileId: driver.driverProfileId,
        href: `/people/drivers/${driver.id}`,
      },
      membership: {
        kind: "membership",
        displayName: `${org.displayName} safety team`,
        organizationId: org.id,
      },
    },
    evidence,
  };
}

/**
 * The driver's own record, seen from inside the carrier they drive for.
 *
 * Keyed by the id the membership carries, so a driver membership's
 * "responsibility is mine" resolves without a lookup table. The facts come from
 * the driver's permanent profile, which belongs to them and is not copied here.
 */
function ownDriverSubject(org: Organization): ComplianceSubjectSeed | null {
  const profile = driverProfileSync();
  if (!profile) return null;
  const relationship = driverRelationshipsSync().find(
    (r) => r.carrierId === org.id && r.status !== "ended",
  );
  if (!relationship) return null;

  // Keyed by the id the carrier's membership carries, so "this is mine"
  // resolves without a translation table. The facts still come from the
  // driver's permanent profile, which belongs to them.
  const subjectId = MOCK_MEMBERSHIPS.find(
    (m) => m.organizationId === org.id && m.driverProfileId,
  )?.driverProfileId;
  if (!subjectId) return null;

  const authority = operatingAuthorityFor(org);
  const documents = driverDocumentsSync();
  const evidence: EvidenceLink[] = documents
    .map((doc): EvidenceLink | null => {
      const key = DRIVER_DOCUMENT_KEYS[doc.requirementKey];
      // Only what the driver actually agreed to share with THIS carrier.
      if (!key || !relationship.sharedDocumentKeys.includes(doc.requirementKey)) return null;
      const expiresAt =
        key === "driver.commercial_licence"
          ? profile.cdlExpiresAt
          : key === "driver.medical_certificate"
            ? profile.medicalCardExpiresAt ?? doc.expiresAt
            : doc.expiresAt;
      return {
        key,
        satisfiedAt: doc.submittedAt,
        evidence: {
          system: "driver_document",
          id: `${profile.id}:${doc.requirementKey}`,
          label: doc.requirementKey.replace(/_/g, " "),
          href: "/driver/documents",
          state: fromDriverDocumentStatus(doc.status),
          fileName: doc.fileName,
          expiresAt,
          capturedAt: doc.submittedAt,
          rejectionReason: doc.rejectionReason,
        },
      };
    })
    .filter((e): e is EvidenceLink => e !== null);

  return {
    subject: {
      kind: "driver",
      id: subjectId,
      label: profile.legalName,
      detail: "Company driver",
      href: "/driver/profile",
    },
    context: {
      kind: "driver",
      organizationId: org.id,
      organizationType: org.type,
      operatingAuthority: authority,
      interstate: authority.interstate,
      engagementType: relationship.engagementType,
      hazmat: false,
    },
    live: true,
    responsible: {
      organization: organizationParty(org),
      driver: {
        kind: "driver",
        displayName: profile.legalName,
        driverProfileId: subjectId,
        href: "/driver/profile",
      },
      membership: {
        kind: "membership",
        displayName: `${org.displayName} safety team`,
        organizationId: org.id,
      },
    },
    evidence,
  };
}

/* -------------------------------------------------------------------------- */
/* Trucks                                                                      */
/* -------------------------------------------------------------------------- */

const TRUCK_DOCUMENT_KEYS: Record<string, ComplianceRequirementKey> = {
  registration: "truck.registration",
  insurance: "truck.insurance_evidence",
  annual_inspection: "truck.annual_inspection",
  lease_agreement: "truck.lease_agreement",
};

/**
 * Requirements whose evidence belongs to ONE carrier relationship.
 *
 * A registration and an annual inspection are facts about the vehicle: whoever
 * uploaded the report, it is the same report. Insurance evidence and a lease
 * agreement are not — they are this carrier's own onboarding paperwork, and
 * another carrier approved on the same truck may never be shown them, still
 * less have them counted as its own compliance.
 */
const PER_CARRIER_KEYS = new Set<ComplianceRequirementKey>([
  "truck.insurance_evidence",
  "truck.lease_agreement",
  "trailer.insurance_evidence",
  "trailer.lease_agreement",
]);

/**
 * Relationship states that make a truck or trailer part of the organization's
 * compliance scope.
 *
 * A requested-but-not-approved relationship is deliberately excluded: the fleet
 * roster does not count it either, and showing compliance obligations for a
 * vehicle you have merely asked to run would inflate every number on the
 * dashboard with equipment that is not yours.
 */
const ASSET_RELATIONSHIP_LIVE = new Set(["approved", "suspended"]);
const ASSET_RELATIONSHIP_IN_SCOPE = new Set(["approved", "suspended", "ended"]);

function truckSubjects(org: Organization): ComplianceSubjectSeed[] {
  const authority = operatingAuthorityFor(org);

  return truckRelationshipsFor(org.id)
    .filter((r) => ASSET_RELATIONSHIP_IN_SCOPE.has(r.status))
    .map((relationship): ComplianceSubjectSeed | null => {
      const truck = truckRecord(relationship.truckId);
      if (!truck) return null;

      const evidence: EvidenceLink[] = truckDocumentsFor(truck.truckId)
        .map((doc): EvidenceLink | null => {
          const key = TRUCK_DOCUMENT_KEYS[doc.kind];
          if (!key) return null;
          // Another carrier's onboarding paperwork never satisfies ours.
          if (PER_CARRIER_KEYS.has(key) && doc.addedByOrganizationId !== org.id) return null;
          return {
            key,
            satisfiedAt: doc.createdAt,
            evidence: {
              system: "truck_document",
              id: doc.id,
              label: doc.kind.replace(/_/g, " "),
              href: `/fleet/trucks/${truck.truckId}`,
              state: fromLifecycleStatus(doc.status),
              fileName: doc.fileName,
              expiresAt: doc.expiresAt,
              capturedAt: doc.createdAt,
              rejectionReason: doc.rejectionReason,
            },
          };
        })
        .filter((e): e is EvidenceLink => e !== null);

      // Registration expiry lives on the permanent truck record, not only on
      // the document — a registration with no file still has a real expiry.
      if (!evidence.some((e) => e.key === "truck.registration")) {
        evidence.push({
          key: "truck.registration",
          satisfiedAt: truck.createdAt,
          evidence: {
            system: "recorded_attestation",
            id: `att_reg_${truck.truckId}`,
            label: `Plate ${truck.registration.plateNumber} (${truck.registration.plateState}) recorded — no document uploaded`,
            state: "approved",
            expiresAt: truck.registration.expiresAt,
            capturedAt: truck.createdAt,
          },
        });
      }

      if (relationship.status === "approved") {
        evidence.push(
          attestation("truck.periodic_maintenance_record", "Maintenance interval completed at the yard", 50),
        );
        if (truck.equipmentType === "tractor" || truck.equipmentType === "box_truck") {
          evidence.push(
            attestation("truck.eld_device_record", "Device serial and model recorded by the carrier", 180),
          );
        }
      }

      return {
        subject: {
          kind: "truck",
          id: truck.truckId,
          label: `Unit ${relationship.unitNumber}`,
          detail: `${truck.year} ${truck.make} ${truck.model}`,
          href: `/fleet/trucks/${truck.truckId}`,
        },
        context: {
          kind: "truck",
          organizationId: org.id,
          organizationType: org.type,
          operatingAuthority: authority,
          interstate: authority.interstate,
          truckEquipmentType: truck.equipmentType,
          carrierRelationshipType: relationship.relationshipType,
          grossWeightPounds: truck.specs.gvwrLbs,
          hazmat: false,
        },
        live: ASSET_RELATIONSHIP_LIVE.has(relationship.status),
        endedAt: relationship.endedAt,
        endedReason: relationship.endReason,
        suspended: relationship.status === "suspended" || truck.status === "maintenance",
        suspendedReason:
          relationship.status === "suspended"
            ? "This carrier's relationship with the truck is suspended."
            : truck.status === "maintenance"
              ? "The truck is in maintenance and is not being dispatched."
              : undefined,
        responsible: {
          organization: organizationParty(org),
          equipment_owner: {
            kind: "equipment_owner",
            displayName: truckOwnerName(truck.truckId) ?? "Recorded owner",
            href: `/fleet/trucks/${truck.truckId}`,
          },
        },
        evidence,
      };
    })
    .filter((s): s is ComplianceSubjectSeed => s !== null);
}

/* -------------------------------------------------------------------------- */
/* Trailers                                                                    */
/* -------------------------------------------------------------------------- */

const TRAILER_DOCUMENT_KEYS: Record<string, ComplianceRequirementKey> = {
  registration: "trailer.registration",
  insurance: "trailer.insurance_evidence",
  annual_inspection: "trailer.annual_inspection",
  lease_agreement: "trailer.lease_agreement",
  reefer_service_record: "trailer.reefer_unit_service_record",
  tarp_securement_inventory: "trailer.securement_equipment_inventory",
};

function trailerSubjects(org: Organization): ComplianceSubjectSeed[] {
  const authority = operatingAuthorityFor(org);

  return trailerRelationshipsFor(org.id)
    .filter((r) => ASSET_RELATIONSHIP_IN_SCOPE.has(r.status))
    .map((relationship): ComplianceSubjectSeed | null => {
      const trailer = trailerRecord(relationship.trailerId);
      if (!trailer) return null;

      const evidence: EvidenceLink[] = trailerDocumentsFor(trailer.trailerId)
        .map((doc): EvidenceLink | null => {
          const key = TRAILER_DOCUMENT_KEYS[doc.kind];
          if (!key) return null;
          // A document added for one carrier's onboarding is that carrier's.
          const owner = doc.carrierOrganizationId ?? doc.addedByOrganizationId;
          if (PER_CARRIER_KEYS.has(key) && owner !== org.id) return null;
          return {
            key,
            satisfiedAt: doc.createdAt,
            evidence: {
              system: "trailer_document",
              id: doc.id,
              label: doc.kind.replace(/_/g, " "),
              href: `/fleet/trailers/${trailer.trailerId}`,
              state: fromLifecycleStatus(doc.status),
              fileName: doc.fileName,
              expiresAt: doc.expiresAt,
              capturedAt: doc.createdAt,
              rejectionReason: doc.rejectionReason,
            },
          };
        })
        .filter((e): e is EvidenceLink => e !== null);

      if (!evidence.some((e) => e.key === "trailer.registration") && trailer.registration.expiresAt) {
        evidence.push({
          key: "trailer.registration",
          satisfiedAt: trailer.createdAt,
          evidence: {
            system: "recorded_attestation",
            id: `att_treg_${trailer.trailerId}`,
            label: `Plate ${trailer.registration.plateNumber} (${trailer.registration.plateState}) recorded — no document uploaded`,
            state: "approved",
            expiresAt: trailer.registration.expiresAt,
            capturedAt: trailer.createdAt,
          },
        });
      }

      const hasReeferUnit =
        trailer.trailerType === "reefer" || Boolean(trailer.configuration.reeferUnitMake);

      // The reefer's last service date is a fact the trailer registry already
      // holds; compliance reads it rather than asking for it again.
      const lastServiced = trailer.configuration.reeferLastServicedAt;
      if (hasReeferUnit && lastServiced && !evidence.some((e) => e.key === "trailer.reefer_unit_service_record")) {
        evidence.push({
          key: "trailer.reefer_unit_service_record",
          satisfiedAt: lastServiced,
          evidence: {
            system: "recorded_attestation",
            id: `att_reefer_${trailer.trailerId}`,
            label: "Refrigeration unit service recorded on the trailer record",
            state: "approved",
            capturedAt: lastServiced,
          },
        });
      }

      const openDeck =
        trailer.trailerType === "flatbed" || trailer.trailerType === "step_deck" ||
        trailer.trailerType === "gooseneck" || trailer.trailerType === "car_hauler";
      if (openDeck && relationship.status === "approved" && trailer.status !== "out_of_service") {
        evidence.push(
          attestation("trailer.securement_equipment_inventory", "Straps, chains and binders counted at the yard", 40),
        );
      }

      return {
        subject: {
          kind: "trailer",
          id: trailer.trailerId,
          label: `Trailer ${relationship.unitNumber}`,
          detail: `${trailer.year} ${trailer.make} ${trailer.model}`,
          href: `/fleet/trailers/${trailer.trailerId}`,
        },
        context: {
          kind: "trailer",
          organizationId: org.id,
          organizationType: org.type,
          operatingAuthority: authority,
          interstate: authority.interstate,
          trailerType: trailer.trailerType,
          hasReeferUnit,
          carrierRelationshipType: relationship.relationshipType,
          hazmat: false,
        },
        live: ASSET_RELATIONSHIP_LIVE.has(relationship.status),
        endedAt: relationship.endedAt,
        endedReason: relationship.endReason,
        suspended: relationship.status === "suspended" || trailer.status === "out_of_service",
        suspendedReason:
          relationship.status === "suspended"
            ? "This carrier's relationship with the trailer is suspended."
            : trailer.status === "out_of_service"
              ? trailer.availability.unavailableReason ?? "Withdrawn from service."
              : undefined,
        responsible: {
          organization: organizationParty(org),
          equipment_owner: {
            kind: "equipment_owner",
            displayName: trailerOwnerName(trailer.trailerId) ?? "Recorded owner",
            href: `/fleet/trailers/${trailer.trailerId}`,
          },
        },
        evidence,
      };
    })
    .filter((s): s is ComplianceSubjectSeed => s !== null);
}

/* -------------------------------------------------------------------------- */
/* The whole picture for one organization                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every subject this organization owes compliance about, right now.
 *
 * Read fresh on every call: a truck connected this morning appears, and a
 * driver whose relationship ended yesterday comes back with `live: false` so
 * the registry can freeze its records instead of losing them.
 */
export function subjectSeeds(organizationId: string): ComplianceSubjectSeed[] {
  const org = organization(organizationId);
  if (!org) return [];

  const seeds: ComplianceSubjectSeed[] = [];

  const carrier = carrierSubject(organizationId);
  if (carrier) seeds.push(carrier);

  if (organizationId === CARRIER_DRIVERS_ORGANIZATION_ID) {
    for (const driver of carrierDriversSync()) {
      seeds.push(driverSubjectFromRelationship(driver, org));
    }
  }
  const own = ownDriverSubject(org);
  if (own) seeds.push(own);

  seeds.push(...truckSubjects(org), ...trailerSubjects(org));
  return seeds;
}

/** Every organization compliance knows about. Used to build the fixtures once. */
export function complianceOrganizationIds(): string[] {
  return MOCK_ORGANIZATIONS.map((o) => o.id);
}

export function complianceOrganization(organizationId: string): Organization | undefined {
  return organization(organizationId);
}

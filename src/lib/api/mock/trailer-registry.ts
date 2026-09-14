import type {
  AssetActivationState,
  AttachmentStatus,
  CarrierRelationshipStatus,
  CarrierRelationshipType,
  CompatibilityResult,
  CompatibilityVerdict,
  FleetTrailer,
  LeaseTermination,
  OwnerType,
  PermissionKey,
  Trailer,
  TrailerAttachment,
  TrailerAttachmentState,
  TrailerCarrierRelationship,
  TrailerConfiguration,
  TrailerDispatchAccess,
  TrailerDocument,
  TrailerDocumentKind,
  TrailerDocumentSnapshot,
  TrailerEvent,
  TrailerMovementRecord,
  TrailerOperatingLease,
  TrailerOperatingStatus,
  TrailerOwnershipClaim,
  TrailerOwnershipRecord,
  TrailerRegistration,
  TrailerSpecs,
  TrailerType,
} from "@/types";
import { normalizeVin, validateVin } from "@/lib/fleet/vin";
import { TRAILER_DOCUMENT_LABEL } from "@/lib/fleet/trailer-equipment";
import { checkMechanicalCompatibility } from "@/lib/fleet/compatibility";
import {
  trailerDocumentTypeKey, trailerRequirementKey,
} from "@/lib/documents/requirements";
import {
  addAssetDocument, assetDocumentRows, seedAssetDocument, submitAssetDocument,
  type AssetDocumentAdapter,
} from "./asset-documents";
import {
  clearDocumentsForSubjectKind, documentById as storedDocument, endRelationshipDocuments,
} from "./document-store";
import {
  TRUCK_IDS,
  activateOperatingLeaseSync,
  activationStateFor as truckActivationStateFor,
  truckHoldingLease,
  truckRecord,
  truckUnitNumber,
} from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE permanent trailer registry.
 *
 * Like the truck registry, and for the same reason, it is NOT partitioned by
 * organization: a trailer exists once in the world, so it exists once here, and
 * which organizations can see it is derived from its relationships. A carrier
 * that ends its relationship stops seeing the trailer even though it created
 * the record, and nobody reaches a trailer by guessing a UUID or a VIN.
 *
 * What makes this file different from the truck registry is the attachment.
 * A trailer has no driver and no authority of its own; it works only when it is
 * hooked to a compatible power unit belonging to a carrier that is approved to
 * run it. So this file has to reason about two registries at once, and the
 * combination activation below is the one place where a truck and a trailer are
 * locked together in a single synchronous step.
 *
 * Every mutation is checked here — against permissions, relationships, leases,
 * attachments and physical compatibility — not in the screens. Hiding a button
 * is a courtesy; this is the boundary.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 450;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);
const hoursFromNow = (n: number) => iso(new Date(Date.now() + n * 3_600_000));

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;

/** A trailer's permanent id is a UUID and nothing else. */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Fixture identifiers                                                         */
/* -------------------------------------------------------------------------- */

/** Stable ids so reviewers and tests can address a known trailer. */
export const TRAILER_IDS = {
  dv220: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0001",
  rf114: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0002",
  fb410: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0003",
  gn330: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0004",
  mt501: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0005",
  oos602: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0006",
  mc701: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0007",
  lk702: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0008",
  bx810: "8b2daf51-bb22-4c20-8202-2b2c3d4e0001",
  ch950: "8b2daf51-bb22-4c20-8202-2b2c3d4e0002",
  cl901: "7a1c9e40-aa11-4b10-9101-1a1b2c3d0009",
} as const;

/** VINs the fixtures use. Reported to reviewers; never shown as hints in the UI. */
export const TRAILER_VINS = {
  dv220: "1JJV532W8PL220445",
  rf114: "1UYVS2530N2114887",
  fb410: "1DW1A5320LB410226",
  gn330: "5FTBG2427PT330119",
  mt501: "1S12E9538MS501774",
  oos602: "1JJV482W2KL602338",
  mc701: "1GRAA0629NB701552",
  lk702: "1UYVS2537P2702661",
  bx810: "1JJV532B4RL810993",
  ch950: "5N7SA2429NC950228",
  cl901: "1DW1A5325MB901447",
} as const;

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface RegistryState {
  trailers: Trailer[];
  ownership: TrailerOwnershipRecord[];
  claims: TrailerOwnershipClaim[];
  relationships: TrailerCarrierRelationship[];
  dispatchAccess: TrailerDispatchAccess[];
  attachments: TrailerAttachment[];
  leases: TrailerOperatingLease[];
  movements: TrailerMovementRecord[];
  events: TrailerEvent[];
}

let registry: RegistryState | null = null;

/** Seeded after the registry exists, so a trailer's label can be resolved. */
let pendingDocumentSeed: (() => void) | null = null;

function db(): RegistryState {
  if (!registry) {
    registry = buildFixtures();
    const seed = pendingDocumentSeed;
    pendingDocumentSeed = null;
    seed?.();
  }
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetTrailerRegistry() {
  seq = 0;
  clearDocumentsForSubjectKind("trailer");
  registry = null;
  pendingDocumentSeed = null;
  db();
}

/**
 * Trailer documents are rows in THE document store, shared with trucks, drivers
 * and organizations. `TrailerDocument` is the projection the fleet screens read.
 */
const TRAILER_DOCUMENTS: AssetDocumentAdapter<TrailerDocumentKind> = {
  subjectKind: "trailer",
  requirementKey: trailerRequirementKey,
  typeKey: trailerDocumentTypeKey,
  kindFromRequirementKey: (key) =>
    key.startsWith("trailer:") ? (key.slice("trailer:".length) as TrailerDocumentKind) : undefined,
};

const ORG_DISPLAY_NAMES: Record<string, string> = {
  org_northline: "Northline Freight",
  org_baxter: "Baxter Transit LLC",
  org_cascade: "Cascade Haul",
  org_meridian: "Meridian Dispatch",
  org_summit: "Summit Dispatch",
  org_ridgeway: "Ridgeway Carriers",
  org_crosswind: "Crosswind Freight",
  org_halberd: "Halberd Leasing LLC",
};

function trailerLabel(trailerId: string): string {
  const found = registry?.trailers.find((t) => t.trailerId === trailerId);
  const unit = registry?.relationships.find(
    (r) => r.trailerId === trailerId && r.status !== "ended" && r.unitNumber,
  )?.unitNumber;
  if (!found) return unit ? `Trailer ${unit}` : "Trailer";
  return `${unit ? `${unit} · ` : ""}${found.year} ${found.make} ${found.model}`;
}

function trailerDocumentsFor(trailerId: string): TrailerDocument[] {
  return assetDocumentRows(TRAILER_DOCUMENTS, trailerId).map((row) => ({ ...row, trailerId }));
}

function trailerDocumentById(documentId: string): TrailerDocument | undefined {
  const subject = storedDocument(documentId)?.links.find((l) => l.subject.kind === "trailer")?.subject;
  if (!subject) return undefined;
  return trailerDocumentsFor(subject.id).find((d) => d.id === documentId);
}

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                            */
/* -------------------------------------------------------------------------- */

function trailer(
  trailerId: string,
  vin: string,
  trailerType: TrailerType,
  year: number,
  make: string,
  model: string,
  status: TrailerOperatingStatus,
  registration: TrailerRegistration,
  specs: TrailerSpecs,
  configuration: TrailerConfiguration,
  availability: Trailer["availability"],
  createdByOrganizationId: string,
  color?: string,
): Trailer {
  return {
    trailerId, vin, trailerType, year, make, model, color,
    registration, specs, configuration, status, availability,
    createdAt: daysAgo(320), createdByOrganizationId,
  };
}

function plate(
  plateNumber: string, plateState: string, expiresInDays: number, registeredOwnerName: string,
): TrailerRegistration {
  return { plateNumber, plateState, expiresAt: daysFromNow(expiresInDays), registeredOwnerName };
}

function own(
  trailerId: string, ownerType: OwnerType, ownerName: string, startedAt: string,
  status: "active" | "ended", endedAt?: string, ownerRef?: string,
): TrailerOwnershipRecord {
  return {
    id: rowId("town"), trailerId, ownerType, ownerName, ownerRef, startedAt, endedAt, status,
    evidence: [{ kind: "title", label: "Title or ownership evidence", fileName: "title.pdf", capturedAt: startedAt }],
    createdByMembershipId: "seed", createdByName: "Antcolos", createdAt: startedAt,
  };
}

function rel(
  trailerId: string, organizationId: string, organizationName: string,
  relationshipType: CarrierRelationshipType, unitNumber: string,
  status: CarrierRelationshipStatus, startedAt: string,
): TrailerCarrierRelationship {
  return {
    id: rowId("trel"), trailerId, organizationId, organizationName, relationshipType,
    unitNumber, status, startedAt, approvedAt: status === "approved" ? startedAt : undefined,
    initiatedByOrganizationId: organizationId, createdAt: startedAt,
  };
}

function dispatch(
  trailerId: string, dispatchOrganizationId: string, dispatchOrganizationName: string,
  grantedByCarrierOrganizationId: string, grantedByCarrierName: string,
  unitLabel: string, startedAt: string,
): TrailerDispatchAccess {
  return {
    id: rowId("tdis"), trailerId, dispatchOrganizationId, dispatchOrganizationName,
    grantedByCarrierOrganizationId, grantedByCarrierName, unitLabel, status: "active",
    startedAt, initiatedByOrganizationId: grantedByCarrierOrganizationId, createdAt: startedAt,
  };
}

function attach(
  trailerId: string, truckId: string, truckUnitLabel: string, organizationId: string,
  organizationName: string, status: AttachmentStatus, attachedAt: string,
  detachedAt?: string, detachReason?: string,
): TrailerAttachment {
  return {
    id: rowId("tatt"), trailerId, truckId, truckUnitLabel, organizationId, organizationName,
    status, reservedAt: attachedAt, attachedAt, detachedAt, detachReason,
    createdByMembershipId: "seed", createdByName: "Antcolos", createdAt: attachedAt,
  };
}

/** Seeds one fixture document straight into the shared store. */
function doc(
  trailerId: string, kind: TrailerDocumentKind, status: TrailerDocument["status"],
  addedByOrganizationId: string, fileName: string, expiresAt?: string, rejectionReason?: string,
): void {
  seedAssetDocument(TRAILER_DOCUMENTS, {
    assetId: trailerId,
    assetLabel: trailerLabel(trailerId),
    assetHref: `/fleet/trailers/${trailerId}`,
    kind, status,
    organizationId: addedByOrganizationId,
    organizationName: ORG_DISPLAY_NAMES[addedByOrganizationId] ?? addedByOrganizationId,
    fileName, fileType: "application/pdf", sizeBytes: 180_000,
    expiresAt, rejectionReason,
    createdAt: daysAgo(90), updatedAt: daysAgo(90),
  });
}

function evt(
  trailerId: string, kind: TrailerEvent["kind"], summary: string, at: string,
  organizationId?: string, detail?: string,
): TrailerEvent {
  return { id: rowId("tevt"), trailerId, at, kind, summary, detail, organizationId };
}

const VAN_SPECS: TrailerSpecs = {
  overallLengthIn: 636, overallWidthIn: 102, overallHeightIn: 162,
  interiorLengthIn: 630, interiorWidthIn: 98, interiorHeightIn: 110,
  rearDoorWidthIn: 93, rearDoorHeightIn: 105,
  gvwrLbs: 68_000, emptyWeightLbs: 14_200, maxPayloadLbs: 45_000,
  axleCount: 2, suspension: "air_ride", tireSize: "295/75R22.5",
};

const REEFER_SPECS: TrailerSpecs = {
  overallLengthIn: 636, overallWidthIn: 102, overallHeightIn: 165,
  interiorLengthIn: 618, interiorWidthIn: 97, interiorHeightIn: 100,
  rearDoorWidthIn: 92, rearDoorHeightIn: 98,
  gvwrLbs: 68_000, emptyWeightLbs: 16_800, maxPayloadLbs: 43_500,
  axleCount: 2, suspension: "air_ride", tireSize: "295/75R22.5",
};

const FLATBED_SPECS: TrailerSpecs = {
  overallLengthIn: 576, overallWidthIn: 102, overallHeightIn: 60,
  gvwrLbs: 65_000, emptyWeightLbs: 11_400, maxPayloadLbs: 48_000,
  axleCount: 2, suspension: "spring", tireSize: "255/70R22.5",
};

const STEP_SPECS: TrailerSpecs = {
  overallLengthIn: 636, overallWidthIn: 102, overallHeightIn: 62,
  gvwrLbs: 70_000, emptyWeightLbs: 13_100, maxPayloadLbs: 48_000,
  axleCount: 2, suspension: "air_ride", tireSize: "255/70R22.5",
};

const GOOSENECK_SPECS: TrailerSpecs = {
  overallLengthIn: 480, overallWidthIn: 102, overallHeightIn: 42,
  gvwrLbs: 25_900, emptyWeightLbs: 7_400, maxPayloadLbs: 18_500,
  axleCount: 2, suspension: "spring", tireSize: "235/80R16",
};

const CAR_HAULER_SPECS: TrailerSpecs = {
  overallLengthIn: 636, overallWidthIn: 102, overallHeightIn: 160,
  gvwrLbs: 34_000, emptyWeightLbs: 12_600, maxPayloadLbs: 21_000,
  axleCount: 2, suspension: "air_ride", tireSize: "235/80R16",
};

function buildFixtures(): RegistryState {
  const T = TRAILER_IDS;
  const V = TRAILER_VINS;

  const trailers: Trailer[] = [
    trailer(T.dv220, V.dv220, "dry_van", 2023, "Wabash", "DuraPlate 53'", "available",
      // Registration expires in 18 days — the state a fleet manager needs to see coming.
      plate("IL-TR2204", "IL", 18, "Northline Freight LLC"), VAN_SPECS,
      { rearDoorStyle: "swing", hasSideDoor: false, hasETrack: true, hasLogisticPosts: true, hasAirRide: true, hasLiftgate: false, palletCapacity: 26, hitchType: "fifth_wheel" },
      { city: "Chicago", state: "IL" }, "org_northline", "White"),

    trailer(T.rf114, V.rf114, "reefer", 2022, "Utility", "3000R 53'", "loaded",
      plate("IL-TR1148", "IL", 210, "Northline Freight LLC"), REEFER_SPECS,
      { reeferUnitMake: "Carrier", reeferUnitModel: "Vector 8600", reeferFuelType: "diesel", minTemperatureF: -20, maxTemperatureF: 70, multiTemperature: false, reeferUnitStatus: "operational", reeferLastServicedAt: daysAgo(45), airflow: "air_chute", palletCapacity: 26, hitchType: "fifth_wheel" },
      { city: "Indianapolis", state: "IN", expectedCity: "Columbus", expectedState: "OH", expectedAvailableAt: hoursFromNow(9) },
      "org_northline", "White"),

    trailer(T.fb410, V.fb410, "flatbed", 2021, "Great Dane", "Freedom LT 48'", "available",
      plate("IL-TR4102", "IL", 150, "Northline Freight LLC"), FLATBED_SPECS,
      { deckLengthIn: 576, deckWidthIn: 102, hasTarps: true, strapCount: 12, chainCount: 8, binderCount: 8, hasCoilRacks: true, hasDunnage: true, hasHeadacheRack: true, hitchType: "fifth_wheel" },
      { city: "Gary", state: "IN" }, "org_northline", "Black"),

    trailer(T.gn330, V.gn330, "gooseneck", 2022, "PJ Trailers", "GB 40'", "attached",
      plate("TX-TR3301", "TX", 260, "Marcus Hale"), GOOSENECK_SPECS,
      { deckLengthIn: 480, deckWidthIn: 102, hitchType: "gooseneck_ball", couplerRatingLbs: 30_000, rampType: "slide_in", hasWinch: true, hasTarps: false, strapCount: 8, chainCount: 6, binderCount: 6 },
      { city: "Joliet", state: "IL" }, "org_northline", "Black"),

    trailer(T.mt501, V.mt501, "step_deck", 2020, "Fontaine", "Infinity 53'", "maintenance",
      plate("IL-TR5017", "IL", 90, "Northline Freight LLC"), STEP_SPECS,
      { upperDeckLengthIn: 132, lowerDeckLengthIn: 444, upperDeckHeightIn: 60, lowerDeckHeightIn: 38, hasRamps: true, hasLoadLevelers: true, securementNotes: "Eight chains, eight binders, two tarps.", hasTarps: true, strapCount: 10, chainCount: 8, binderCount: 8, hitchType: "fifth_wheel" },
      { city: "Chicago", state: "IL", unavailableReason: "Landing gear repair at the Chicago yard.", expectedAvailableAt: daysFromNow(4) },
      "org_northline", "Grey"),

    trailer(T.oos602, V.oos602, "dry_van", 2016, "Hyundai", "Composite 48'", "out_of_service",
      plate("IL-TR6021", "IL", -30, "Northline Freight LLC"), { ...VAN_SPECS, overallLengthIn: 576, interiorLengthIn: 570 },
      { rearDoorStyle: "roll_up", hasSideDoor: true, hasETrack: false, hasLogisticPosts: false, hasAirRide: false, hasLiftgate: false, palletCapacity: 24, hitchType: "fifth_wheel" },
      { city: "Chicago", state: "IL", unavailableReason: "Failed floor inspection. Withdrawn from service pending a decision." },
      "org_northline", "White"),

    trailer(T.mc701, V.mc701, "dry_van", 2023, "Great Dane", "Champion 53'", "available",
      plate("IL-TR7015", "IL", 300, "Northline Freight LLC"), VAN_SPECS,
      { rearDoorStyle: "swing", hasSideDoor: false, hasETrack: true, hasLogisticPosts: true, hasAirRide: true, hasLiftgate: false, palletCapacity: 26, hitchType: "fifth_wheel" },
      { city: "Lafayette", state: "IN" }, "org_northline", "White"),

    trailer(T.lk702, V.lk702, "reefer", 2023, "Utility", "3000R 53'", "loaded",
      plate("IL-TR7028", "IL", 280, "Northline Freight LLC"), REEFER_SPECS,
      { reeferUnitMake: "Thermo King", reeferUnitModel: "Precedent S-750", reeferFuelType: "diesel", minTemperatureF: -20, maxTemperatureF: 70, multiTemperature: true, reeferUnitStatus: "operational", reeferLastServicedAt: daysAgo(20), airflow: "air_chute", palletCapacity: 26, hitchType: "fifth_wheel" },
      { city: "Memphis", state: "TN", expectedAvailableAt: hoursFromNow(3) }, "org_northline", "White"),

    trailer(T.bx810, V.bx810, "dry_van", 2021, "Wabash", "DuraPlate 53'", "available",
      plate("PA-TR8104", "PA", 190, "Baxter Transit LLC"), VAN_SPECS,
      { rearDoorStyle: "swing", hasSideDoor: false, hasETrack: false, hasLogisticPosts: true, hasAirRide: true, hasLiftgate: false, palletCapacity: 26, hitchType: "fifth_wheel" },
      { city: "Allentown", state: "PA" }, "org_baxter", "Silver"),

    trailer(T.ch950, V.ch950, "car_hauler", 2022, "Sun Country", "Open 7-car", "available",
      plate("PA-TR9502", "PA", 120, "Baxter Transit LLC"), CAR_HAULER_SPECS,
      { vehicleCapacity: 7, deckConfiguration: "double", rampType: "slide_in", hasWinch: true, maxVehicleLengthIn: 240, maxVehicleHeightIn: 84, enclosed: false, hitchType: "fifth_wheel" },
      { city: "Baltimore", state: "MD" }, "org_baxter", "Black"),

    trailer(T.cl901, V.cl901, "flatbed", 2019, "Reitnouer", "MaxMiser 48'", "available",
      plate("IL-TR9014", "IL", 70, "Northline Freight LLC"), FLATBED_SPECS,
      { deckLengthIn: 576, deckWidthIn: 102, hasTarps: false, strapCount: 10, chainCount: 4, binderCount: 4, hasCoilRacks: false, hasDunnage: false, hasHeadacheRack: false, hitchType: "fifth_wheel" },
      { city: "Hammond", state: "IN" }, "org_northline", "Silver"),
  ];

  const ownership: TrailerOwnershipRecord[] = [
    own(T.dv220, "organization", "Northline Freight LLC", daysAgo(300), "active", undefined, "org_northline"),
    own(T.rf114, "organization", "Northline Freight LLC", daysAgo(280), "active", undefined, "org_northline"),
    own(T.fb410, "organization", "Northline Freight LLC", daysAgo(260), "active", undefined, "org_northline"),
    // A historical transfer, mirroring the hotshot it is hooked to: the trailer
    // changed hands and kept its id, VIN, documents and every other history.
    own(T.gn330, "organization", "Halberd Leasing LLC", daysAgo(640), "ended", daysAgo(210)),
    own(T.gn330, "person", "Marcus Hale", daysAgo(210), "active", undefined, "dp_marcus"),
    own(T.mt501, "organization", "Northline Freight LLC", daysAgo(520), "active", undefined, "org_northline"),
    own(T.oos602, "organization", "Northline Freight LLC", daysAgo(700), "active", undefined, "org_northline"),
    own(T.mc701, "organization", "Northline Freight LLC", daysAgo(120), "active", undefined, "org_northline"),
    own(T.lk702, "organization", "Northline Freight LLC", daysAgo(140), "active", undefined, "org_northline"),
    own(T.bx810, "organization", "Baxter Transit LLC", daysAgo(330), "active", undefined, "org_baxter"),
    own(T.ch950, "organization", "Baxter Transit LLC", daysAgo(230), "active", undefined, "org_baxter"),
    own(T.cl901, "organization", "Northline Freight LLC", daysAgo(410), "active", undefined, "org_northline"),
  ];

  const relationships: TrailerCarrierRelationship[] = [
    rel(T.dv220, "org_northline", "Northline Freight", "carrier_owned", "V-220", "approved", daysAgo(300)),
    rel(T.rf114, "org_northline", "Northline Freight", "carrier_owned", "R-114", "approved", daysAgo(280)),
    rel(T.fb410, "org_northline", "Northline Freight", "carrier_owned", "F-410", "approved", daysAgo(260)),
    // The carrier runs it; Marcus Hale owns it. Two different things.
    rel(T.gn330, "org_northline", "Northline Freight", "leased_owner_operator", "G-330", "approved", daysAgo(200)),
    rel(T.mt501, "org_northline", "Northline Freight", "carrier_owned", "S-501", "approved", daysAgo(520)),
    rel(T.oos602, "org_northline", "Northline Freight", "carrier_owned", "V-602", "approved", daysAgo(700)),
    rel(T.cl901, "org_northline", "Northline Freight", "carrier_owned", "F-901", "approved", daysAgo(410)),
    rel(T.bx810, "org_baxter", "Baxter Transit LLC", "carrier_owned", "BX-810", "approved", daysAgo(330)),
    rel(T.ch950, "org_baxter", "Baxter Transit LLC", "carrier_owned", "BX-950", "approved", daysAgo(230)),
    // The multi-carrier case: two carriers fully onboarded on one trailer.
    rel(T.mc701, "org_northline", "Northline Freight", "carrier_owned", "V-701", "approved", daysAgo(120)),
    rel(T.mc701, "org_baxter", "Baxter Transit LLC", "leased_owner_operator", "BX-701", "approved", daysAgo(40)),
    rel(T.lk702, "org_northline", "Northline Freight", "carrier_owned", "R-702", "approved", daysAgo(140)),
    rel(T.lk702, "org_baxter", "Baxter Transit LLC", "leased_owner_operator", "BX-702", "approved", daysAgo(35)),
    // Requested but not yet approved — an honest pending state.
    rel(T.fb410, "org_baxter", "Baxter Transit LLC", "leased_owner_operator", "BX-410", "pending_approval", daysAgo(4)),
  ];

  // Meridian dispatches for Baxter. It neither owns these trailers nor runs them.
  const dispatchAccess: TrailerDispatchAccess[] = [
    dispatch(T.bx810, "org_meridian", "Meridian Dispatch", "org_baxter", "Baxter Transit LLC", "BX-810", daysAgo(100)),
    dispatch(T.ch950, "org_meridian", "Meridian Dispatch", "org_baxter", "Baxter Transit LLC", "BX-950", daysAgo(80)),
    // The same two carriers seen by a second dispatch agency, scoped to what
    // Northline granted Summit and nothing else.
    dispatch(T.dv220, "org_summit", "Summit Dispatch", "org_northline", "Northline Freight LLC", "V-220", daysAgo(45)),
    dispatch(T.mc701, "org_summit", "Summit Dispatch", "org_northline", "Northline Freight LLC", "V-701", daysAgo(30)),
  ];

  const attachments: TrailerAttachment[] = [
    // Live: the gooseneck on the hotshot Marcus Hale drives and owns.
    attach(T.gn330, TRUCK_IDS.nl118, "118", "org_northline", "Northline Freight", "attached", daysAgo(60)),
    // Live: the loaded reefer on a tractor, out on a movement.
    // Hooked up and loaded, but not out on a movement — so it can be moved.
    attach(T.rf114, TRUCK_IDS.claimed, "127", "org_northline", "Northline Freight", "attached", daysAgo(2)),
    // This one has the live operating lease, so it really is in motion.
    attach(T.lk702, TRUCK_IDS.nl115, "115", "org_northline", "Northline Freight", "in_movement", daysAgo(1)),
    // History: the same gooseneck was on a different power unit before, and the
    // trailer kept everything when it moved.
    attach(T.gn330, TRUCK_IDS.nl115, "115", "org_northline", "Northline Freight", "detached",
      daysAgo(180), daysAgo(61), "Moved to the hotshot for a Texas run."),
    attach(T.dv220, TRUCK_IDS.claimed, "127", "org_northline", "Northline Freight", "detached",
      daysAgo(40), daysAgo(12), "Dropped at the Chicago yard."),
  ];

  const northlineLk702 = relationships.find(
    (r) => r.trailerId === T.lk702 && r.organizationId === "org_northline",
  )!;
  const leases: TrailerOperatingLease[] = [
    {
      id: "tlease_lk702", trailerId: T.lk702,
      organizationId: "org_northline", organizationName: "Northline Freight",
      relationshipId: northlineLk702.id, status: "active",
      loadReference: "NL-4417", truckId: TRUCK_IDS.nl115,
      reservedAt: daysAgo(1), activatedAt: daysAgo(1),
      expectedEndAt: hoursFromNow(3), termination: {},
      createdAt: daysAgo(1), initiatedByMembershipId: "seed", initiatedByName: "Antcolos",
    },
  ];

  const seedDocuments = () => {
    doc(T.dv220, "registration", "expiring_soon", "org_northline", "reg-v220.pdf", daysFromNow(18));
    doc(T.dv220, "title", "approved", "org_northline", "title-v220.pdf");
    doc(T.dv220, "insurance", "approved", "org_northline", "coi-v220.pdf", daysFromNow(160));
    doc(T.dv220, "annual_inspection", "approved", "org_northline", "inspection-v220.pdf", daysFromNow(210));
    doc(T.rf114, "registration", "approved", "org_northline", "reg-r114.pdf", daysFromNow(210));
    doc(T.rf114, "title", "approved", "org_northline", "title-r114.pdf");
    doc(T.rf114, "reefer_service_record", "approved", "org_northline", "reefer-service-r114.pdf", daysFromNow(135));
    doc(T.fb410, "registration", "approved", "org_northline", "reg-f410.pdf", daysFromNow(150));
    doc(T.fb410, "annual_inspection", "rejected", "org_northline", "inspection-f410.jpg", undefined,
      "The photo cuts off the inspector's signature and the date. Please upload the full page.");
    doc(T.gn330, "registration", "approved", "org_northline", "reg-g330.pdf", daysFromNow(260));
    doc(T.gn330, "lease_agreement", "pending_review", "org_northline", "lease-hale-trailer.pdf");
    doc(T.mt501, "registration", "approved", "org_northline", "reg-s501.pdf", daysFromNow(90));
    doc(T.oos602, "registration", "expired", "org_northline", "reg-v602.pdf", daysFromNow(-30));
    doc(T.mc701, "registration", "approved", "org_northline", "reg-v701.pdf", daysFromNow(300));
    doc(T.mc701, "title", "approved", "org_northline", "title-v701.pdf");
    doc(T.lk702, "registration", "approved", "org_northline", "reg-r702.pdf", daysFromNow(280));
    doc(T.lk702, "reefer_service_record", "approved", "org_northline", "reefer-service-r702.pdf", daysFromNow(160));
    doc(T.bx810, "registration", "approved", "org_baxter", "reg-bx810.pdf", daysFromNow(190));
    doc(T.ch950, "registration", "approved", "org_baxter", "reg-bx950.pdf", daysFromNow(120));
    doc(T.cl901, "registration", "approved", "org_northline", "reg-f901.pdf", daysFromNow(70));
  };

  const claims: TrailerOwnershipClaim[] = [
    {
      id: "tclaim_pending", trailerId: T.cl901,
      claimantOrganizationId: "org_halberd", claimantName: "Halberd Leasing LLC",
      claimedOwnerType: "organization", claimedOwnerName: "Halberd Leasing LLC",
      status: "pending",
      evidence: [{ kind: "title", label: "Title or ownership evidence", fileName: "halberd-trailer-title.pdf", capturedAt: daysAgo(3) }],
      note: "This trailer was part of the November lease buyout along with the tractor.",
      createdAt: daysAgo(3),
    },
  ];

  const movements: TrailerMovementRecord[] = [
    {
      id: "tmv_1", trailerId: T.rf114, truckId: TRUCK_IDS.claimed,
      organizationId: "org_northline", organizationName: "Northline Freight",
      loadReference: "NL-2288", startedAt: daysAgo(2),
      originCity: "Chicago", originState: "IL", destinationCity: "Columbus", destinationState: "OH",
    },
    {
      id: "tmv_2", trailerId: T.dv220, truckId: TRUCK_IDS.claimed,
      organizationId: "org_northline", organizationName: "Northline Freight",
      loadReference: "NL-2201", startedAt: daysAgo(40), endedAt: daysAgo(12),
      originCity: "Chicago", originState: "IL", destinationCity: "Memphis", destinationState: "TN",
    },
  ];

  const events: TrailerEvent[] = [
    evt(T.gn330, "ownership_started", "Halberd Leasing LLC recorded as owner", daysAgo(640)),
    evt(T.gn330, "ownership_ended", "Halberd Leasing LLC ownership ended", daysAgo(210)),
    evt(T.gn330, "ownership_started", "Marcus Hale recorded as owner", daysAgo(210), undefined,
      "Ownership transferred. The trailer, its VIN, documents, attachments and history were unchanged."),
    evt(T.gn330, "relationship_started", "Northline Freight began operating this trailer", daysAgo(200), "org_northline"),
    evt(T.gn330, "attached", "Attached to unit 115", daysAgo(180), "org_northline"),
    evt(T.gn330, "detached", "Detached from unit 115", daysAgo(61), "org_northline",
      "Moved to the hotshot for a Texas run. Nothing else about the trailer changed."),
    evt(T.gn330, "attached", "Attached to unit 118", daysAgo(60), "org_northline"),
    evt(T.rf114, "attached", "Attached to unit 127", daysAgo(2), "org_northline"),
    evt(T.dv220, "detached", "Detached from unit 127", daysAgo(12), "org_northline", "Dropped at the Chicago yard."),
    evt(T.lk702, "lease_activated", "Northline Freight took exclusive operating authority", daysAgo(1), "org_northline"),
    evt(T.lk702, "lease_locked_others", "Activation locked for every other approved carrier", daysAgo(1), "org_northline"),
    evt(T.lk702, "attached", "Attached to unit 115", daysAgo(1), "org_northline"),
    evt(T.fb410, "relationship_requested", "Baxter Transit LLC requested to operate this trailer", daysAgo(4), "org_baxter"),
    evt(T.cl901, "ownership_claim_opened", "Halberd Leasing LLC claimed ownership", daysAgo(3)),
    evt(T.mt501, "status_changed", "Marked in maintenance", daysAgo(3), "org_northline", "Landing gear repair at the Chicago yard."),
    evt(T.oos602, "status_changed", "Withdrawn from service", daysAgo(28), "org_northline", "Failed floor inspection."),
    evt(T.bx810, "dispatch_access_started", "Meridian Dispatch granted dispatch access", daysAgo(100), "org_baxter"),
  ];

  for (const t of trailers) {
    events.push(evt(t.trailerId, "created", "Trailer registered in Antcolos", t.createdAt, t.createdByOrganizationId));
  }

  // Seeded after the registry exists: a document snapshots its trailer's label.
  pendingDocumentSeed = seedDocuments;

  return {
    trailers, ownership, claims, relationships, dispatchAccess,
    attachments, leases, movements, events,
  };
}

/* -------------------------------------------------------------------------- */
/* Context and errors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The caller. Mirrors ServiceContext: an organization and the permissions of
 * the membership acting inside it. Never a user, and never an organization
 * supplied by a form.
 */
export interface TrailerContext {
  organizationId: string;
  membershipId: string;
  actorName: string;
  permissions: ReadonlySet<PermissionKey>;
  /** Present only for a membership scoped to its own records. */
  driverProfileId?: string;
}

export class TrailerPermissionError extends Error {
  missing: PermissionKey[];
  constructor(missing: PermissionKey[]) {
    super(`Missing permission: ${missing.join(", ")}`);
    this.name = "TrailerPermissionError";
    this.missing = missing;
  }
}

/**
 * Thrown for an unknown trailer AND for one this organization may not see.
 * The two are deliberately indistinguishable, so a URL cannot be used to probe
 * whether another carrier's trailer exists.
 */
export class TrailerNotFoundError extends Error {
  constructor() {
    super("Trailer not found");
    this.name = "TrailerNotFoundError";
  }
}

function requirePermissions(ctx: TrailerContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new TrailerPermissionError(missing);
}

/* -------------------------------------------------------------------------- */
/* Relationship accessors                                                      */
/* -------------------------------------------------------------------------- */

function relationshipFor(trailerId: string, organizationId: string) {
  return db().relationships.find(
    (r) => r.trailerId === trailerId && r.organizationId === organizationId && r.status !== "ended",
  );
}

function approvedRelationship(trailerId: string, organizationId: string) {
  const found = relationshipFor(trailerId, organizationId);
  return found?.status === "approved" ? found : undefined;
}

function pendingRelationship(trailerId: string, organizationId: string) {
  const found = relationshipFor(trailerId, organizationId);
  return found && (found.status === "pending_approval" || found.status === "onboarding")
    ? found
    : undefined;
}

function otherApprovedCarrier(trailerId: string, organizationId: string) {
  return db().relationships.find(
    (r) => r.trailerId === trailerId && r.organizationId !== organizationId
      && (r.status === "approved" || r.status === "suspended"),
  );
}

function activeDispatchAccess(trailerId: string, organizationId: string) {
  return db().dispatchAccess.find(
    (d) => d.trailerId === trailerId && d.dispatchOrganizationId === organizationId && d.status === "active",
  );
}

function activeOwnership(trailerId: string) {
  return db().ownership.find((o) => o.trailerId === trailerId && o.status === "active");
}

/* -------------------------------------------------------------------------- */
/* Operating authority accessors                                               */
/* -------------------------------------------------------------------------- */

/** The one lease that currently holds the trailer, if any. */
function holdingLease(trailerId: string) {
  return db().leases.find(
    (l) => l.trailerId === trailerId
      && (l.status === "active" || l.status === "reserved" || l.status === "pending_release"),
  );
}

function leaseFor(trailerId: string, organizationId: string) {
  const held = holdingLease(trailerId);
  return held && held.organizationId === organizationId ? held : undefined;
}

function operatingCarrier(trailerId: string) {
  const held = holdingLease(trailerId);
  if (!held) return undefined;
  return db().relationships.find((r) => r.id === held.relationshipId);
}

export function trailerActivationStateFor(
  trailerId: string,
  organizationId: string,
): AssetActivationState {
  const relationship = db().relationships.find(
    (r) => r.trailerId === trailerId && r.organizationId === organizationId,
  );
  if (!relationship || relationship.status === "ended") return "ended";
  if (relationship.status === "suspended") return "suspended";
  if (relationship.status === "onboarding") return "onboarding";
  if (relationship.status === "pending_approval") return "pending_approval";

  const held = holdingLease(trailerId);
  if (!held) return "available_for_activation";
  if (held.organizationId !== organizationId) return "locked_by_other";
  if (held.status === "reserved") return "activation_reserved";
  if (held.status === "pending_release") return "pending_release";
  return "active_operating_lease";
}

/* -------------------------------------------------------------------------- */
/* Attachment accessors                                                        */
/* -------------------------------------------------------------------------- */

const LIVE_ATTACHMENT_STATUSES: AttachmentStatus[] = [
  "reserved", "attached", "in_movement", "pending_detachment",
];

/**
 * The attachment currently holding the trailer, whatever stage it is at.
 *
 * A reservation counts. It is the moment the trailer is committed to a power
 * unit, and it is what stops two trucks being sent for the same trailer.
 */
function liveAttachmentForTrailer(trailerId: string) {
  return db().attachments.find(
    (a) => a.trailerId === trailerId && LIVE_ATTACHMENT_STATUSES.includes(a.status),
  );
}

/**
 * What a power unit is already pulling.
 *
 * One trailer per power unit. Doubles and triples exist in the world but not in
 * this product, and inventing support for them would be a claim about what
 * Antcolos can dispatch.
 */
function liveAttachmentForTruck(truckId: string) {
  return db().attachments.find(
    (a) => a.truckId === truckId && LIVE_ATTACHMENT_STATUSES.includes(a.status),
  );
}

export function attachmentStateFor(trailerId: string): TrailerAttachmentState {
  const trailer = db().trailers.find((t) => t.trailerId === trailerId);
  if (trailer?.status === "out_of_service") return "out_of_service";
  const live = liveAttachmentForTrailer(trailerId);
  if (!live) return "unattached";
  switch (live.status) {
    case "reserved": return "reserved_for_attachment";
    case "attached": return "attached";
    case "in_movement": return "in_active_movement";
    case "pending_detachment": return "pending_detachment";
    default: return "unattached";
  }
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

export type TrailerAccessReason =
  | "operating_carrier"
  | "pending_relationship"
  | "dispatch_access"
  | "owner";

/**
 * Why — if at all — this organization can see this trailer.
 *
 * Note what is absent: there is no driver reason. A driver does not get the
 * trailer fleet because they are on a truck; trailer visibility comes from an
 * organization relationship and the `trailers:view` permission, and nothing
 * else grants it.
 */
export function trailerAccessReason(
  trailerId: string,
  ctx: TrailerContext,
): TrailerAccessReason | null {
  const relationship = relationshipFor(trailerId, ctx.organizationId);
  if (relationship && relationship.status === "approved") return "operating_carrier";
  if (pendingRelationship(trailerId, ctx.organizationId)) return "pending_relationship";
  if (activeDispatchAccess(trailerId, ctx.organizationId)) return "dispatch_access";
  const owner = activeOwnership(trailerId);
  if (owner?.ownerRef && owner.ownerRef === ctx.organizationId) return "owner";
  return null;
}

function getTrailerOrThrow(trailerId: string, ctx: TrailerContext): Trailer {
  requirePermissions(ctx, "trailers:view");
  const found = db().trailers.find((t) => t.trailerId === trailerId);
  // Unknown id and forbidden id are deliberately indistinguishable.
  if (!found || trailerAccessReason(trailerId, ctx) === null) throw new TrailerNotFoundError();
  return found;
}

/**
 * Whose private records on this trailer this viewer may read.
 *
 * Same rule as trucks: "all" for the recorded owner, otherwise exactly the
 * carriers the viewer is entitled to — itself, or the carrier that granted its
 * dispatch access. This is what stops one approved carrier reading a
 * competitor's unit number, lease dates or load reference while it waits.
 */
function visibleCarrierOrgIds(trailerId: string, ctx: TrailerContext): Set<string> | "all" {
  const owner = activeOwnership(trailerId);
  if (owner?.ownerRef && owner.ownerRef === ctx.organizationId) return "all";
  const ids = new Set<string>();
  if (relationshipFor(trailerId, ctx.organizationId)) ids.add(ctx.organizationId);
  const grant = activeDispatchAccess(trailerId, ctx.organizationId);
  if (grant) ids.add(grant.grantedByCarrierOrganizationId);
  return ids;
}

function canSeeCarrier(visible: Set<string> | "all", organizationId?: string): boolean {
  if (visible === "all") return true;
  return organizationId !== undefined && visible.has(organizationId);
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

const DOC_WARNING_STATUSES = new Set(["expired", "expiring_soon", "rejected", "missing"]);

function documentWarnings(trailerId: string): number {
  return trailerDocumentsFor(trailerId).filter((d) => DOC_WARNING_STATUSES.has(d.status)).length;
}

function project(trailer: Trailer, ctx: TrailerContext): FleetTrailer {
  const relationship = approvedRelationship(trailer.trailerId, ctx.organizationId)
    ?? pendingRelationship(trailer.trailerId, ctx.organizationId);
  const dispatchGrant = activeDispatchAccess(trailer.trailerId, ctx.organizationId);
  const visible = visibleCarrierOrgIds(trailer.trailerId, ctx);
  const live = liveAttachmentForTrailer(trailer.trailerId);
  const state = trailerActivationStateFor(trailer.trailerId, ctx.organizationId);
  const mine = leaseFor(trailer.trailerId, ctx.organizationId);
  // The power unit belongs to whichever carrier hooked it up. Another approved
  // carrier waiting for the trailer is not entitled to know which truck it is on.
  const showAttachment = live !== undefined && canSeeCarrier(visible, live.organizationId);

  return {
    trailerId: trailer.trailerId,
    id: trailer.trailerId,
    organizationId: ctx.organizationId,
    unit: relationship?.unitNumber ?? dispatchGrant?.unitLabel ?? "—",
    carrierName: dispatchGrant?.grantedByCarrierName,
    carrierOrganizationId: dispatchGrant?.grantedByCarrierOrganizationId,
    trailerType: trailer.trailerType,
    status: trailer.status,
    attachmentState: attachmentStateFor(trailer.trailerId),
    attachedTruckId: showAttachment ? live.truckId : undefined,
    attachedTruckUnit: showAttachment ? live.truckUnitLabel : undefined,
    currentCity: trailer.availability.city,
    currentState: trailer.availability.state,
    expectedAvailableAt: trailer.availability.expectedAvailableAt,
    documentWarnings: documentWarnings(trailer.trailerId),
    activationState: state,
    lockedByAnotherCarrier: state === "locked_by_other",
    myLoadReference: mine?.loadReference,
  };
}

/**
 * The organization's trailers.
 *
 * Pending relationships are excluded: a trailer you have asked to run is not
 * yet part of your fleet, and counting it would make the roster lie.
 */
export async function listTrailerFleet(ctx: TrailerContext): Promise<FleetTrailer[]> {
  await sleep(250);
  return trailerFleetSync(ctx);
}

export function trailerFleetSync(ctx: TrailerContext): FleetTrailer[] {
  if (!ctx.permissions.has("trailers:view")) return [];
  return db().trailers
    .filter((t) => {
      const reason = trailerAccessReason(t.trailerId, ctx);
      return reason !== null && reason !== "pending_relationship";
    })
    .map((t) => project(t, ctx));
}

/** Trailers this organization has asked to run but does not yet run. */
export async function listPendingTrailerConnections(ctx: TrailerContext): Promise<
  Array<{ trailer: Trailer; relationship: TrailerCarrierRelationship }>
> {
  await sleep(200);
  if (!ctx.permissions.has("trailers:view")) return [];
  return db().relationships
    .filter((r) => r.organizationId === ctx.organizationId
      && (r.status === "pending_approval" || r.status === "onboarding"))
    .map((r) => ({ trailer: db().trailers.find((t) => t.trailerId === r.trailerId)!, relationship: r }))
    .filter((row) => Boolean(row.trailer));
}

export function trailerCount(ctx: TrailerContext): number {
  return trailerFleetSync(ctx).length;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export interface TrailerProfileView {
  trailer: Trailer;
  accessReason: TrailerAccessReason;
  ownership: TrailerOwnershipRecord[];
  claims: TrailerOwnershipClaim[];
  relationships: TrailerCarrierRelationship[];
  dispatchAccess: TrailerDispatchAccess[];
  attachments: TrailerAttachment[];
  leases: TrailerOperatingLease[];
  documents: TrailerDocument[];
  movements: TrailerMovementRecord[];
  events: TrailerEvent[];
  /** This organization's own live relationship, when it has one. */
  myRelationship?: TrailerCarrierRelationship;
  /** What THIS organization may do with the trailer right now. */
  activationState: AssetActivationState;
  myLease?: TrailerOperatingLease;
  lockedByAnotherCarrier: boolean;
  /** Present only when the viewer is entitled to know who holds the trailer. */
  operatingCarrierName?: string;
  attachmentState: TrailerAttachmentState;
  /** The live attachment, when this viewer may see it. */
  currentAttachment?: TrailerAttachment;
}

const CARRIER_PRIVATE_EVENTS = new Set<TrailerEvent["kind"]>([
  "relationship_requested", "relationship_started", "relationship_ended",
  "relationship_suspended", "relationship_approved", "activation_reserved",
  "lease_activated", "lease_release_requested", "lease_termination_step",
  "lease_ended", "activation_refused", "combination_activated", "combination_refused",
  "attachment_reserved", "attachment_reservation_cancelled", "attached",
  "detach_requested", "detached", "attachment_blocked",
]);

/**
 * The timeline records everything and shows each viewer only what is theirs.
 *
 * A locked-out carrier still sees that the trailer was taken and when — it needs
 * that to understand why it cannot activate — but the line no longer names the
 * carrier, the power unit or the load.
 */
function redactEvent(event: TrailerEvent, visible: Set<string> | "all"): TrailerEvent {
  if (canSeeCarrier(visible, event.organizationId)) return event;
  if (!CARRIER_PRIVATE_EVENTS.has(event.kind)) {
    return { ...event, actorName: undefined };
  }
  return { ...event, summary: "Recorded by another carrier", detail: undefined, actorName: undefined };
}

export async function getTrailerProfile(
  trailerId: string,
  ctx: TrailerContext,
): Promise<TrailerProfileView> {
  await sleep(300);
  const trailer = getTrailerOrThrow(trailerId, ctx);
  const reason = trailerAccessReason(trailerId, ctx)!;
  const visible = visibleCarrierOrgIds(trailerId, ctx);
  const holder = operatingCarrier(trailerId);
  const live = liveAttachmentForTrailer(trailerId);

  const byDate = <T extends { startedAt?: string; createdAt?: string; at?: string }>(a: T, b: T) =>
    String(b.startedAt ?? b.createdAt ?? b.at ?? "").localeCompare(
      String(a.startedAt ?? a.createdAt ?? a.at ?? ""));

  return {
    trailer,
    accessReason: reason,
    ownership: db().ownership.filter((o) => o.trailerId === trailerId).sort(byDate),
    claims: db().claims.filter((c) => c.trailerId === trailerId).sort(byDate),
    // Each carrier's own onboarding, insurance and unit number stay its own.
    relationships: db().relationships
      .filter((r) => r.trailerId === trailerId && canSeeCarrier(visible, r.organizationId))
      .sort(byDate),
    dispatchAccess: db().dispatchAccess
      .filter((d) => d.trailerId === trailerId
        && (canSeeCarrier(visible, d.grantedByCarrierOrganizationId)
          || d.dispatchOrganizationId === ctx.organizationId))
      .sort(byDate),
    attachments: db().attachments
      .filter((a) => a.trailerId === trailerId && canSeeCarrier(visible, a.organizationId))
      .sort(byDate),
    leases: db().leases
      .filter((l) => l.trailerId === trailerId && canSeeCarrier(visible, l.organizationId))
      // Even the owner does not get another carrier's load reference.
      .map((l) => (l.organizationId === ctx.organizationId ? l : { ...l, loadReference: undefined }))
      .sort(byDate),
    documents: trailerDocumentsFor(trailerId).filter(
      (d) => d.trailerId === trailerId
        && (!d.carrierOrganizationId || canSeeCarrier(visible, d.carrierOrganizationId)),
    ),
    movements: db().movements
      .filter((m) => m.trailerId === trailerId && canSeeCarrier(visible, m.organizationId))
      .sort(byDate),
    events: db().events.filter((e) => e.trailerId === trailerId)
      .map((e) => redactEvent(e, visible))
      .sort((a, b) => b.at.localeCompare(a.at)),
    myRelationship: relationshipFor(trailerId, ctx.organizationId),
    activationState: trailerActivationStateFor(trailerId, ctx.organizationId),
    myLease: leaseFor(trailerId, ctx.organizationId),
    lockedByAnotherCarrier: trailerActivationStateFor(trailerId, ctx.organizationId) === "locked_by_other",
    operatingCarrierName: canSeeCarrier(visible, holder?.organizationId)
      ? holder?.organizationName
      : undefined,
    attachmentState: attachmentStateFor(trailerId),
    currentAttachment: live && canSeeCarrier(visible, live.organizationId) ? live : undefined,
  };
}

function record(event: Omit<TrailerEvent, "id">) {
  db().events = [...db().events, { ...event, id: rowId("tevt") }];
}

const ORG_NAMES: Record<string, string> = {
  org_northline: "Northline Freight",
  org_meridian: "Meridian Dispatch",
  org_summit: "Summit Dispatch",
  org_cascade: "Cascade Haul",
  org_baxter: "Baxter Transit LLC",
  org_ridgeway: "Ridgeway Carriers",
  org_crosswind: "Crosswind Freight",
  org_halberd: "Halberd Leasing LLC",
};
function organizationNameFor(id: string): string {
  return ORG_NAMES[id] ?? id;
}

/* -------------------------------------------------------------------------- */
/* THE canonical registration service                                          */
/* -------------------------------------------------------------------------- */

export interface RegisterTrailerInput {
  vin: string;
  trailerType: TrailerType;
  unitNumber: string;
  year: number;
  make: string;
  model: string;
  color?: string;
  registration: TrailerRegistration;
  specs: TrailerSpecs;
  configuration: TrailerConfiguration;
  status: TrailerOperatingStatus;
  availability: Trailer["availability"];
  notes?: string;
  relationshipType: CarrierRelationshipType;
  /** First ownership, for a genuinely new trailer. */
  ownerType: OwnerType;
  ownerName: string;
  ownerRef?: string;
  /** Filenames only. Nothing is uploaded — see addTrailerDocument. */
  evidence: TrailerDocumentSnapshot[];
}

export type RegisterTrailerOutcome =
  | { status: "created"; trailer: Trailer }
  | { status: "existing_connected"; trailer: Trailer; relationship: TrailerCarrierRelationship }
  | { status: "relationship_pending"; trailer: Trailer; relationship: TrailerCarrierRelationship; currentOperator?: string }
  | { status: "ownership_claim_required"; trailer: Trailer; currentOwnerName: string }
  | { status: "invalid_vin"; message: string }
  | { status: "missing_evidence"; message: string }
  | { status: "unauthorized"; missing: PermissionKey[] };

/**
 * The one way a trailer enters Antcolos or gains a new carrier.
 *
 * Manual entry, document scanning and owner-operator equipment setup all land
 * here, so they cannot drift apart and quietly grow different duplicate rules.
 * The order matters: normalize, validate, then look for an existing trailer
 * BEFORE considering creating one. A second submission of a VIN never creates a
 * second trailer and never overwrites the first.
 */
export async function registerOrConnectTrailer(
  ctx: TrailerContext,
  input: RegisterTrailerInput,
): Promise<RegisterTrailerOutcome> {
  await sleep(LATENCY_MS);

  const missing = (["trailers:create", "trailers:relationships:manage"] as PermissionKey[])
    .filter((k) => !ctx.permissions.has(k));
  if (missing.length) return { status: "unauthorized", missing };

  const vinProblem = validateVin(input.vin);
  if (vinProblem) return { status: "invalid_vin", message: vinProblem };
  const vin = normalizeVin(input.vin);

  const existing = db().trailers.find((t) => t.vin === vin);

  /* ---- A trailer we have never seen: create it, and its first ownership ---- */
  if (!existing) {
    // A genuinely new trailer needs at least one ownership document. Nothing is
    // uploaded or read; we require that somebody at least chose a file.
    const hasEvidence = input.evidence.some((e) => e.kind === "title" || e.kind === "registration");
    if (!hasEvidence) {
      return {
        status: "missing_evidence",
        message: "A new trailer needs a title or a registration before it can be created.",
      };
    }

    const trailerId = uuid();
    const at = iso(now());
    const created: Trailer = {
      trailerId,
      vin,
      trailerType: input.trailerType,
      year: input.year,
      make: input.make.trim(),
      model: input.model.trim(),
      color: input.color?.trim() || undefined,
      registration: input.registration,
      specs: input.specs,
      configuration: input.configuration,
      status: input.status,
      availability: input.availability,
      notes: input.notes?.trim() || undefined,
      createdAt: at,
      createdByOrganizationId: ctx.organizationId,
    };
    db().trailers = [created, ...db().trailers];

    db().ownership = [
      {
        id: rowId("town"),
        trailerId,
        ownerType: input.ownerType,
        ownerName: input.ownerName.trim(),
        ownerRef: input.ownerRef,
        startedAt: at,
        status: "active",
        evidence: input.evidence,
        createdByMembershipId: ctx.membershipId,
        createdByName: ctx.actorName,
        createdAt: at,
      },
      ...db().ownership,
    ];

    const relationship = rel(
      trailerId, ctx.organizationId, organizationNameFor(ctx.organizationId),
      input.relationshipType, input.unitNumber.trim(), "approved", at,
    );
    db().relationships = [relationship, ...db().relationships];

    record({ trailerId, at, kind: "created", summary: "Trailer registered in Antcolos", organizationId: ctx.organizationId, actorName: ctx.actorName });
    record({ trailerId, at, kind: "ownership_started", summary: `${input.ownerName.trim()} recorded as owner`, organizationId: ctx.organizationId, actorName: ctx.actorName });
    record({ trailerId, at, kind: "relationship_started", summary: `${organizationNameFor(ctx.organizationId)} began operating this trailer`, organizationId: ctx.organizationId, actorName: ctx.actorName });
    return { status: "created", trailer: created };
  }

  /* ---- The VIN is already a trailer. Never create a second one. ---- */
  const mineApproved = approvedRelationship(existing.trailerId, ctx.organizationId);
  if (mineApproved) {
    return { status: "existing_connected", trailer: existing, relationship: mineApproved };
  }

  const minePending = pendingRelationship(existing.trailerId, ctx.organizationId);
  if (minePending) {
    return {
      status: "relationship_pending",
      trailer: existing,
      relationship: minePending,
      currentOperator: operatingCarrier(existing.trailerId)?.organizationName,
    };
  }

  const owner = activeOwnership(existing.trailerId);
  const ownedByMe = owner?.ownerRef === ctx.organizationId;
  const other = otherApprovedCarrier(existing.trailerId, ctx.organizationId);

  // Somebody else is already onboarded on it. Ask, never take.
  if (other) {
    const at = iso(now());
    const requested = rel(
      existing.trailerId, ctx.organizationId, organizationNameFor(ctx.organizationId),
      input.relationshipType, input.unitNumber.trim(), "pending_approval", at,
    );
    db().relationships = [requested, ...db().relationships];
    record({
      trailerId: existing.trailerId, at, kind: "relationship_requested",
      summary: `${organizationNameFor(ctx.organizationId)} requested to operate this trailer`,
      detail: "Nothing changes for any other carrier until this is approved.",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return {
      status: "relationship_pending", trailer: existing, relationship: requested,
      currentOperator: other.organizationName,
    };
  }

  // Nobody is onboarded on it and somebody else owns it: an ownership question,
  // not an operating one, and not ours to answer.
  if (owner && !ownedByMe) {
    return { status: "ownership_claim_required", trailer: existing, currentOwnerName: owner.ownerName };
  }

  // Ours already, or ownerless: connect it.
  const at = iso(now());
  const relationship = rel(
    existing.trailerId, ctx.organizationId, organizationNameFor(ctx.organizationId),
    input.relationshipType, input.unitNumber.trim(), "approved", at,
  );
  db().relationships = [relationship, ...db().relationships];
  record({
    trailerId: existing.trailerId, at, kind: "relationship_started",
    summary: `${organizationNameFor(ctx.organizationId)} began operating this trailer`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { status: "existing_connected", trailer: existing, relationship };
}

/** Look a VIN up before committing to anything. Used by the wizard's VIN step. */
export interface TrailerVinLookupResult {
  vin: string;
  trailer?: Trailer;
  operatorName?: string;
  ownerName?: string;
  alreadyConnected: boolean;
  pendingForMe: boolean;
  /** What this organization's relationship with it currently is, if any. */
  myRelationshipStatus?: CarrierRelationshipStatus;
  activationState?: AssetActivationState;
}

export async function lookUpTrailerVin(
  vin: string,
  ctx: TrailerContext,
): Promise<TrailerVinLookupResult> {
  await sleep(400);
  const normalized = normalizeVin(vin);
  const trailer = db().trailers.find((t) => t.vin === normalized);
  if (!trailer) return { vin: normalized, alreadyConnected: false, pendingForMe: false };

  const mine = db().relationships.find(
    (r) => r.trailerId === trailer.trailerId && r.organizationId === ctx.organizationId,
  );
  return {
    vin: normalized,
    trailer,
    operatorName: (operatingCarrier(trailer.trailerId)
      ?? otherApprovedCarrier(trailer.trailerId, ctx.organizationId))?.organizationName,
    ownerName: activeOwnership(trailer.trailerId)?.ownerName,
    alreadyConnected: Boolean(approvedRelationship(trailer.trailerId, ctx.organizationId)),
    pendingForMe: Boolean(pendingRelationship(trailer.trailerId, ctx.organizationId)),
    myRelationshipStatus: mine?.status,
    activationState: mine ? trailerActivationStateFor(trailer.trailerId, ctx.organizationId) : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Ownership                                                                   */
/* -------------------------------------------------------------------------- */

export async function openTrailerOwnershipClaim(
  trailerId: string,
  ctx: TrailerContext,
  input: { claimedOwnerType: OwnerType; claimedOwnerName: string; note?: string; evidence: TrailerDocumentSnapshot[] },
): Promise<TrailerOwnershipClaim> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trailers:create");
  const trailer = db().trailers.find((t) => t.trailerId === trailerId);
  if (!trailer) throw new TrailerNotFoundError();

  const at = iso(now());
  const claim: TrailerOwnershipClaim = {
    id: rowId("tclaim"),
    trailerId,
    claimantOrganizationId: ctx.organizationId,
    claimantName: organizationNameFor(ctx.organizationId),
    claimedOwnerType: input.claimedOwnerType,
    claimedOwnerName: input.claimedOwnerName.trim(),
    status: "pending",
    evidence: input.evidence,
    note: input.note?.trim() || undefined,
    createdAt: at,
  };
  db().claims = [claim, ...db().claims];
  record({
    trailerId, at, kind: "ownership_claim_opened",
    summary: `${claim.claimantName} claimed ownership`,
    detail: "Nothing about the trailer changes unless the current owner accepts.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...claim };
}

export async function listTrailerClaimsToReview(ctx: TrailerContext): Promise<
  Array<{ claim: TrailerOwnershipClaim; trailer: Trailer }>
> {
  await sleep(250);
  if (!ctx.permissions.has("trailers:ownership:review")) return [];
  return db().claims
    .filter((c) => c.status === "pending" || c.status === "manual_review")
    .map((c) => ({ claim: c, trailer: db().trailers.find((t) => t.trailerId === c.trailerId)! }))
    .filter((row) => row.trailer && activeOwnership(row.trailer.trailerId)?.ownerRef === ctx.organizationId);
}

export type TrailerClaimDecision = "accept" | "reject" | "manual_review";

/**
 * Resolve an ownership claim.
 *
 * An accepted transfer touches TWO things and nothing else: it ends one
 * ownership record, opens another, and writes a timeline event. The trailer,
 * its id, its VIN, its specifications, its configuration, its documents, its
 * carrier relationships, its attachments, its movements and its leases are all
 * left exactly as they were, and there is a test that snapshots them to prove
 * it.
 */
export async function resolveTrailerOwnershipClaim(
  claimId: string,
  decision: TrailerClaimDecision,
  ctx: TrailerContext,
  note?: string,
): Promise<TrailerOwnershipClaim> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trailers:ownership:review");

  const claim = db().claims.find((c) => c.id === claimId);
  if (!claim) throw new TrailerNotFoundError();
  // Only the recorded owner decides. Anybody else gets the same answer as an
  // id that does not exist.
  const current = activeOwnership(claim.trailerId);
  if (!current || current.ownerRef !== ctx.organizationId) throw new TrailerNotFoundError();

  const at = iso(now());
  const resolved: TrailerOwnershipClaim = {
    ...claim,
    status: decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "manual_review",
    resolvedAt: decision === "manual_review" ? undefined : at,
    resolutionNote: note?.trim() || undefined,
  };
  db().claims = db().claims.map((c) => (c.id === claimId ? resolved : c));

  if (decision === "accept") {
    db().ownership = db().ownership.map((o) =>
      o.id === current.id ? { ...o, status: "ended" as const, endedAt: at } : o);
    db().ownership = [
      {
        id: rowId("town"),
        trailerId: claim.trailerId,
        ownerType: claim.claimedOwnerType,
        ownerName: claim.claimedOwnerName,
        ownerRef: claim.claimantOrganizationId,
        startedAt: at,
        status: "active",
        evidence: claim.evidence,
        createdByMembershipId: ctx.membershipId,
        createdByName: ctx.actorName,
        createdAt: at,
      },
      ...db().ownership,
    ];
    record({
      trailerId: claim.trailerId, at, kind: "ownership_ended",
      summary: `${current.ownerName} ownership ended`, organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    record({
      trailerId: claim.trailerId, at, kind: "ownership_started",
      summary: `${claim.claimedOwnerName} recorded as owner`,
      detail: "Ownership transferred. The trailer, its id, VIN, specifications, documents, carrier relationships, attachments and history were unchanged.",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  } else {
    record({
      trailerId: claim.trailerId, at, kind: "ownership_claim_resolved",
      summary: decision === "reject" ? "Ownership claim rejected" : "Ownership claim sent to manual review",
      detail: note?.trim() || undefined,
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  }
  return { ...resolved };
}

/* -------------------------------------------------------------------------- */
/* Carrier relationships                                                       */
/* -------------------------------------------------------------------------- */

/** Approve an onboarding relationship so that carrier becomes eligible. */
export async function approveTrailerCarrierRelationship(
  relationshipId: string,
  ctx: TrailerContext,
): Promise<TrailerCarrierRelationship> {
  await sleep(350);
  requirePermissions(ctx, "trailers:relationships:manage");
  const relationship = db().relationships.find((r) => r.id === relationshipId);
  if (!relationship) throw new TrailerNotFoundError();

  const owner = activeOwnership(relationship.trailerId);
  const allowed = relationship.organizationId === ctx.organizationId
    || (owner?.ownerRef !== undefined && owner.ownerRef === ctx.organizationId);
  if (!allowed) throw new TrailerNotFoundError();
  if (relationship.status !== "pending_approval" && relationship.status !== "onboarding") {
    return { ...relationship };
  }

  const at = iso(now());
  const approved: TrailerCarrierRelationship = { ...relationship, status: "approved", approvedAt: at };
  db().relationships = db().relationships.map((r) => (r.id === relationshipId ? approved : r));
  record({
    trailerId: relationship.trailerId, at, kind: "relationship_approved",
    summary: `${relationship.organizationName} approved to operate this trailer`,
    detail: "Eligible to activate when the trailer is free. Not operating yet.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...approved };
}

/**
 * End this organization's relationship with a trailer.
 *
 * The relationship ends; the trailer does not. Its record, ownership, documents,
 * attachment history, movements and timeline all survive, and the organization
 * simply stops being able to see it.
 */
export async function endTrailerCarrierRelationship(
  relationshipId: string,
  reason: string,
  ctx: TrailerContext,
): Promise<TrailerCarrierRelationship> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trailers:relationships:manage");
  const relationship = db().relationships.find((r) => r.id === relationshipId);
  if (!relationship || relationship.organizationId !== ctx.organizationId) {
    throw new TrailerNotFoundError();
  }

  const at = iso(now());
  // Anything live is closed with the relationship rather than left dangling.
  const live = liveAttachmentForTrailer(relationship.trailerId);
  if (live && live.organizationId === ctx.organizationId) {
    db().attachments = db().attachments.map((a) =>
      a.id === live.id
        ? { ...a, status: "detached" as const, detachedAt: at, detachReason: "The carrier relationship ended." }
        : a);
    record({
      trailerId: relationship.trailerId, at, kind: "detached",
      summary: `Detached from unit ${live.truckUnitLabel}`,
      detail: "The carrier relationship ended. The attachment history is kept.",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  }

  const ended: TrailerCarrierRelationship = {
    ...relationship, status: "ended", endedAt: at, endReason: reason.trim() || undefined,
  };
  db().relationships = db().relationships.map((r) => (r.id === relationshipId ? ended : r));

  // Documents survive. This carrier's links are closed and its shares revoked,
  // a snapshot of each is kept, and no record, version or event is deleted.
  endRelationshipDocuments({
    subjectKind: "trailer",
    subjectId: relationship.trailerId,
    organizationId: ctx.organizationId,
    reason: reason.trim() || "Carrier relationship ended.",
    actorName: ctx.actorName,
  });

  record({
    trailerId: relationship.trailerId, at, kind: "relationship_ended",
    summary: `${relationship.organizationName} stopped operating this trailer`,
    detail: reason.trim() || undefined,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...ended };
}

/* -------------------------------------------------------------------------- */
/* Status and availability                                                     */
/* -------------------------------------------------------------------------- */

export async function setTrailerStatus(
  trailerId: string,
  status: TrailerOperatingStatus,
  ctx: TrailerContext,
  availability?: Partial<Trailer["availability"]>,
): Promise<Trailer> {
  await sleep(300);
  requirePermissions(ctx, "trailers:status:manage");
  // Only a carrier that is actually onboarded may change the equipment's state.
  if (!approvedRelationship(trailerId, ctx.organizationId)) throw new TrailerNotFoundError();
  const trailer = db().trailers.find((t) => t.trailerId === trailerId);
  if (!trailer) throw new TrailerNotFoundError();

  const at = iso(now());
  const updated: Trailer = {
    ...trailer,
    status,
    availability: availability ? { ...trailer.availability, ...availability } : trailer.availability,
  };
  db().trailers = db().trailers.map((t) => (t.trailerId === trailerId ? updated : t));

  record({
    trailerId, at, kind: "status_changed",
    summary: `Status changed to ${TRAILER_STATUS_LABEL[status]}`,
    detail: availability?.unavailableReason,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  if (availability && (availability.city || availability.expectedAvailableAt || availability.expectedCity)) {
    record({
      trailerId, at, kind: "availability_changed",
      summary: "Availability updated",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  }
  // A change of operational status is not a change of ownership, of carrier
  // relationship or of operating authority, and deliberately touches none.
  return { ...updated };
}

const TRAILER_STATUS_LABEL: Record<TrailerOperatingStatus, string> = {
  available: "Available",
  attached: "Attached",
  loaded: "Loaded",
  expected_available: "Expected available",
  maintenance: "Maintenance",
  out_of_service: "Out of service",
};

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Record that somebody chose a file.
 *
 * That is genuinely all this does. The browser gives us a name, a type and a
 * size; nothing is uploaded, stored, opened, scanned or verified, and the
 * status the document lands in says exactly that.
 */
export async function addTrailerDocument(
  trailerId: string,
  kind: TrailerDocumentKind,
  file: { name: string; type?: string; size?: number },
  ctx: TrailerContext,
  expiresAt?: string,
): Promise<TrailerDocument> {
  await sleep(400);
  requirePermissions(ctx, "trailers:documents:manage");
  if (!approvedRelationship(trailerId, ctx.organizationId)) throw new TrailerNotFoundError();

  // A replacement supersedes the old record; it never deletes it. The shared
  // store owns that rule, so trailers version exactly as trucks and drivers do.
  const { record: created } = addAssetDocument(TRAILER_DOCUMENTS, {
    assetId: trailerId,
    assetLabel: trailerLabel(trailerId),
    assetHref: `/fleet/trailers/${trailerId}`,
    kind, file,
    organizationId: ctx.organizationId,
    organizationName: ORG_DISPLAY_NAMES[ctx.organizationId] ?? ctx.organizationId,
    actorName: ctx.actorName,
    membershipId: ctx.membershipId,
    expiresAt,
  });
  record({
    trailerId, at: iso(now()), kind: "document_added",
    summary: `${TRAILER_DOCUMENT_LABEL[kind] ?? kind} selected`,
    detail: "Chosen in the browser only. Nothing was uploaded, stored, read or verified.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  const row = trailerDocumentById(created.documentId);
  if (!row) throw new TrailerNotFoundError();
  return row;
}

/** Send a selected document for review. Still nothing leaves the browser. */
export async function submitTrailerDocument(
  documentId: string,
  ctx: TrailerContext,
): Promise<TrailerDocument> {
  await sleep(350);
  requirePermissions(ctx, "trailers:documents:manage");
  const document = trailerDocumentById(documentId);
  if (!document) throw new TrailerNotFoundError();
  if (!approvedRelationship(document.trailerId, ctx.organizationId)) throw new TrailerNotFoundError();

  submitAssetDocument(documentId, ctx.actorName, ctx.organizationId);
  record({
    trailerId: document.trailerId, at: iso(now()), kind: "document_reviewed",
    summary: `${TRAILER_DOCUMENT_LABEL[document.kind] ?? document.kind} sent for review`,
    detail: "Pending review. Nobody has looked at it and nothing was verified.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  const row = trailerDocumentById(documentId);
  if (!row) throw new TrailerNotFoundError();
  return row;
}

/* -------------------------------------------------------------------------- */
/* Compatibility, relationship-aware                                           */
/* -------------------------------------------------------------------------- */

/**
 * The whole question: may THIS organization put THIS trailer on THAT power unit?
 *
 * Mechanical fit is only part of it, and it is checked last, because a
 * perfectly matched fifth wheel is no use when the trailer is under another
 * carrier's lease. The order below is the order a person would think in:
 * am I allowed, is either asset spoken for, is either out of service, am I
 * approved on both, and only then — does it actually fit?
 *
 * `missing_required_data` is a real answer rather than an error. Antcolos often
 * has no tow rating for a pickup, and saying "compatible" without one would be
 * a claim nobody checked.
 */
export function evaluateAttachmentSync(
  trailerId: string,
  truckId: string,
  ctx: TrailerContext,
): CompatibilityResult {
  const deny = (verdict: CompatibilityVerdict, reason: string, missing: string[] = []): CompatibilityResult =>
    ({ verdict, reasons: [reason], missing, fullyChecked: false });

  if (!ctx.permissions.has("trailers:attachments:manage")) {
    return deny("unauthorized", "You do not have permission to attach or detach trailers.");
  }

  const trailer = db().trailers.find((t) => t.trailerId === trailerId);
  if (!trailer || trailerAccessReason(trailerId, ctx) === null) {
    return deny("trailer_unavailable", "This trailer is not available to your organization.");
  }
  const truck = truckRecord(truckId);
  if (!truck) {
    return deny("power_unit_unavailable", "That power unit is not available to your organization.");
  }
  // The power unit must be one this organization can actually operate. Reusing
  // the truck registry's own answer keeps the two registries from disagreeing.
  const truckState = truckActivationStateFor(truckId, ctx.organizationId);
  if (truckState === "ended" || truckState === "suspended") {
    return deny("power_unit_unavailable", "Your organization does not operate that power unit.");
  }

  /* ---- Out of service or in the shop, before anything else ----
     A trailer in the shop cannot be hooked to anything, and saying "that truck
     is busy" would send somebody looking for a different truck. */
  if (trailer.status === "out_of_service") {
    return deny("trailer_unavailable", "This trailer is out of service and cannot be attached.");
  }
  if (trailer.status === "maintenance") {
    return deny("trailer_unavailable", "This trailer is in maintenance and cannot be attached.");
  }
  if (truck.status === "maintenance") {
    return deny("power_unit_unavailable", "That power unit is in maintenance and cannot take a trailer.");
  }
  if (truck.status === "unavailable") {
    return deny("power_unit_unavailable", "That power unit is marked unavailable.");
  }

  /* ---- Approval on both assets ---- */
  if (!approvedRelationship(trailerId, ctx.organizationId)) {
    return deny("carrier_not_approved", "Your organization is not approved to operate this trailer yet.");
  }
  if (truckState === "onboarding" || truckState === "pending_approval") {
    return deny("carrier_not_approved", "Your organization is not approved to operate that power unit yet.");
  }

  /* ---- Somebody else's operating lease ----
     Checked before occupancy on purpose: a locked-out carrier is entitled to
     know the trailer is unavailable, but not which power unit somebody else has
     put it on, so the lock has to be the answer it gets. */
  if (trailerActivationStateFor(trailerId, ctx.organizationId) === "locked_by_other") {
    return deny(
      "locked_by_other_carrier",
      "This trailer is under another carrier's active operating lease.",
    );
  }
  if (truckState === "locked_by_other") {
    return deny(
      "locked_by_other_carrier",
      "That power unit is under another carrier's active operating lease.",
    );
  }

  /* ---- Already spoken for ---- */
  const visible = visibleCarrierOrgIds(trailerId, ctx);
  const trailerLive = liveAttachmentForTrailer(trailerId);
  if (trailerLive && trailerLive.truckId !== truckId) {
    // Another carrier's unit number is theirs. Say it is taken, not by what.
    const where = canSeeCarrier(visible, trailerLive.organizationId)
      ? `unit ${trailerLive.truckUnitLabel}`
      : "another power unit";
    return trailerLive.status === "reserved"
      ? deny("reserved", `This trailer is already reserved for ${where}.`)
      : deny("already_attached", `This trailer is already attached to ${where}.`);
  }
  const truckLive = liveAttachmentForTruck(truckId);
  if (truckLive && truckLive.trailerId !== trailerId) {
    return deny(
      "already_attached",
      "That power unit is already pulling a trailer. Antcolos supports one trailer per power unit.",
    );
  }

  /* ---- Only now, does it physically fit? ---- */
  const mechanical = checkMechanicalCompatibility(truck, trailer);
  return { ...mechanical };
}

export async function evaluateAttachment(
  trailerId: string,
  truckId: string,
  ctx: TrailerContext,
): Promise<CompatibilityResult> {
  await sleep(300);
  return evaluateAttachmentSync(trailerId, truckId, ctx);
}

/**
 * Every power unit this organization could put this trailer on, with the
 * verdict for each. Used by the attach screen so the reason is visible before
 * anybody presses anything.
 */
export interface CompatibilityCandidate {
  truckId: string;
  unit: string;
  equipment: string;
  result: CompatibilityResult;
}

export async function listAttachmentCandidates(
  trailerId: string,
  ctx: TrailerContext,
): Promise<CompatibilityCandidate[]> {
  await sleep(350);
  if (!ctx.permissions.has("trailers:view") || !ctx.permissions.has("trucks:view")) return [];
  const { fleetSync } = await import("./truck-registry");
  const trucks = fleetSync({
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actorName,
    permissions: ctx.permissions,
  });
  return trucks.map((t) => ({
    truckId: t.truckId,
    unit: t.unit,
    equipment: t.equipment,
    result: evaluateAttachmentSync(trailerId, t.truckId, ctx),
  }));
}

/* -------------------------------------------------------------------------- */
/* Attachment                                                                  */
/* -------------------------------------------------------------------------- */

export type AttachOutcome =
  | { status: "reserved"; attachment: TrailerAttachment }
  | { status: "attached"; attachment: TrailerAttachment }
  | { status: "refused"; result: CompatibilityResult };

/**
 * Put a trailer on a power unit, or commit it to one.
 *
 * The check and the write happen together, synchronously, with no await between
 * them. That is what makes two dispatchers racing for the same trailer safe:
 * the simulated latency is taken first, then one caller runs this block to
 * completion before the other can start, and the loser is told the trailer is
 * already taken. Splitting the check from the write — even by one await — would
 * let both win and send two trucks for one trailer.
 */
export async function attachTrailer(
  trailerId: string,
  truckId: string,
  ctx: TrailerContext,
  options: { reserveOnly?: boolean } = {},
): Promise<AttachOutcome> {
  // All latency BEFORE the critical section, never inside it.
  await sleep(LATENCY_MS);

  /* ---- critical section: no awaits from here to the return ---- */
  const result = evaluateAttachmentSync(trailerId, truckId, ctx);
  if (result.verdict !== "compatible" && result.verdict !== "missing_required_data") {
    const at = iso(now());
    record({
      trailerId, at, kind: "attachment_blocked",
      summary: "Attachment refused",
      detail: result.reasons[0],
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { status: "refused", result };
  }

  const at = iso(now());
  const existing = liveAttachmentForTrailer(trailerId);

  // Confirming our own reservation upgrades it rather than double-booking.
  if (existing && existing.truckId === truckId) {
    if (existing.status === "reserved" && !options.reserveOnly) {
      const upgraded: TrailerAttachment = { ...existing, status: "attached", attachedAt: at };
      db().attachments = db().attachments.map((a) => (a.id === existing.id ? upgraded : a));
      markAttachedStatus(trailerId);
      /* ---- end critical section ---- */
      record({
        trailerId, at, kind: "attached", summary: `Attached to unit ${upgraded.truckUnitLabel}`,
        organizationId: ctx.organizationId, actorName: ctx.actorName,
      });
      return { status: "attached", attachment: { ...upgraded } };
    }
    return existing.status === "reserved"
      ? { status: "reserved", attachment: { ...existing } }
      : { status: "attached", attachment: { ...existing } };
  }

  const unitLabel = truckUnitLabelFor(truckId, ctx);
  const attachment: TrailerAttachment = {
    id: rowId("tatt"),
    trailerId,
    truckId,
    truckUnitLabel: unitLabel,
    organizationId: ctx.organizationId,
    organizationName: organizationNameFor(ctx.organizationId),
    status: options.reserveOnly ? "reserved" : "attached",
    reservedAt: at,
    attachedAt: options.reserveOnly ? undefined : at,
    createdByMembershipId: ctx.membershipId,
    createdByName: ctx.actorName,
    createdAt: at,
  };
  db().attachments = [attachment, ...db().attachments];
  if (!options.reserveOnly) markAttachedStatus(trailerId);
  /* ---- end critical section ---- */

  record({
    trailerId, at,
    kind: options.reserveOnly ? "attachment_reserved" : "attached",
    summary: options.reserveOnly
      ? `Reserved for unit ${unitLabel}`
      : `Attached to unit ${unitLabel}`,
    detail: result.verdict === "missing_required_data"
      ? `Attached, but Antcolos could not fully check the pairing: ${result.missing.join("; ")}.`
      : undefined,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return options.reserveOnly
    ? { status: "reserved", attachment: { ...attachment } }
    : { status: "attached", attachment: { ...attachment } };
}

/** An available trailer that gets hooked up reads as attached, not available. */
function markAttachedStatus(trailerId: string) {
  const trailer = db().trailers.find((t) => t.trailerId === trailerId);
  if (!trailer || trailer.status !== "available") return;
  db().trailers = db().trailers.map((t) =>
    t.trailerId === trailerId ? { ...t, status: "attached" as const } : t);
}

/**
 * The label to write into the attachment record.
 *
 * A unit number belongs to the carrier relationship, not to the truck, so it is
 * read from the truck registry rather than guessed at — and it is snapshotted
 * here so an attachment from two years ago still reads sensibly after the truck
 * has moved to another carrier and been renumbered.
 */
function truckUnitLabelFor(truckId: string, ctx: TrailerContext): string {
  return truckUnitNumber(truckId, ctx.organizationId)
    ?? truckRecord(truckId)?.registration.plateNumber
    ?? "—";
}

/** Cancel a reservation before the trailer is ever hooked up. */
export async function cancelAttachmentReservation(
  attachmentId: string,
  ctx: TrailerContext,
): Promise<TrailerAttachment> {
  await sleep(300);
  requirePermissions(ctx, "trailers:attachments:manage");
  const attachment = db().attachments.find((a) => a.id === attachmentId);
  if (!attachment || attachment.organizationId !== ctx.organizationId) throw new TrailerNotFoundError();
  if (attachment.status !== "reserved") throw new TrailerNotFoundError();

  const at = iso(now());
  const cancelled: TrailerAttachment = { ...attachment, status: "detached", detachedAt: at, detachReason: "Reservation cancelled." };
  db().attachments = db().attachments.map((a) => (a.id === attachmentId ? cancelled : a));
  record({
    trailerId: attachment.trailerId, at, kind: "attachment_reservation_cancelled",
    summary: `Reservation for unit ${attachment.truckUnitLabel} cancelled`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...cancelled };
}

/** Mark an attachment as being on a live movement. */
export async function markAttachmentInMovement(
  attachmentId: string,
  ctx: TrailerContext,
): Promise<TrailerAttachment> {
  await sleep(300);
  requirePermissions(ctx, "trailers:attachments:manage");
  const attachment = db().attachments.find((a) => a.id === attachmentId);
  if (!attachment || attachment.organizationId !== ctx.organizationId) throw new TrailerNotFoundError();
  if (attachment.status !== "attached") throw new TrailerNotFoundError();

  const updated: TrailerAttachment = { ...attachment, status: "in_movement" };
  db().attachments = db().attachments.map((a) => (a.id === attachmentId ? updated : a));
  return { ...updated };
}

export type DetachOutcome =
  | { status: "detached"; attachment: TrailerAttachment }
  | { status: "blocked"; reason: string };

/**
 * Ask for a trailer to come off, then take it off.
 *
 * A trailer on a live movement cannot simply be unhooked: the movement has to
 * be finished first, exactly as an operating lease has to be released rather
 * than expired. `requestDetach` records the intent; `detachTrailer` completes
 * it once nothing is in motion.
 */
export async function requestDetach(
  attachmentId: string,
  ctx: TrailerContext,
): Promise<TrailerAttachment> {
  await sleep(300);
  requirePermissions(ctx, "trailers:attachments:manage");
  const attachment = db().attachments.find((a) => a.id === attachmentId);
  if (!attachment || attachment.organizationId !== ctx.organizationId) throw new TrailerNotFoundError();
  if (!LIVE_ATTACHMENT_STATUSES.includes(attachment.status)) throw new TrailerNotFoundError();

  const at = iso(now());
  const updated: TrailerAttachment = { ...attachment, status: "pending_detachment", detachRequestedAt: at };
  db().attachments = db().attachments.map((a) => (a.id === attachmentId ? updated : a));
  record({
    trailerId: attachment.trailerId, at, kind: "detach_requested",
    summary: `Detachment requested from unit ${attachment.truckUnitLabel}`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...updated };
}

export async function detachTrailer(
  attachmentId: string,
  reason: string,
  ctx: TrailerContext,
): Promise<DetachOutcome> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trailers:attachments:manage");
  const attachment = db().attachments.find((a) => a.id === attachmentId);
  if (!attachment || attachment.organizationId !== ctx.organizationId) throw new TrailerNotFoundError();
  if (!LIVE_ATTACHMENT_STATUSES.includes(attachment.status)) throw new TrailerNotFoundError();

  if (attachment.status === "in_movement") {
    return {
      status: "blocked",
      reason: "This trailer is on a live movement. Finish the movement before unhooking it.",
    };
  }

  const at = iso(now());
  const detached: TrailerAttachment = {
    ...attachment, status: "detached", detachedAt: at, detachReason: reason.trim() || undefined,
  };
  db().attachments = db().attachments.map((a) => (a.id === attachmentId ? detached : a));

  // An attached trailer that comes off is available again. A trailer in
  // maintenance or out of service stays exactly where it was.
  const trailer = db().trailers.find((t) => t.trailerId === attachment.trailerId);
  if (trailer && trailer.status === "attached") {
    db().trailers = db().trailers.map((t) =>
      t.trailerId === attachment.trailerId ? { ...t, status: "available" as const } : t);
  }

  record({
    trailerId: attachment.trailerId, at, kind: "detached",
    summary: `Detached from unit ${attachment.truckUnitLabel}`,
    detail: reason.trim() || "The trailer keeps its id, documents and full history.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { status: "detached", attachment: { ...detached } };
}

/**
 * Move a trailer straight from one power unit to another.
 *
 * One call, so there is no window in which the trailer looks free and somebody
 * else grabs it. If the new pairing is refused, the old attachment is left
 * exactly as it was.
 */
export async function reassignTrailer(
  trailerId: string,
  toTruckId: string,
  reason: string,
  ctx: TrailerContext,
): Promise<AttachOutcome> {
  await sleep(LATENCY_MS);

  /* ---- critical section: no awaits from here to the return ---- */
  const existing = liveAttachmentForTrailer(trailerId);
  if (existing && existing.status === "in_movement") {
    return {
      status: "refused",
      result: {
        verdict: "already_attached",
        reasons: ["This trailer is on a live movement. Finish the movement before moving it to another power unit."],
        missing: [], fullyChecked: true,
      },
    };
  }

  // Evaluate the new pairing as though the trailer were already free, because
  // the whole point of a reassignment is that it is coming off this unit.
  const at = iso(now());
  const saved = existing;
  if (saved) {
    db().attachments = db().attachments.map((a) =>
      a.id === saved.id
        ? { ...a, status: "detached" as const, detachedAt: at, detachReason: reason.trim() || "Moved to another power unit." }
        : a);
  }

  const result = evaluateAttachmentSync(trailerId, toTruckId, ctx);
  if (result.verdict !== "compatible" && result.verdict !== "missing_required_data") {
    // Put the old attachment back exactly as it was. Nothing happened.
    if (saved) db().attachments = db().attachments.map((a) => (a.id === saved.id ? saved : a));
    record({
      trailerId, at, kind: "attachment_blocked",
      summary: "Reassignment refused", detail: result.reasons[0],
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { status: "refused", result };
  }

  const unitLabel = truckUnitLabelFor(toTruckId, ctx);
  const attachment: TrailerAttachment = {
    id: rowId("tatt"), trailerId, truckId: toTruckId, truckUnitLabel: unitLabel,
    organizationId: ctx.organizationId, organizationName: organizationNameFor(ctx.organizationId),
    status: "attached", reservedAt: at, attachedAt: at,
    createdByMembershipId: ctx.membershipId, createdByName: ctx.actorName, createdAt: at,
  };
  db().attachments = [attachment, ...db().attachments];
  /* ---- end critical section ---- */

  if (saved) {
    record({
      trailerId, at, kind: "detached",
      summary: `Detached from unit ${saved.truckUnitLabel}`,
      detail: reason.trim() || "Moved to another power unit. Nothing else about the trailer changed.",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  }
  record({
    trailerId, at, kind: "attached", summary: `Attached to unit ${unitLabel}`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { status: "attached", attachment: { ...attachment } };
}

/* -------------------------------------------------------------------------- */
/* Operating authority: activation, locking and release                        */
/* -------------------------------------------------------------------------- */

export type TrailerActivationOutcome =
  | { status: "activated"; lease: TrailerOperatingLease }
  | { status: "reserved"; lease: TrailerOperatingLease }
  | { status: "locked_by_other" }
  | { status: "not_approved"; relationshipStatus: CarrierRelationshipStatus | "none" }
  | { status: "unauthorized"; missing: PermissionKey[] };

interface TrailerActivationOptions {
  loadReference?: string;
  expectedEndAt?: string;
  reserveOnly?: boolean;
  combinationId?: string;
  truckId?: string;
}

/**
 * Take exclusive operating authority over a trailer.
 *
 * Same shape and same guarantee as the truck version: all latency first, then a
 * synchronous check-and-set, so two carriers racing for the same trailer cannot
 * both win. Approval is permission to take the trailer when it is free; this is
 * the taking.
 */
export function activateTrailerLeaseSync(
  trailerId: string,
  ctx: TrailerContext,
  options: TrailerActivationOptions = {},
): TrailerActivationOutcome {
  const missing = (["trailers:relationships:manage"] as PermissionKey[])
    .filter((k) => !ctx.permissions.has(k));
  if (missing.length) return { status: "unauthorized", missing };

  /* ---- critical section: no awaits from here to the return ---- */
  const relationship = db().relationships.find(
    (r) => r.trailerId === trailerId && r.organizationId === ctx.organizationId,
  );
  if (!relationship || relationship.status !== "approved") {
    return { status: "not_approved", relationshipStatus: relationship?.status ?? "none" };
  }

  const held = holdingLease(trailerId);
  if (held) {
    if (held.organizationId !== ctx.organizationId) {
      record({
        trailerId, at: iso(now()), kind: "activation_refused",
        summary: "Activation refused — the trailer is under another carrier's operating lease",
        organizationId: ctx.organizationId, actorName: ctx.actorName,
      });
      return { status: "locked_by_other" };
    }
    if (held.status === "reserved" && !options.reserveOnly) {
      const upgraded: TrailerOperatingLease = {
        ...held, status: "active", activatedAt: iso(now()),
        loadReference: options.loadReference ?? held.loadReference,
        expectedEndAt: options.expectedEndAt ?? held.expectedEndAt,
        truckId: options.truckId ?? held.truckId,
      };
      db().leases = db().leases.map((l) => (l.id === held.id ? upgraded : l));
      record({
        trailerId, at: iso(now()), kind: "lease_activated",
        summary: `${relationship.organizationName} took exclusive operating authority`,
        organizationId: ctx.organizationId, actorName: ctx.actorName,
      });
      return { status: "activated", lease: { ...upgraded } };
    }
    return held.status === "reserved"
      ? { status: "reserved", lease: { ...held } }
      : { status: "activated", lease: { ...held } };
  }

  const at = iso(now());
  const lease: TrailerOperatingLease = {
    id: rowId("tlease"),
    trailerId,
    organizationId: ctx.organizationId,
    organizationName: relationship.organizationName,
    relationshipId: relationship.id,
    status: options.reserveOnly ? "reserved" : "active",
    loadReference: options.loadReference,
    combinationId: options.combinationId,
    truckId: options.truckId,
    reservedAt: at,
    activatedAt: options.reserveOnly ? undefined : at,
    expectedEndAt: options.expectedEndAt,
    termination: {},
    createdAt: at,
    initiatedByMembershipId: ctx.membershipId,
    initiatedByName: ctx.actorName,
  };
  db().leases = [lease, ...db().leases];
  /* ---- end critical section ---- */

  record({
    trailerId, at, kind: options.reserveOnly ? "activation_reserved" : "lease_activated",
    summary: options.reserveOnly
      ? `${relationship.organizationName} reserved activation`
      : `${relationship.organizationName} took exclusive operating authority`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  record({
    trailerId, at, kind: "lease_locked_others",
    summary: "Activation locked for every other approved carrier",
    detail: "Their onboarding, documents and history are untouched.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });

  return options.reserveOnly
    ? { status: "reserved", lease: { ...lease } }
    : { status: "activated", lease: { ...lease } };
}

export async function activateTrailerLease(
  trailerId: string,
  ctx: TrailerContext,
  options: TrailerActivationOptions = {},
): Promise<TrailerActivationOutcome> {
  await sleep(LATENCY_MS);
  return activateTrailerLeaseSync(trailerId, ctx, options);
}

export type TerminationStep =
  | "unloaded" | "trip_requirements" | "delivery_confirmation" | "exclusive_control";

const STEP_FIELD: Record<TerminationStep, keyof LeaseTermination> = {
  unloaded: "unloadedAt",
  trip_requirements: "tripRequirementsCompletedAt",
  delivery_confirmation: "deliveryConfirmationRecordedAt",
  exclusive_control: "exclusiveControlEndedAt",
};

export const TRAILER_TERMINATION_STEPS: TerminationStep[] = [
  "unloaded", "trip_requirements", "delivery_confirmation", "exclusive_control",
];

export const TRAILER_TERMINATION_STEP_LABEL: Record<TerminationStep, string> = {
  unloaded: "Load marked unloaded",
  trip_requirements: "Trip and lease termination requirements completed",
  delivery_confirmation: "Delivery or release confirmation recorded",
  exclusive_control: "Exclusive operational control formally ended",
};

export function trailerTerminationComplete(t: LeaseTermination): boolean {
  return Boolean(
    t.unloadedAt && t.tripRequirementsCompletedAt
    && t.deliveryConfirmationRecordedAt && t.exclusiveControlEndedAt,
  );
}

export function outstandingTrailerTerminationSteps(t: LeaseTermination): TerminationStep[] {
  return TRAILER_TERMINATION_STEPS.filter((step) => !t[STEP_FIELD[step]]);
}

/**
 * Record one of the four things that have to happen before release.
 *
 * Note what is NOT here: the estimated delivery time passing. A trailer is not
 * free because a clock says it should be, and nothing in this file will ever
 * unlock it on that basis.
 */
export async function recordTrailerTerminationStep(
  leaseId: string,
  step: TerminationStep,
  ctx: TrailerContext,
): Promise<TrailerOperatingLease> {
  await sleep(300);
  requirePermissions(ctx, "trailers:relationships:manage");
  const lease = db().leases.find((l) => l.id === leaseId);
  if (!lease || lease.organizationId !== ctx.organizationId) throw new TrailerNotFoundError();
  if (lease.status === "ended") throw new TrailerNotFoundError();

  const at = iso(now());
  const updated: TrailerOperatingLease = {
    ...lease,
    status: lease.status === "active" ? "pending_release" : lease.status,
    releaseRequestedAt: lease.releaseRequestedAt ?? at,
    termination: { ...lease.termination, [STEP_FIELD[step]]: at },
  };
  db().leases = db().leases.map((l) => (l.id === leaseId ? updated : l));
  record({
    trailerId: lease.trailerId, at, kind: "lease_termination_step",
    summary: TRAILER_TERMINATION_STEP_LABEL[step],
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...updated };
}

export type TrailerReleaseOutcome =
  | { status: "released"; lease: TrailerOperatingLease }
  | { status: "blocked"; outstanding: TerminationStep[] }
  | { status: "unauthorized"; missing: PermissionKey[] };

/**
 * End exclusive operating authority and hand the trailer back.
 *
 * Refused until all four termination requirements are on the record. The
 * completed lease is kept as history, the trailer keeps its permanent id and
 * everything else, and every other approved carrier becomes eligible again
 * without having to re-onboard.
 */
export async function releaseTrailerLease(
  leaseId: string,
  ctx: TrailerContext,
): Promise<TrailerReleaseOutcome> {
  await sleep(LATENCY_MS);
  const missing = (["trailers:relationships:manage"] as PermissionKey[])
    .filter((k) => !ctx.permissions.has(k));
  if (missing.length) return { status: "unauthorized", missing };

  const lease = db().leases.find((l) => l.id === leaseId);
  if (!lease || lease.organizationId !== ctx.organizationId) throw new TrailerNotFoundError();

  const outstanding = outstandingTrailerTerminationSteps(lease.termination);
  if (outstanding.length > 0) return { status: "blocked", outstanding };

  const at = iso(now());
  const ended: TrailerOperatingLease = { ...lease, status: "ended", endedAt: at };
  db().leases = db().leases.map((l) => (l.id === leaseId ? ended : l));
  record({
    trailerId: lease.trailerId, at, kind: "lease_ended",
    summary: `${lease.organizationName} released exclusive operating authority`,
    detail: "The trailer is available again to every approved carrier. Nothing else changed.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { status: "released", lease: { ...ended } };
}

/* -------------------------------------------------------------------------- */
/* Truck-and-trailer combination                                               */
/* -------------------------------------------------------------------------- */

export type CombinationOutcome =
  | {
      status: "activated";
      combinationId: string;
      trailerLease: TrailerOperatingLease;
      attachment: TrailerAttachment;
    }
  | { status: "trailer_locked_by_other" }
  | { status: "power_unit_locked_by_other" }
  | { status: "not_approved"; asset: "truck" | "trailer"; relationshipStatus: CarrierRelationshipStatus | "none" }
  | { status: "attachment_refused"; result: CompatibilityResult }
  | { status: "unauthorized"; missing: PermissionKey[] };

/**
 * Activate a power unit and a trailer together, for one movement.
 *
 * This is the rule that makes the two registries agree: an attached truck and
 * trailer cannot run under two different carrier authorities for the same
 * movement, so they are validated and locked in ONE synchronous block. Both
 * must be approved with this carrier, neither may be under anybody else's
 * lease, and the pairing must be physically allowed.
 *
 * The order is: check everything, then write everything. There is no partial
 * outcome and therefore nothing to roll back — if the trailer half is refused,
 * the truck was never locked, and vice versa.
 */
export async function activateCombination(
  truckId: string,
  trailerId: string,
  ctx: TrailerContext,
  options: { loadReference?: string; expectedEndAt?: string } = {},
): Promise<CombinationOutcome> {
  // All latency BEFORE the critical section, never inside it.
  await sleep(LATENCY_MS);

  const missing = (["trucks:relationships:manage", "trailers:relationships:manage", "trailers:attachments:manage"] as PermissionKey[])
    .filter((k) => !ctx.permissions.has(k));
  if (missing.length) return { status: "unauthorized", missing };

  /* ---- critical section: no awaits from here to the return ---- */

  /* 1. Approval on both assets, before anything is written. */
  const trailerRel = db().relationships.find(
    (r) => r.trailerId === trailerId && r.organizationId === ctx.organizationId,
  );
  if (!trailerRel || trailerRel.status !== "approved") {
    return { status: "not_approved", asset: "trailer", relationshipStatus: trailerRel?.status ?? "none" };
  }
  const truckState = truckActivationStateFor(truckId, ctx.organizationId);
  if (truckState === "onboarding" || truckState === "pending_approval"
    || truckState === "ended" || truckState === "suspended") {
    return { status: "not_approved", asset: "truck", relationshipStatus: "none" };
  }

  /* 2. Neither asset may be held by anybody else. */
  const trailerHeld = holdingLease(trailerId);
  if (trailerHeld && trailerHeld.organizationId !== ctx.organizationId) {
    record({
      trailerId, at: iso(now()), kind: "combination_refused",
      summary: "Combination refused — the trailer is under another carrier's operating lease",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { status: "trailer_locked_by_other" };
  }
  if (truckState === "locked_by_other") {
    record({
      trailerId, at: iso(now()), kind: "combination_refused",
      summary: "Combination refused — the power unit is under another carrier's operating lease",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { status: "power_unit_locked_by_other" };
  }

  /* 3. The pairing itself has to be allowed. */
  const compatibility = evaluateAttachmentSync(trailerId, truckId, ctx);
  if (compatibility.verdict !== "compatible" && compatibility.verdict !== "missing_required_data") {
    record({
      trailerId, at: iso(now()), kind: "combination_refused",
      summary: "Combination refused", detail: compatibility.reasons[0],
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { status: "attachment_refused", result: compatibility };
  }

  /* 4. Everything checked. Now write both, with nothing in between. */
  const combinationId = rowId("combo");
  const at = iso(now());

  const truckOutcome = activateOperatingLeaseSync(truckId, {
    organizationId: ctx.organizationId, membershipId: ctx.membershipId,
    actorName: ctx.actorName, permissions: ctx.permissions,
  }, { loadReference: options.loadReference, expectedEndAt: options.expectedEndAt, combinationId });
  // The state was checked a few lines above with no await since, so this cannot
  // fail for a reason we have not already handled — but if it somehow does,
  // nothing has been written for the trailer yet and we stop here.
  if (truckOutcome.status !== "activated") {
    return truckOutcome.status === "locked_by_other"
      ? { status: "power_unit_locked_by_other" }
      : { status: "not_approved", asset: "truck", relationshipStatus: "none" };
  }

  const trailerOutcome = activateTrailerLeaseSync(trailerId, ctx, {
    loadReference: options.loadReference, expectedEndAt: options.expectedEndAt,
    combinationId, truckId,
  });
  if (trailerOutcome.status !== "activated") {
    return trailerOutcome.status === "locked_by_other"
      ? { status: "trailer_locked_by_other" }
      : { status: "not_approved", asset: "trailer", relationshipStatus: trailerRel.status };
  }

  const existing = liveAttachmentForTrailer(trailerId);
  let attachment: TrailerAttachment;
  if (existing && existing.truckId === truckId) {
    attachment = { ...existing, status: "in_movement", attachedAt: existing.attachedAt ?? at };
    db().attachments = db().attachments.map((a) => (a.id === existing.id ? attachment : a));
  } else {
    attachment = {
      id: rowId("tatt"), trailerId, truckId,
      truckUnitLabel: truckUnitLabelFor(truckId, ctx),
      organizationId: ctx.organizationId,
      organizationName: organizationNameFor(ctx.organizationId),
      status: "in_movement", reservedAt: at, attachedAt: at,
      createdByMembershipId: ctx.membershipId, createdByName: ctx.actorName, createdAt: at,
    };
    db().attachments = [attachment, ...db().attachments];
  }

  db().movements = [
    {
      id: rowId("tmv"), trailerId, truckId,
      organizationId: ctx.organizationId,
      organizationName: organizationNameFor(ctx.organizationId),
      loadReference: options.loadReference, startedAt: at,
    },
    ...db().movements,
  ];
  /* ---- end critical section ---- */

  record({
    trailerId, at, kind: "combination_activated",
    summary: `${organizationNameFor(ctx.organizationId)} activated unit ${attachment.truckUnitLabel} with this trailer`,
    detail: "Both the power unit and the trailer are locked to this carrier for the movement.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return {
    status: "activated", combinationId,
    trailerLease: trailerOutcome.lease, attachment: { ...attachment },
  };
}

/**
 * The truck half of a combination, so a screen can show both sides.
 *
 * Reads the truck registry rather than duplicating its state, which is the
 * point: there is one lease per asset, not a combined record that could drift.
 */
export function combinationPartnerLease(trailerLease: TrailerOperatingLease) {
  if (!trailerLease.truckId) return undefined;
  const held = truckHoldingLease(trailerLease.truckId);
  return held && held.combinationId === trailerLease.combinationId ? held : undefined;
}

/**
 * What a given power unit is pulling, for the truck profile to show.
 *
 * Deliberately keyed by truckId and read from here rather than stored on the
 * truck: the two assets have separate owners and separate histories, and a
 * trailer nested inside a truck record would be wrong the moment either is
 * sold. Returns nothing when the caller may not see the trailer.
 */
export async function trailerOnTruck(
  truckId: string,
  ctx: TrailerContext,
): Promise<{ trailerId: string; unit: string } | undefined> {
  await sleep(200);
  if (!ctx.permissions.has("trailers:view")) return undefined;
  const live = liveAttachmentForTruck(truckId);
  if (!live) return undefined;
  if (trailerAccessReason(live.trailerId, ctx) === null) return undefined;
  const visible = visibleCarrierOrgIds(live.trailerId, ctx);
  if (!canSeeCarrier(visible, live.organizationId)) return undefined;
  const relationship = relationshipFor(live.trailerId, ctx.organizationId);
  return { trailerId: live.trailerId, unit: relationship?.unitNumber ?? "—" };
}

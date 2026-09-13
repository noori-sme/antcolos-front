import type {
  CarrierRelationshipType,
  FleetTruck,
  OwnerType,
  PermissionKey,
  Truck,
  TruckCarrierRelationship,
  TruckDispatchAccess,
  TruckDocument,
  TruckDocumentKind,
  TruckDocumentSnapshot,
  TruckDriverAssignment,
  TruckEquipmentType,
  TruckEvent,
  TruckEventKind,
  TruckOperatingStatus,
  TruckOwnershipClaim,
  TruckOwnershipRecord,
  TruckRegistration,
  TruckSpecs,
} from "@/types";
import { DOCUMENT_LABEL } from "@/lib/fleet/equipment";
import { normalizeVin, validateVin } from "@/lib/fleet/vin";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE permanent truck registry.
 *
 * It is deliberately NOT partitioned by organization. A truck exists once, and
 * which organizations can see it is derived from its relationships — so a
 * carrier that ends its relationship stops seeing the truck even though it
 * created the record, and no organization can reach a truck by guessing an id.
 *
 * Every mutation goes through this file and every one of them is checked
 * against the caller's permissions and relationships here, not in the screens.
 * Hiding a button is a courtesy; this is the boundary.
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

/**
 * A truck's permanent id is a UUID and nothing else — never a unit number, a
 * VIN, a row number or an organization-scoped code.
 */
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Deterministic fallback for environments without WebCrypto.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Fixture identity                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Stable UUIDs for the seeded trucks, so loads and Needs You items can point at
 * the same permanent trucks the registry holds.
 */
export const TRUCK_IDS = {
  nl104: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1001",
  nl107: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1002",
  nl111: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1003",
  nl115: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1004",
  nl118: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1005",
  nl121: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1006",
  nl124: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1007",
  nl127: "a1f0c2d4-1111-4a10-9c01-0b0f5d7e1008",
  mdA12: "b2e1d3c5-2222-4b20-8d02-1c1e6f8a2001",
  mdB04: "b2e1d3c5-2222-4b20-8d02-1c1e6f8a2002",
  mdC31: "b2e1d3c5-2222-4b20-8d02-1c1e6f8a2003",
  mdA18: "b2e1d3c5-2222-4b20-8d02-1c1e6f8a2004",
  cs47: "c3d2e4f6-3333-4c30-7e03-2d2f7a9b3001",
  crosswind: "d4c3f5a7-4444-4d40-6f04-3e3a8b1c4001",
  claimed: "e5b4a6c8-5555-4e50-5a05-4f4b9c2d5001",
} as const;

/** VINs the fixtures use. Reported to reviewers; never shown as hints in the UI. */
export const FIXTURE_VINS = {
  nl104: "1FTBW2CM8NKA51234",
  nl107: "WD3PE8CD5KP123456",
  nl111: "1FVACWDT4HHJK1234",
  nl115: "1XKYDP9X5MJ456789",
  nl118: "3C6UR5DL8NG123456",
  nl121: "1FVACYDT7GHHA1234",
  mdA12: "1XPWD40X1ED215307",
  mdB04: "1FTYE1CM4KKA12345",
  crosswind: "1GCWGAFP7N1234567",
  claimed: "1HTMMAAL5MH123456",
} as const;

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface RegistryState {
  trucks: Truck[];
  ownership: TruckOwnershipRecord[];
  claims: TruckOwnershipClaim[];
  relationships: TruckCarrierRelationship[];
  dispatchAccess: TruckDispatchAccess[];
  assignments: TruckDriverAssignment[];
  documents: TruckDocument[];
  events: TruckEvent[];
}

/**
 * Built on first use, not at module load.
 *
 * The fixtures are assembled by helpers declared further down the file, so
 * evaluating them eagerly would read those consts before they exist. Lazy
 * initialization also keeps module import free of side effects.
 */
let registry: RegistryState | null = null;

function db(): RegistryState {
  if (!registry) registry = buildFixtures();
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetTruckRegistry() {
  seq = 0;
  registry = buildFixtures();
}

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                            */
/* -------------------------------------------------------------------------- */

function truck(
  truckId: string,
  vin: string,
  equipmentType: TruckEquipmentType,
  year: number,
  make: string,
  model: string,
  status: TruckOperatingStatus,
  registration: TruckRegistration,
  specs: TruckSpecs,
  availability: Truck["availability"],
  createdByOrganizationId: string,
  color?: string,
): Truck {
  return {
    truckId, vin: normalizeVin(vin), equipmentType, year, make, model, color,
    registration, specs, status, availability,
    createdAt: daysAgo(400), createdByOrganizationId,
  };
}

const plate = (plateNumber: string, plateState: string, days: number, owner: string): TruckRegistration => ({
  plateNumber, plateState, expiresAt: daysFromNow(days), registeredOwnerName: owner,
});

function own(
  truckId: string, ownerType: OwnerType, ownerName: string,
  startedAt: string, status: "active" | "ended", endedAt?: string, ownerRef?: string,
): TruckOwnershipRecord {
  return {
    id: rowId("own"), truckId, ownerType, ownerName, ownerRef,
    startedAt, endedAt, status,
    evidence: [{ kind: "title", label: "Title or ownership evidence", fileName: "title.pdf", capturedAt: startedAt }],
    createdByMembershipId: "seed", createdByName: "Antcolos", createdAt: startedAt,
  };
}

function rel(
  truckId: string, organizationId: string, organizationName: string,
  relationshipType: CarrierRelationshipType, unitNumber: string,
  status: TruckCarrierRelationship["status"], startedAt: string,
  minimumRatePerMileCents = 100, maxDeadheadMiles = 30,
): TruckCarrierRelationship {
  return {
    id: rowId("rel"), truckId, organizationId, organizationName, relationshipType,
    unitNumber, status, startedAt, initiatedByOrganizationId: organizationId,
    createdAt: startedAt, minimumRatePerMileCents, maxDeadheadMiles,
  };
}

function dispatch(
  truckId: string, dispatchOrganizationId: string, dispatchOrganizationName: string,
  carrierId: string, carrierName: string, unitLabel: string, startedAt: string,
): TruckDispatchAccess {
  return {
    id: rowId("dsp"), truckId, dispatchOrganizationId, dispatchOrganizationName,
    grantedByCarrierOrganizationId: carrierId, grantedByCarrierName: carrierName,
    unitLabel, status: "active", startedAt,
    initiatedByOrganizationId: carrierId, createdAt: startedAt,
  };
}

function assign(
  truckId: string, organizationId: string, driverProfileId: string, driverName: string,
  startedAt: string, endedAt?: string, endReason?: string,
): TruckDriverAssignment {
  return {
    id: rowId("asg"), truckId, organizationId, driverProfileId, driverName,
    startedAt, endedAt, endReason, createdAt: startedAt,
  };
}

function doc(
  truckId: string, kind: TruckDocumentKind, status: TruckDocument["status"],
  organizationId: string, fileName?: string, expiresAt?: string, rejectionReason?: string,
): TruckDocument {
  return {
    id: rowId("doc"), truckId, kind, status, fileName,
    fileType: fileName?.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    sizeBytes: fileName ? 820_000 : undefined,
    expiresAt, rejectionReason,
    addedByOrganizationId: organizationId, createdAt: daysAgo(90), updatedAt: daysAgo(20),
  };
}

function evt(
  truckId: string, kind: TruckEventKind, summary: string, at: string,
  organizationId?: string, detail?: string,
): TruckEvent {
  return { id: rowId("evt"), truckId, at, kind, summary, detail, organizationId, actorName: "Antcolos" };
}

const VAN_SPECS: TruckSpecs = {
  gvwrLbs: 9070, emptyWeightLbs: 5200, maxPayloadLbs: 3870,
  cargoLengthIn: 146, cargoWidthIn: 54, cargoHeightIn: 57,
  doorWidthIn: 50, doorHeightIn: 49, palletCapacity: 4,
  fuelType: "gasoline", hasLiftgate: false, hazmatCapable: false,
};
const SPRINTER_SPECS: TruckSpecs = {
  gvwrLbs: 11030, emptyWeightLbs: 5900, maxPayloadLbs: 5130,
  cargoLengthIn: 170, cargoWidthIn: 55, cargoHeightIn: 79,
  doorWidthIn: 52, doorHeightIn: 72, palletCapacity: 6,
  fuelType: "diesel", hasLiftgate: false, hazmatCapable: false,
};
const BOX_SPECS: TruckSpecs = {
  gvwrLbs: 25999, emptyWeightLbs: 14200, maxPayloadLbs: 11799,
  cargoLengthIn: 312, cargoWidthIn: 96, cargoHeightIn: 97,
  doorWidthIn: 92, doorHeightIn: 92, palletCapacity: 12,
  axleCount: 2, fuelType: "diesel", hasLiftgate: true, isDockHeight: true,
  hasReefer: false, hazmatCapable: false,
};
const TRACTOR_SPECS: TruckSpecs = {
  gvwrLbs: 80000, emptyWeightLbs: 17800, axleCount: 3,
  fuelType: "diesel", hasSleeper: true, hazmatCapable: true,
};
const HOTSHOT_SPECS: TruckSpecs = {
  gvwrLbs: 14000, emptyWeightLbs: 8100, maxPayloadLbs: 5900,
  axleCount: 2, fuelType: "diesel", hazmatCapable: false,
};

function buildFixtures(): RegistryState {
  const V = FIXTURE_VINS;
  const T = TRUCK_IDS;

  const trucks: Truck[] = [
    truck(T.nl104, V.nl104, "cargo_van", 2022, "Ford", "Transit 250", "available",
      plate("IL-4471X", "IL", 240, "Northline Freight LLC"), VAN_SPECS,
      { city: "Lafayette", state: "IN", expectedAvailableAt: hoursFromNow(4), homeTerminal: "Chicago, IL" },
      "org_northline", "White"),
    truck(T.nl107, V.nl107, "sprinter_van", 2021, "Mercedes-Benz", "Sprinter 2500", "loaded",
      plate("IL-7712B", "IL", 120, "Northline Freight LLC"), SPRINTER_SPECS,
      { city: "Indianapolis", state: "IN", expectedAvailableAt: hoursFromNow(2), homeTerminal: "Chicago, IL" },
      "org_northline", "White"),
    truck(T.nl111, V.nl111, "box_truck", 2020, "Freightliner", "M2 106", "expected_available",
      plate("IL-1190C", "IL", 30, "Northline Freight LLC"), BOX_SPECS,
      { city: "Chicago", state: "IL", expectedAvailableAt: hoursFromNow(9), homeTerminal: "Chicago, IL" },
      "org_northline", "Blue"),
    truck(T.nl115, V.nl115, "tractor", 2019, "Kenworth", "T680", "maintenance",
      plate("IL-8820D", "IL", 400, "Northline Freight LLC"), TRACTOR_SPECS,
      { city: "Memphis", state: "TN", homeTerminal: "Chicago, IL" },
      "org_northline", "Red"),
    truck(T.nl118, V.nl118, "hotshot", 2023, "Ram", "3500", "available",
      plate("TX-5540H", "TX", 300, "Marcus Hale"), HOTSHOT_SPECS,
      { city: "Joliet", state: "IL", expectedAvailableAt: hoursFromNow(-20) },
      "org_northline", "Black"),
    truck(T.nl121, V.nl121, "box_truck", 2021, "International", "MV607", "unavailable",
      plate("IL-3301E", "IL", 90, "Northline Freight LLC"), BOX_SPECS,
      { city: "Chicago", state: "IL" }, "org_northline", "White"),
    truck(T.mdA12, V.mdA12, "tractor", 2020, "Peterbilt", "579", "loaded",
      plate("PA-2215T", "PA", 180, "Baxter Transit LLC"), TRACTOR_SPECS,
      { city: "Allentown", state: "PA", expectedAvailableAt: hoursFromNow(3) },
      "org_baxter", "Blue"),
    truck(T.mdB04, V.mdB04, "cargo_van", 2022, "Ford", "Transit 350", "available",
      plate("NJ-6640V", "NJ", 210, "Ridgeway Carriers"), VAN_SPECS,
      { city: "Newark", state: "NJ", expectedAvailableAt: hoursFromNow(-6) },
      "org_ridgeway", "Silver"),
    truck(T.crosswind, V.crosswind, "box_truck", 2021, "Chevrolet", "Silverado 6500", "available",
      plate("VA-9987K", "VA", 150, "Crosswind Freight"), BOX_SPECS,
      { city: "Richmond", state: "VA" }, "org_crosswind", "White"),
    truck(T.claimed, V.claimed, "tractor", 2018, "International", "LT625", "available",
      plate("IL-7744L", "IL", 60, "Northline Freight LLC"), TRACTOR_SPECS,
      { city: "Gary", state: "IN", homeTerminal: "Chicago, IL" }, "org_northline", "Grey"),
    truck(T.mdA18, "1FTBR1C81PKB77441", "cargo_van", 2023, "Ford", "Transit 250", "available",
      plate("PA-3318V", "PA", 200, "Baxter Transit LLC"), VAN_SPECS,
      { city: "Baltimore", state: "MD", expectedAvailableAt: hoursFromNow(-1) },
      "org_baxter", "White"),
    truck(T.cs47, "1FTYE2CM1LKA99887", "sprinter_van", 2020, "Mercedes-Benz", "Sprinter 3500", "available",
      plate("OR-1120S", "OR", 260, "Cascade Haul Co."), SPRINTER_SPECS,
      { city: "Portland", state: "OR" }, "org_cascade", "White"),
  ];

  const ownership: TruckOwnershipRecord[] = [
    own(T.nl104, "organization", "Northline Freight LLC", daysAgo(380), "active", undefined, "org_northline"),
    own(T.nl107, "organization", "Northline Freight LLC", daysAgo(360), "active", undefined, "org_northline"),
    own(T.nl111, "organization", "Northline Freight LLC", daysAgo(300), "active", undefined, "org_northline"),
    own(T.nl115, "organization", "Northline Freight LLC", daysAgo(600), "active", undefined, "org_northline"),
    // A historical transfer: the truck changed hands and kept everything else.
    own(T.nl118, "organization", "Halberd Leasing LLC", daysAgo(700), "ended", daysAgo(210)),
    own(T.nl118, "person", "Marcus Hale", daysAgo(210), "active", undefined, "dp_marcus"),
    own(T.nl121, "organization", "Northline Freight LLC", daysAgo(200), "active", undefined, "org_northline"),
    own(T.mdA12, "organization", "Baxter Transit LLC", daysAgo(500), "active", undefined, "org_baxter"),
    own(T.mdB04, "organization", "Ridgeway Carriers", daysAgo(420), "active", undefined, "org_ridgeway"),
    own(T.crosswind, "organization", "Crosswind Freight", daysAgo(320), "active", undefined, "org_crosswind"),
    own(T.claimed, "organization", "Northline Freight LLC", daysAgo(260), "active", undefined, "org_northline"),
    own(T.mdA18, "organization", "Baxter Transit LLC", daysAgo(280), "active", undefined, "org_baxter"),
    own(T.cs47, "organization", "Cascade Haul Co.", daysAgo(340), "active", undefined, "org_cascade"),
  ];

  const relationships: TruckCarrierRelationship[] = [
    rel(T.nl104, "org_northline", "Northline Freight", "carrier_owned", "104", "active", daysAgo(380), 100, 30),
    rel(T.nl107, "org_northline", "Northline Freight", "carrier_owned", "107", "active", daysAgo(360), 105, 30),
    rel(T.nl111, "org_northline", "Northline Freight", "carrier_owned", "111", "active", daysAgo(300), 120, 45),
    rel(T.nl115, "org_northline", "Northline Freight", "carrier_owned", "115", "active", daysAgo(600), 140, 60),
    // The carrier operates it; Marcus Hale owns it. Two different things.
    rel(T.nl118, "org_northline", "Northline Freight", "leased_owner_operator", "118", "active", daysAgo(200), 125, 40),
    // Requested but not yet accepted — an honest pending state, not a fleet member.
    rel(T.nl121, "org_northline", "Northline Freight", "carrier_owned", "121", "pending", daysAgo(3), 110, 35),
    rel(T.mdA12, "org_baxter", "Baxter Transit LLC", "carrier_owned", "A-12", "active", daysAgo(500), 110, 30),
    rel(T.mdB04, "org_ridgeway", "Ridgeway Carriers", "carrier_owned", "B-04", "active", daysAgo(420), 100, 25),
    rel(T.crosswind, "org_crosswind", "Crosswind Freight", "carrier_owned", "C-31", "active", daysAgo(320), 125, 40),
    rel(T.claimed, "org_northline", "Northline Freight", "carrier_owned", "127", "active", daysAgo(260), 120, 45),
    rel(T.mdA18, "org_baxter", "Baxter Transit LLC", "carrier_owned", "A-18", "active", daysAgo(280), 100, 30),
    rel(T.cs47, "org_cascade", "Cascade Haul", "carrier_owned", "47", "active", daysAgo(340), 105, 30),
  ];

  // Meridian dispatches for carriers it neither owns nor operates for.
  const dispatchAccess: TruckDispatchAccess[] = [
    dispatch(T.mdA12, "org_meridian", "Meridian Dispatch", "org_baxter", "Baxter Transit LLC", "A-12", daysAgo(120)),
    dispatch(T.mdB04, "org_meridian", "Meridian Dispatch", "org_ridgeway", "Ridgeway Carriers", "B-04", daysAgo(90)),
    dispatch(T.mdA18, "org_meridian", "Meridian Dispatch", "org_baxter", "Baxter Transit LLC", "A-18", daysAgo(70)),
    dispatch(T.crosswind, "org_meridian", "Meridian Dispatch", "org_crosswind", "Crosswind Freight", "C-31", daysAgo(60)),
  ];

  const assignments: TruckDriverAssignment[] = [
    assign(T.nl104, "org_northline", "dp_dmitri", "Dmitri Kovalenko", daysAgo(210)),
    assign(T.nl107, "org_northline", "dp_marisol", "Marisol Ortiz", daysAgo(7)),
    assign(T.nl115, "org_northline", "dp_amir", "Amir Haddad", daysAgo(290)),
    assign(T.nl118, "org_northline", "dp_marcus", "Marcus Hale", daysAgo(200)),
    // History on 121: a driver who has moved on. The profile is untouched.
    assign(T.nl121, "org_northline", "dp_kelsey", "Kelsey Nguyen", daysAgo(180), daysAgo(60), "Left the carrier."),
    assign(T.claimed, "org_northline", "dp_ray", "Ray Bell", daysAgo(150), daysAgo(20), "Reassigned to another truck."),
    assign(T.cs47, "org_cascade", "dp_sam", "Sam Murtaza", daysAgo(108)),
  ];

  const documents: TruckDocument[] = [
    doc(T.nl104, "registration", "approved", "org_northline", "reg-104.pdf", daysFromNow(240)),
    doc(T.nl104, "title", "approved", "org_northline", "title-104.pdf"),
    doc(T.nl104, "insurance", "approved", "org_northline", "coi-104.pdf", daysFromNow(180)),
    doc(T.nl104, "annual_inspection", "approved", "org_northline", "inspection-104.pdf", daysFromNow(200)),
    doc(T.nl107, "registration", "approved", "org_northline", "reg-107.pdf", daysFromNow(120)),
    doc(T.nl107, "title", "approved", "org_northline", "title-107.pdf"),
    // Expiring soon — the state a fleet manager actually needs to see coming.
    doc(T.nl107, "insurance", "expiring_soon", "org_northline", "coi-107.pdf", daysFromNow(21)),
    doc(T.nl111, "registration", "expired", "org_northline", "reg-111.pdf", daysFromNow(-9)),
    doc(T.nl111, "title", "approved", "org_northline", "title-111.pdf"),
    doc(T.nl115, "registration", "approved", "org_northline", "reg-115.pdf", daysFromNow(400)),
    doc(T.nl115, "annual_inspection", "rejected", "org_northline", "inspection-115.jpg", undefined,
      "The photo cuts off the inspector's signature and the date. Please upload the full page."),
    doc(T.nl118, "registration", "approved", "org_northline", "reg-118.pdf", daysFromNow(300)),
    doc(T.nl118, "lease_agreement", "pending_review", "org_northline", "lease-hale.pdf"),
    doc(T.claimed, "registration", "approved", "org_northline", "reg-127.pdf", daysFromNow(60)),
  ];

  const claims: TruckOwnershipClaim[] = [
    {
      id: "claim_pending", truckId: T.claimed,
      claimantOrganizationId: "org_halberd", claimantName: "Halberd Leasing LLC",
      claimedOwnerType: "organization", claimedOwnerName: "Halberd Leasing LLC",
      status: "pending",
      evidence: [{ kind: "title", label: "Title or ownership evidence", fileName: "halberd-title.pdf", capturedAt: daysAgo(2) }],
      note: "We hold the title following the November lease buyout.",
      createdAt: daysAgo(2),
    },
    {
      id: "claim_rejected", truckId: T.nl115,
      claimantOrganizationId: "org_halberd", claimantName: "Halberd Leasing LLC",
      claimedOwnerType: "organization", claimedOwnerName: "Halberd Leasing LLC",
      status: "rejected",
      evidence: [{ kind: "registration", label: "Registration", fileName: "reg-copy.pdf", capturedAt: daysAgo(40) }],
      createdAt: daysAgo(40), resolvedAt: daysAgo(38),
      resolutionNote: "Registration is not proof of title, and the VIN on it does not match.",
    },
  ];

  const events: TruckEvent[] = [
    evt(T.nl118, "created", "Truck registered in Antcolos", daysAgo(700), "org_northline"),
    evt(T.nl118, "ownership_started", "Halberd Leasing LLC recorded as owner", daysAgo(700)),
    evt(T.nl118, "ownership_ended", "Halberd Leasing LLC ownership ended", daysAgo(210)),
    evt(T.nl118, "ownership_started", "Marcus Hale recorded as owner", daysAgo(210),
      undefined, "Ownership transferred. The truck, its VIN, documents and history were unchanged."),
    evt(T.nl118, "relationship_started", "Northline Freight began operating this truck", daysAgo(200), "org_northline"),
    evt(T.nl118, "driver_assigned", "Marcus Hale assigned", daysAgo(200), "org_northline"),
    evt(T.claimed, "ownership_claim_opened", "Halberd Leasing LLC claimed ownership", daysAgo(2)),
    evt(T.nl115, "ownership_claim_resolved", "Ownership claim rejected", daysAgo(38), "org_northline"),
    evt(T.nl121, "relationship_requested", "Northline Freight requested to operate this truck", daysAgo(3), "org_northline"),
    evt(T.nl121, "driver_unassigned", "Kelsey Nguyen assignment ended", daysAgo(60), "org_northline"),
    evt(T.mdA12, "dispatch_access_started", "Meridian Dispatch granted dispatch access", daysAgo(120), "org_baxter"),
  ];

  for (const t of trucks) {
    events.push(evt(t.truckId, "created", "Truck registered in Antcolos", t.createdAt, t.createdByOrganizationId));
  }

  return { trucks, ownership, claims, relationships, dispatchAccess, assignments, documents, events };
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The caller. Mirrors ServiceContext: an organization and the permissions of
 * the membership acting inside it. Never a user, and never an organization
 * supplied by a form.
 */
export interface TruckContext {
  organizationId: string;
  membershipId: string;
  actorName: string;
  permissions: ReadonlySet<PermissionKey>;
  /** Set when the membership is a driver, so "only my truck" can be resolved. */
  driverProfileId?: string;
}

export class TruckPermissionError extends Error {
  constructor(readonly required: PermissionKey[]) {
    super(`Missing permission: ${required.join(", ")}`);
    this.name = "TruckPermissionError";
  }
}

/**
 * A truck the caller may not see and a truck that does not exist are the same
 * answer. Anything else turns an id field into a directory of other people's
 * fleets.
 */
export class TruckNotFoundError extends Error {
  constructor() {
    super("Truck not found");
    this.name = "TruckNotFoundError";
  }
}

function requirePermissions(ctx: TruckContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new TruckPermissionError(missing);
}

/** The organization's live operating relationship with a truck, if any. */
function activeRelationship(truckId: string, organizationId: string) {
  return db().relationships.find(
    (r) => r.truckId === truckId && r.organizationId === organizationId &&
      (r.status === "active" || r.status === "suspended"),
  );
}

function pendingRelationship(truckId: string, organizationId: string) {
  return db().relationships.find(
    (r) => r.truckId === truckId && r.organizationId === organizationId && r.status === "pending",
  );
}

function activeDispatchAccess(truckId: string, organizationId: string) {
  return db().dispatchAccess.find(
    (d) => d.truckId === truckId && d.dispatchOrganizationId === organizationId && d.status === "active",
  );
}

/** Whoever currently operates the truck, whatever organization that is. */
function operatingCarrier(truckId: string) {
  return db().relationships.find((r) => r.truckId === truckId && r.status === "active");
}

function activeOwnership(truckId: string) {
  return db().ownership.find((o) => o.truckId === truckId && o.status === "active");
}

function activeAssignment(truckId: string, organizationId: string) {
  return db().assignments.find(
    (a) => a.truckId === truckId && a.organizationId === organizationId && !a.endedAt,
  );
}

export type TruckAccessReason =
  | "operating_carrier"
  | "pending_relationship"
  | "dispatch_access"
  | "owner"
  | "assigned_driver";

/**
 * Why — if at all — this organization can see this truck.
 *
 * Visibility comes from relationships and nothing else. Creating the record
 * confers nothing: a carrier that ends its relationship stops seeing the truck
 * it first registered.
 */
export function accessReason(truckId: string, ctx: TruckContext): TruckAccessReason | null {
  if (activeRelationship(truckId, ctx.organizationId)) return "operating_carrier";
  if (pendingRelationship(truckId, ctx.organizationId)) return "pending_relationship";
  if (activeDispatchAccess(truckId, ctx.organizationId)) return "dispatch_access";
  const owner = activeOwnership(truckId);
  if (owner?.ownerRef && owner.ownerRef === ctx.organizationId) return "owner";
  if (ctx.driverProfileId) {
    const mine = db().assignments.find(
      (a) => a.truckId === truckId && a.driverProfileId === ctx.driverProfileId && !a.endedAt,
    );
    if (mine) return "assigned_driver";
  }
  return null;
}

function getTruckOrThrow(truckId: string, ctx: TruckContext): Truck {
  requirePermissions(ctx, "trucks:view");
  const found = db().trucks.find((t) => t.truckId === truckId);
  // Unknown id and forbidden id are deliberately indistinguishable.
  if (!found || accessReason(truckId, ctx) === null) throw new TruckNotFoundError();
  return found;
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

const DOC_WARNING_STATUSES = new Set(["expired", "expiring_soon", "rejected", "missing"]);

function documentWarnings(truckId: string): number {
  return db().documents.filter(
    (d) => d.truckId === truckId && DOC_WARNING_STATUSES.has(d.status),
  ).length;
}

/** What one organization sees of one permanent truck, right now. */
function project(truck: Truck, ctx: TruckContext): FleetTruck {
  const relationship = activeRelationship(truck.truckId, ctx.organizationId)
    ?? pendingRelationship(truck.truckId, ctx.organizationId);
  const dispatchGrant = activeDispatchAccess(truck.truckId, ctx.organizationId);
  const operator = operatingCarrier(truck.truckId);
  const assignment = activeAssignment(truck.truckId, operator?.organizationId ?? ctx.organizationId);

  return {
    truckId: truck.truckId,
    id: truck.truckId,
    organizationId: ctx.organizationId,
    unit: relationship?.unitNumber ?? dispatchGrant?.unitLabel ?? "—",
    // A dispatcher needs to know whose authority the truck runs under.
    carrierName: dispatchGrant ? operator?.organizationName : undefined,
    equipment: truck.equipmentType,
    status: truck.status,
    currentDriverId: assignment?.driverProfileId,
    currentDriverName: assignment?.driverName,
    currentCity: truck.availability.city,
    currentState: truck.availability.state,
    estimatedEmptyAt: truck.availability.expectedAvailableAt,
    minimumRatePerMileCents: relationship?.minimumRatePerMileCents ?? 100,
    maxDeadheadMiles: relationship?.maxDeadheadMiles ?? 30,
    documentWarnings: documentWarnings(truck.truckId),
  };
}

/**
 * The organization's fleet.
 *
 * Pending relationships are excluded: a truck you have asked to operate is not
 * yet part of your fleet, and counting it would make the roster lie. A driver
 * sees only the truck they are assigned to.
 */
export async function listFleet(ctx: TruckContext): Promise<FleetTruck[]> {
  await sleep(250);
  return fleetSync(ctx);
}

export function fleetSync(ctx: TruckContext): FleetTruck[] {
  if (!ctx.permissions.has("trucks:view")) return [];
  return db().trucks
    .filter((t) => {
      const reason = accessReason(t.truckId, ctx);
      if (reason === null || reason === "pending_relationship") return false;
      // A driver sees the truck they are on, not the carrier's whole fleet —
      // and that is true even though their organization operates all of them,
      // so it is decided by the assignment itself rather than by access reason.
      if (ctx.driverProfileId) {
        return db().assignments.some(
          (a) => a.truckId === t.truckId && a.driverProfileId === ctx.driverProfileId && !a.endedAt,
        );
      }
      return true;
    })
    .map((t) => project(t, ctx));
}

/** Trucks this organization has asked to operate but does not yet operate. */
export async function listPendingConnections(ctx: TruckContext): Promise<
  Array<{ truck: Truck; relationship: TruckCarrierRelationship }>
> {
  await sleep(200);
  if (!ctx.permissions.has("trucks:view")) return [];
  return db().relationships
    .filter((r) => r.organizationId === ctx.organizationId && r.status === "pending")
    .map((r) => ({ truck: db().trucks.find((t) => t.truckId === r.truckId)!, relationship: r }))
    .filter((row) => Boolean(row.truck));
}

export interface TruckProfileView {
  truck: Truck;
  accessReason: TruckAccessReason;
  ownership: TruckOwnershipRecord[];
  claims: TruckOwnershipClaim[];
  relationships: TruckCarrierRelationship[];
  dispatchAccess: TruckDispatchAccess[];
  assignments: TruckDriverAssignment[];
  documents: TruckDocument[];
  events: TruckEvent[];
  /** This organization's own live relationship, when it has one. */
  myRelationship?: TruckCarrierRelationship;
}

export async function getTruckProfile(truckId: string, ctx: TruckContext): Promise<TruckProfileView> {
  await sleep(300);
  const truck = getTruckOrThrow(truckId, ctx);
  const reason = accessReason(truckId, ctx)!;
  const byDate = <T extends { startedAt?: string; createdAt?: string; at?: string }>(a: T, b: T) =>
    String(b.startedAt ?? b.createdAt ?? b.at ?? "").localeCompare(String(a.startedAt ?? a.createdAt ?? a.at ?? ""));

  return {
    truck,
    accessReason: reason,
    ownership: db().ownership.filter((o) => o.truckId === truckId).sort(byDate),
    claims: db().claims.filter((c) => c.truckId === truckId).sort(byDate),
    relationships: db().relationships.filter((r) => r.truckId === truckId).sort(byDate),
    dispatchAccess: db().dispatchAccess.filter((d) => d.truckId === truckId).sort(byDate),
    assignments: db().assignments.filter((a) => a.truckId === truckId).sort(byDate),
    documents: db().documents.filter((d) => d.truckId === truckId),
    events: db().events.filter((e) => e.truckId === truckId)
      .sort((a, b) => b.at.localeCompare(a.at)),
    myRelationship: activeRelationship(truckId, ctx.organizationId) ?? pendingRelationship(truckId, ctx.organizationId),
  };
}

function record(event: Omit<TruckEvent, "id">) {
  db().events = [...db().events, { ...event, id: rowId("evt") }];
}

/* -------------------------------------------------------------------------- */
/* THE canonical registration service                                          */
/* -------------------------------------------------------------------------- */

export interface RegisterTruckInput {
  vin: string;
  equipmentType: TruckEquipmentType;
  unitNumber: string;
  year: number;
  make: string;
  model: string;
  color?: string;
  registration: TruckRegistration;
  specs: TruckSpecs;
  status: TruckOperatingStatus;
  availability: Truck["availability"];
  notes?: string;
  relationshipType: CarrierRelationshipType;
  /** First ownership, for a genuinely new truck. */
  ownerType: OwnerType;
  ownerName: string;
  ownerRef?: string;
  /** Filenames only. Nothing is uploaded — see mockAddDocument. */
  evidence: TruckDocumentSnapshot[];
  minimumRatePerMileCents?: number;
  maxDeadheadMiles?: number;
}

export type RegisterTruckOutcome =
  | { status: "created"; truck: Truck }
  | { status: "existing_connected"; truck: Truck; relationship: TruckCarrierRelationship }
  | { status: "relationship_pending"; truck: Truck; relationship: TruckCarrierRelationship; currentOperator?: string }
  | { status: "ownership_claim_required"; truck: Truck; currentOwnerName: string }
  | { status: "manual_review_required"; truck: Truck; claim: TruckOwnershipClaim }
  | { status: "invalid_vin"; message: string }
  | { status: "unauthorized"; missing: PermissionKey[] };

/**
 * The one way a truck enters Antcolos or gains a new carrier.
 *
 * Manual entry, document scanning and owner-operator onboarding all land here,
 * so they cannot drift apart and quietly grow different duplicate rules. The
 * order matters: normalize, validate, then look for an existing truck BEFORE
 * considering creating one. A second submission of a VIN never creates a second
 * truck and never overwrites the first.
 */
export async function registerOrConnectTruck(
  ctx: TruckContext,
  input: RegisterTruckInput,
): Promise<RegisterTruckOutcome> {
  await sleep(LATENCY_MS);

  const missing = (["trucks:create", "trucks:relationships:manage"] as PermissionKey[])
    .filter((k) => !ctx.permissions.has(k));
  if (missing.length) return { status: "unauthorized", missing };

  const vinProblem = validateVin(input.vin);
  if (vinProblem) return { status: "invalid_vin", message: vinProblem };
  const vin = normalizeVin(input.vin);

  const existing = db().trucks.find((t) => t.vin === vin);

  /* ---- A truck we have never seen: create it, and its first ownership ---- */
  if (!existing) {
    const truckId = uuid();
    const created: Truck = {
      truckId,
      vin,
      equipmentType: input.equipmentType,
      year: input.year,
      make: input.make.trim(),
      model: input.model.trim(),
      color: input.color?.trim() || undefined,
      registration: input.registration,
      specs: input.specs,
      status: input.status,
      availability: input.availability,
      notes: input.notes?.trim() || undefined,
      createdAt: iso(now()),
      createdByOrganizationId: ctx.organizationId,
    };
    db().trucks = [created, ...db().trucks];

    db().ownership = [
      {
        id: rowId("own"),
        truckId,
        ownerType: input.ownerType,
        ownerName: input.ownerName.trim(),
        ownerRef: input.ownerRef,
        startedAt: iso(now()),
        status: "active",
        evidence: input.evidence,
        createdByMembershipId: ctx.membershipId,
        createdByName: ctx.actorName,
        createdAt: iso(now()),
      },
      ...db().ownership,
    ];

    const relationship = rel(
      truckId, ctx.organizationId, organizationNameFor(ctx.organizationId),
      input.relationshipType, input.unitNumber.trim(), "active", iso(now()),
      input.minimumRatePerMileCents ?? 100, input.maxDeadheadMiles ?? 30,
    );
    db().relationships = [relationship, ...db().relationships];

    record({ truckId, at: iso(now()), kind: "created", summary: "Truck registered in Antcolos", organizationId: ctx.organizationId, actorName: ctx.actorName });
    record({ truckId, at: iso(now()), kind: "ownership_started", summary: `${input.ownerName.trim()} recorded as owner`, organizationId: ctx.organizationId, actorName: ctx.actorName });
    record({ truckId, at: iso(now()), kind: "relationship_started", summary: `${organizationNameFor(ctx.organizationId)} began operating this truck`, organizationId: ctx.organizationId, actorName: ctx.actorName });
    return { status: "created", truck: created };
  }

  /* ---- The VIN is already a truck. Never create a second one. ---- */
  const mineActive = activeRelationship(existing.truckId, ctx.organizationId);
  if (mineActive) return { status: "existing_connected", truck: existing, relationship: mineActive };

  const minePending = pendingRelationship(existing.truckId, ctx.organizationId);
  if (minePending) {
    return {
      status: "relationship_pending",
      truck: existing,
      relationship: minePending,
      currentOperator: operatingCarrier(existing.truckId)?.organizationName,
    };
  }

  const owner = activeOwnership(existing.truckId);
  const ownedByMe = owner?.ownerRef === ctx.organizationId;
  const operator = operatingCarrier(existing.truckId);

  // Somebody else is running it. Ask, never take.
  if (operator && operator.organizationId !== ctx.organizationId) {
    const requested = rel(
      existing.truckId, ctx.organizationId, organizationNameFor(ctx.organizationId),
      input.relationshipType, input.unitNumber.trim(), "pending", iso(now()),
      input.minimumRatePerMileCents ?? 100, input.maxDeadheadMiles ?? 30,
    );
    db().relationships = [requested, ...db().relationships];
    record({
      truckId: existing.truckId, at: iso(now()), kind: "relationship_requested",
      summary: `${organizationNameFor(ctx.organizationId)} requested to operate this truck`,
      detail: `${operator.organizationName} still operates it until this is accepted.`,
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return {
      status: "relationship_pending", truck: existing, relationship: requested,
      currentOperator: operator.organizationName,
    };
  }

  // Nobody is operating it, and somebody else owns it: this is an ownership
  // question, not an operating one, and it is not ours to answer.
  if (owner && !ownedByMe) {
    return { status: "ownership_claim_required", truck: existing, currentOwnerName: owner.ownerName };
  }

  // Ours already, or ownerless: connect it.
  const relationship = rel(
    existing.truckId, ctx.organizationId, organizationNameFor(ctx.organizationId),
    input.relationshipType, input.unitNumber.trim(), "active", iso(now()),
    input.minimumRatePerMileCents ?? 100, input.maxDeadheadMiles ?? 30,
  );
  db().relationships = [relationship, ...db().relationships];
  record({
    truckId: existing.truckId, at: iso(now()), kind: "relationship_started",
    summary: `${organizationNameFor(ctx.organizationId)} began operating this truck`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { status: "existing_connected", truck: existing, relationship };
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

/** Look a VIN up before committing to anything. Used by the wizard's VIN step. */
export interface VinLookupResult {
  vin: string;
  truck?: Truck;
  operatorName?: string;
  ownerName?: string;
  alreadyConnected: boolean;
  pendingForMe: boolean;
}

export async function lookUpVin(vin: string, ctx: TruckContext): Promise<VinLookupResult> {
  await sleep(400);
  const normalized = normalizeVin(vin);
  const truck = db().trucks.find((t) => t.vin === normalized);
  if (!truck) return { vin: normalized, alreadyConnected: false, pendingForMe: false };
  return {
    vin: normalized,
    truck,
    operatorName: operatingCarrier(truck.truckId)?.organizationName,
    ownerName: activeOwnership(truck.truckId)?.ownerName,
    alreadyConnected: Boolean(activeRelationship(truck.truckId, ctx.organizationId)),
    pendingForMe: Boolean(pendingRelationship(truck.truckId, ctx.organizationId)),
  };
}

/* -------------------------------------------------------------------------- */
/* Ownership claims and transfer                                               */
/* -------------------------------------------------------------------------- */

export async function openOwnershipClaim(
  truckId: string,
  ctx: TruckContext,
  input: { ownerType: OwnerType; ownerName: string; note?: string; evidence: TruckDocumentSnapshot[] },
): Promise<TruckOwnershipClaim> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trucks:create");
  const truck = db().trucks.find((t) => t.truckId === truckId);
  if (!truck) throw new TruckNotFoundError();

  const claim: TruckOwnershipClaim = {
    id: rowId("claim"),
    truckId,
    claimantOrganizationId: ctx.organizationId,
    claimantName: organizationNameFor(ctx.organizationId),
    claimedOwnerType: input.ownerType,
    claimedOwnerName: input.ownerName.trim(),
    status: "pending",
    evidence: input.evidence,
    note: input.note?.trim() || undefined,
    createdAt: iso(now()),
  };
  db().claims = [claim, ...db().claims];
  record({
    truckId, at: iso(now()), kind: "ownership_claim_opened",
    summary: `${claim.claimantName} claimed ownership`,
    detail: "Pending review by the recorded owner. Nothing has changed yet.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...claim };
}

/** Claims waiting on THIS organization, as the currently recorded owner. */
export async function listClaimsToReview(ctx: TruckContext): Promise<
  Array<{ claim: TruckOwnershipClaim; truck: Truck; currentOwner: TruckOwnershipRecord }>
> {
  await sleep(200);
  if (!ctx.permissions.has("trucks:ownership:review")) return [];
  return db().claims
    .filter((c) => c.status === "pending" || c.status === "manual_review")
    .map((claim) => {
      const truck = db().trucks.find((t) => t.truckId === claim.truckId);
      const currentOwner = activeOwnership(claim.truckId);
      return truck && currentOwner ? { claim, truck, currentOwner } : null;
    })
    .filter((row): row is { claim: TruckOwnershipClaim; truck: Truck; currentOwner: TruckOwnershipRecord } =>
      row !== null && row.currentOwner.ownerRef === ctx.organizationId);
}

export type ClaimDecision = "accept" | "reject" | "manual_review";

/**
 * Resolve an ownership claim.
 *
 * Accepting is a transfer of a RELATIONSHIP, not a replacement of a truck. It
 * ends one ownership record, opens another, and writes one event. It must leave
 * the truckId, the VIN, the profile, the specifications, the documents, the
 * carrier relationships, the driver assignments and every other history exactly
 * as they were — which is what the ownership tests assert, field by field.
 */
export async function resolveOwnershipClaim(
  claimId: string,
  decision: ClaimDecision,
  ctx: TruckContext,
  note?: string,
): Promise<TruckOwnershipClaim> {
  await sleep(LATENCY_MS);
  // Deciding who owns a truck is stronger than editing one, and is gated apart.
  requirePermissions(ctx, "trucks:ownership:review");

  const claim = db().claims.find((c) => c.id === claimId);
  if (!claim) throw new TruckNotFoundError();
  const currentOwner = activeOwnership(claim.truckId);
  if (!currentOwner || currentOwner.ownerRef !== ctx.organizationId) {
    // Only the recorded owner may answer a claim against their truck.
    throw new TruckPermissionError(["trucks:ownership:review"]);
  }

  if (decision === "manual_review") {
    const updated: TruckOwnershipClaim = {
      ...claim, status: "manual_review", resolutionNote: note?.trim() || undefined,
    };
    db().claims = db().claims.map((c) => (c.id === claimId ? updated : c));
    record({
      truckId: claim.truckId, at: iso(now()), kind: "ownership_claim_resolved",
      summary: "Ownership claim sent to manual review",
      detail: "Nothing has changed. Antcolos support will look at the evidence.",
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { ...updated };
  }

  if (decision === "reject") {
    const updated: TruckOwnershipClaim = {
      ...claim, status: "rejected", resolvedAt: iso(now()), resolutionNote: note?.trim() || undefined,
    };
    db().claims = db().claims.map((c) => (c.id === claimId ? updated : c));
    record({
      truckId: claim.truckId, at: iso(now()), kind: "ownership_claim_resolved",
      summary: "Ownership claim rejected",
      detail: note?.trim(), organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
    return { ...updated };
  }

  // Accepted. Touch ownership records and the timeline. Nothing else.
  const endedAt = iso(now());
  db().ownership = db().ownership.map((o) =>
    o.id === currentOwner.id ? { ...o, status: "ended" as const, endedAt } : o,
  );
  db().ownership = [
    {
      id: rowId("own"),
      truckId: claim.truckId,
      ownerType: claim.claimedOwnerType,
      ownerName: claim.claimedOwnerName,
      ownerRef: claim.claimantOrganizationId,
      startedAt: endedAt,
      status: "active",
      evidence: claim.evidence,
      createdByMembershipId: ctx.membershipId,
      createdByName: ctx.actorName,
      createdAt: endedAt,
    },
    ...db().ownership,
  ];
  const updated: TruckOwnershipClaim = {
    ...claim, status: "accepted", resolvedAt: endedAt, resolutionNote: note?.trim() || undefined,
  };
  db().claims = db().claims.map((c) => (c.id === claimId ? updated : c));
  record({
    truckId: claim.truckId, at: endedAt, kind: "ownership_ended",
    summary: `${currentOwner.ownerName} ownership ended`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  record({
    truckId: claim.truckId, at: endedAt, kind: "ownership_started",
    summary: `${claim.claimedOwnerName} recorded as owner`,
    detail: "Ownership transferred. The truck, its VIN, documents and history were unchanged.",
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...updated };
}

/* -------------------------------------------------------------------------- */
/* Carrier relationships                                                       */
/* -------------------------------------------------------------------------- */

export async function endCarrierRelationship(
  relationshipId: string,
  reason: string,
  ctx: TruckContext,
): Promise<TruckCarrierRelationship> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trucks:relationships:manage");
  const relationship = db().relationships.find((r) => r.id === relationshipId);
  if (!relationship || relationship.organizationId !== ctx.organizationId) {
    throw new TruckNotFoundError();
  }
  const ended: TruckCarrierRelationship = {
    ...relationship, status: "ended", endedAt: iso(now()), endReason: reason.trim(),
  };
  db().relationships = db().relationships.map((r) => (r.id === ended.id ? ended : r));

  // The driver's assignment for this carrier goes with the relationship. The
  // driver's permanent profile does not.
  db().assignments = db().assignments.map((a) =>
    a.truckId === relationship.truckId && a.organizationId === ctx.organizationId && !a.endedAt
      ? { ...a, endedAt: iso(now()), endReason: "Carrier relationship ended." }
      : a,
  );
  record({
    truckId: relationship.truckId, at: iso(now()), kind: "relationship_ended",
    summary: `${relationship.organizationName} stopped operating this truck`,
    detail: reason.trim(), organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...ended };
}

/* -------------------------------------------------------------------------- */
/* Driver assignment                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Put a driver on a truck.
 *
 * `eligibleDriverIds` is supplied by the caller from its own organization's
 * roster and checked here, so a carrier cannot assign somebody else's driver by
 * passing an id it happens to know.
 */
export async function assignDriver(
  truckId: string,
  driver: { driverProfileId: string; driverName: string },
  eligibleDriverIds: readonly string[],
  ctx: TruckContext,
): Promise<TruckDriverAssignment> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trucks:assignments:manage");
  getTruckOrThrow(truckId, ctx);
  if (!activeRelationship(truckId, ctx.organizationId)) throw new TruckNotFoundError();
  if (!eligibleDriverIds.includes(driver.driverProfileId)) {
    throw new TruckPermissionError(["trucks:assignments:manage"]);
  }

  const at = iso(now());
  const existing = activeAssignment(truckId, ctx.organizationId);
  if (existing) {
    db().assignments = db().assignments.map((a) =>
      a.id === existing.id ? { ...a, endedAt: at, endReason: "Replaced by a new assignment." } : a,
    );
    record({
      truckId, at, kind: "driver_unassigned",
      summary: `${existing.driverName} assignment ended`,
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  }

  const assignment: TruckDriverAssignment = {
    id: rowId("asg"), truckId, organizationId: ctx.organizationId,
    driverProfileId: driver.driverProfileId, driverName: driver.driverName,
    startedAt: at, createdAt: at,
  };
  db().assignments = [assignment, ...db().assignments];
  record({
    truckId, at, kind: "driver_assigned", summary: `${driver.driverName} assigned`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...assignment };
}

export async function endDriverAssignment(
  assignmentId: string,
  reason: string,
  ctx: TruckContext,
): Promise<TruckDriverAssignment> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "trucks:assignments:manage");
  const assignment = db().assignments.find((a) => a.id === assignmentId);
  if (!assignment || assignment.organizationId !== ctx.organizationId) throw new TruckNotFoundError();
  const at = iso(now());
  const ended = { ...assignment, endedAt: at, endReason: reason.trim() };
  db().assignments = db().assignments.map((a) => (a.id === ended.id ? ended : a));
  record({
    truckId: assignment.truckId, at, kind: "driver_unassigned",
    summary: `${assignment.driverName} assignment ended`,
    detail: reason.trim(), organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...ended };
}

/* -------------------------------------------------------------------------- */
/* Status, availability and documents                                          */
/* -------------------------------------------------------------------------- */

export async function setTruckStatus(
  truckId: string,
  status: TruckOperatingStatus,
  ctx: TruckContext,
  availability?: Truck["availability"],
): Promise<Truck> {
  await sleep(350);
  requirePermissions(ctx, "trucks:edit");
  const truck = getTruckOrThrow(truckId, ctx);
  if (!activeRelationship(truckId, ctx.organizationId)) throw new TruckNotFoundError();

  const updated: Truck = { ...truck, status, availability: availability ?? truck.availability };
  db().trucks = db().trucks.map((t) => (t.truckId === truckId ? updated : t));
  record({
    truckId, at: iso(now()), kind: "status_changed",
    summary: `Status changed to ${status.replace(/_/g, " ")}`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  if (availability) {
    record({
      truckId, at: iso(now()), kind: "availability_changed",
      summary: "Availability updated",
      detail: [availability.city, availability.state].filter(Boolean).join(", ") || undefined,
      organizationId: ctx.organizationId, actorName: ctx.actorName,
    });
  }
  return { ...updated };
}

/**
 * Attach a document record.
 *
 * Nothing is uploaded. The browser told us a filename, a type and a size, and
 * the record says exactly that — `selected_local` — rather than claiming the
 * file was stored, transmitted, read or approved by anyone.
 */
export async function addTruckDocument(
  truckId: string,
  kind: TruckDocumentKind,
  file: { name: string; type: string; size: number },
  ctx: TruckContext,
  expiresAt?: string,
): Promise<TruckDocument> {
  await sleep(400);
  requirePermissions(ctx, "trucks:documents:manage");
  getTruckOrThrow(truckId, ctx);

  // A replaced document is superseded, never deleted: the carrier keeps what it
  // was given, and the history stays readable.
  const previous = db().documents.find(
    (d) => d.truckId === truckId && d.kind === kind && d.status !== "superseded",
  );
  const document: TruckDocument = {
    id: rowId("doc"), truckId, kind, status: "selected_local",
    fileName: file.name, fileType: file.type || "application/octet-stream", sizeBytes: file.size,
    expiresAt, addedByOrganizationId: ctx.organizationId,
    createdAt: iso(now()), updatedAt: iso(now()),
  };
  if (previous) {
    db().documents = db().documents.map((d) =>
      d.id === previous.id ? { ...d, status: "superseded" as const, supersededByDocumentId: document.id } : d,
    );
  }
  db().documents = [...db().documents, document];
  record({
    truckId, at: iso(now()), kind: "document_added",
    summary: `${DOCUMENT_LABEL[kind] ?? kind} attached`,
    detail: previous ? "Replaces an earlier document, which is kept in history." : undefined,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...document };
}

export async function submitTruckDocument(documentId: string, ctx: TruckContext): Promise<TruckDocument> {
  await sleep(350);
  requirePermissions(ctx, "trucks:documents:manage");
  const existing = db().documents.find((d) => d.id === documentId);
  if (!existing) throw new TruckNotFoundError();
  getTruckOrThrow(existing.truckId, ctx);
  const updated: TruckDocument = { ...existing, status: "pending_review", updatedAt: iso(now()) };
  db().documents = db().documents.map((d) => (d.id === documentId ? updated : d));
  record({
    truckId: existing.truckId, at: iso(now()), kind: "document_reviewed",
    summary: `${DOCUMENT_LABEL[existing.kind] ?? existing.kind} sent for review`,
    organizationId: ctx.organizationId, actorName: ctx.actorName,
  });
  return { ...updated };
}

/** Read-only helpers the screens use for counts, kept honest against the roster. */
export function fleetCount(ctx: TruckContext): number {
  return fleetSync(ctx).length;
}

/**
 * Adapts a ServiceContext into a registry context.
 *
 * The organization always comes from the authenticated membership on the
 * context, never from anything a screen or a form supplied.
 */
export function truckContextFrom(ctx: {
  organizationId: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  actor: { displayNameSnapshot: string };
  driverProfileId?: string;
  scope?: { loads: "all" | "assigned" };
}): TruckContext {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    permissions: ctx.permissions,
    driverProfileId: ctx.scope?.loads === "assigned" ? ctx.driverProfileId : undefined,
  };
}

"use client";

import type {
  CarrierRelationship,
  DriverDocument,
  DriverDocumentRequirement,
  DriverProfile,
  EngagementType,
  RelationshipStatus,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Driver profiles, carrier relationships and document states live here in
 * memory for the browser session.
 *
 * Nothing is uploaded and no file ever leaves the browser. "Uploading" reads a
 * file's name, type and size — the properties the browser gives us for free —
 * and then throws the file away. There is no storage, no transfer, and nothing
 * is verified by anyone. A real adapter replaces this file; the rest of the
 * feature never learns the difference.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 600;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

let sequence = 0;
const nextId = (p: string) => `${p}_${(++sequence).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* What each carrier asks a driver for                                         */
/* -------------------------------------------------------------------------- */

const DRIVER_DOCUMENTS: DriverDocumentRequirement[] = [
  { key: "cdl_front", label: "Driver license / CDL — front", description: "A clear photo of the front of your licence. All four corners visible.", category: "driver", required: true, expires: true },
  { key: "cdl_back", label: "Driver license / CDL — back", description: "The back of the same licence.", category: "driver", required: true, expires: false },
  { key: "medical_front", label: "Medical card — front", description: "Your current DOT medical examiner's certificate.", category: "driver", required: true, expires: true },
  { key: "medical_back", label: "Medical card — back", description: "The back of the medical card, if it has anything printed on it.", category: "driver", required: false, expires: false },
];

const OWNER_OPERATOR_DOCUMENTS: DriverDocumentRequirement[] = [
  { key: "business_info", label: "Business information", description: "Your legal business name, structure and address.", category: "owner_operator", required: true, expires: false },
  { key: "w9", label: "W-9", description: "So the carrier can pay you and report it correctly.", category: "owner_operator", required: true, expires: false },
  { key: "coi", label: "Certificate of Insurance", description: "Proof of your own coverage, with the carrier listed.", category: "owner_operator", required: true, expires: true },
  { key: "vehicle_registration", label: "Vehicle registration", description: "Registration for the truck you will run.", category: "owner_operator", required: true, expires: true },
  { key: "lease_agreement", label: "Lease or operating agreement", description: "The agreement between you and this carrier.", category: "owner_operator", required: false, expires: false },
];

/**
 * Per-carrier extras. Kept as data so a carrier can ask for something unusual
 * without any code change — the checklist simply grows a row.
 */
const CARRIER_EXTRA_DOCUMENTS: Record<string, DriverDocumentRequirement[]> = {
  org_northline: [
    {
      key: "northline_handbook",
      label: "Signed driver handbook",
      description: "Northline asks every driver to sign their handbook before the first load.",
      category: "driver",
      required: true,
      expires: false,
      carrierSpecific: true,
    },
  ],
  org_cascade: [],
};

/** The full checklist for one engagement with one carrier. */
export function documentRequirements(
  engagementType: EngagementType,
  carrierId: string,
): DriverDocumentRequirement[] {
  const extras = CARRIER_EXTRA_DOCUMENTS[carrierId] ?? [];
  return engagementType === "owner_operator"
    ? [...DRIVER_DOCUMENTS, ...extras, ...OWNER_OPERATOR_DOCUMENTS]
    : [...DRIVER_DOCUMENTS, ...extras];
}

/* -------------------------------------------------------------------------- */
/* Seed state                                                                  */
/* -------------------------------------------------------------------------- */

function seedProfile(): DriverProfile {
  return {
    id: "dp_sam",
    userId: "usr_sam",
    username: "sam_murtaza",
    legalName: "Sam Murtaza",
    email: "sam@antcolos.com",
    phone: "+1 (312) 555-0148",
    cdlNumber: "K4471182993",
    cdlState: "IL",
    cdlExpiresAt: daysFromNow(210),
    medicalCardExpiresAt: daysFromNow(24),
    createdAt: daysAgo(300),
  };
}

function seedRelationships(): CarrierRelationship[] {
  return [
    {
      id: "rel_cascade",
      driverProfileId: "dp_sam",
      carrierId: "org_cascade",
      carrierName: "Cascade Haul",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      invitedAt: daysAgo(110),
      startedAt: daysAgo(108),
      status: "active",
      sharedDocumentKeys: ["cdl_front", "cdl_back", "medical_front"],
    },
    {
      id: "rel_ridgeway",
      driverProfileId: "dp_sam",
      carrierId: "org_ridgeway",
      carrierName: "Ridgeway Carriers",
      engagementType: "owner_operator",
      roleName: "Driver",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload"],
      invitedAt: daysAgo(430),
      startedAt: daysAgo(425),
      status: "ended",
      endedAt: daysAgo(150),
      endReason: "Driver moved to a different carrier.",
      sharedDocumentKeys: ["cdl_front", "cdl_back", "medical_front", "w9", "coi"],
    },
  ];
}

function seedDocuments(): DriverDocument[] {
  return [
    { requirementKey: "cdl_front", status: "approved", fileName: "cdl-front.jpg", fileType: "image/jpeg", sizeBytes: 1_842_000, expiresAt: daysFromNow(210), submittedAt: daysAgo(107), updatedAt: daysAgo(105) },
    { requirementKey: "cdl_back", status: "approved", fileName: "cdl-back.jpg", fileType: "image/jpeg", sizeBytes: 1_610_000, submittedAt: daysAgo(107), updatedAt: daysAgo(105) },
    { requirementKey: "medical_front", status: "expiring_soon", fileName: "medical-card.pdf", fileType: "application/pdf", sizeBytes: 402_000, expiresAt: daysFromNow(24), submittedAt: daysAgo(107), updatedAt: daysAgo(20) },
    { requirementKey: "northline_handbook", status: "rejected", fileName: "handbook-scan.pdf", fileType: "application/pdf", sizeBytes: 980_000, rejectionReason: "Page 4 is missing a signature. Please sign every page marked with an X and upload again.", submittedAt: daysAgo(4), updatedAt: daysAgo(2) },
  ];
}

let PROFILE: DriverProfile | null = seedProfile();
let RELATIONSHIPS: CarrierRelationship[] = seedRelationships();
let DOCUMENTS: DriverDocument[] = seedDocuments();

/** Test hook. Never called by the UI. */
export function resetDriverMock(options?: { withProfile?: boolean }) {
  PROFILE = options?.withProfile === false ? null : seedProfile();
  RELATIONSHIPS = options?.withProfile === false ? [] : seedRelationships();
  DOCUMENTS = options?.withProfile === false ? [] : seedDocuments();
  sequence = 0;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Synchronous reads for other modules.
 *
 * The driver's own permanent profile and their carrier relationships live here
 * and only here. Safety & Compliance reads them to build the compliance a
 * driver sees about themselves; it never copies the person.
 */
export function driverProfileSync(): DriverProfile | null {
  return PROFILE ? { ...PROFILE } : null;
}

export function driverRelationshipsSync(): CarrierRelationship[] {
  return RELATIONSHIPS.map((r) => ({ ...r }));
}

export function driverDocumentsSync(): DriverDocument[] {
  return DOCUMENTS.map((d) => ({ ...d }));
}

export async function mockGetDriverProfile(): Promise<DriverProfile | null> {
  await sleep(250);
  return PROFILE ? { ...PROFILE } : null;
}

export interface QuickOnboardingInput {
  legalName: string;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
}

/**
 * Creates the permanent profile, or reuses the one the person already has.
 *
 * A driver who already has a profile and accepts a second carrier's invitation
 * must not be asked for their licence again, and must certainly not end up with
 * a second Antcolos account.
 */
export async function mockCreateOrGetDriverProfile(
  input: QuickOnboardingInput,
): Promise<DriverProfile> {
  await sleep(LATENCY_MS);
  if (PROFILE) return { ...PROFILE };
  PROFILE = {
    id: nextId("dp"),
    userId: "usr_sam",
    username: "sam_murtaza",
    legalName: input.legalName.trim(),
    email: "sam@antcolos.com",
    cdlNumber: input.cdlNumber.trim().toUpperCase(),
    cdlState: input.cdlState,
    cdlExpiresAt: input.cdlExpiresAt,
    createdAt: iso(now()),
  };
  return { ...PROFILE };
}

/* -------------------------------------------------------------------------- */
/* Relationships                                                               */
/* -------------------------------------------------------------------------- */

export async function mockListRelationships(): Promise<CarrierRelationship[]> {
  await sleep(250);
  return RELATIONSHIPS.map((r) => ({ ...r }));
}

export interface NewRelationshipInput {
  carrierId: string;
  carrierName: string;
  engagementType: EngagementType;
  roleName: string;
  permissions: CarrierRelationship["permissions"];
  sharedDocumentKeys: string[];
}

export async function mockCreateRelationship(
  profileId: string,
  input: NewRelationshipInput,
): Promise<CarrierRelationship> {
  await sleep(LATENCY_MS);
  const relationship: CarrierRelationship = {
    id: nextId("rel"),
    driverProfileId: profileId,
    ...input,
    invitedAt: iso(now()),
    startedAt: iso(now()),
    status: "onboarding",
    sharedDocumentKeys: [...input.sharedDocumentKeys],
  };
  RELATIONSHIPS = [relationship, ...RELATIONSHIPS];
  return { ...relationship };
}

/**
 * Ending a relationship ends the carrier's access and nothing else.
 *
 * The permanent profile, the Antcolos account and every other carrier
 * relationship are untouched. What the carrier was already given stays in their
 * records as a snapshot; what changes afterwards is no longer theirs to see.
 */
export async function mockEndRelationship(
  relationshipId: string,
  reason: string,
): Promise<CarrierRelationship> {
  await sleep(LATENCY_MS);
  const index = RELATIONSHIPS.findIndex((r) => r.id === relationshipId);
  if (index < 0) throw new Error(`No such relationship: ${relationshipId}`);
  const ended: CarrierRelationship = {
    ...RELATIONSHIPS[index],
    status: "ended",
    endedAt: iso(now()),
    endReason: reason.trim(),
  };
  RELATIONSHIPS = RELATIONSHIPS.map((r) => (r.id === ended.id ? ended : r));
  return { ...ended };
}

export async function mockSetRelationshipStatus(
  relationshipId: string,
  status: RelationshipStatus,
): Promise<CarrierRelationship> {
  await sleep(LATENCY_MS);
  const index = RELATIONSHIPS.findIndex((r) => r.id === relationshipId);
  if (index < 0) throw new Error(`No such relationship: ${relationshipId}`);
  const updated = { ...RELATIONSHIPS[index], status };
  RELATIONSHIPS = RELATIONSHIPS.map((r) => (r.id === updated.id ? updated : r));
  return { ...updated };
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export async function mockListDocuments(): Promise<DriverDocument[]> {
  await sleep(250);
  return DOCUMENTS.map((d) => ({ ...d }));
}

function upsert(doc: DriverDocument) {
  const index = DOCUMENTS.findIndex((d) => d.requirementKey === doc.requirementKey);
  DOCUMENTS = index >= 0
    ? DOCUMENTS.map((d) => (d.requirementKey === doc.requirementKey ? doc : d))
    : [...DOCUMENTS, doc];
}

/**
 * Pretends to upload. Reads the name, type and size the browser already knows
 * and then lets the file go — nothing is read, transmitted or kept.
 *
 * `onProgress` exists so the screen can show a real progress bar over fake
 * work; a real adapter reports genuine progress through the same callback.
 */
export async function mockUploadDocument(
  requirementKey: string,
  file: { name: string; type: string; size: number },
  onProgress: (percent: number) => void,
): Promise<DriverDocument> {
  for (let percent = 0; percent <= 100; percent += 20) {
    onProgress(percent);
    await sleep(140);
  }
  const doc: DriverDocument = {
    requirementKey,
    status: "uploaded",
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    updatedAt: iso(now()),
  };
  upsert(doc);
  return { ...doc };
}

/** Takes a file back off the checklist before it was ever submitted. */
export async function mockRemoveDocument(requirementKey: string): Promise<void> {
  await sleep(250);
  DOCUMENTS = DOCUMENTS.filter((d) => d.requirementKey !== requirementKey);
}

export async function mockSetDocumentExpiry(
  requirementKey: string,
  expiresAt: string,
): Promise<DriverDocument> {
  await sleep(200);
  const existing = DOCUMENTS.find((d) => d.requirementKey === requirementKey);
  if (!existing) throw new Error(`Nothing uploaded for ${requirementKey}`);
  const updated = { ...existing, expiresAt, updatedAt: iso(now()) };
  upsert(updated);
  return { ...updated };
}

/** Hands the document to the carrier for review. Nobody actually reviews it. */
export async function mockSubmitDocument(requirementKey: string): Promise<DriverDocument> {
  await sleep(LATENCY_MS);
  const existing = DOCUMENTS.find((d) => d.requirementKey === requirementKey);
  if (!existing) throw new Error(`Nothing uploaded for ${requirementKey}`);
  const updated: DriverDocument = {
    ...existing,
    status: "under_review",
    submittedAt: iso(now()),
    updatedAt: iso(now()),
  };
  upsert(updated);
  return { ...updated };
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

export interface Completion {
  required: number;
  done: number;
  percent: number;
  outstanding: DriverDocumentRequirement[];
}

/** Approved, under review and uploaded all count as "the driver has done it". */
const DONE_STATUSES = new Set(["uploaded", "under_review", "approved", "expiring_soon"]);

export function completion(
  requirements: readonly DriverDocumentRequirement[],
  documents: readonly DriverDocument[],
): Completion {
  const required = requirements.filter((r) => r.required);
  const byKey = new Map(documents.map((d) => [d.requirementKey, d]));
  const outstanding = required.filter((r) => {
    const doc = byKey.get(r.key);
    return !doc || !DONE_STATUSES.has(doc.status);
  });
  const done = required.length - outstanding.length;
  return {
    required: required.length,
    done,
    percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
    outstanding,
  };
}

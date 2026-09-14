"use client";

import type {
  DocumentStatus, EngagementType, PermissionKey, RelationshipStatus,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The carrier's side of the same relationships. Invented rows, held in memory
 * for the browser session.
 *
 * A carrier sees a driver only through the relationship: what the driver agreed
 * to share, as a snapshot taken when they shared it. Ending a relationship ends
 * that access — it never touches the driver's permanent profile, which lives in
 * mock-driver.ts and belongs to the driver.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 400;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

export interface SharedDocumentSnapshot {
  key: string;
  label: string;
  status: DocumentStatus;
  fileName?: string;
  sharedAt: string;
  expiresAt?: string;
}

export interface TimelineEvent {
  at: string;
  event: string;
  detail?: string;
}

export interface CarrierDriver {
  /** The relationship id, not the driver's. A driver may work for several. */
  id: string;
  driverProfileId: string;
  name: string;
  email: string;
  engagementType: EngagementType;
  roleName: string;
  permissions: PermissionKey[];
  status: RelationshipStatus;
  documentsDone: number;
  documentsRequired: number;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
  medicalExpiresAt?: string;
  invitedAt: string;
  startedAt?: string;
  endedAt?: string;
  endReason?: string;
  sharedDocuments: SharedDocumentSnapshot[];
  invitationHistory: TimelineEvent[];
  timeline: TimelineEvent[];
}

const DRIVER_PERMS: PermissionKey[] = [
  "loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view",
];

function seed(): CarrierDriver[] {
  return [
    {
      id: "cd_1", driverProfileId: "dp_dmitri", name: "Dmitri Kovalenko", email: "dmitri@example.com",
      engagementType: "company_driver", roleName: "Driver", permissions: DRIVER_PERMS,
      status: "active", documentsDone: 5, documentsRequired: 5,
      cdlNumber: "S2290184471", cdlState: "IL", cdlExpiresAt: daysFromNow(400), medicalExpiresAt: daysFromNow(190),
      invitedAt: daysAgo(220), startedAt: daysAgo(218),
      sharedDocuments: [
        { key: "cdl_front", label: "Driver license / CDL — front", status: "approved", fileName: "cdl-front.jpg", sharedAt: daysAgo(217), expiresAt: daysFromNow(400) },
        { key: "cdl_back", label: "Driver license / CDL — back", status: "approved", fileName: "cdl-back.jpg", sharedAt: daysAgo(217) },
        { key: "medical_front", label: "Medical card — front", status: "approved", fileName: "medical.pdf", sharedAt: daysAgo(217), expiresAt: daysFromNow(190) },
        { key: "northline_handbook", label: "Signed driver handbook", status: "approved", fileName: "handbook.pdf", sharedAt: daysAgo(210) },
      ],
      invitationHistory: [
        { at: daysAgo(220), event: "Invitation sent", detail: "Company Driver · expires in 14 days" },
        { at: daysAgo(218), event: "Invitation accepted" },
      ],
      timeline: [
        { at: daysAgo(220), event: "Invited as Company Driver" },
        { at: daysAgo(218), event: "Accepted and created driver profile" },
        { at: daysAgo(210), event: "All required documents approved" },
        { at: daysAgo(208), event: "Relationship became active" },
      ],
    },
    {
      id: "cd_2", driverProfileId: "dp_marisol", name: "Marisol Ortiz", email: "marisol@example.com",
      engagementType: "owner_operator", roleName: "Driver", permissions: DRIVER_PERMS,
      status: "onboarding", documentsDone: 4, documentsRequired: 9,
      cdlNumber: "R8813320045", cdlState: "TX", cdlExpiresAt: daysFromNow(35), medicalExpiresAt: daysFromNow(300),
      invitedAt: daysAgo(9), startedAt: daysAgo(7),
      sharedDocuments: [
        { key: "cdl_front", label: "Driver license / CDL — front", status: "approved", fileName: "licence-front.jpg", sharedAt: daysAgo(7), expiresAt: daysFromNow(35) },
        { key: "cdl_back", label: "Driver license / CDL — back", status: "approved", fileName: "licence-back.jpg", sharedAt: daysAgo(7) },
        { key: "medical_front", label: "Medical card — front", status: "pending_review", fileName: "med-card.pdf", sharedAt: daysAgo(2), expiresAt: daysFromNow(300) },
        { key: "w9", label: "W-9", status: "rejected", fileName: "w9-2025.pdf", sharedAt: daysAgo(3) },
      ],
      invitationHistory: [
        { at: daysAgo(9), event: "Invitation sent", detail: "Owner-Operator · expires in 14 days" },
        { at: daysAgo(7), event: "Invitation accepted" },
      ],
      timeline: [
        { at: daysAgo(9), event: "Invited as Owner-Operator" },
        { at: daysAgo(7), event: "Accepted and created driver profile" },
        { at: daysAgo(3), event: "W-9 sent back", detail: "Wrong tax year." },
        { at: daysAgo(2), event: "Medical card submitted for review" },
      ],
    },
    {
      id: "cd_3", driverProfileId: "dp_ray", name: "Ray Bell", email: "ray.bell@example.com",
      engagementType: "company_driver", roleName: "Driver", permissions: DRIVER_PERMS,
      status: "invited", documentsDone: 0, documentsRequired: 5,
      cdlNumber: "—", cdlState: "—", cdlExpiresAt: "",
      invitedAt: daysAgo(2),
      sharedDocuments: [],
      invitationHistory: [
        { at: daysAgo(2), event: "Invitation sent", detail: "Company Driver · expires in 12 days" },
      ],
      timeline: [{ at: daysAgo(2), event: "Invited as Company Driver" }],
    },
    {
      id: "cd_4", driverProfileId: "dp_amir", name: "Amir Haddad", email: "amir@example.com",
      engagementType: "company_driver", roleName: "Driver", permissions: DRIVER_PERMS,
      status: "suspended", documentsDone: 4, documentsRequired: 5,
      cdlNumber: "H1120938471", cdlState: "IN", cdlExpiresAt: daysFromNow(-6), medicalExpiresAt: daysFromNow(120),
      invitedAt: daysAgo(300), startedAt: daysAgo(298),
      sharedDocuments: [
        { key: "cdl_front", label: "Driver license / CDL — front", status: "expired", fileName: "cdl.jpg", sharedAt: daysAgo(297), expiresAt: daysFromNow(-6) },
        { key: "medical_front", label: "Medical card — front", status: "approved", fileName: "medical.pdf", sharedAt: daysAgo(297), expiresAt: daysFromNow(120) },
      ],
      invitationHistory: [
        { at: daysAgo(300), event: "Invitation sent", detail: "Company Driver" },
        { at: daysAgo(298), event: "Invitation accepted" },
      ],
      timeline: [
        { at: daysAgo(300), event: "Invited as Company Driver" },
        { at: daysAgo(298), event: "Accepted and created driver profile" },
        { at: daysAgo(6), event: "Suspended", detail: "CDL expired — cannot be dispatched." },
      ],
    },
    {
      id: "cd_5", driverProfileId: "dp_kelsey", name: "Kelsey Nguyen", email: "kelsey@example.com",
      engagementType: "owner_operator", roleName: "Driver", permissions: DRIVER_PERMS,
      status: "ended", documentsDone: 9, documentsRequired: 9,
      cdlNumber: "N5540192288", cdlState: "WI", cdlExpiresAt: daysFromNow(260),
      invitedAt: daysAgo(500), startedAt: daysAgo(496), endedAt: daysAgo(60),
      endReason: "Moved to another carrier.",
      sharedDocuments: [
        { key: "cdl_front", label: "Driver license / CDL — front", status: "approved", fileName: "cdl-front.jpg", sharedAt: daysAgo(495) },
        { key: "w9", label: "W-9", status: "approved", fileName: "w9.pdf", sharedAt: daysAgo(494) },
        { key: "coi", label: "Certificate of Insurance", status: "approved", fileName: "coi.pdf", sharedAt: daysAgo(494) },
      ],
      invitationHistory: [
        { at: daysAgo(500), event: "Invitation sent", detail: "Owner-Operator" },
        { at: daysAgo(496), event: "Invitation accepted" },
      ],
      timeline: [
        { at: daysAgo(500), event: "Invited as Owner-Operator" },
        { at: daysAgo(496), event: "Accepted and created driver profile" },
        { at: daysAgo(60), event: "Relationship ended", detail: "Moved to another carrier." },
      ],
    },
  ];
}

let DRIVERS: CarrierDriver[] = seed();

/** Test hook. Never called by the UI. */
export function resetCarrierDriversMock() {
  DRIVERS = seed();
}

export async function mockListCarrierDrivers(): Promise<CarrierDriver[]> {
  await sleep(300);
  return DRIVERS.map((d) => ({ ...d }));
}

export async function mockGetCarrierDriver(id: string): Promise<CarrierDriver | null> {
  await sleep(300);
  const found = DRIVERS.find((d) => d.id === id);
  return found ? { ...found } : null;
}

/**
 * Ends the carrier's engagement with this driver.
 *
 * The driver's permanent profile and Antcolos account are untouched — this
 * changes one relationship and nothing else. Documents already shared stay in
 * the carrier's records as a historical snapshot; the carrier simply stops
 * receiving anything new.
 */
export async function mockEndCarrierRelationship(
  id: string,
  reason: string,
): Promise<CarrierDriver> {
  await sleep(LATENCY_MS);
  const index = DRIVERS.findIndex((d) => d.id === id);
  if (index < 0) throw new Error(`No such driver relationship: ${id}`);
  const ended: CarrierDriver = {
    ...DRIVERS[index],
    status: "ended",
    endedAt: iso(now()),
    endReason: reason.trim(),
    timeline: [
      ...DRIVERS[index].timeline,
      { at: iso(now()), event: "Relationship ended", detail: reason.trim() },
    ],
  };
  DRIVERS = DRIVERS.map((d) => (d.id === id ? ended : d));
  return { ...ended };
}

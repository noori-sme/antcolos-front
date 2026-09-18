import type {
  CarrierRelationship, DriverAccessReason, DriverAvailability, DriverDocument,
  DriverPreferences, DriverProfile, DriverView,
  EngagementType, PermissionKey, RelationshipStatus,
} from "@/types";
import { driverRequirements } from "@/lib/documents/requirements";
import { TRUCK_IDS, truckDispatchGrants, type TruckContext } from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The driver registry: the people, not one carrier's roster of them.
 *
 * Built on the same shape as the truck registry, because a driver raises the
 * same question a truck does. The person is permanent and has ONE profile that
 * follows them from carrier to carrier; what a carrier holds is a dated
 * engagement with that person, and ending it ends the carrier's access and
 * nothing else. The licence does not get re-entered, the medical card does not
 * get re-uploaded, and the person does not get a second account.
 *
 * Three narrowing rules live here, and every one of them is about a real person
 * rather than a record:
 *
 *  1. You see a driver THROUGH a carrier engagement you are entitled to see —
 *     because you are that carrier, or because that carrier granted your
 *     workspace dispatch access to the truck the driver is on. There is no
 *     driver lookup by id without one.
 *
 *  2. Documents travel only as far as the driver agreed when they joined that
 *     carrier. `sharedDocumentKeys` is the driver's decision, not the carrier's,
 *     and a dispatch agency working for the carrier sees what the carrier sees —
 *     never more.
 *
 *  3. The licence NUMBER never reaches a dispatch workspace. Dispatch needs to
 *     know the licence is current and which state issued it; the number itself
 *     is the person's, and no dispatching decision has ever needed it.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 200;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);
const hoursFromNow = (n: number) => iso(new Date(Date.now() + n * 3_600_000));

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/** The permanent person, plus everything that hangs off them. */
interface DriverRecord {
  profile: DriverProfile;
  availability: DriverAvailability;
  preferences: DriverPreferences;
  engagements: CarrierRelationship[];
  /** Keyed by carrier: the driver's paperwork as that carrier holds it. */
  documents: Record<string, DriverDocument[]>;
}

let registry: DriverRecord[] | null = null;
/** Profiles created at runtime keep counting up from the fixtures. */
let profileSeq = 0;

function db(): DriverRecord[] {
  if (!registry) registry = buildFixtures();
  return registry;
}

/**
 * Test hook. Never called by the UI.
 *
 * `omitUserIds` rebuilds the registry as if those people had never had a
 * profile. It exists because "a person with no profile yet" is a real state the
 * product has to handle — somebody who has just made an account — and, now that
 * a profile is one record in one place, dropping it here is the only honest way
 * to express it. There is no second store to leave empty instead.
 */
export function resetDriverRegistry(options?: { omitUserIds?: readonly string[] }) {
  profileSeq = 0;
  const omit = options?.omitUserIds;
  registry = omit && omit.length > 0
    ? buildFixtures().filter((r) => !omit.includes(r.profile.userId))
    : null;
}

/* -------------------------------------------------------------------------- */
/* THE canonical DriverProfile writer                                          */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE ONE PLACE A DriverProfile IS CREATED ★
 *
 * There used to be two. The carrier-facing registry held Sam Murtaza's licence,
 * and the driver-facing mock held it again, in a second literal, agreeing only
 * because two people had typed matching values. Nothing reconciled them, no
 * test asserted they agreed, and the moment either was edited the product would
 * have held two different opinions about one person's licence.
 *
 * So the profile lives here, once, and the driver's own module reads and writes
 * it through these two functions. Which is also what makes the product rule
 * enforceable rather than merely stated: ONE permanent profile per person.
 *
 * ███ WHO MAY CALL THIS ███
 * The person themselves, and nobody else. There is deliberately no carrier-side
 * caller and no lookup by licence number: a carrier that could search the
 * registry for a CDL could ask whether a stranger is on Antcolos, and a carrier
 * that could create a profile could create a second one for somebody who
 * already had it. Both are exactly what this boundary exists to prevent, and
 * both are prevented by there being no function that does it — not by a comment
 * asking callers not to.
 */
export function profileForUser(userId: string): DriverProfile | undefined {
  const record = db().find((d) => d.profile.userId === userId);
  // A COPY. The caller holds the person's licence details, not a handle on the
  // canonical record — editing what they were given must not edit the registry.
  return record ? { ...record.profile } : undefined;
}

export interface CreateOrResumeProfileInput {
  /** From the authenticated session. Never a literal, never a display name. */
  userId: string;
  legalName: string;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
  /** Required: `DriverProfile.email` is. Comes from the verified account. */
  email: string;
  phone?: string;
  username?: string;
}

export interface CreateOrResumeProfileResult {
  profile: DriverProfile;
  /** True when a profile already existed and was reused rather than made. */
  resumed: boolean;
}

/**
 * The person's own create-or-resume, keyed on who they are.
 *
 * RESUMES FIRST, ALWAYS. A person who already has a profile gets it back
 * unchanged — the same id, the same licence, the same creation date — however
 * many times they ask and whatever they pass in. A second attempt after a
 * half-finished sign-up, a double-submitted form and a retry all converge on
 * one record, and a resume never overwrites what is on file: somebody typing a
 * different licence number here is not how a licence gets corrected.
 *
 * The check and the write are one synchronous block with no `await` between
 * them, so two calls in one tab cannot both create. Two TABS could, and that is
 * the backend's unique index to enforce, not this module's to pretend about.
 */
export function createOrResumeProfile(
  input: CreateOrResumeProfileInput,
): CreateOrResumeProfileResult {
  const rows = db();
  const existing = rows.find((d) => d.profile.userId === input.userId);
  if (existing) return { profile: { ...existing.profile }, resumed: true };

  const created: DriverProfile = {
    id: `dp_${(profileSeq += 1).toString(36)}${Date.now().toString(36)}`,
    userId: input.userId,
    username: input.username
      ?? input.legalName.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""),
    legalName: input.legalName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim(),
    cdlNumber: input.cdlNumber.trim().toUpperCase(),
    cdlState: input.cdlState,
    cdlExpiresAt: input.cdlExpiresAt,
    createdAt: iso(now()),
  };

  // A person with a profile and no carrier is a real, common state — somebody
  // who signed up for themselves. They get the profile and nothing else: no
  // engagement, no documents, no employer. Being a driver is not being hired.
  rows.push({
    profile: created,
    availability: { status: "available" },
    preferences: {},
    engagements: [],
    documents: {},
  });
  return { profile: { ...created }, resumed: false };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function profile(
  id: string, legalName: string, cdlNumber: string, cdlState: string,
  opts: { phone?: string; email?: string; cdlDays?: number; medicalDays?: number } = {},
): DriverProfile {
  return {
    id,
    userId: `usr_${id.slice(3)}`,
    username: legalName.toLowerCase().replace(/[^a-z]+/g, "_"),
    legalName,
    email: opts.email ?? `${legalName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
    phone: opts.phone,
    cdlNumber,
    cdlState,
    cdlExpiresAt: daysFromNow(opts.cdlDays ?? 400),
    medicalCardExpiresAt: opts.medicalDays === undefined ? undefined : daysFromNow(opts.medicalDays),
    createdAt: daysAgo(600),
  };
}

function engagement(
  driverProfileId: string, carrierId: string, carrierName: string,
  engagementType: EngagementType, status: RelationshipStatus, startedDaysAgo: number,
  sharedDocumentKeys: string[], assignedTruckId?: string,
): CarrierRelationship {
  return {
    id: `deng_${driverProfileId}_${carrierId}`,
    driverProfileId, carrierId, carrierName, engagementType,
    roleName: "Driver",
    permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload"],
    invitedAt: daysAgo(startedDaysAgo + 2),
    acceptedAt: daysAgo(startedDaysAgo + 1),
    startedAt: daysAgo(startedDaysAgo),
    // Seeded relationships are ones the product watched begin. An imported one
    // would carry `carrier_asserted` here and would never be promoted to this.
    startedAtBasis: "observed",
    status,
    sharedDocumentKeys,
    assignedTruckId,
  };
}

/** A relationship that has already ended. It stays on the record, with its reason. */
function endedEngagement(
  driverProfileId: string, carrierId: string, carrierName: string,
  engagementType: EngagementType, startedDaysAgo: number, endedDaysAgo: number,
  endReason: string, sharedDocumentKeys: string[],
): CarrierRelationship {
  return {
    ...engagement(driverProfileId, carrierId, carrierName, engagementType, "ended",
      startedDaysAgo, sharedDocumentKeys),
    status: "ended",
    endedAt: daysAgo(endedDaysAgo),
    endReason,
  };
}

function docs(
  entries: Array<[key: string, status: DriverDocument["status"], opts?: { expiresDays?: number; reason?: string }]>,
): DriverDocument[] {
  return entries.map(([requirementKey, status, opts]) => ({
    requirementKey,
    status,
    fileName: status === "missing" ? undefined : `${requirementKey}.pdf`,
    fileType: "application/pdf",
    sizeBytes: status === "missing" ? undefined : 640_000,
    expiresAt: opts?.expiresDays === undefined ? undefined : daysFromNow(opts.expiresDays),
    rejectionReason: opts?.reason,
    submittedAt: status === "missing" ? undefined : daysAgo(90),
    updatedAt: daysAgo(20),
  }));
}

const FULL_SHARE = ["cdl_front", "cdl_back", "medical_front", "w9", "coi"];

function buildFixtures(): DriverRecord[] {
  return [
    {
      profile: profile("dp_dmitri", "Dmitri Kovalenko", "K2210094471", "IL",
        { phone: "+1 (312) 555-0181", cdlDays: 520, medicalDays: 160 }),
      availability: {
        status: "driving", hoursNote: "6h 20m of drive time left today.",
        homeTerminal: "Chicago, IL", currentCity: "Lafayette", currentState: "IN",
      },
      preferences: { preferredStates: ["IL", "IN", "OH"], maxDaysOut: 4, homeBy: "Home Friday night", endorsements: ["Doubles"] },
      engagements: [engagement("dp_dmitri", "org_northline", "Northline Freight", "company_driver", "active", 210, FULL_SHARE, TRUCK_IDS.nl104)],
      documents: {
        org_northline: docs([
          ["cdl_front", "approved", { expiresDays: 520 }],
          ["cdl_back", "approved"],
          ["medical_front", "approved", { expiresDays: 160 }],
        ]),
      },
    },
    {
      profile: profile("dp_marisol", "Marisol Ortiz", "O8840112238", "IL",
        { phone: "+1 (312) 555-0182", cdlDays: 300, medicalDays: 18 }),
      availability: {
        status: "driving", hoursNote: "On a 34-hour reset from tomorrow evening.",
        homeTerminal: "Chicago, IL", currentCity: "Indianapolis", currentState: "IN",
      },
      preferences: { preferredStates: ["IL", "IN", "MI"], avoidStates: ["NY"], maxDaysOut: 3, endorsements: ["Hazmat", "Tanker"] },
      engagements: [engagement("dp_marisol", "org_northline", "Northline Freight", "company_driver", "active", 7, FULL_SHARE, TRUCK_IDS.nl107)],
      documents: {
        org_northline: docs([
          ["cdl_front", "approved", { expiresDays: 300 }],
          ["cdl_back", "approved"],
          // Lapses in under three weeks. The driver cannot run once it does.
          ["medical_front", "expiring_soon", { expiresDays: 18 }],
        ]),
      },
    },
    {
      profile: profile("dp_amir", "Amir Haddad", "H1120448890", "IL",
        { phone: "+1 (312) 555-0184", cdlDays: 95, medicalDays: 240 }),
      availability: { status: "driving", homeTerminal: "Chicago, IL", currentCity: "Memphis", currentState: "TN" },
      preferences: { maxDaysOut: 7, endorsements: ["Hazmat"] },
      engagements: [engagement("dp_amir", "org_northline", "Northline Freight", "company_driver", "active", 290, FULL_SHARE, TRUCK_IDS.nl115)],
      documents: {
        org_northline: docs([
          ["cdl_front", "approved", { expiresDays: 95 }],
          ["cdl_back", "approved"],
          // Rejected and never replaced. This is why the driver shows a warning.
          ["medical_front", "rejected", { reason: "The certificate is cut off at the examiner's signature. Please upload the whole page." }],
        ]),
      },
    },
    {
      profile: profile("dp_marcus", "Marcus Hale", "H4471029983", "TX",
        { phone: "+1 (214) 555-0166", cdlDays: 610, medicalDays: 320 }),
      availability: {
        status: "available", hoursNote: "Full hours. Reset finished this morning.",
        homeTerminal: "Joliet, IL", currentCity: "Joliet", currentState: "IL",
      },
      preferences: { preferredStates: ["IL", "TX", "MO"], maxDaysOut: 10, notes: "Owns the truck. Happy with long runs." },
      // An owner-operator: more paperwork, because they carry their own.
      engagements: [engagement("dp_marcus", "org_northline", "Northline Freight", "owner_operator", "active", 200, FULL_SHARE, TRUCK_IDS.nl118)],
      documents: {
        org_northline: docs([
          ["cdl_front", "approved", { expiresDays: 610 }],
          ["cdl_back", "approved"],
          ["medical_front", "approved", { expiresDays: 320 }],
          ["w9", "approved"],
          ["coi", "expiring_soon", { expiresDays: 22 }],
        ]),
      },
    },
    {
      profile: profile("dp_sam", "Sam Murtaza", "K4471182993", "IL",
        { phone: "+1 (312) 555-0148", email: "sam@antcolos.com", cdlDays: 210, medicalDays: 24 }),
      availability: {
        status: "driving", hoursNote: "Delivering in Eugene this afternoon.",
        homeTerminal: "Portland, OR", currentCity: "Portland", currentState: "OR",
      },
      preferences: { preferredStates: ["OR", "WA", "ID"], maxDaysOut: 3, homeBy: "Home most nights" },
      /*
       * ★ ONE SET OF ENGAGEMENTS FOR THIS PERSON, HERE ★
       *
       * Stonebridge and Ridgeway used to be a SECOND literal, in
       * `features/driver/mock-driver.ts`, describing the same person's
       * relationships from the driver's side while this file described them
       * from the carrier's. The two already disagreed: both claimed Cascade,
       * and they did not agree about what Sam had shared with it.
       *
       * That is precisely the defect PR-1 removed for `DriverProfile`, one
       * level up. So the relationships live here now — with the module that
       * owns the type and owns the only command that ends one — and the
       * driver's own module reads them.
       */
      engagements: [
        engagement("dp_sam", "org_cascade", "Cascade Haul", "company_driver", "active", 108,
          // The driver shared their licence but NOT the medical card with this
          // carrier. The gap is the driver's decision and the page says so.
          ["cdl_front", "cdl_back"], TRUCK_IDS.cs47),
        // The owner-operator side of the same person. Engagement type is the
        // carrier's decision, and it is what proposal and trip policies resolve
        // from — which is why one person needs to hold both.
        engagement("dp_sam", "org_stonebridge", "Stonebridge Carriers", "owner_operator", "active", 84,
          ["cdl_front", "cdl_back", "medical_front", "w9", "coi", "vehicle_registration"]),
        endedEngagement("dp_sam", "org_ridgeway", "Ridgeway Carriers", "owner_operator", 425, 150,
          "Driver moved to a different carrier.",
          ["cdl_front", "cdl_back", "medical_front", "w9", "coi"]),
      ],
      documents: {
        org_cascade: docs([
          ["cdl_front", "approved", { expiresDays: 210 }],
          ["cdl_back", "approved"],
          ["medical_front", "expiring_soon", { expiresDays: 24 }],
        ]),
      },
    },
    {
      profile: profile("dp_owen", "Owen Fitz", "F2029918840", "OR",
        { phone: "+1 (503) 555-0134", cdlDays: 480, medicalDays: 200 }),
      availability: {
        status: "available", hoursNote: "Empties in Salem this afternoon.",
        homeTerminal: "Portland, OR", currentCity: "Salem", currentState: "OR",
      },
      preferences: { preferredStates: ["OR", "WA"], avoidStates: ["CA"], maxDaysOut: 2, homeBy: "Home Friday nights", notes: "Does not want to be out over a weekend." },
      engagements: [engagement("dp_owen", "org_cascade", "Cascade Haul", "company_driver", "active", 60, FULL_SHARE, TRUCK_IDS.cs58)],
      documents: {
        org_cascade: docs([
          ["cdl_front", "approved", { expiresDays: 480 }],
          ["cdl_back", "approved"],
          ["medical_front", "approved", { expiresDays: 200 }],
        ]),
      },
    },
    {
      // ★ INVITED, AND HOLDING NOTHING ★
      //
      // The case that proves a compliance REQUIREMENT is not a document: Ray
      // has been invited, has shared nothing, and every obligation about him
      // exists anyway. He lived only in the driver feature's screen roster
      // until Safety & Compliance started deriving from this registry; a
      // scenario the product depends on has to exist in the canonical record,
      // not beside it.
      profile: profile("dp_ray", "Ray Bell", "B3310027745", "IL",
        { phone: "+1 (312) 555-0190", email: "ray.bell@example.com", cdlDays: 450 }),
      availability: { status: "inactive", homeTerminal: "Chicago, IL" },
      preferences: {},
      engagements: [{
        ...engagement("dp_ray", "org_northline", "Northline Freight", "company_driver", "invited", 3, []),
        startedAt: undefined,
      }],
      documents: {},
    },
    {
      profile: profile("dp_kelsey", "Kelsey Nguyen", "N5590028841", "IL",
        { phone: "+1 (312) 555-0186", cdlDays: 380, medicalDays: 150 }),
      availability: { status: "inactive", homeTerminal: "Chicago, IL" },
      preferences: {},
      // Ended. The person keeps their profile; the carrier keeps nothing live.
      engagements: [{
        ...engagement("dp_kelsey", "org_northline", "Northline Freight", "company_driver", "ended", 180, FULL_SHARE, TRUCK_IDS.nl121),
        endedAt: daysAgo(60),
        endReason: "Left the carrier.",
      }],
      documents: { org_northline: docs([["cdl_front", "approved", { expiresDays: 380 }]]) },
    },
    {
      profile: profile("dp_luis", "Luis Carrera", "C9910228847", "VA",
        { phone: "+1 (804) 555-0192", cdlDays: 260, medicalDays: 90 }),
      availability: {
        status: "off_duty", availableAt: hoursFromNow(10),
        homeTerminal: "Richmond, VA", currentCity: "Richmond", currentState: "VA",
      },
      preferences: { preferredStates: ["VA", "NC", "MD"], maxDaysOut: 2 },
      engagements: [engagement("dp_luis", "org_crosswind", "Crosswind Freight", "company_driver", "active", 140, FULL_SHARE, TRUCK_IDS.crosswind)],
      documents: {
        org_crosswind: docs([
          ["cdl_front", "approved", { expiresDays: 260 }],
          ["cdl_back", "approved"],
          ["medical_front", "approved", { expiresDays: 90 }],
        ]),
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

const DRIVER_PERMS: PermissionKey[] = ["drivers:view"];

/**
 * The live engagement a viewer may see a driver through.
 *
 * Returns the engagement AND the reason, because the reason decides how much of
 * the person travels — a carrier sees its own driver's licence number, a
 * dispatch agency working for that carrier does not.
 */
function engagementFor(
  record: DriverRecord,
  ctx: TruckContext,
  carrierHint?: string,
): { engagement: CarrierRelationship; reason: DriverAccessReason } | undefined {
  const live = record.engagements.filter((e) => e.status === "active");

  // The viewer is the carrier.
  const own = live.find((e) => e.carrierId === ctx.organizationId);
  if (own) return { engagement: own, reason: "engaging_carrier" };

  // The viewer dispatches for the carrier. Narrowed by the carrier that granted
  // access on the truck in hand when the caller knows which truck that is.
  for (const e of live) {
    if (carrierHint && e.carrierId !== carrierHint) continue;
    const grants = truckDispatchGrants(e.assignedTruckId ?? "");
    const mine = grants.find((g) => g.dispatchOrganizationId === ctx.organizationId);
    if (mine && mine.grantedByCarrierOrganizationId === e.carrierId) {
      return { engagement: e, reason: "dispatch_access" };
    }
  }

  // The viewer is the driver.
  if (ctx.driverProfileId && ctx.driverProfileId === record.profile.id) {
    const any = live[0];
    if (any) return { engagement: any, reason: "self" };
  }
  return undefined;
}

function project(
  record: DriverRecord,
  engagement: CarrierRelationship,
  reason: DriverAccessReason,
): DriverView {
  const held = record.documents[engagement.carrierId] ?? [];
  // Rule 2: only what the driver agreed to share with THIS carrier.
  const shared = held.filter((d) => engagement.sharedDocumentKeys.includes(d.requirementKey));

  return {
    driverProfileId: record.profile.id,
    legalName: record.profile.legalName,
    phone: record.profile.phone,
    email: record.profile.email,
    // Rule 3: the number stops at the carrier that engaged them.
    cdlNumber: reason === "dispatch_access" ? undefined : record.profile.cdlNumber,
    cdlState: record.profile.cdlState,
    cdlExpiresAt: record.profile.cdlExpiresAt,
    // The expiry date is on the permanent profile, but it is READ OFF the
    // medical card — so a driver who did not share that card with this carrier
    // has not shared the date either. Letting it through anyway would make the
    // withholding decorative.
    medicalCardExpiresAt: engagement.sharedDocumentKeys.includes("medical_front")
      ? record.profile.medicalCardExpiresAt
      : undefined,
    medicalCardShared: engagement.sharedDocumentKeys.includes("medical_front"),
    availability: record.availability,
    preferences: record.preferences,
    carrierOrganizationId: engagement.carrierId,
    carrierName: engagement.carrierName,
    engagementType: engagement.engagementType,
    engagementStatus: engagement.status,
    engagedSince: engagement.startedAt,
    permissions: engagement.permissions,
    documents: shared,
    requirements: driverRequirements(engagement.engagementType),
    reason,
  };
}

/**
 * One driver, as this workspace may see them.
 *
 * `carrierHint` narrows the view to a particular carrier's engagement, which
 * matters for a person who drives for two carriers at once: a dispatch agency
 * working for one of them must be shown that engagement and never the other.
 */
export function driverViewSync(
  driverProfileId: string,
  ctx: TruckContext,
  carrierHint?: string,
): DriverView | undefined {
  if (!DRIVER_PERMS.every((p) => ctx.permissions.has(p))) return undefined;
  const record = db().find((d) => d.profile.id === driverProfileId);
  if (!record) return undefined;
  const found = engagementFor(record, ctx, carrierHint);
  // A driver the viewer may not see and a driver who does not exist are one
  // answer, for the same reason a truck is.
  if (!found) return undefined;
  return project(record, found.engagement, found.reason);
}

export async function driverView(
  driverProfileId: string,
  ctx: TruckContext,
  carrierHint?: string,
): Promise<DriverView | undefined> {
  await sleep(LATENCY_MS);
  return driverViewSync(driverProfileId, ctx, carrierHint);
}

/** The paperwork problems on a driver, as this viewer may see them. */
export function driverDocumentProblems(view: DriverView): Array<{
  requirementKey: string;
  label: string;
  status: DriverDocument["status"];
  expiresAt?: string;
  rejectionReason?: string;
}> {
  const out: ReturnType<typeof driverDocumentProblems> = [];
  const byKey = new Map(view.documents.map((d) => [d.requirementKey, d]));

  for (const requirement of view.requirements) {
    if (requirement.applicability !== "required") continue;
    const held = byKey.get(requirement.key);
    if (!held) {
      // Careful: a document the viewer is not entitled to see is NOT a document
      // that is missing. Only say it is absent when the driver shared the key
      // and there is still nothing behind it.
      continue;
    }
    if (held.status === "expired" || held.status === "expiring_soon" || held.status === "rejected"
      || held.status === "missing") {
      out.push({
        requirementKey: requirement.key,
        label: requirement.label,
        status: held.status,
        expiresAt: held.expiresAt,
        rejectionReason: held.rejectionReason,
      });
    }
  }
  return out;
}

/** Every driver this workspace may see, for a roster or a picker. */
/**
 * One carrier's copy of a driver's paperwork, with NO access check.
 *
 * The same shape of read as `truckDocumentRowsUnscoped`, and for the same
 * reason: callers that are already scoping by something else need the rows
 * without a context. Contract requirements use it — a requirement's status is a
 * fact about the record, so it must not come out differently for two people
 * looking at the same agreement. Anything serving a caller directly wants
 * `driverViewSync`, which takes a context and gates on it.
 */
export function driverDocumentRowsUnscoped(
  driverProfileId: string,
  organizationId: string,
): DriverDocument[] {
  const record = db().find((d) => d.profile.id === driverProfileId);
  return (record?.documents[organizationId] ?? []).map((d) => ({ ...d }));
}

/* -------------------------------------------------------------------------- */
/* Cross-module reads and the relationship command                             */
/* -------------------------------------------------------------------------- */

/**
 * One carrier's engagement with one driver, with NO access check.
 *
 * The same shape of read as `driverDocumentRowsUnscoped` and for the same
 * reason: a caller already scoping by something else needs the record without a
 * context. Workforce uses it to ANSWER whether an operational driver
 * relationship exists — never to decide who may see the driver, which stays
 * `driverViewSync`'s job.
 */
export function carrierRelationshipUnscoped(
  driverProfileId: string,
  carrierId: string,
): CarrierRelationship | undefined {
  const record = db().find((d) => d.profile.id === driverProfileId);
  const found = record?.engagements.find((e) => e.carrierId === carrierId);
  return found ? { ...found } : undefined;
}

/** The permanent person, with NO access check. Never returned to a screen. */
export function driverProfileUnscoped(driverProfileId: string): DriverProfile | undefined {
  const record = db().find((d) => d.profile.id === driverProfileId);
  return record ? { ...record.profile } : undefined;
}

/**
 * One carrier's driver relationships, as the modules downstream of the registry
 * need them. NO access check: the caller scopes by the organization it passes.
 *
 * ★ WHY THIS EXISTS ★
 * Safety & Compliance has to know which drivers a carrier owes records about,
 * and whether each relationship is still live — that is what decides when a
 * requirement freezes and a snapshot is taken. It used to read a SECOND driver
 * roster held in the driver feature, which meant a relationship ended here was
 * invisible there: a driver could leave and their compliance records would
 * never freeze, while a driver present here and absent there sat permanently at
 * "requirements not built".
 *
 * The fix is not to keep two rosters in step. It is for the one that is
 * canonical to be the one compliance derives from, which is this function.
 * Nothing is copied: every field below is read from the registry's own records
 * at the moment it is asked for.
 */
export interface CarrierDriverRelationshipRow {
  /** The relationship id. A driver may hold one per carrier. */
  id: string;
  driverProfileId: string;
  name: string;
  email: string;
  engagementType: EngagementType;
  status: RelationshipStatus;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
  medicalExpiresAt?: string;
  startedAt?: string;
  endedAt?: string;
  endReason?: string;
  /** Only the keys the driver agreed to share with THIS carrier. */
  sharedDocuments: Array<{
    key: string;
    status: DriverDocument["status"];
    fileName?: string;
    sharedAt: string;
    expiresAt?: string;
  }>;
}

export function carrierDriverRelationshipsUnscoped(
  organizationId: string,
): CarrierDriverRelationshipRow[] {
  const out: CarrierDriverRelationshipRow[] = [];
  for (const record of db()) {
    for (const engagement of record.engagements) {
      if (engagement.carrierId !== organizationId) continue;
      const held = record.documents[organizationId] ?? [];
      out.push({
        id: engagement.id,
        driverProfileId: record.profile.id,
        name: record.profile.legalName,
        email: record.profile.email,
        engagementType: engagement.engagementType,
        status: engagement.status,
        cdlNumber: record.profile.cdlNumber,
        cdlState: record.profile.cdlState,
        cdlExpiresAt: record.profile.cdlExpiresAt,
        medicalExpiresAt: record.profile.medicalCardExpiresAt,
        startedAt: engagement.startedAt,
        endedAt: engagement.endedAt,
        endReason: engagement.endReason,
        // Rule 2 of this registry, applied here too: only what the driver
        // agreed to share with this carrier travels.
        sharedDocuments: held
          .filter((d) => engagement.sharedDocumentKeys.includes(d.requirementKey))
          .map((d) => ({
            key: d.requirementKey,
            status: d.status,
            fileName: d.fileName,
            sharedAt: d.submittedAt ?? d.updatedAt ?? engagement.invitedAt,
            expiresAt: d.expiresAt,
          })),
      });
    }
  }
  return out;
}

/**
 * What `endCarrierRelationship` did. Four outcomes, and they are not the same.
 *
 * `already_ended` is a SUCCESS: the command is idempotent, so asking twice
 * leaves one ending and one history entry. A caller that treated it as a
 * failure would raise an offboarding item about work that is already done.
 */
export type EndRelationshipOutcome =
  | "ended"
  | "already_ended"
  | "unknown_driver"
  | "no_relationship";

/**
 * ★ THE DRIVER RELATIONSHIP MODULE'S OWN ENDING COMMAND ★
 *
 * The only way a `CarrierRelationship` ever ends, and it lives HERE, with the
 * records it changes. Workforce offboarding calls it; it does not reach into
 * this registry's state, which is the difference between a module performing
 * its own change and another module writing into its store.
 *
 * IDEMPOTENT. A retry, a double click or a re-run of a half-finished
 * offboarding produces one ending, one `endedAt`, one reason — the second call
 * answers `already_ended` and changes nothing. That matters more here than
 * almost anywhere: the caller is an offboarding that may legitimately be run
 * again after a different step failed.
 *
 * PRESERVES, NEVER DELETES. The relationship row stays, with its status, its
 * end date, its reason and everything it was. What it stops being is live.
 *
 * What it does NOT touch, ever: the `DriverProfile`, the person's account, the
 * documents they own, another carrier's relationship, load history, settlements,
 * qualification records or anything in the audit ledger. Ending a relationship
 * ends the relationship. Following A6's rule about published facts, it also
 * leaves every event and every meter reading published under that relationship
 * exactly as it was.
 */
export function endCarrierRelationship(
  driverProfileId: string,
  carrierId: string,
  reason: string,
  at: string = iso(now()),
): { outcome: EndRelationshipOutcome; relationship?: CarrierRelationship } {
  const record = db().find((d) => d.profile.id === driverProfileId);
  if (!record) return { outcome: "unknown_driver" };

  const engagement = record.engagements.find((e) => e.carrierId === carrierId);
  if (!engagement) return { outcome: "no_relationship" };
  if (engagement.status === "ended") {
    return { outcome: "already_ended", relationship: { ...engagement } };
  }

  engagement.status = "ended";
  engagement.endedAt = at;
  engagement.endReason = reason;
  // The truck ASSIGNMENT goes with the relationship, because it was the
  // relationship that put them on it. The truck, its registry record, its
  // meters and its history are the truck registry's and are untouched.
  engagement.assignedTruckId = undefined;
  return { outcome: "ended", relationship: { ...engagement } };
}

/* -------------------------------------------------------------------------- */
/* Starting a relationship                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateRelationshipInput {
  driverProfileId: string;
  carrierId: string;
  carrierName: string;
  engagementType: EngagementType;
  /** Snapshotted from the invitation, so later role edits do not rewrite it. */
  roleName: string;
  permissions: readonly PermissionKey[];
  /**
   * What the driver agreed to share, ALREADY narrowed to ordinary paperwork.
   *
   * This module does not do the narrowing and must not: the rule is a property
   * of the document type and lives with the document domain
   * (`ordinaryDocumentKeys`). Taking the answer rather than re-deriving it is
   * what stops a second, drifting copy of "what counts as restricted".
   */
  sharedDocumentKeys: readonly string[];
  /** When the carrier offered. Snapshotted from the invitation, never `now`. */
  invitedAt: string;
  /** When the person said yes. See the note on the type. */
  acceptedAt: string;
  /**
   * A start date the CARRIER asserted, for an existing worker being connected.
   *
   * Carried through untouched and marked as their claim, never invented and
   * never promoted. Absent for somebody genuinely new, whose relationship has
   * no start date until activation writes one — and acceptance never supplies
   * this, which is the whole point of it being a parameter rather than a
   * default: the import path states it, and every other caller does not.
   */
  assertedStartDate?: string;
}

export type CreateRelationshipOutcome =
  | "created"
  /** One already existed and is live. Nothing was written. */
  | "resumed"
  | "unknown_driver";

/**
 * ★ THE DRIVER RELATIONSHIP MODULE'S OWN STARTING COMMAND ★
 *
 * The counterpart of `endCarrierRelationship`, and the only way a
 * `CarrierRelationship` is ever created from an acceptance. It lives HERE, with
 * the records it changes, for the same reason the ending command does.
 *
 * ── THE DATE RULE THIS COMMAND EXISTS TO ENFORCE ───────────────────────────
 *
 * It sets `acceptedAt` and it does NOT set `startedAt`. Not to `now`, not to
 * `acceptedAt`, not at all.
 *
 * Somebody accepting an invitation has agreed to work for this carrier. They
 * have not begun: for a new driver the paperwork is not in, no truck is
 * assigned, and nobody yet knows the date they will actually start. Writing
 * today's date into `startedAt` because the field looked empty would turn a
 * guess into a fact, and every downstream reader — tenure, settlements,
 * qualification windows, "engaged since" on a dispatcher's screen — would treat
 * it as one. So the relationship opens in `onboarding` with an accepted date
 * and no start date, and `startedAt` is written by whatever actually starts it.
 *
 * An imported relationship is the other side of the same rule: a carrier
 * asserting a historical start date supplies `startedAt` WITH
 * `startedAtBasis: "carrier_asserted"`, and nothing here or afterwards
 * promotes that to `observed`.
 *
 * IDEMPOTENT on `(driverProfileId, carrierId)` where the relationship is live.
 * A retry, a double-submitted acceptance, or a link opened twice produces ONE
 * engagement — and `resumed` is a SUCCESS, carrying the one that is already
 * there. The check and the write are one synchronous block with no `await`
 * between them.
 */
export function createOrResumeRelationship(
  input: CreateRelationshipInput,
): { outcome: CreateRelationshipOutcome; relationship?: CarrierRelationship } {
  const record = db().find((d) => d.profile.id === input.driverProfileId);
  if (!record) return { outcome: "unknown_driver" };

  const live = record.engagements.find(
    (e) => e.carrierId === input.carrierId && e.status !== "ended",
  );
  if (live) return { outcome: "resumed", relationship: { ...live } };

  const relationship: CarrierRelationship = {
    id: `deng_${input.driverProfileId}_${input.carrierId}`,
    driverProfileId: input.driverProfileId,
    carrierId: input.carrierId,
    carrierName: input.carrierName,
    engagementType: input.engagementType,
    roleName: input.roleName,
    permissions: [...input.permissions],
    invitedAt: input.invitedAt,
    acceptedAt: input.acceptedAt,
    // Absent unless the carrier asserted one, and then marked as their claim.
    // Acceptance never supplies one — see the note above.
    startedAt: input.assertedStartDate,
    startedAtBasis: input.assertedStartDate ? "carrier_asserted" : undefined,
    status: "onboarding",
    sharedDocumentKeys: [...input.sharedDocumentKeys],
  };
  record.engagements.push(relationship);
  // The carrier's copy of this driver's paperwork starts EMPTY. Nothing is
  // copied across: what the carrier comes to hold is what the driver's own
  // documents are linked into, by the document store, on the driver's consent.
  record.documents[input.carrierId] ??= [];
  return { outcome: "created", relationship: { ...relationship } };
}

/**
 * Moves a relationship into `active` — the moment work actually begins.
 *
 * This is where `startedAt` is finally written, with `startedAtBasis:
 * "observed"`, because this IS the observation. Idempotent: activating an
 * already-active relationship changes nothing and keeps the original date.
 */
export function activateCarrierRelationship(
  driverProfileId: string,
  carrierId: string,
  at: string = iso(now()),
): { outcome: "activated" | "already_active" | "no_relationship"; relationship?: CarrierRelationship } {
  const record = db().find((d) => d.profile.id === driverProfileId);
  const engagement = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  if (!engagement) return { outcome: "no_relationship" };
  if (engagement.status === "active") {
    return { outcome: "already_active", relationship: { ...engagement } };
  }
  engagement.status = "active";

  /*
   * ★ ACTIVATION DOES NOT OVERWRITE A DATE SOMEBODY ALREADY ASSERTED ★
   *
   * This wrote `startedAt = today` and `startedAtBasis = "observed"`
   * unconditionally. For a driver who was IMPORTED — a carrier asserting they
   * have driven here since March — activating them in Antcolos would have
   * replaced March with this afternoon and relabelled the carrier's claim as
   * something Antcolos watched happen. That is the same collapse the whole date
   * decision exists to prevent, arriving one step later than acceptance.
   *
   * So the date is written only when there is none. When one is already there,
   * it and its basis are left exactly as they are: activation is a change of
   * STATE, and it is not evidence about when the relationship began.
   */
  if (engagement.startedAt === undefined) {
    engagement.startedAt = at;
    // Antcolos watched this one begin. That is what `observed` means.
    engagement.startedAtBasis = "observed";
  }
  return { outcome: "activated", relationship: { ...engagement } };
}

/**
 * Test hook: a relationship carrying a date the CARRIER asserted.
 *
 * Stands in for the import path PR-3 will build. Until that exists there is no
 * product way to produce a `carrier_asserted` start date, so the rule that
 * nothing promotes one has nothing to be tested against — and a test written
 * over a seeded `observed` relationship passes without exercising it at all.
 */
export function setAssertedStartForTests(
  driverProfileId: string,
  carrierId: string,
  assertedStartedAt: string,
): void {
  if (!CONSENT_SEAM_AVAILABLE) return;
  const record = db().find((d) => d.profile.id === driverProfileId);
  const engagement = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  if (!engagement) return;
  engagement.startedAt = assertedStartedAt;
  engagement.startedAtBasis = "carrier_asserted";
  engagement.status = "onboarding";
}

/**
 * Moves a live relationship to another status — suspended, back to onboarding.
 *
 * Deliberately cannot reach `ended`: ending is `endCarrierRelationship`'s, and
 * it does more than set a field. A caller that could end one here would skip
 * the end date, the reason and the truck being released.
 */
export function setCarrierRelationshipStatus(
  driverProfileId: string,
  carrierId: string,
  status: Exclude<RelationshipStatus, "ended">,
): CarrierRelationship | undefined {
  const record = db().find((d) => d.profile.id === driverProfileId);
  const engagement = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  if (!engagement) return undefined;
  engagement.status = status;
  return { ...engagement };
}

/**
 * Records more sharing consent on a live relationship.
 *
 * A SET UNION, so re-running it adds nothing: a driver may agree to share more
 * than they did the first time, and never un-shares by accident. It records the
 * consent only — the links the carrier actually reads through are the document
 * store's, and the caller writes those FIRST, so a relationship never promises
 * paperwork that was not handed over.
 *
 * Returns undefined when there is no live relationship, because consent with
 * nothing to consent to is not something this module will invent.
 */
/**
 * ███ TEST SEAM — NEVER SET BY THE PRODUCT ███
 *
 * Refuses the consent write, so a sharing grant can be made to fail at the one
 * point that matters most: AFTER every link has been committed and BEFORE the
 * agreement that makes them readable exists. Inert wherever a window exists,
 * for the same reasons and with the same honest limits as the other seams.
 */
const CONSENT_SEAM_AVAILABLE = typeof window === "undefined";
let consentFault = false;

export function failConsentWriteForTests(on: boolean): void {
  if (!CONSENT_SEAM_AVAILABLE) return;
  consentFault = on;
}

/**
 * Test hook: withdraw consent underneath a link that already exists.
 *
 * There is no product path that leaves a `driver_consent` link with no consent
 * behind it — that is the property the read check defends — so the only way to
 * prove the check works is to construct the state directly.
 */
export function setSharedDocumentKeysForTests(
  driverProfileId: string, carrierId: string, keys: readonly string[],
): void {
  if (!CONSENT_SEAM_AVAILABLE) return;
  const record = db().find((d) => d.profile.id === driverProfileId);
  const engagement = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  if (engagement) engagement.sharedDocumentKeys = [...keys];
}

export function addSharedDocumentKeys(
  driverProfileId: string,
  carrierId: string,
  requirementKeys: readonly string[],
): CarrierRelationship | undefined {
  if (consentFault) {
    throw new Error(
      "Injected consent failure (test only). In a real system this is where the "
      + "agreement record would have refused, with every link already written.",
    );
  }
  const record = db().find((d) => d.profile.id === driverProfileId);
  const engagement = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  if (!engagement) return undefined;
  engagement.sharedDocumentKeys = [
    ...new Set([...engagement.sharedDocumentKeys, ...requirementKeys]),
  ];
  return { ...engagement };
}

/**
 * Puts a relationship's consent list back to exactly what it was.
 *
 * ★ THE COMPENSATING HALF OF A CROSS-STORE GRANT ★
 * Consent lives here; the links live in the document store. That store can undo
 * its own writes and cannot reach into this registry — so a grant that fails
 * AFTER the consent write lands would leave this record claiming documents the
 * carrier cannot read. Not a leak: a record that is simply false, and one
 * nothing would correct, because the retry path treats consent as already given
 * and would never re-add it.
 *
 * Takes the exact prior list rather than subtracting the keys it added: the
 * driver may already have agreed to some of them, and removing those would
 * revoke consent this grant never gave.
 */
export function restoreSharedDocumentKeys(
  driverProfileId: string,
  carrierId: string,
  previous: readonly string[],
): void {
  const record = db().find((d) => d.profile.id === driverProfileId);
  const engagement = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  if (!engagement) return;
  engagement.sharedDocumentKeys = [...previous];
}

/** The one live relationship between this person and this carrier, if any. */
export function liveRelationship(
  driverProfileId: string, carrierId: string,
): CarrierRelationship | undefined {
  const record = db().find((d) => d.profile.id === driverProfileId);
  const found = record?.engagements.find(
    (e) => e.carrierId === carrierId && e.status !== "ended",
  );
  return found ? { ...found } : undefined;
}

/** Every engagement this person holds, live or ended. Their own view. */
export function relationshipsForProfile(driverProfileId: string): CarrierRelationship[] {
  const record = db().find((d) => d.profile.id === driverProfileId);
  return (record?.engagements ?? []).map((e) => ({ ...e }));
}

export function driversForWorkspaceSync(ctx: TruckContext): DriverView[] {
  if (!DRIVER_PERMS.every((p) => ctx.permissions.has(p))) return [];
  const out: DriverView[] = [];
  for (const record of db()) {
    // `engagementFor` already decides both whether this viewer may see the
    // person and through which carrier. Re-deriving that here would be a second
    // copy of the rule, and second copies are where leaks come from.
    const found = engagementFor(record, ctx);
    if (!found) continue;
    out.push(project(record, found.engagement, found.reason));
  }
  return out.sort((a, b) => a.legalName.localeCompare(b.legalName));
}

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

function db(): DriverRecord[] {
  if (!registry) registry = buildFixtures();
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetDriverRegistry() {
  registry = null;
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
    startedAt: daysAgo(startedDaysAgo),
    status,
    sharedDocumentKeys,
    assignedTruckId,
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
      engagements: [engagement("dp_sam", "org_cascade", "Cascade Haul", "company_driver", "active", 108,
        // The driver shared their licence but NOT the medical card with this
        // carrier. The gap is the driver's decision and the page says so.
        ["cdl_front", "cdl_back"], TRUCK_IDS.cs47)],
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

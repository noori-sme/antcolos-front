import type {
  Achievement, ProfileContribution, UserProfile, WorkplaceAssociation,
} from "@/types";
import { CONFERRED_DEFINITIONS } from "./achievements";
import type { ProfileRecords } from "./view";

/**
 * ███ MOCK DATA — NOT A BACKEND ███
 *
 * The seeded profile records, and the ONE module both sides of the network can
 * read.
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 * Everything else in the mock layer lives in a browser tab. A share card does
 * not: an Open Graph image is drawn on the server, for a crawler that has no
 * tab, no session and no store. So the seeded records live here, in a module
 * with no client dependencies, and the mock store seeds itself FROM this file
 * rather than owning a second copy.
 *
 * ★ THE LIMITATION, STATED PLAINLY ★
 * A profile edited in a tab is edited in that tab's store. The server-rendered
 * share card still draws the seeded snapshot, because nothing carries the edit
 * across. That is a property of having no backend, not a design: a real
 * implementation renders the card from the same row the page reads, and this
 * module is exactly the seam that read goes through. See
 * `docs/permanent-user-profile.md`.
 */

const SAM = "usr_sam";
const ALEX = "usr_newcomer";

/* -------------------------------------------------------------------------- */
/* Profiles                                                                    */
/* -------------------------------------------------------------------------- */

const PROFILES: UserProfile[] = [
  {
    userId: SAM,
    username: "sam_murtaza",
    fullName: "Sam Murtaza",
    headline: "Dispatcher and owner-operator · Reefer and dry van, Midwest to Southeast",
    bio:
      "I book my own freight and run two trucks. Ten years in produce lanes before Antcolos, "
      + "and I still answer the phone at 5am.",
    location: "Chicago, IL",
    links: [{ label: "Northline Freight", url: "https://northlinefreight.example.com" }],
    visibility: "public",
    sections: { metrics: true, workplaces: true, achievements: true },
    verifications: [
      { kind: "email", verifiedAt: "2025-11-04T16:31:00.000Z", source: "account" },
      { kind: "carrier-authority", verifiedAt: "2025-11-05T09:12:00.000Z", source: "fmcsa" },
      { kind: "cdl", verifiedAt: "2026-05-31T14:02:00.000Z", source: "safety" },
    ],
    joinedAt: "2025-11-04T16:20:00.000Z",
    completedAt: "2025-11-04T16:34:00.000Z",
    updatedAt: "2026-09-02T18:05:00.000Z",
  },
  {
    // The profile every account starts with: a record, a handle, and nothing
    // to show yet. Reached with `?fixture=newcomer`; see lib/session/scenarios.
    userId: ALEX,
    username: "alex_rivera",
    fullName: "Alex Rivera",
    links: [],
    visibility: "public",
    sections: { metrics: true, workplaces: true, achievements: true },
    verifications: [
      { kind: "email", verifiedAt: "2026-09-16T00:14:00.000Z", source: "account" },
    ],
    joinedAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:14:00.000Z",
  },
];

/* -------------------------------------------------------------------------- */
/* Workplace history                                                           */
/* -------------------------------------------------------------------------- */

const association = (
  id: string,
  organizationId: string,
  organizationNameSnapshot: string,
  organizationType: WorkplaceAssociation["organizationType"],
  capacity: WorkplaceAssociation["capacity"],
  positionTitle: string,
  startedAt: string,
  endedAt?: string,
): WorkplaceAssociation => ({
  id, userId: SAM, organizationId, organizationNameSnapshot, organizationType,
  capacity, positionTitle, startedAt, endedAt, verified: true,
});

const ASSOCIATIONS: WorkplaceAssociation[] = [
  // The one that ENDED, and the reason the history model exists: Sam has no
  // membership at SME any more, and this line is still theirs.
  association(
    "wa_sme", "org_sme", "SME Transport Group LLC", "DISPATCH_AGENCY",
    "dispatcher", "Dispatcher",
    "2025-12-01T00:00:00.000Z", "2026-02-15T00:00:00.000Z",
  ),
  association(
    "wa_northline", "org_northline", "Northline Freight LLC", "CARRIER",
    "carrier-owner", "Owner", "2025-11-04T16:20:00.000Z",
  ),
  association(
    "wa_meridian", "org_meridian", "Meridian Dispatch Group Inc.", "DISPATCH_AGENCY",
    "dispatcher", "Senior dispatcher", "2026-02-18T14:02:00.000Z",
  ),
  association(
    "wa_baxter", "org_baxter", "Baxter Transit LLC", "CARRIER",
    "carrier-owner", "Owner", "2026-03-09T13:30:00.000Z",
  ),
  association(
    "wa_cascade", "org_cascade", "Cascade Haul Co.", "CARRIER",
    "driver", "Company driver", "2026-05-30T19:45:00.000Z",
  ),
  association(
    "wa_stonebridge", "org_stonebridge", "Stonebridge Carriers LLC", "CARRIER",
    "driver", "Owner-operator", "2026-06-22T12:15:00.000Z",
  ),
  association(
    "wa_summit", "org_summit", "Summit Dispatch Partners LLC", "DISPATCH_AGENCY",
    "dispatch-owner", "Owner", "2026-08-11T15:10:00.000Z",
  ),
  association(
    "wa_solo", "org_solo", "Sam Murtaza — Dispatch", "DISPATCH_AGENCY",
    "dispatcher", "Individual dispatcher", "2026-09-02T17:40:00.000Z",
  ),
];

/* -------------------------------------------------------------------------- */
/* The contribution ledger                                                     */
/* -------------------------------------------------------------------------- */

const CHI_DAL = { origin: "Chicago, IL", destination: "Dallas, TX" };
const ATL_CLT = { origin: "Atlanta, GA", destination: "Charlotte, NC" };
const LRD_CHI = { origin: "Laredo, TX", destination: "Chicago, IL" };

let rowNumber = 0;
const contribution = (
  organizationId: string,
  organizationNameSnapshot: string,
  capacity: ProfileContribution["capacity"],
  kind: ProfileContribution["kind"],
  value: number,
  occurredAt: string,
  lane?: ProfileContribution["lane"],
): ProfileContribution => {
  rowNumber += 1;
  return {
    id: `pc_seed_${rowNumber}`,
    userId: SAM,
    organizationId,
    organizationNameSnapshot,
    capacity,
    kind,
    value,
    occurredAt,
    lane,
  };
};

/** One quarter's dispatch work on one lane: the loads, and what they booked. */
const dispatchQuarter = (
  organizationId: string,
  name: string,
  at: string,
  loads: number,
  cents: number,
  lane?: ProfileContribution["lane"],
): ProfileContribution[] => [
  contribution(organizationId, name, "dispatcher", "load_dispatched", loads, at, lane),
  contribution(organizationId, name, "dispatcher", "revenue_booked", cents, at, lane),
];

const CONTRIBUTIONS: ProfileContribution[] = [
  /* SME — the ended dispatch job. Its rows outlive the relationship. */
  ...dispatchQuarter("org_sme", "SME Transport Group LLC", "2025-12-18T00:00:00.000Z", 26, 5_980_000, LRD_CHI),
  ...dispatchQuarter("org_sme", "SME Transport Group LLC", "2026-02-10T00:00:00.000Z", 34, 7_820_000, CHI_DAL),

  /* Meridian — the long-running one. */
  ...dispatchQuarter("org_meridian", "Meridian Dispatch Group Inc.", "2026-03-30T00:00:00.000Z", 88, 21_120_000, CHI_DAL),
  ...dispatchQuarter("org_meridian", "Meridian Dispatch Group Inc.", "2026-06-29T00:00:00.000Z", 132, 32_340_000, CHI_DAL),
  ...dispatchQuarter("org_meridian", "Meridian Dispatch Group Inc.", "2026-09-15T00:00:00.000Z", 100, 25_140_000, ATL_CLT),

  /* Summit — the dispatch organization Sam owns. */
  ...dispatchQuarter("org_summit", "Summit Dispatch Partners LLC", "2026-09-10T00:00:00.000Z", 90, 22_140_000, ATL_CLT),

  /* The one-person workspace. */
  ...dispatchQuarter("org_solo", "Sam Murtaza — Dispatch", "2026-09-18T00:00:00.000Z", 24, 6_300_000, LRD_CHI),

  /* Cascade — company driving. */
  contribution("org_cascade", "Cascade Haul Co.", "driver", "load_delivered", 64, "2026-06-20T00:00:00.000Z", CHI_DAL),
  contribution("org_cascade", "Cascade Haul Co.", "driver", "delivery_on_time", 58, "2026-06-20T00:00:00.000Z"),
  contribution("org_cascade", "Cascade Haul Co.", "driver", "delivery_late", 6, "2026-06-20T00:00:00.000Z"),
  contribution("org_cascade", "Cascade Haul Co.", "driver", "miles_driven", 41_800, "2026-06-20T00:00:00.000Z"),
  contribution("org_cascade", "Cascade Haul Co.", "driver", "clean_inspection", 1, "2026-06-12T00:00:00.000Z"),
  // One event on the record, so the safety score is a real number rather than
  // a number that could only ever have been 100.
  contribution("org_cascade", "Cascade Haul Co.", "driver", "safety_event", 1, "2026-06-05T00:00:00.000Z"),

  /* Stonebridge — owner-operator. */
  contribution("org_stonebridge", "Stonebridge Carriers LLC", "driver", "load_delivered", 71, "2026-09-12T00:00:00.000Z", ATL_CLT),
  contribution("org_stonebridge", "Stonebridge Carriers LLC", "driver", "delivery_on_time", 70, "2026-09-12T00:00:00.000Z"),
  contribution("org_stonebridge", "Stonebridge Carriers LLC", "driver", "delivery_late", 1, "2026-09-12T00:00:00.000Z"),
  contribution("org_stonebridge", "Stonebridge Carriers LLC", "driver", "miles_driven", 63_400, "2026-09-12T00:00:00.000Z"),
  contribution("org_stonebridge", "Stonebridge Carriers LLC", "driver", "clean_inspection", 2, "2026-08-28T00:00:00.000Z"),
];

/* -------------------------------------------------------------------------- */
/* Conferred awards                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The comparative award, which the rule engine deliberately cannot derive.
 *
 * It arrives as a stored record because deciding it needs every other
 * dispatcher's quarter — see the note at the top of ./achievements.ts.
 */
const CONFERRED: Achievement[] = [
  {
    key: "dispatch.top.quarter",
    definition: CONFERRED_DEFINITIONS["dispatch.top.quarter"],
    earnedAt: "2026-07-05T00:00:00.000Z",
    period: "Q2 2026",
    organizationNameSnapshot: "Meridian Dispatch Group Inc.",
  },
];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** A deep copy, so a caller that mutates a record cannot edit the seed. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function publishedProfiles(): UserProfile[] {
  return clone(PROFILES);
}

export function publishedUsernames(): string[] {
  return PROFILES.map((p) => p.username);
}

/** Everything a view needs for one person, or null when there is no such handle. */
export function publishedRecords(username: string): ProfileRecords | null {
  const profile = PROFILES.find((p) => p.username === username);
  if (!profile) return null;
  return clone({
    profile,
    associations: ASSOCIATIONS.filter((a) => a.userId === profile.userId),
    contributions: CONTRIBUTIONS.filter((c) => c.userId === profile.userId),
    conferred: CONFERRED.filter(() => profile.userId === SAM),
  });
}

/** The same, by user id, for the seam that knows who is signed in. */
export function publishedRecordsForUser(userId: string): ProfileRecords | null {
  const profile = PROFILES.find((p) => p.userId === userId);
  return profile ? publishedRecords(profile.username) : null;
}

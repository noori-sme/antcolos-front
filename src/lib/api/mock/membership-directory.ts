import { effectivePermissions } from "@/lib/permissions/effective";
import { DEFAULT_SCOPE, OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_USER, appliedSeedTemplate,
} from "@/lib/session/fixtures";
import { notifyRosterChanged } from "@/lib/session/membership-store";
import type {
  IsoDateTime, Membership, PermissionKey, ResponsibilityFunction,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE membership directory. One roster, for the whole app.
 *
 * Before this file, Antcolos had three lists of the same people in three
 * modules — `MOCK_ORG_MEMBERS` for assignment menus, `TEAM_ROSTER` for the MT
 * Loop board, `SEEDED_RESPONSIBILITY` for who starts out holding a loop — and
 * they did not agree with one another. Meridian had Lane Okafor on one and Tara
 * Whitfield on another, so "who can I hand this to?" had two answers depending
 * on which screen asked.
 *
 * The responsibility engine cannot be built on that, and the integration rule
 * is explicit that it must not add a fourth. So those lists now DERIVE from
 * this one, and this one is built out of the same primitives the session
 * already uses:
 *
 *   • A colleague is a real `Membership` record, with template ids, grants and
 *     revocations, run through the real `effectivePermissions`. Nobody here has
 *     a hand-written permission set, so a colleague cannot be eligible for work
 *     the product would not actually let them do.
 *   • What the routing engine needs BEYOND permissions — availability, who
 *     supervises whom, which trucks and carriers somebody has been given —
 *     lives in a profile beside the membership, never inside it. None of it is
 *     a role name, and nothing in the engine reads a `title`.
 *
 * ███ FRONTEND ONLY ███
 * Availability here is fixture data. Real availability comes from a rota, an
 * HR system or the person themselves, and none of those exist in a frontend.
 */

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether this membership can pick work up right now.
 *
 * Kept apart from `MembershipStatus`, which is about the SEAT: a suspended
 * membership is not a member at all, while an on-leave one is a member who
 * cannot take work this week. Collapsing them would make "route around them for
 * now" indistinguishable from "they are gone".
 */
export type MembershipAvailability =
  | "available"
  /** Working, but not this shift. */
  | "off_shift"
  | "on_leave"
  /** Present and refusing new work — at capacity, or on something else. */
  | "unavailable";

export const AVAILABILITY_LABEL: Record<MembershipAvailability, string> = {
  available: "Available",
  off_shift: "Off shift",
  on_leave: "On leave",
  unavailable: "Not taking work",
};

export const AVAILABILITY_TAKES_WORK: Record<MembershipAvailability, boolean> = {
  available: true,
  off_shift: false,
  on_leave: false,
  unavailable: false,
};

/* -------------------------------------------------------------------------- */
/* The profile beside the membership                                           */
/* -------------------------------------------------------------------------- */

/**
 * Everything the routing engine needs that a `Membership` does not carry.
 *
 * Read the fields and notice there is no job title among them. `functions` is
 * the closest thing, and it is deliberately a list of WORK rather than a name:
 * a person can be declared for dispatch and maintenance at once, and the engine
 * treats that as two weak signals rather than one identity.
 */
export interface MembershipProfile {
  membershipId: string;
  availability: MembershipAvailability;
  /** Absent when nobody supervises them — an Owner, or a flat workspace. */
  supervisorMembershipId?: string;
  /** Work this membership has been declared for. A hint, never a gate. */
  functions: ResponsibilityFunction[];
  /** Trucks this membership has specifically been given. */
  truckIds: string[];
  /** Carriers delegated to this membership inside a dispatch workspace. */
  carrierOrganizationIds: string[];
  /** The shift they work, where a workspace runs shifts. Display and scope. */
  shiftLabel?: string;
  /** A named part of the business, where a workspace has them. */
  departmentLabel?: string;
  /** When the seat or the delegation behind it runs out, where one does. */
  endsAt?: IsoDateTime;
}

/** A membership, its permissions and its profile, resolved together. */
export interface DirectoryMember {
  membershipId: string;
  organizationId: string;
  userId: string;
  displayName: string;
  title?: string;
  status: Membership["status"];
  isOwner: boolean;
  permissions: ReadonlySet<PermissionKey>;
  scope: Membership["scope"];
  driverProfileId?: string;
  availability: MembershipAvailability;
  supervisorMembershipId?: string;
  functions: ResponsibilityFunction[];
  truckIds: string[];
  carrierOrganizationIds: string[];
  shiftLabel?: string;
  departmentLabel?: string;
  endsAt?: IsoDateTime;
  /** True when the seat is active AND they can take work right now. */
  takesWork: boolean;
}

/* -------------------------------------------------------------------------- */
/* Colleagues                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The people the signed-in user works with.
 *
 * Real `Membership` records, so their permissions are computed rather than
 * asserted. Every one of them exists to make a scenario in the milestone
 * testable against something other than the Owner:
 *
 *   Paige Ellery      a Northline dispatcher — so a carrier can delegate
 *                     without being a dispatch agency.
 *   Ivy Delgado       a second Northline dispatcher, on nights, so shift scope
 *                     is a real thing rather than a field nobody sets.
 *   Ben Osei          Northline maintenance — the maintenance routing case.
 *   Tess Ferraro      Northline safety and compliance — the desk whose absence
 *                     was sending forty compliance items to the Owner.
 *   Renata Cruz       Northline bookkeeping — paperwork, and an example of
 *                     somebody who is eligible for nothing operational.
 *   Wes Abara         Northline company driver — driver-action routing.
 *   Nadia Rahimi      Meridian's OWNER. Sam is only a dispatcher there, so
 *                     without her the dispatch workspace has no fallback.
 *   Lane Okafor       Meridian dispatcher holding one named carrier.
 *   Inés Vidal        Meridian dispatcher holding a different carrier, which is
 *                     what cross-carrier isolation inside one workspace needs.
 *   Tara Whitfield    Meridian operations lead — the supervisor the escalation
 *                     ladder points at.
 *   Jonas Petit       Meridian, SUSPENDED. The assignee-removal case.
 *   Rosa Delgado      Summit dispatcher, ON LEAVE. The unavailable case.
 *   Devon Pike        Summit dispatcher, available.
 *   Marisol Vega      Owner of Cascade, and Hattie Brandt of Stonebridge — the
 *                     two carriers Sam drives for. Without them each of those
 *                     workspaces has nobody in it but a driver, and a driver
 *                     cannot be the fallback for work they may not do.
 */
const COLLEAGUES: readonly Membership[] = [
  /* -- Northline: a carrier that dispatches itself --------------------- */
  {
    id: "mem_northline_paige",
    userId: "usr_paige",
    organizationId: "org_northline",
    status: "active",
    title: "Dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_northline", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-01-12T15:00:00.000Z",
  },
  {
    id: "mem_northline_disp1",
    userId: "usr_ivy",
    organizationId: "org_northline",
    status: "active",
    title: "Dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_northline", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-03-02T15:00:00.000Z",
  },
  {
    id: "mem_northline_disp2",
    userId: "usr_ben",
    organizationId: "org_northline",
    status: "active",
    title: "Shop lead",
    // Maintenance work, and enough of the fleet to know which truck it is on.
    // Deliberately NOT a dispatcher: he cannot be routed dispatch work, and the
    // engine has to reach that conclusion from his permissions rather than from
    // the word "shop".
    appliedTemplates: [appliedSeedTemplate("org_northline", "maintenance")],
    grants: ["trucks:view", "trailers:view"],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2025-12-08T15:00:00.000Z",
  },
  {
    // ★ The reason the Owner's queue was full of compliance ★
    //
    // Northline runs seven trucks and had nobody at all holding
    // `compliance:manage`, `insurance:manage` or `claims:manage`, so forty
    // items correctly fell to the Owner as fallback. That is the engine working
    // — and it is also a carrier that has not hired a safety person. A
    // seven-truck fleet has one, so now the fixture does too, and the Owner's
    // personal queue shows what it should: the handful of decisions only an
    // owner can make.
    id: "mem_northline_safety",
    userId: "usr_tess",
    organizationId: "org_northline",
    status: "active",
    title: "Safety & compliance",
    appliedTemplates: [
      appliedSeedTemplate("org_northline", "safety"),
      appliedSeedTemplate("org_northline", "compliance"),
      appliedSeedTemplate("org_northline", "risk and insurance"),
    ],
    grants: ["trucks:view", "trailers:view", "drivers:view"],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-01-26T15:00:00.000Z",
  },
  {
    id: "mem_northline_books",
    userId: "usr_renata",
    organizationId: "org_northline",
    status: "active",
    title: "Bookkeeper",
    appliedTemplates: [appliedSeedTemplate("org_northline", "accountant")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-02-01T15:00:00.000Z",
  },
  {
    id: "mem_northline_driver_wes",
    userId: "usr_wes",
    organizationId: "org_northline",
    status: "active",
    title: "Company driver",
    appliedTemplates: [appliedSeedTemplate("org_northline", "driver")],
    grants: [],
    revocations: [],
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "drv_nl_0311",
    isOwner: false,
    joinedAt: "2026-04-19T15:00:00.000Z",
  },

  /* -- Meridian: a dispatch organization with several carriers ---------- */
  {
    // Meridian's Owner. Sam is a DISPATCHER here, not the owner — which is the
    // whole reason this membership has to exist: "the Dispatch Organization
    // Owner is the default fallback for its workspace" is not a rule a
    // workspace with no owner in it can keep.
    id: "mem_meridian_owner",
    userId: "usr_nadia",
    organizationId: "org_meridian",
    status: "active",
    title: "Owner",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2026-02-18T14:02:00.000Z",
  },
  {
    id: "mem_meridian_lane",
    userId: "usr_lane",
    organizationId: "org_meridian",
    status: "active",
    title: "Dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_meridian", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-02-20T15:00:00.000Z",
  },
  {
    id: "mem_meridian_ines",
    userId: "usr_ines",
    organizationId: "org_meridian",
    status: "active",
    title: "Dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_meridian", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-04-06T15:00:00.000Z",
  },
  {
    id: "mem_meridian_ops",
    userId: "usr_tara",
    organizationId: "org_meridian",
    status: "active",
    title: "Operations lead",
    appliedTemplates: [appliedSeedTemplate("org_meridian", "dispatcher")],
    // What makes her a supervisor is the profile below, not this list. These
    // are the powers the job needs; being escalated to is not a permission.
    grants: ["members:view", "documents:approve"],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-02-18T15:00:00.000Z",
  },
  {
    id: "mem_meridian_night",
    userId: "usr_jonas",
    organizationId: "org_meridian",
    // Suspended, on purpose. `effectivePermissions` returns an empty set for a
    // membership that is not active, so this person is refused by the engine
    // for the right reason rather than by a special case.
    status: "suspended",
    title: "Night dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_meridian", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-03-30T15:00:00.000Z",
  },

  /* -- The carriers Sam drives for -------------------------------------- */
  {
    // Cascade and Stonebridge employ Sam as a driver, so without these two the
    // only membership in each workspace is a driver — and a driver cannot be
    // the fallback for dispatch work they are not allowed to do. A carrier
    // always has an owner; these make the fixtures say so.
    id: "mem_cascade_owner",
    userId: "usr_marisol",
    organizationId: "org_cascade",
    status: "active",
    title: "Owner",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2026-05-30T19:45:00.000Z",
  },
  {
    id: "mem_stonebridge_owner",
    userId: "usr_hattie",
    organizationId: "org_stonebridge",
    status: "active",
    title: "Owner",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2026-06-22T12:15:00.000Z",
  },

  /* -- Summit: the second dispatch organization ------------------------- */
  {
    id: "mem_summit_rosa",
    userId: "usr_rosa",
    organizationId: "org_summit",
    status: "active",
    title: "Dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_summit", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-08-14T15:00:00.000Z",
  },
  {
    id: "mem_summit_dev",
    userId: "usr_devon",
    organizationId: "org_summit",
    status: "active",
    title: "Dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_summit", "dispatcher")],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-08-20T15:00:00.000Z",
  },
];

/** Display names, kept beside the memberships rather than inside them. */
const USER_NAMES: Record<string, string> = {
  [MOCK_USER.id]: MOCK_USER.displayName,
  usr_paige: "Paige Ellery",
  usr_ivy: "Ivy Delgado",
  usr_ben: "Ben Osei",
  usr_tess: "Tess Ferraro",
  usr_renata: "Renata Cruz",
  usr_wes: "Wes Abara",
  usr_nadia: "Nadia Rahimi",
  usr_lane: "Lane Okafor",
  usr_ines: "Inés Vidal",
  usr_tara: "Tara Whitfield",
  usr_jonas: "Jonas Petit",
  usr_marisol: "Marisol Vega",
  usr_hattie: "Hattie Brandt",
  usr_rosa: "Rosa Delgado",
  usr_devon: "Devon Pike",
};

/* -------------------------------------------------------------------------- */
/* Profiles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Availability, supervision and what each person has been given.
 *
 * A membership with no entry here is available, supervised by nobody, declared
 * for nothing and given nothing — which is the correct default for a brand new
 * member and, more importantly, for an Owner of a workspace of one.
 */
const PROFILES: readonly MembershipProfile[] = [
  /* -- Northline -------------------------------------------------------- */
  {
    // The Owner is declared for what they actually do — this carrier dispatches
    // its own trucks — and NOT for the desks they have hired people for. It
    // barely matters to the outcome, because the routing engine takes the Owner
    // out of the running whenever anybody else can do the work, but a fixture
    // that claimed the Owner personally handles billing would be telling a
    // story the product does not.
    membershipId: "mem_northline_owner",
    availability: "available",
    functions: ["dispatch", "administration"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    departmentLabel: "Office",
  },
  {
    membershipId: "mem_northline_paige",
    availability: "available",
    supervisorMembershipId: "mem_northline_owner",
    functions: ["dispatch"],
    // Not narrowed: Paige is the day desk and covers the carrier's dispatch.
    //
    // Scoped delegation is demonstrated at RUNTIME instead, through
    // `setMembershipDelegationScope` — which is the better test anyway, because
    // it proves the TRANSITION (grant a scope, watch the other trucks leave
    // them; revoke it, watch them come back) rather than a static fixture.
    // Baking a narrow scope in here also quietly uncovered five trucks, since
    // the only other dispatcher works nights.
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    shiftLabel: "Days",
    departmentLabel: "Dispatch",
  },
  {
    membershipId: "mem_northline_disp1",
    availability: "off_shift",
    supervisorMembershipId: "mem_northline_owner",
    functions: ["dispatch"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    shiftLabel: "Nights",
    departmentLabel: "Dispatch",
  },
  {
    membershipId: "mem_northline_disp2",
    availability: "available",
    supervisorMembershipId: "mem_northline_owner",
    functions: ["maintenance"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    departmentLabel: "Shop",
  },
  {
    membershipId: "mem_northline_safety",
    availability: "available",
    supervisorMembershipId: "mem_northline_owner",
    functions: ["safety", "compliance"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    departmentLabel: "Safety",
  },
  {
    membershipId: "mem_northline_books",
    availability: "available",
    supervisorMembershipId: "mem_northline_owner",
    functions: ["finance", "documents"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    departmentLabel: "Office",
  },
  {
    membershipId: "mem_northline_driver_wes",
    availability: "available",
    supervisorMembershipId: "mem_northline_paige",
    functions: ["driver_action"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
  },

  /* -- Meridian --------------------------------------------------------- */
  {
    membershipId: "mem_meridian_owner",
    availability: "available",
    functions: ["administration"],
    truckIds: [],
    carrierOrganizationIds: [],
  },
  {
    membershipId: "mem_meridian_dispatcher",
    availability: "available",
    supervisorMembershipId: "mem_meridian_ops",
    functions: ["dispatch"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    shiftLabel: "Days",
    departmentLabel: "Desk 1",
  },
  {
    membershipId: "mem_meridian_lane",
    availability: "available",
    supervisorMembershipId: "mem_meridian_ops",
    functions: ["dispatch"],
    truckIds: [],
    // Lane holds Baxter. Inés holds Cascade. Neither is routed the other's
    // work, inside one dispatch workspace — the isolation the milestone asks
    // for, expressed as data rather than as a filter somebody has to remember.
    carrierOrganizationIds: ["org_baxter"],
    shiftLabel: "Days",
    departmentLabel: "Desk 2",
  },
  {
    membershipId: "mem_meridian_ines",
    availability: "available",
    supervisorMembershipId: "mem_meridian_ops",
    functions: ["dispatch"],
    truckIds: [],
    carrierOrganizationIds: ["org_cascade"],
    shiftLabel: "Days",
    departmentLabel: "Desk 3",
  },
  {
    membershipId: "mem_meridian_ops",
    availability: "available",
    supervisorMembershipId: "mem_meridian_owner",
    functions: ["dispatch", "administration"],
    truckIds: [],
    carrierOrganizationIds: [],
    departmentLabel: "Operations",
  },
  {
    membershipId: "mem_meridian_night",
    availability: "unavailable",
    supervisorMembershipId: "mem_meridian_ops",
    functions: ["dispatch"],
    truckIds: [],
    carrierOrganizationIds: ["org_northline"],
    shiftLabel: "Nights",
  },

  /* -- Summit ----------------------------------------------------------- */
  {
    membershipId: "mem_summit_owner",
    availability: "available",
    functions: ["dispatch", "administration"],
    truckIds: [],
    carrierOrganizationIds: [],
  },
  {
    membershipId: "mem_summit_rosa",
    availability: "on_leave",
    supervisorMembershipId: "mem_summit_owner",
    functions: ["dispatch"],
    truckIds: [],
    carrierOrganizationIds: [],
  },
  {
    membershipId: "mem_summit_dev",
    availability: "available",
    supervisorMembershipId: "mem_summit_owner",
    functions: ["dispatch"],
    truckIds: [],
    carrierOrganizationIds: [],
  },

  /* -- The workspaces of one ------------------------------------------- */
  {
    membershipId: "mem_solo_dispatcher",
    availability: "available",
    functions: ["dispatch", "administration"],
    truckIds: [],
    carrierOrganizationIds: [],
  },
  {
    membershipId: "mem_baxter_owner",
    availability: "available",
    functions: ["dispatch", "administration", "maintenance", "finance"],
    truckIds: [],
    carrierOrganizationIds: ["org_baxter"],
  },
  {
    membershipId: "mem_cascade_owner",
    availability: "available",
    functions: ["dispatch", "administration", "finance", "maintenance"],
    truckIds: [],
    carrierOrganizationIds: ["org_cascade"],
  },
  {
    membershipId: "mem_cascade_driver",
    availability: "available",
    supervisorMembershipId: "mem_cascade_owner",
    functions: ["driver_action"],
    truckIds: [],
    carrierOrganizationIds: ["org_cascade"],
  },
  {
    membershipId: "mem_stonebridge_owner",
    availability: "available",
    functions: ["dispatch", "administration", "finance", "maintenance"],
    truckIds: [],
    carrierOrganizationIds: ["org_stonebridge"],
  },
  {
    membershipId: "mem_stonebridge_driver",
    availability: "available",
    supervisorMembershipId: "mem_stonebridge_owner",
    functions: ["driver_action"],
    truckIds: [],
    carrierOrganizationIds: ["org_stonebridge"],
  },
];

const PROFILE_BY_ID = new Map(PROFILES.map((p) => [p.membershipId, p]));

const DEFAULT_PROFILE: Omit<MembershipProfile, "membershipId"> = {
  availability: "available",
  functions: [],
  truckIds: [],
  carrierOrganizationIds: [],
};

/* -------------------------------------------------------------------------- */
/* Overrides                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runtime changes to the directory — a person marked away, a seat suspended.
 *
 * Held apart from the fixtures so a reset puts the world back exactly. The UI
 * writes here through the responsibility service; nothing else does.
 */
interface DirectoryOverrides {
  availability: Map<string, MembershipAvailability>;
  status: Map<string, Membership["status"]>;
  /** Runtime delegation scope: which trucks and carriers somebody was given. */
  scope: Map<string, { truckIds?: string[]; carrierOrganizationIds?: string[] }>;
  /**
   * Runtime access: the applied templates, grants and revocations a seat has
   * been given since the fixtures were written.
   *
   * Held here for the same reason as the others — so a reset puts the world
   * back exactly — and holding nothing else. It carries no permission of its
   * own: the values are what the Access service already clamped and decided to
   * write, and `effectivePermissions` still turns them into permissions.
   */
  access: Map<string, MembershipAccessOverride>;
}

/** Exactly the three fields a template application may change. */
export interface MembershipAccessOverride {
  appliedTemplates?: Membership["appliedTemplates"];
  grants?: Membership["grants"];
  revocations?: Membership["revocations"];
}

let overrides: DirectoryOverrides | null = null;

function ov(): DirectoryOverrides {
  if (!overrides) {
    overrides = {
      availability: new Map(), status: new Map(), scope: new Map(), access: new Map(),
    };
  }
  return overrides;
}

/** Test hook and demo control. Never called during a normal render. */
export function resetMembershipDirectory() {
  overrides = null;
  notifyRosterChanged();
}

/**
 * Mark somebody away, or back.
 *
 * Exposed so the "assignee unavailable" trigger can be demonstrated without
 * editing a fixture file — and so the fallback it causes can be watched
 * happening rather than described.
 */
export function setMembershipAvailability(
  membershipId: string,
  availability: MembershipAvailability,
) {
  ov().availability.set(membershipId, availability);
  notifyRosterChanged();
}

/**
 * End or suspend a seat.
 *
 * The milestone's "assignee removed" case. Nothing is deleted: the membership
 * stays in the directory with its new status, every timeline entry that names
 * it stays readable, and the routing engine stops considering it.
 */
export function setMembershipStatus(
  membershipId: string,
  status: Membership["status"],
) {
  ov().status.set(membershipId, status);
  notifyRosterChanged();
}

/**
 * Give a membership a delegation scope, or take it away.
 *
 * An EMPTY list means "not narrowed", never "narrowed to nothing" — the same
 * rule the eligibility gate applies — so `{ truckIds: [] }` hands somebody the
 * whole carrier back and `undefined` clears the override entirely.
 *
 * This is how a scoped delegation is granted and revoked at runtime, which is
 * what makes the transition testable: grant a dispatcher two trucks and the
 * other five leave them; revoke it and they come back, with the work itself
 * never duplicated or destroyed.
 */
/**
 * Record a change to what a seat carries.
 *
 * ★ A PRIMITIVE, NOT A COMMAND ★
 * It writes what it is given and checks nothing. WHO may change a seat, whether
 * the selection is inside their own access, and whether the organization
 * boundary was crossed are all the Access service's — see
 * `./access-templates.ts`, which answers every one of them before calling here.
 */
export function updateMemberAccess(
  membershipId: string,
  patch: MembershipAccessOverride,
): Membership | undefined {
  const base = ALL_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!base) return undefined;
  const current = ov().access.get(membershipId) ?? {};
  ov().access.set(membershipId, { ...current, ...patch });
  // The roster's answer just changed. Screens read it through one subscription.
  notifyRosterChanged();
  return membershipRecordFor(membershipId);
}

export function setMembershipDelegationScope(
  membershipId: string,
  scope: { truckIds?: string[]; carrierOrganizationIds?: string[] } | undefined,
) {
  if (scope === undefined) ov().scope.delete(membershipId);
  else ov().scope.set(membershipId, scope);
  notifyRosterChanged();
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/** Every membership the app knows about: the session's, plus the colleagues. */
const ALL_MEMBERSHIPS: readonly Membership[] = [...MOCK_MEMBERSHIPS, ...COLLEAGUES];

function organizationOf(organizationId: string) {
  return MOCK_ORGANIZATIONS.find((o) => o.id === organizationId);
}

/** The fixture record plus whatever has been written over it at runtime. */
function current(membership: Membership): Membership {
  const status = ov().status.get(membership.id) ?? membership.status;
  const access = ov().access.get(membership.id);
  if (status === membership.status && !access) return membership;
  return {
    ...membership,
    status,
    appliedTemplates: access?.appliedTemplates ?? membership.appliedTemplates,
    grants: access?.grants ?? membership.grants,
    revocations: access?.revocations ?? membership.revocations,
  };
}

/** Every seat in one organization, as a plain record, overrides applied. */
export function membershipsIn(organizationId: string): Membership[] {
  return ALL_MEMBERSHIPS
    .filter((m) => m.organizationId === organizationId)
    .map(current);
}

function resolve(membership: Membership): DirectoryMember | undefined {
  const organization = organizationOf(membership.organizationId);
  if (!organization) return undefined;

  const live = current(membership);
  const status = live.status;
  const profile = PROFILE_BY_ID.get(membership.id)
    ?? { membershipId: membership.id, ...DEFAULT_PROFILE };
  const availability = ov().availability.get(membership.id) ?? profile.availability;
  const scopeOverride = ov().scope.get(membership.id);

  // The real function, on the real record. A suspended or ended membership
  // resolves to the empty set, which is what makes removal work without a
  // single special case downstream.
  const permissions = effectivePermissions(live, organization);

  return {
    membershipId: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    displayName: USER_NAMES[membership.userId] ?? "A member",
    title: membership.title,
    status,
    isOwner: membership.isOwner,
    permissions,
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    availability,
    supervisorMembershipId: profile.supervisorMembershipId,
    functions: profile.functions,
    truckIds: scopeOverride?.truckIds ?? profile.truckIds,
    carrierOrganizationIds:
      scopeOverride?.carrierOrganizationIds ?? profile.carrierOrganizationIds,
    shiftLabel: profile.shiftLabel,
    departmentLabel: profile.departmentLabel,
    endsAt: profile.endsAt,
    takesWork: status === "active" && AVAILABILITY_TAKES_WORK[availability],
  };
}

/**
 * Everybody in one workspace, whatever their state.
 *
 * Includes suspended and away memberships deliberately: a queue that shows work
 * held by somebody who has left has to be able to say WHO, and an engine that
 * routes around them has to be able to see them to route around them.
 */
export function membersOf(organizationId: string): DirectoryMember[] {
  return ALL_MEMBERSHIPS
    .filter((m) => m.organizationId === organizationId)
    .map(resolve)
    .filter((m): m is DirectoryMember => Boolean(m))
    // Owner first, then by name, so every list in the app reads the same way.
    .sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

/** One membership, from any workspace. Undefined when it does not exist. */
export function memberById(membershipId: string): DirectoryMember | undefined {
  const membership = ALL_MEMBERSHIPS.find((m) => m.id === membershipId);
  return membership ? resolve(membership) : undefined;
}

/**
 * One membership, but only when it belongs to the workspace asking.
 *
 * The cross-organization guard for every lookup that starts from an id a screen
 * supplied. A membership in another workspace and a membership that does not
 * exist are the same answer, for the same reason a forbidden truck and an
 * unknown one are.
 */
export function memberIn(
  organizationId: string,
  membershipId: string,
): DirectoryMember | undefined {
  const member = memberById(membershipId);
  return member?.organizationId === organizationId ? member : undefined;
}

/**
 * The Owner of a workspace: the fallback of last resort, and the one membership
 * that is never allowed to be missing.
 *
 * Prefers an active Owner. Falls back to any Owner — including a suspended one —
 * because "the Owner is suspended" must still produce an accountable name on
 * the record rather than an ownerless piece of work, which is the one outcome
 * this module forbids.
 */
export function ownerOf(organizationId: string): DirectoryMember | undefined {
  const members = membersOf(organizationId);
  return members.find((m) => m.isOwner && m.status === "active")
    ?? members.find((m) => m.isOwner);
}

/** Active memberships that could hold work. Drivers are counted separately. */
export function workforceOf(organizationId: string): DirectoryMember[] {
  return membersOf(organizationId).filter(
    (m) => m.status === "active" && !m.driverProfileId,
  );
}

/** Everybody this membership supervises, directly. */
export function directReportsOf(
  organizationId: string,
  membershipId: string,
): DirectoryMember[] {
  return membersOf(organizationId).filter(
    (m) => m.supervisorMembershipId === membershipId,
  );
}

/**
 * The chain above one membership, nearest first, ending at the Owner.
 *
 * Cycle-safe: a directory that somehow said A reports to B reports to A would
 * hang the escalation ladder, so the walk stops the first time it sees a
 * membership twice and lets the Owner close the chain.
 */
export function supervisorChainOf(
  organizationId: string,
  membershipId: string,
): DirectoryMember[] {
  const chain: DirectoryMember[] = [];
  const seen = new Set<string>([membershipId]);
  let current = memberIn(organizationId, membershipId);

  while (current?.supervisorMembershipId && !seen.has(current.supervisorMembershipId)) {
    seen.add(current.supervisorMembershipId);
    const next = memberIn(organizationId, current.supervisorMembershipId);
    if (!next) break;
    chain.push(next);
    current = next;
  }

  const owner = ownerOf(organizationId);
  if (owner && !seen.has(owner.membershipId)) chain.push(owner);
  return chain;
}

/**
 * The shape every assignment menu in the app already expects.
 *
 * `MOCK_ORG_MEMBERS` and the MT Loop's team roster are now views of this, so
 * there is one answer to "who can I hand this to" instead of three.
 */
export function assignableMembersOf(
  organizationId: string,
): Array<{ membershipId: string; displayName: string; title?: string }> {
  return membersOf(organizationId)
    .filter((m) => m.status === "active")
    .map((m) => ({
      membershipId: m.membershipId,
      displayName: m.displayName,
      title: m.title,
    }));
}

/* -------------------------------------------------------------------------- */
/* The underlying records                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The raw `Membership`, for the services that need the record and not the view.
 *
 * The MT Loop service takes an organization and a membership rather than their
 * ids, so a caller holding only a `ServiceContext` needs these two lookups to
 * build one. Kept here so the directory stays the single place memberships are
 * resolved from, rather than every service reaching into the session fixtures.
 */
export function membershipRecordFor(membershipId: string): Membership | undefined {
  const membership = ALL_MEMBERSHIPS.find((m) => m.id === membershipId);
  return membership ? current(membership) : undefined;
}

/** The organization record behind an id. */
export function organizationRecordFor(organizationId: string) {
  return MOCK_ORGANIZATIONS.find((o) => o.id === organizationId);
}

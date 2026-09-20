import { OWN_RECORDS_SCOPE, DEFAULT_SCOPE } from "@/lib/permissions/scope";
import { seedTemplateId, seedTemplates } from "@/lib/permissions/templates";
import type {
  AppliedTemplate, Membership, Organization, PermissionTemplate, Session, User,
} from "@/types";

/**
 * Development fixtures only. Shapes match the typed contracts exactly, so
 * swapping in the real API is a service-layer change, not a UI change.
 *
 * One permanent user with several memberships, chosen to prove the model: the
 * same person is an Owner in two carriers, an Owner of a dispatch organization
 * with a team, a rate-blind Dispatcher employed by another, a lone dispatcher
 * in a workspace of one, a company Driver in a carrier and an owner-operator in
 * another. Nothing about the profile changes when they switch, and every one of
 * those produces a different dashboard from the same code.
 */

export const MOCK_USER: User = {
  id: "usr_sam",
  displayName: "Sam Murtaza",
  email: "sam@antcolos.com",
  phone: "+1 (312) 555-0148",
  locale: "en-US",
  timeZone: "America/Los_Angeles",
  preferences: {
    theme: "system",
    density: "comfortable",
    language: "en",
    notifications: { email: true, push: true, telegram: true },
  },
  createdAt: "2025-11-04T16:20:00.000Z",
};

/**
 * A person who has just created an account and belongs to nothing.
 *
 * No membership, no organization, no carrier relationship, no driver profile —
 * the state every real user starts in and the one the demo account can never
 * show. Reached with `?fixture=newcomer`; see ./scenarios.ts.
 */
export const NEWCOMER_USER: User = {
  id: "usr_newcomer",
  displayName: "Alex Rivera",
  email: "alex.rivera@example.com",
  locale: "en-US",
  timeZone: "America/Chicago",
  preferences: {
    theme: "system",
    density: "comfortable",
    language: "en",
    notifications: { email: true, push: true, telegram: false },
  },
  createdAt: "2026-09-16T00:00:00.000Z",
};

export const NEWCOMER_MEMBERSHIPS: Membership[] = [];
export const NEWCOMER_ORGANIZATIONS: Organization[] = [];

export const MOCK_ORGANIZATIONS: Organization[] = [
  {
    id: "org_northline",
    type: "CARRIER",
    legalName: "Northline Freight LLC",
    displayName: "Northline Freight",
    username: "northline-freight",
    dotNumber: "3487211",
    mcNumber: "MC-1142908",
    timeZone: "America/Chicago",
    createdAt: "2025-11-04T16:20:00.000Z",
  },
  {
    id: "org_meridian",
    type: "DISPATCH_AGENCY",
    legalName: "Meridian Dispatch Group Inc.",
    displayName: "Meridian Dispatch",
    username: "meridian-dispatch",
    timeZone: "America/New_York",
    createdAt: "2026-02-18T14:02:00.000Z",
  },
  {
    id: "org_summit",
    type: "DISPATCH_AGENCY",
    legalName: "Summit Dispatch Partners LLC",
    displayName: "Summit Dispatch",
    username: "summit-dispatch",
    timeZone: "America/Denver",
    createdAt: "2026-08-11T15:10:00.000Z",
  },
  {
    // The individual-dispatcher workspace: one person booking freight for
    // carriers, with no company behind them. It is a dispatch workspace, not a
    // dispatch organization, and both things that follow from that are derived
    // from the one stored flag — the dashboard it gets, and the paperwork it is
    // asked for, which is personal identity and a service agreement rather than
    // company registration and company-level insurance.
    id: "org_solo",
    type: "DISPATCH_AGENCY",
    legalName: "Sam Murtaza",
    displayName: "Sam Murtaza — Dispatch",
    soloDispatcher: true,
    timeZone: "America/Los_Angeles",
    createdAt: "2026-09-02T17:40:00.000Z",
  },
  {
    // A SECOND carrier, so the truck side of the product can be reviewed from
    // both ends: Baxter is approved to run two of Northline's trucks, which is
    // what makes "one truck, several approved carriers, one operating lease"
    // something you can actually look at.
    id: "org_baxter",
    type: "CARRIER",
    legalName: "Baxter Transit LLC",
    displayName: "Baxter Transit",
    username: "baxter-transit",
    dotNumber: "3155902",
    mcNumber: "MC-1098447",
    timeZone: "America/New_York",
    createdAt: "2026-03-09T13:30:00.000Z",
  },
  {
    id: "org_cascade",
    type: "CARRIER",
    legalName: "Cascade Haul Co.",
    displayName: "Cascade Haul",
    username: "cascade-haul",
    dotNumber: "2910446",
    timeZone: "America/Los_Angeles",
    createdAt: "2026-05-30T19:45:00.000Z",
  },
  {
    // The second driver seat, and the reason it exists: Sam is a COMPANY
    // DRIVER at Cascade and an OWNER-OPERATOR here. Same person, same product,
    // two engagements — which is the only way to see that the proposal view and
    // the actions on it are decided by carrier policy and not by the screen.
    id: "org_stonebridge",
    type: "CARRIER",
    legalName: "Stonebridge Carriers LLC",
    displayName: "Stonebridge Carriers",
    username: "stonebridge",
    dotNumber: "3620118",
    mcNumber: "MC-1203774",
    timeZone: "America/New_York",
    createdAt: "2026-06-22T12:15:00.000Z",
  },
];

export const MOCK_TEMPLATES: PermissionTemplate[] = MOCK_ORGANIZATIONS.flatMap(
  (org) => seedTemplates(org.id),
);

const TEMPLATES_BY_ID = new Map(MOCK_TEMPLATES.map((t) => [t.id, t]));

/**
 * A seeded template as it lands on a fixture seat: the SNAPSHOT, not a pointer.
 *
 * Fixture memberships go through exactly the shape a real application produces,
 * so a seeded seat and one an owner set up by hand are the same kind of record.
 * `appliedByMembershipId` says `seed` because nobody applied these — they came
 * with the workspace — and inventing an administrator who did would put a
 * person's name on an act they did not perform.
 */
export function appliedSeedTemplate(
  orgId: string,
  name: string,
  appliedAt = "2026-01-05T00:00:00.000Z",
): AppliedTemplate {
  const template = TEMPLATES_BY_ID.get(seedTemplateId(orgId, name));
  if (!template) throw new Error(`No seeded template "${name}" in ${orgId}`);
  return {
    templateId: template.id,
    templateName: template.name,
    version: template.version,
    permissions: [...template.permissions],
    appliedAt,
    appliedByMembershipId: "seed",
    appliedByName: "Set up with the workspace",
  };
}

export const MOCK_MEMBERSHIPS: Membership[] = [
  {
    id: "mem_northline_owner",
    userId: MOCK_USER.id,
    organizationId: "org_northline",
    status: "active",
    title: "Owner",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2025-11-04T16:20:00.000Z",
  },
  {
    id: "mem_meridian_dispatcher",
    userId: MOCK_USER.id,
    organizationId: "org_meridian",
    status: "active",
    title: "Senior dispatcher",
    appliedTemplates: [appliedSeedTemplate("org_meridian", "dispatcher")],
    // Template plus extra grants, minus one explicit revocation — the exact
    // case that fixed roles cannot express. `insurance:view` is here so the
    // dispatch side of insurance disclosure can actually be looked at: it
    // shows only what a carrier has deliberately shared, with the premium,
    // the deductibles and every claim figure absent.
    grants: ["customers:edit", "documents:approve", "insurance:view"],
    revocations: ["loads:delete"],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-02-18T14:02:00.000Z",
  },
  {
    // The dispatch-agency side of ownership: the same person, owning a
    // dispatch organization rather than a carrier. Its invitation types and
    // permission set differ from Northline's, which is the point of having it.
    id: "mem_summit_owner",
    userId: MOCK_USER.id,
    organizationId: "org_summit",
    status: "active",
    title: "Owner",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2026-08-11T15:10:00.000Z",
  },
  {
    // Owner of the second carrier. Same person, a different carrier — the org
    // switcher is how you move between the two sides of an operating lease.
    id: "mem_baxter_owner",
    userId: MOCK_USER.id,
    organizationId: "org_baxter",
    status: "active",
    title: "Owner",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2026-03-09T13:30:00.000Z",
  },
  {
    // Working alone. Owner of a workspace that has no team in it, which is a
    // different thing from being an owner who happens to be the only member —
    // and, for the Document Center, a workspace with its own paperwork
    // obligations, different from either kind of organization.
    id: "mem_solo_dispatcher",
    userId: MOCK_USER.id,
    organizationId: "org_solo",
    status: "active",
    title: "Individual dispatcher",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: DEFAULT_SCOPE,
    isOwner: true,
    joinedAt: "2026-09-02T17:40:00.000Z",
  },
  {
    id: "mem_cascade_driver",
    userId: MOCK_USER.id,
    organizationId: "org_cascade",
    status: "active",
    title: "Company driver",
    appliedTemplates: [appliedSeedTemplate("org_cascade", "driver")],
    grants: [],
    revocations: [],
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "drv_cascade_0192",
    isOwner: false,
    joinedAt: "2026-05-30T19:45:00.000Z",
  },
  {
    id: "mem_stonebridge_driver",
    userId: MOCK_USER.id,
    organizationId: "org_stonebridge",
    status: "active",
    title: "Owner-operator",
    appliedTemplates: [appliedSeedTemplate("org_stonebridge", "driver")],
    grants: [],
    revocations: [],
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "drv_sb_0044",
    isOwner: false,
    joinedAt: "2026-06-22T12:15:00.000Z",
  },
];

export const MOCK_SESSION: Session = {
  user: MOCK_USER,
  memberships: MOCK_MEMBERSHIPS,
  organizations: MOCK_ORGANIZATIONS,
  activeMembershipId: "mem_northline_owner",
};

import { OWN_RECORDS_SCOPE, DEFAULT_SCOPE } from "@/lib/permissions/scope";
import { seedTemplates } from "@/lib/permissions/templates";
import type {
  Membership, Organization, PermissionTemplate, Session, User,
} from "@/types";

/**
 * Development fixtures only. Shapes match the typed contracts exactly, so
 * swapping in the real API is a service-layer change, not a UI change.
 *
 * One permanent user with several memberships, chosen to prove the model: the
 * same person is an Owner in two carriers, an Owner of a dispatch organization
 * with a team, a rate-blind Dispatcher employed by another, a lone dispatcher
 * in a workspace of one, and a scoped Driver in a carrier. Nothing about the
 * profile changes when they switch, and every one of those produces a different
 * dashboard from the same code.
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

export const MOCK_ORGANIZATIONS: Organization[] = [
  {
    id: "org_northline",
    type: "CARRIER",
    legalName: "Northline Freight LLC",
    displayName: "Northline Freight",
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
    timeZone: "America/New_York",
    createdAt: "2026-02-18T14:02:00.000Z",
  },
  {
    id: "org_summit",
    type: "DISPATCH_AGENCY",
    legalName: "Summit Dispatch Partners LLC",
    displayName: "Summit Dispatch",
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
    dotNumber: "2910446",
    timeZone: "America/Los_Angeles",
    createdAt: "2026-05-30T19:45:00.000Z",
  },
];

export const MOCK_TEMPLATES: PermissionTemplate[] = MOCK_ORGANIZATIONS.flatMap(
  (org) => seedTemplates(org.id),
);

const tpl = (orgId: string, name: string) => `tpl_${orgId}_${name}`;

export const MOCK_MEMBERSHIPS: Membership[] = [
  {
    id: "mem_northline_owner",
    userId: MOCK_USER.id,
    organizationId: "org_northline",
    status: "active",
    title: "Owner",
    templateIds: [],
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
    templateIds: [tpl("org_meridian", "dispatcher")],
    // Template plus one extra grant, minus one explicit revocation — the exact
    // case that fixed roles cannot express.
    grants: ["customers:edit", "documents:approve"],
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
    templateIds: [],
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
    templateIds: [],
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
    templateIds: [],
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
    templateIds: [tpl("org_cascade", "driver")],
    grants: [],
    revocations: [],
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "drv_cascade_0192",
    isOwner: false,
    joinedAt: "2026-05-30T19:45:00.000Z",
  },
];

export const MOCK_SESSION: Session = {
  user: MOCK_USER,
  memberships: MOCK_MEMBERSHIPS,
  organizations: MOCK_ORGANIZATIONS,
  activeMembershipId: "mem_northline_owner",
};

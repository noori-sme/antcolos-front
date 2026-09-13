import { OWN_RECORDS_SCOPE, DEFAULT_SCOPE } from "@/lib/permissions/scope";
import { seedTemplates } from "@/lib/permissions/templates";
import type {
  Membership, Organization, PermissionTemplate, Session, User,
} from "@/types";

/**
 * Development fixtures only. Shapes match the typed contracts exactly, so
 * swapping in the real API is a service-layer change, not a UI change.
 *
 * One permanent user, three memberships, three organizations — chosen to prove
 * the model: the same person is an Owner in one org, a rate-blind Dispatcher in
 * another, and a scoped Driver in a third. Nothing about the profile changes
 * when they switch.
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
    grants: ["customers:manage", "documents:approve"],
    revocations: ["loads:delete"],
    scope: DEFAULT_SCOPE,
    isOwner: false,
    joinedAt: "2026-02-18T14:02:00.000Z",
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

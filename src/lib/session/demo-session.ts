import { effectivePermissions } from "@/lib/permissions/effective";
import type { Membership, Organization, PermissionKey } from "@/types";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_SESSION, MOCK_USER } from "./fixtures";
import type { SessionContextValue } from "./provider";

/**
 * The demo session (plan 10).
 *
 * In http mode with demo areas on, a page with no backend yet runs on the
 * in-memory mocks. Their seeded data belongs to the Northline demo company, so
 * the page is rendered as the Northline owner: that membership, that
 * organization's id and that owner's permissions. Everything the person sees as
 * theirs stays real: the organization's display name, their own name and email,
 * the switcher's memberships, density and sign-out all come from the real
 * session.
 */
const DEMO_MEMBERSHIP: Membership = MOCK_MEMBERSHIPS.find(
  (m) => m.id === MOCK_SESSION.activeMembershipId,
)!;
const DEMO_ORGANIZATION: Organization = MOCK_ORGANIZATIONS.find(
  (o) => o.id === DEMO_MEMBERSHIP.organizationId,
)!;

let demoPermissionsCache: ReadonlySet<PermissionKey> | null = null;

/** What the Northline owner may do in mock mode: the demo pages' permission set. */
export function demoPermissions(): ReadonlySet<PermissionKey> {
  demoPermissionsCache ??= effectivePermissions(DEMO_MEMBERSHIP, DEMO_ORGANIZATION);
  return demoPermissionsCache;
}

/** The real session, re-pointed at the demo company for a demo page. */
export function buildDemoSession(real: SessionContextValue): SessionContextValue {
  return {
    ...real,
    // The mock data's "assigned to me" records belong to the fixture user, so
    // the id is the fixture's. The name and email the page shows stay real.
    user: { ...real.user, id: MOCK_USER.id },
    activeMembership: DEMO_MEMBERSHIP,
    activeOrganization: {
      ...DEMO_ORGANIZATION,
      displayName: real.activeOrganization?.displayName || DEMO_ORGANIZATION.displayName,
    },
    permissions: demoPermissions(),
    isDriverMembership: Boolean(DEMO_MEMBERSHIP.driverProfileId),
  };
}

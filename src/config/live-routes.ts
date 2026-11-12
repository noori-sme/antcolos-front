/**
 * Routes that work against the real API when `NEXT_PUBLIC_API_MODE=http` (plan 08).
 *
 * Every other (app) route still runs on in-memory mocks. In http mode those
 * are hidden from navigation, and opening one shows "not available yet"
 * instead of an adapter error. In mock mode everything stays reachable.
 *
 * Add a route here in the same change that moves its screens to an http
 * adapter. A prefix covers its children (`/fleet/trucks` covers
 * `/fleet/trucks/new` and `/fleet/trucks/<id>`).
 */
export const HTTP_LIVE_ROUTES: readonly string[] = [
  "/home",                  // live home (features/home/live-home-screen)
  "/fleet/trucks",          // trucks (fleet-api-contract)
  "/people/drivers",        // orgPeople (users-api-contract)
  "/people/dispatchers",
  "/people/admins",
  "/settings/invitations",  // orgInvitations (invitations-api-contract)
  "/settings/permissions",  // orgRoles + catalog (permissions-api-contract)
  "/account/profile",       // selfProfile (profile.md, plan 11)
  "/settings/users",        // orgMembers (membership-api-contract §2, plan 12)
];

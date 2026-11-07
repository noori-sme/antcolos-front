/**
 * Which paths need a session. Pure, so `src/middleware.ts` (server) and the
 * session provider (client) share one answer instead of two drifting lists.
 */

/** Pages under `src/app/(public)`: reached without signing in, by anyone. */
const PUBLIC_PREFIXES = ["/profile/", "/shared/", "/track/"] as const;

/** Pages under `src/app/(auth)`: for people who are not signed in yet. */
const AUTH_PREFIXES = [
  "/verify-email",
  "/forgot-password",
  "/invite",
  "/invitation",
  "/invitations",
  "/referral",
] as const;

/** A share, profile, or tracking page. Never redirected, signed in or not. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Sign-in, sign-up, and invitation/referral acceptance pages. */
export function isAuthPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

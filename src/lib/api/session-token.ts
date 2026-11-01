/**
 * Which responses may replace the session token.
 *
 * Only sign-in, sign-up/onboarding, email verification and invitation
 * acceptance hand out a session. Other responses can carry a field named
 * `token` that is NOT a session (an invitation token, a share or tracking
 * token, a verification token), and saving one of those as `antcolos_token`
 * would sign the current user out.
 */

/** Endpoints under `/auth/` that never issue a session. */
const NON_SESSION_AUTH_PATHS = ["/auth/resend-verification", "/auth/forgot-password"];

/** Strip origin, query string and hash, so `url` is compared as a path. */
function pathOf(url: string): string {
  const withoutOrigin = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const path = withoutOrigin.split(/[?#]/, 1)[0] ?? "";
  // The baseURL already holds `/api/v1`; tolerate callers that repeat it.
  return path.replace(/^\/api\/v\d+(?=\/)/, "");
}

export function issuesSessionToken(url: string): boolean {
  const path = pathOf(url);
  if (path.startsWith("/invitations/accept/")) return true;
  if (!path.startsWith("/auth/")) return false;
  return !NON_SESSION_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

type Body = Record<string, unknown> | null | undefined;

function stringField(body: Body, key: string): string | undefined {
  const value = body?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The session token in a response body, or undefined when this response must
 * not touch the session (see `issuesSessionToken`).
 */
export function sessionTokenFrom(url: string, data: unknown): string | undefined {
  if (!issuesSessionToken(url) || !data || typeof data !== "object") return undefined;
  const body = data as Record<string, unknown>;
  const nested =
    body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : undefined;
  for (const source of [body, nested]) {
    for (const key of ["accessToken", "access_token", "token"]) {
      const found = stringField(source, key);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Server-side helpers for the same-origin API proxy (plan 21). Used by
 * `src/proxy.ts` and `app/api/session/[...path]/route.ts`; never imported by
 * browser code.
 */

export const SESSION_COOKIE = {
  /** The real access token. httpOnly. */
  access: "antcolos_at",
  /** The refresh token. httpOnly, sent only to /api/session. */
  refresh: "antcolos_rt",
  /** Readable by page scripts: the access token without its signature. */
  claims: "antcolos_token",
} as const;

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
export const BFF_SECRET_HEADER = "x-antcolos-bff-secret";
export const BFF_CLIENT_IP_HEADER = "x-antcolos-client-ip";

/** The API base (`…/api/v1`), from server-only env first. */
export function upstreamBase(): string {
  const base =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "https://antcolos-staging.up.railway.app/api/v1";
  return base.replace(/\/+$/, "");
}

/**
 * The JWT without its signature: page scripts can still read the claims
 * (scope, organization), but the API rejects it as a credential.
 */
export function claimsOnly(jwt: string): string {
  const [header, payload] = jwt.split(".");
  return header && payload ? `${header}.${payload}.` : "";
}

/** A claims-only token carries no signature; never send it as a credential. */
export function isClaimsOnly(token: string): boolean {
  return token.endsWith(".") || token.split(".").length !== 3;
}

export function cookieOptions(secure: boolean, path = "/") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path,
    maxAge: SESSION_MAX_AGE_S,
  };
}

/** The browser's address as the hosting proxy reports it. */
export function clientIpOf(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || undefined;
}

/**
 * Headers for the API call: the caller's own `Authorization` and cookies never
 * pass through (the session cookie decides who is calling), and the browser's
 * address goes along with the shared secret when one is configured.
 */
export function upstreamHeaders(incoming: Headers, accessToken: string | undefined): Headers {
  const headers = new Headers(incoming);
  for (const name of ["authorization", "cookie", "host", "connection", BFF_SECRET_HEADER, BFF_CLIENT_IP_HEADER]) {
    headers.delete(name);
  }
  if (accessToken && !isClaimsOnly(accessToken)) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  const secret = process.env.BFF_SHARED_SECRET?.trim();
  const ip = clientIpOf(incoming);
  if (secret && ip) {
    headers.set(BFF_SECRET_HEADER, secret);
    headers.set(BFF_CLIENT_IP_HEADER, ip);
  }
  return headers;
}

/**
 * The access token for an API call: the httpOnly cookie, or — for a session
 * started before this change, until that token expires — the old readable
 * cookie if it still holds a real JWT. Remove the fallback once
 * `JWT_EXPIRES_IN` has passed after the deploy.
 */
export function accessTokenFrom(cookies: { get(name: string): { value: string } | undefined }): string | undefined {
  const access = cookies.get(SESSION_COOKIE.access)?.value;
  if (access) return access;
  const legacy = cookies.get(SESSION_COOKIE.claims)?.value;
  return legacy && !isClaimsOnly(legacy) ? legacy : undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated same-origin endpoints: a request that
 * changes something must come from this app's own pages. Browsers send
 * `Origin` on every cross-site and same-origin POST; `Sec-Fetch-Site` is the
 * fallback. A request with neither (curl, server code) has no ambient cookie
 * to abuse and is allowed.
 */
export function isAllowedOrigin(method: string, headers: Headers, ownOrigin: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const origin = headers.get("origin");
  if (origin) return origin === ownOrigin;
  const site = headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

/** A body-carrying session call must be JSON (a cross-site form cannot send it without a preflight). */
export function isJsonOrEmpty(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const length = headers.get("content-length");
  const type = headers.get("content-type") ?? "";
  return type.startsWith("application/json") || (!type && (length === null || length === "0"));
}

/** `/api/backend/<rest>` → the API URL for `<rest>` (host is never taken from the path). */
export function backendTarget(pathname: string, search: string, prefix = "/api/backend"): URL {
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  const base = new URL(`${upstreamBase()}/`);
  const target = new URL(`${upstreamBase()}${rest.startsWith("/") || rest === "" ? rest : `/${rest}`}${search}`);
  if (target.origin !== base.origin) throw new Error("backend target escaped the API origin");
  return target;
}

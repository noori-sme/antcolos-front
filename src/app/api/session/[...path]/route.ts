import { type NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE, accessTokenFrom, claimsOnly, cookieOptions, isAllowedOrigin, isJsonOrEmpty,
  upstreamBase, upstreamHeaders,
} from "@/lib/api/bff";
import { issuesSessionToken } from "@/lib/api/session-token";

/**
 * Same-origin session endpoints (plan 27). Session-issuing API calls come here
 * so the tokens they return go into httpOnly cookies; page scripts get only a
 * claims-only copy. `/auth/refresh` and `/auth/logout` use the refresh cookie.
 */
type Context = { params: Promise<{ path: string[] }> };

/** Headers for a request whose body this route builds: fetch sets the length. */
function headersFor(request: NextRequest, accessToken: string | undefined): Headers {
  const headers = upstreamHeaders(request.headers, accessToken);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
}

const REFRESH = "/auth/refresh";
const LOGOUT = "/auth/logout";

async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  const { path } = await context.params;
  const apiPath = `/${path.map(encodeURIComponent).join("/")}`;
  const secure = request.nextUrl.protocol === "https:";

  // Login CSRF guard: a cross-site form must not plant or clear a session.
  if (!isAllowedOrigin(request.method, request.headers, request.nextUrl.origin)
    || !isJsonOrEmpty(request.method, request.headers)) {
    return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });
  }

  if (apiPath === REFRESH) return refresh(request, secure);
  if (apiPath === LOGOUT) return logout(request, secure);
  if (!issuesSessionToken(apiPath)) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const method = request.method;
  const upstream = await fetch(`${upstreamBase()}${apiPath}${request.nextUrl.search}`, {
    method,
    headers: headersFor(request, accessTokenFrom(request.cookies)),
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  });
  return relay(upstream, secure);
}

/** Copies the API answer; a body with `accessToken` becomes cookies. */
async function relay(upstream: Response, secure: boolean): Promise<NextResponse> {
  const text = await upstream.text();
  const type = upstream.headers.get("content-type") ?? "";
  let body: unknown = text;
  if (type.includes("application/json") && text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  const tokens = sessionTokens(body);
  const outgoing =
    tokens && typeof body === "object" && body
      ? { ...(body as Record<string, unknown>), accessToken: claimsOnly(tokens.access), refreshToken: undefined }
      : body;

  const response =
    typeof outgoing === "string"
      ? new NextResponse(outgoing || null, { status: upstream.status })
      : NextResponse.json(outgoing, { status: upstream.status });
  if (type) response.headers.set("content-type", type);
  const correlation = upstream.headers.get("x-correlation-id");
  if (correlation) response.headers.set("x-correlation-id", correlation);
  if (tokens) setSession(response, tokens.access, tokens.refresh, secure);
  return response;
}

function sessionTokens(body: unknown): { access: string; refresh?: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const access = typeof record.accessToken === "string" ? record.accessToken : undefined;
  if (!access || access.split(".").length !== 3) return undefined;
  const refresh = typeof record.refreshToken === "string" ? record.refreshToken : undefined;
  return { access, refresh };
}

function setSession(response: NextResponse, access: string, refresh: string | undefined, secure: boolean) {
  response.cookies.set(SESSION_COOKIE.access, access, cookieOptions(secure));
  response.cookies.set(SESSION_COOKIE.claims, claimsOnly(access), { ...cookieOptions(secure), httpOnly: false });
  if (refresh) {
    response.cookies.set(SESSION_COOKIE.refresh, refresh, cookieOptions(secure, "/api/session"));
  } else {
    // A new session without a refresh token must not keep the previous one's.
    response.cookies.set(SESSION_COOKIE.refresh, "", { ...cookieOptions(secure, "/api/session"), maxAge: 0 });
  }
}

function clearSession(response: NextResponse, secure: boolean) {
  response.cookies.set(SESSION_COOKIE.access, "", { ...cookieOptions(secure), maxAge: 0 });
  response.cookies.set(SESSION_COOKIE.claims, "", { ...cookieOptions(secure), httpOnly: false, maxAge: 0 });
  response.cookies.set(SESSION_COOKIE.refresh, "", { ...cookieOptions(secure, "/api/session"), maxAge: 0 });
}

async function refresh(request: NextRequest, secure: boolean): Promise<NextResponse> {
  const refreshToken = request.cookies.get(SESSION_COOKIE.refresh)?.value;
  if (!refreshToken) {
    return NextResponse.json({ message: "Session expired. Sign in again." }, { status: 401 });
  }
  const headers = headersFor(request, undefined);
  headers.set("content-type", "application/json");
  const upstream = await fetch(`${upstreamBase()}${REFRESH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  }).catch(() => null);
  // Cookies are left alone on any failure: another tab may have just stored
  // fresh ones. Only the API's own 401 means the session is over; a 429, 5xx
  // or network error is "try later", not "signed out".
  if (!upstream || !upstream.ok) {
    return upstream?.status === 401
      ? NextResponse.json({ message: "Session expired. Sign in again." }, { status: 401 })
      : NextResponse.json({ message: "Could not renew the session right now." }, { status: 503 });
  }
  const tokens = sessionTokens(await upstream.json().catch(() => null));
  if (!tokens) {
    return NextResponse.json({ message: "Could not renew the session right now." }, { status: 503 });
  }
  const response = NextResponse.json({ refreshed: true });
  setSession(response, tokens.access, tokens.refresh, secure);
  return response;
}

async function logout(request: NextRequest, secure: boolean): Promise<NextResponse> {
  const refreshToken = request.cookies.get(SESSION_COOKIE.refresh)?.value;
  if (refreshToken) {
    const headers = headersFor(request, undefined);
    headers.set("content-type", "application/json");
    await fetch(`${upstreamBase()}${LOGOUT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  const response = new NextResponse(null, { status: 204 });
  clearSession(response, secure);
  return response;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };

import { afterEach, describe, expect, it } from "vitest";
import {
  accessTokenFrom, backendTarget, claimsOnly, isAllowedOrigin, isClaimsOnly, isJsonOrEmpty, upstreamHeaders,
} from "./bff";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEiLCJzY29wZSI6InRlbmFudCJ9.c2lnbmF0dXJl";
const jar = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name] } : undefined),
});

describe("bff helpers", () => {
  afterEach(() => {
    delete process.env.BFF_SHARED_SECRET;
  });

  it("drops the signature but keeps the claims readable", () => {
    const claims = claimsOnly(jwt);
    expect(claims).toBe("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEiLCJzY29wZSI6InRlbmFudCJ9.");
    expect(JSON.parse(atob(claims.split(".")[1]))).toEqual({ sub: "u-1", scope: "tenant" });
    expect(isClaimsOnly(claims)).toBe(true);
    expect(isClaimsOnly(jwt)).toBe(false);
  });

  it("never forwards the caller's Authorization or cookies; adds the session token", () => {
    const headers = upstreamHeaders(
      new Headers({ authorization: "Bearer stolen", cookie: "antcolos_at=x", "content-type": "application/json", "idempotency-key": "k" }),
      jwt,
    );
    expect(headers.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("idempotency-key")).toBe("k");
  });

  it("does not send a claims-only token as a credential", () => {
    expect(upstreamHeaders(new Headers(), claimsOnly(jwt)).get("authorization")).toBeNull();
  });

  it("forwards the browser address only with the shared secret, and drops spoofed values", () => {
    const incoming = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-antcolos-client-ip": "6.6.6.6" });
    expect(upstreamHeaders(incoming, jwt).get("x-antcolos-client-ip")).toBeNull();
    process.env.BFF_SHARED_SECRET = "s".repeat(32);
    const headers = upstreamHeaders(incoming, jwt);
    expect(headers.get("x-antcolos-client-ip")).toBe("203.0.113.9");
    expect(headers.get("x-antcolos-bff-secret")).toBe("s".repeat(32));
  });

  it("prefers the httpOnly cookie and still accepts an old real JWT until it expires", () => {
    expect(accessTokenFrom(jar({ antcolos_at: "new", antcolos_token: jwt }))).toBe("new");
    expect(accessTokenFrom(jar({ antcolos_token: jwt }))).toBe(jwt);
    expect(accessTokenFrom(jar({ antcolos_token: claimsOnly(jwt) }))).toBeUndefined();
  });

  it("refuses cross-site writes and allows same-origin ones and reads", () => {
    const own = "https://app.antcolos.com";
    expect(isAllowedOrigin("POST", new Headers({ origin: own }), own)).toBe(true);
    expect(isAllowedOrigin("POST", new Headers({ origin: "https://evil.example" }), own)).toBe(false);
    expect(isAllowedOrigin("POST", new Headers({ "sec-fetch-site": "cross-site" }), own)).toBe(false);
    expect(isAllowedOrigin("POST", new Headers({ "sec-fetch-site": "same-site" }), own)).toBe(false);
    expect(isAllowedOrigin("POST", new Headers({ "sec-fetch-site": "same-origin" }), own)).toBe(true);
    expect(isAllowedOrigin("GET", new Headers({ origin: "https://evil.example" }), own)).toBe(true);
  });

  it("only takes JSON (or no body) on session writes, so a form post is refused", () => {
    expect(isJsonOrEmpty("POST", new Headers({ "content-type": "application/json" }))).toBe(true);
    expect(isJsonOrEmpty("POST", new Headers({ "content-type": "application/x-www-form-urlencoded" }))).toBe(false);
    expect(isJsonOrEmpty("POST", new Headers({ "content-type": "text/plain" }))).toBe(false);
    expect(isJsonOrEmpty("POST", new Headers())).toBe(true);
  });

  it("maps /api/backend paths onto the API without leaving its host", () => {
    process.env.API_URL = "https://api.antcolos.test/api/v1";
    expect(backendTarget("/api/backend/trucks/7", "?page=2").toString()).toBe(
      "https://api.antcolos.test/api/v1/trucks/7?page=2",
    );
    expect(backendTarget("/api/backend//evil.example/x", "").host).toBe("api.antcolos.test");
    expect(backendTarget("/api/backend", "").toString()).toBe("https://api.antcolos.test/api/v1");
    delete process.env.API_URL;
  });
});

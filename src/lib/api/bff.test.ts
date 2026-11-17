import { afterEach, describe, expect, it } from "vitest";
import { accessTokenFrom, claimsOnly, isClaimsOnly, upstreamHeaders } from "./bff";

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

  it("prefers the httpOnly cookie and accepts an old real JWT once", () => {
    expect(accessTokenFrom(jar({ antcolos_at: "new", antcolos_token: jwt }))).toBe("new");
    expect(accessTokenFrom(jar({ antcolos_token: jwt }))).toBe(jwt);
    expect(accessTokenFrom(jar({ antcolos_token: claimsOnly(jwt) }))).toBeUndefined();
  });
});

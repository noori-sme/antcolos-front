import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, GET } from "./route";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEiLCJzY29wZSI6InRlbmFudCJ9.c2ln";
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string>; cookie?: string } = {},
) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`http://localhost:3001/api/session/${path}`, {
    method: init.method,
    body: init.body,
    headers,
  });
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("/api/session route", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_URL = "http://api.test/api/v1";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env.API_URL;
  });

  it("turns a login answer into httpOnly cookies and hands back only claims", async () => {
    fetchMock.mockResolvedValue(json({ user: { id: "u-1" }, accessToken: JWT, refreshToken: "r".repeat(43) }, 201));

    const res = await POST(
      req("auth/login", { method: "POST", body: JSON.stringify({ email: "a@b.c" }), headers: { "content-type": "application/json", authorization: "Bearer evil" } }),
      ctx("auth", "login"),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/v1/auth/login");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.accessToken).toBe(JWT.split(".").slice(0, 2).join(".") + ".");
    expect(body).not.toHaveProperty("refreshToken");
    const access = res.cookies.get("antcolos_at");
    expect(access?.value).toBe(JWT);
    expect(access?.httpOnly).toBe(true);
    const refresh = res.cookies.get("antcolos_rt");
    expect(refresh).toMatchObject({ value: "r".repeat(43), httpOnly: true, path: "/api/session" });
    expect(res.cookies.get("antcolos_token")?.httpOnly).toBe(false);
  });

  it("forwards the session cookie on session reads such as /auth/me", async () => {
    fetchMock.mockResolvedValue(json({ id: "u-1" }));
    await GET(req("auth/me", { cookie: `antcolos_at=${JWT}` }), ctx("auth", "me"));
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${JWT}`);
  });

  it("refuses paths that are not session endpoints", async () => {
    const res = await GET(req("loads"), ctx("loads"));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes with the refresh cookie and rotates both cookies", async () => {
    fetchMock.mockResolvedValue(json({ accessToken: JWT, refreshToken: "n".repeat(43) }, 201));
    const res = await POST(
      req("auth/refresh", { method: "POST", cookie: `antcolos_rt=${"o".repeat(43)}`, headers: { "content-length": "0" } }),
      ctx("auth", "refresh"),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: "o".repeat(43) });
    // The browser's empty-body length must not reach the API with a JSON body.
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("content-length")).toBeNull();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: true });
    expect(res.cookies.get("antcolos_rt")?.value).toBe("n".repeat(43));
  });

  it("leaves cookies alone when the refresh is refused (another tab may hold the new ones)", async () => {
    fetchMock.mockResolvedValue(json({ message: "no" }, 401));
    const res = await POST(req("auth/refresh", { method: "POST", cookie: `antcolos_rt=${"o".repeat(43)}` }), ctx("auth", "refresh"));
    expect(res.status).toBe(401);
    expect(res.cookies.getAll()).toEqual([]);
  });

  it("answers 401 to a refresh without a refresh cookie, without calling the API", async () => {
    const res = await POST(req("auth/refresh", { method: "POST" }), ctx("auth", "refresh"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs out: revokes upstream and clears every session cookie", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(req("auth/logout", { method: "POST", cookie: `antcolos_rt=${"o".repeat(43)}` }), ctx("auth", "logout"));
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/v1/auth/logout");
    expect(res.status).toBe(204);
    for (const name of ["antcolos_at", "antcolos_rt", "antcolos_token"]) {
      expect(res.cookies.get(name)?.maxAge).toBe(0);
    }
  });
});

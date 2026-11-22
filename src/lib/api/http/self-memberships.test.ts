import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("../client", () => ({ apiClient: { post: (...args: unknown[]) => post(...args) } }));

import { httpSelfMembershipsService } from "./carrier-authority";

const ctx = { organizationId: "org-1" } as never;

describe("selfMemberships.leave", () => {
  beforeEach(() => post.mockReset());

  it("leaves", async () => {
    post.mockResolvedValue({ status: 200, data: "" });
    await expect(httpSelfMembershipsService.leave(ctx, "org-2")).resolves.toEqual({ alreadyLeft: false });
    expect(post.mock.calls[0][0]).toBe("/users/me/memberships/org-2/leave");
  });

  it("reads a 404 as already left, by status rather than wording", async () => {
    post.mockResolvedValue({ status: 404, data: { message: "anything" } });
    await expect(httpSelfMembershipsService.leave(ctx, "org-2")).resolves.toEqual({ alreadyLeft: true });
  });
});

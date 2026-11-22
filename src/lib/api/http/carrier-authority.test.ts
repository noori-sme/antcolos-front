import { describe, expect, it } from "vitest";
import { toAuthorityRecord, toDirectoryCarrier, toMyOrganization } from "./carrier-authority";

/** Copied from ../antcolos/docs/requirements/carrier-authority-api-contract.md §Record. */
const CONTRACT_RECORD = {
  id: "…",
  organizationId: "…",
  dotNumber: "1234567",
  mcNumber: "MC123456",
  status: "AUTHORIZED",
  allowedToOperate: true,
  outOfService: false,
  authorities: [{ docketNumber: "MC123456", type: "COMMON", status: "A" }],
  authoritySince: "2019-04-02T00:00:00.000Z",
  authorityAgeDays: 2420,
  source: "fmcsa",
  checkedByUserId: "…",
  checkedAt: "2026-11-16T10:00:00.000Z",
};

describe("carrier authority mappers", () => {
  it("maps the contract record", () => {
    expect(toAuthorityRecord(CONTRACT_RECORD)).toEqual({
      id: "…",
      dotNumber: "1234567",
      mcNumber: "MC123456",
      status: "AUTHORIZED",
      allowedToOperate: true,
      outOfService: false,
      authorities: [{ docketNumber: "MC123456", type: "COMMON", status: "A" }],
      authoritySince: "2019-04-02T00:00:00.000Z",
      authorityAgeDays: 2420,
      checkedAt: "2026-11-16T10:00:00.000Z",
    });
  });

  it("keeps an unknown age as null and an unknown status raw", () => {
    const r = toAuthorityRecord({ ...CONTRACT_RECORD, status: "PENDING_REVIEW", authoritySince: null, authorityAgeDays: null });
    expect(r.status).toBe("PENDING_REVIEW");
    expect(r.authorityAgeDays).toBeNull();
  });

  it("maps a directory carrier (membership-api-contract §6) and drops a row without an id", () => {
    expect(
      toDirectoryCarrier({ organizationId: "o1", name: "Acme Haulage", handle: "acme-haulage", type: "CARRIER", mcNumber: "MC123456", dotNumber: "1234567" }),
    ).toEqual({ organizationId: "o1", name: "Acme Haulage", handle: "acme-haulage", mcNumber: "MC123456", dotNumber: "1234567" });
    expect(toDirectoryCarrier({ name: "x" })).toBeUndefined();
  });

  it("maps one of my memberships", () => {
    expect(
      toMyOrganization({ organizationId: "o1", organizationName: "Acme", organizationType: "CARRIER", roleId: "DRIVER", joinedAt: "2026-11-01T00:00:00.000Z" }),
    ).toEqual({ organizationId: "o1", name: "Acme", type: "CARRIER", roleId: "DRIVER", joinedAt: "2026-11-01T00:00:00.000Z" });
  });
});

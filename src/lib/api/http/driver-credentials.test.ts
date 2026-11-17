import { describe, expect, it } from "vitest";
import { toCredentialHistoryEntry, toDriverCredential } from "./driver-credentials";

/** Copied from ../antcolos/docs/requirements/driver-credentials-api-contract.md. */
const CONTRACT_CREDENTIAL = {
  id: "6f1d2c3b-0000-4000-8000-000000000010",
  organizationId: "9a8b7c6d-0000-4000-8000-000000000002",
  userId: "b2a7c1d0-0000-4000-8000-000000000001",
  type: "CDL",
  label: "Class A",
  status: "ACTIVE",
  issuedAt: "2024-03-01T00:00:00.000Z",
  effectiveAt: null,
  expiresAt: "2028-03-01T00:00:00.000Z",
  source: "api",
  createdByUserId: "b2a7c1d0-0000-4000-8000-000000000009",
  updatedByUserId: "b2a7c1d0-0000-4000-8000-000000000009",
  createdAt: "2026-11-16T10:00:00.000Z",
  updatedAt: "2026-11-16T10:00:00.000Z",
};

describe("driver credentials mappers", () => {
  it("maps the contract credential", () => {
    expect(toDriverCredential(CONTRACT_CREDENTIAL)).toEqual({
      id: CONTRACT_CREDENTIAL.id,
      userId: CONTRACT_CREDENTIAL.userId,
      type: "CDL",
      label: "Class A",
      status: "ACTIVE",
      issuedAt: "2024-03-01T00:00:00.000Z",
      effectiveAt: null,
      expiresAt: "2028-03-01T00:00:00.000Z",
      source: "api",
      updatedByUserId: CONTRACT_CREDENTIAL.updatedByUserId,
      createdAt: "2026-11-16T10:00:00.000Z",
      updatedAt: "2026-11-16T10:00:00.000Z",
    });
  });

  it("keeps an empty label and refuses unknown enum values", () => {
    const mapped = toDriverCredential({ ...CONTRACT_CREDENTIAL, label: "", type: "PILOT", status: "WEIRD" });
    expect(mapped).toMatchObject({ label: "", type: "OTHER", status: "NOT_HELD" });
  });

  it("maps a history entry", () => {
    expect(
      toCredentialHistoryEntry({
        id: "0b7f2e1c-0000-4000-8000-000000000020",
        type: "driver_credential.status_changed",
        occurredAt: "2026-11-16T10:00:00.000Z",
        source: "system",
        actorId: "system",
        details: { from: "ACTIVE", to: "EXPIRED", reason: null },
      }),
    ).toEqual({
      id: "0b7f2e1c-0000-4000-8000-000000000020",
      type: "driver_credential.status_changed",
      occurredAt: "2026-11-16T10:00:00.000Z",
      source: "system",
      actorId: "system",
      details: { from: "ACTIVE", to: "EXPIRED", reason: null },
    });
  });
});

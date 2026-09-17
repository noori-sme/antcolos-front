import { beforeEach, describe, expect, it } from "vitest";
import { DOMAIN_EVENT_LABEL, type DomainEventKind, type PermissionKey } from "@/types";
import { EVENT_SCOPE_MATRIX } from "@/lib/propagation/scope-policy";
import { PERMISSION_CATALOG, PERMISSION_GROUP_LABELS } from "@/lib/permissions/catalog";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { MOCK_STORES, resetAllMocks } from "./registry";
import { allDocuments, allSharePackages } from "./document-store";
import { allQualificationRecords } from "./qualification-store";
import { allEngagements } from "./workforce-store";
import { mockWorkforceService as workforce } from "./workforce";
import { services } from "@/lib/api";
import { httpServices } from "@/lib/api/http";
import {
  completion, documentRequirements, mockListDocuments, resetDriverMock,
} from "@/features/driver/mock-driver";
import type { ServiceContext } from "../contracts/context";

/**
 * The boundaries this milestone promised not to cross, asserted rather than
 * described.
 *
 * Every test here would fail on the change it exists to prevent, which is the
 * only kind of boundary worth writing down.
 */

const ctx = (organizationId: string, permissions: PermissionKey[]): ServiceContext => ({
  organizationId,
  organizationName: organizationId,
  workspaceKind: "carrier_organization",
  membershipId: `mem_${organizationId}`,
  permissions: new Set(permissions),
  actor: {
    userId: "usr_test", membershipId: `mem_${organizationId}`,
    displayNameSnapshot: "Test Person", source: "web",
  },
  scope: { loads: "all", financials: "all" },
});

beforeEach(() => {
  resetAllMocks();
});

describe("A6's boundary is reused, not re-implemented", () => {
  it("adds no DomainEventKind, so the scope matrix is unchanged", () => {
    const kinds = Object.keys(EVENT_SCOPE_MATRIX) as DomainEventKind[];
    expect(kinds.sort()).toEqual([
      "equipment_meter.reading_recorded",
      "fuel_transaction.confirmed",
      "load.finalized",
    ]);
    // The label map and the matrix are the same closed set: adding a kind for
    // HR would have forced an entry in both, and neither has one.
    expect(Object.keys(DOMAIN_EVENT_LABEL).sort()).toEqual(kinds.sort());
  });

  it("keeps no FactScope of its own on either new record", () => {
    for (const engagement of allEngagements()) {
      expect(engagement).not.toHaveProperty("scope");
    }
    for (const record of allQualificationRecords()) {
      expect(record).not.toHaveProperty("scope");
      expect(record).not.toHaveProperty("carrierOrganizationId");
    }
  });
});

describe("the service registry and the seams stay complete", () => {
  it("offers workforce and qualification through AntcolosServices", () => {
    expect(services.workforce).toBeDefined();
    expect(services.qualification).toBeDefined();
  });

  it("gives the HTTP adapter an honest not-implemented method for each one", () => {
    for (const [name, method] of Object.entries(httpServices.workforce)) {
      expect(() => (method as () => never)()).toThrow(/not implemented/i);
      expect(name).toBeTruthy();
    }
    for (const method of Object.values(httpServices.qualification)) {
      expect(() => (method as () => never)()).toThrow(/not implemented/i);
    }
  });

  it("registers both new stores in the one reset registry", () => {
    const ids = MOCK_STORES.map((s) => s.id);
    expect(ids).toContain("workforce");
    expect(ids).toContain("qualification");
  });

  it("actually empties them on reset", async () => {
    await workforce.create(ctx("org_northline", ["workforce:view", "workforce:manage"]), {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    expect(allEngagements().some((e) => e.person.displayName === "Rae Okonkwo")).toBe(true);
    resetAllMocks();
    expect(allEngagements().some((e) => e.person.displayName === "Rae Okonkwo")).toBe(false);
  });
});

describe("the shared vocabularies gained entries and no second copy", () => {
  it("puts the new permission keys in the catalog, grouped and described", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    for (const key of [
      "workforce:view", "workforce:manage", "workforce:end",
      "qualification:view", "qualification:dispose",
    ] as PermissionKey[]) {
      expect(keys).toContain(key);
      const meta = PERMISSION_CATALOG.find((p) => p.key === key)!;
      expect(PERMISSION_GROUP_LABELS[meta.group]).toBeTruthy();
      expect(meta.description.length).toBeGreaterThan(20);
    }
  });

  it("adds no permission that grants employment or reads as a role", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key as string);
    expect(keys).not.toContain("hr:manage_everything");
    expect(keys.filter((k) => k.startsWith("workforce:"))).toHaveLength(3);
  });

  it("describes every new audit action in the one action catalog", () => {
    const described = new Set(AUDIT_ACTIONS.map((a) => a.key as string));
    for (const action of [
      "workforce.engagement_created", "workforce.activated", "workforce.ended",
      "compliance.qualification_adopted", "compliance.qualification_disposed",
    ]) {
      expect(described.has(action)).toBe(true);
    }
  });
});

describe("regression: what was already working still works", () => {
  it("leaves the Driver Document Wallet and its share packages alone", () => {
    // Seeded driver documents and packages are still the document store's.
    expect(allDocuments().length).toBeGreaterThan(0);
    expect(Array.isArray(allSharePackages())).toBe(true);
  });

  it("leaves the driver's own onboarding checklist untouched", async () => {
    // The driver's own completion still computes from the driver's own
    // requirements and documents. HR reads this world; it did not take it over.
    resetDriverMock();
    const documents = await mockListDocuments();
    const result = completion(documentRequirements("company_driver", "org_cascade"), documents);
    expect(result.required).toBeGreaterThan(0);
    expect(result.percent).toBeGreaterThanOrEqual(0);
    expect(result.percent).toBeLessThanOrEqual(100);
  });
});

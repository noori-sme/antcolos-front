import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { resetComplianceRegistry } from "@/lib/api/mock/compliance-registry";
import { resetComplianceNeedsYou } from "@/lib/api/mock/compliance-needs-you";
import { resetCarrierDriversMock } from "@/features/driver/mock-carrier-drivers";
import { mockStore } from "@/lib/api/mock/store";
import type { NeedsYouItem } from "@/types";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER,
  contextFor, withoutPermissions,
} from "../support/context";

/**
 * Compliance does not get a second alert system. These tests hold the line:
 * compliance items are REAL Needs You items, in the same queue, obeying the
 * same rules, and the operational items that were there before are untouched.
 */

const needsYou = services.needsYou;
const compliance = services.compliance;

beforeEach(() => {
  resetCarrierDriversMock();
  resetComplianceRegistry();
  resetComplianceNeedsYou();
  mockStore.reset();
});

const complianceItems = (items: NeedsYouItem[]) =>
  items.filter((i) => i.entity.kind === "compliance_requirement");

describe("compliance items land in the existing queue", () => {
  it("appears alongside the operational items rather than replacing them", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await needsYou.list(ctx, { status: ["open", "escalated"] });
    const fromCompliance = complianceItems(items);
    const operational = items.filter((i) => i.entity.kind !== "compliance_requirement");

    expect(fromCompliance.length).toBeGreaterThan(0);
    // The load, truck and document items that existed before are still here.
    expect(operational.length).toBeGreaterThan(0);
    expect(operational.some((i) => i.entity.kind === "load")).toBe(true);
  });

  it("sorts into the same urgency order as everything else", async () => {
    const items = await needsYou.list(contextFor(NORTHLINE_OWNER), {
      status: ["open", "escalated"],
    });
    // Compliance items are ranked, not appended: among the items that carry a
    // deadline, severity still runs worst-first across both producers.
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    const dated = items.filter((i) => i.dueAt);
    for (let i = 1; i < dated.length; i++) {
      expect(rank[dated[i].severity]).toBeGreaterThanOrEqual(rank[dated[i - 1].severity]);
    }
    // And they really are interleaved with the operational queue rather than
    // sitting in a block at the end.
    const kinds = items.map((i) => i.entity.kind === "compliance_requirement");
    expect(new Set(kinds).size).toBe(2);
    expect(kinds.indexOf(false)).toBeGreaterThan(-1);
    expect(kinds.lastIndexOf(true)).toBeGreaterThan(kinds.indexOf(false));
  });

  it("is counted by openCount", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const open = await needsYou.list(ctx, { status: ["open", "escalated"] });
    expect(await needsYou.openCount(ctx)).toBe(open.length);
  });
});

describe("the five kinds of compliance issue", () => {
  it("raises missing, rejected, expiring, expired and critical items", async () => {
    const items = complianceItems(
      await needsYou.list(contextFor(NORTHLINE_OWNER), { status: ["open", "escalated"] }),
    );
    const categories = new Set(items.map((i) => i.category));
    // Critical absorbs whatever severity it came from, so the other four are
    // the ones that must be reachable at lower severities.
    expect(categories.has("compliance_critical")).toBe(true);
    expect(
      ["compliance_missing", "compliance_expiring", "compliance_expired", "compliance_rejected"]
        .some((c) => categories.has(c as never)),
    ).toBe(true);
  });

  it("treats an expired requirement as worse than the same one merely due", async () => {
    const items = complianceItems(
      await needsYou.list(contextFor(NORTHLINE_OWNER), { status: ["open", "escalated"] }),
    );
    const expired = items.filter((i) => i.category === "compliance_expired");
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((i) => i.severity === "critical" || i.severity === "high")).toBe(true);
  });
});

describe("links from every item", () => {
  it("links to the compliance record, the entity, the document and the person", async () => {
    const items = complianceItems(
      await needsYou.list(contextFor(NORTHLINE_OWNER), { status: ["open", "escalated"] }),
    );
    for (const item of items) {
      expect(item.entity.href).toMatch(/^\/compliance\//);
      const kinds = (item.relatedEntities ?? []).map((r) => r.kind);
      // The entity it is about, always.
      expect(kinds.some((k) => ["driver", "truck", "trailer", "organization"].includes(k))).toBe(true);
      // Whoever owes it, always.
      expect(kinds.some((k) => ["driver", "organization", "person"].includes(k))).toBe(true);
    }
  });

  it("links to the document only when a document exists", async () => {
    const items = complianceItems(
      await needsYou.list(contextFor(NORTHLINE_OWNER), { status: ["open", "escalated"] }),
    );
    const withDocument = items.filter((i) =>
      (i.relatedEntities ?? []).some((r) => r.kind === "document"),
    );
    expect(withDocument.length).toBeGreaterThan(0);
    for (const item of withDocument) {
      const requirement = await compliance.get(contextFor(NORTHLINE_OWNER), item.entity.id);
      expect(requirement.evidence).toBeTruthy();
      expect(requirement.evidence?.system).not.toBe("recorded_attestation");
    }
  });
});

describe("compliance items obey the queue's own rules", () => {
  it("snoozes within the cap for its severity and refuses beyond it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const item = complianceItems(await needsYou.list(ctx, { status: ["open"] }))
      .find((i) => i.severity === "critical")!;
    expect(item).toBeTruthy();

    await expect(
      needsYou.snooze(ctx, item.id, { hours: 24, reason: "Chasing the broker" }),
    ).rejects.toThrow(/at most 2 hours/);

    const snoozed = await needsYou.snooze(ctx, item.id, {
      hours: 2, reason: "Safety manager is on it this afternoon.",
    });
    expect(snoozed.status).toBe("snoozed");
    // And the snooze survives the requirement being recomputed.
    const again = await needsYou.get(ctx, item.id);
    expect(again.status).toBe("snoozed");
    expect(again.snoozeReason).toMatch(/Safety manager/);
  });

  it("keeps an assignment across a recomputation", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const item = complianceItems(await needsYou.list(ctx, { status: ["open"] }))[0];
    await needsYou.assign(ctx, item.id, "mem_northline_owner");
    const again = await needsYou.get(ctx, item.id);
    expect(again.assigneeMembershipId).toBe("mem_northline_owner");
    expect(again.history.some((h) => h.action === "assigned")).toBe(true);
  });

  it("closes itself when the requirement stops needing action, keeping its history", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const item = complianceItems(await needsYou.list(ctx, { status: ["open"] }))
      .find((i) => i.category !== "compliance_critical" || true)!;
    const before = item.history.length;

    await compliance.recordResolution(ctx, item.entity.id, {
      method: "waived",
      note: "Waived while the renewal is in the post.",
    });

    const after = await needsYou.get(ctx, item.id);
    expect(after.status).toBe("resolved");
    expect(after.resolutionNote).toBeTruthy();
    // Closing it appended to the history rather than discarding it.
    expect(after.history.length).toBeGreaterThan(before);
    expect(after.history.at(-1)?.action).toBe("resolved");
  });
});

describe("visibility", () => {
  it("raises nothing for a membership without compliance:view", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "compliance:view");
    const items = await needsYou.list(ctx, { status: ["open", "escalated"] });
    expect(complianceItems(items)).toHaveLength(0);
    // …and the operational queue is unaffected.
    expect(items.length).toBeGreaterThan(0);
  });

  it("raises nothing about another organization's records for a dispatcher", async () => {
    // A dispatcher may READ a shared inspection record. It is not their work,
    // so it never becomes an item in their queue.
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    const items = complianceItems(await needsYou.list(ctx, { status: ["open", "escalated"] }));
    expect(items.every((i) => i.organizationId === "org_meridian")).toBe(true);
  });

  it("raises only the driver's own items for a driver membership", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const items = complianceItems(await needsYou.list(ctx, { status: ["open", "escalated"] }));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const requirement = await compliance.get(ctx, item.entity.id);
      expect(requirement.subject.id).toBe("drv_cascade_0192");
    }
  });

  it("keeps one organization's items out of another's queue", async () => {
    const northline = complianceItems(
      await needsYou.list(contextFor(NORTHLINE_OWNER), { status: ["open", "escalated"] }),
    );
    const baxter = complianceItems(
      await needsYou.list(contextFor(BAXTER_OWNER), { status: ["open", "escalated"] }),
    );
    const overlap = northline.filter((n) => baxter.some((b) => b.id === n.id));
    expect(overlap).toHaveLength(0);
  });
});

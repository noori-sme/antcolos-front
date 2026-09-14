import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey, WorkspaceKind } from "@/types";
import type { ServiceContext } from "../contracts/context";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_USER } from "@/lib/session/fixtures";
import { effectivePermissions } from "@/lib/permissions/effective";
import { MOCK_TEMPLATES } from "@/lib/session/fixtures";
import { workspaceKindOf } from "@/types";
import { mockNeedsYouService } from "./needs-you";
import { mockHomeService } from "./home";
import { mockDocumentsService, resetDocumentCenter } from "./documents";
import { resetDocumentNeedsYou } from "./document-needs-you";
import { resetDocumentStore } from "./document-store";
import { resetTruckRegistry } from "./truck-registry";
import { resetTrailerRegistry } from "./trailer-registry";
import { mockStore } from "./store";

/** The real session fixtures, turned into service contexts the way the app does. */
function contextFor(membershipId: string): ServiceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId)!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
  return {
    organizationId: organization.id,
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization) as WorkspaceKind,
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization, MOCK_TEMPLATES) as ReadonlySet<PermissionKey>,
    actor: {
      userId: MOCK_USER.id,
      membershipId: membership.id,
      displayNameSnapshot: MOCK_USER.displayName,
      source: "web",
    },
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
  };
}

beforeEach(() => {
  mockStore.reset();
  resetDocumentStore();
  resetDocumentNeedsYou();
  resetDocumentCenter();
  resetTruckRegistry();
  resetTrailerRegistry();
});

describe("every membership in the fixtures works", () => {
  it("loads Home for every organization the user can switch into", async () => {
    for (const membership of MOCK_MEMBERSHIPS) {
      const ctx = contextFor(membership.id);
      // A missing data partition is a crash, not an empty screen.
      await expect(mockHomeService.summary(ctx)).resolves.toBeDefined();
    }
  });

  it("loads the Needs You queue for every membership", async () => {
    for (const membership of MOCK_MEMBERSHIPS) {
      const ctx = contextFor(membership.id);
      await expect(mockNeedsYouService.list(ctx, {})).resolves.toBeInstanceOf(Array);
      await expect(mockNeedsYouService.openCount(ctx)).resolves.toBeTypeOf("number");
    }
  });

  it("loads the Document Center for every membership that may see documents", async () => {
    for (const membership of MOCK_MEMBERSHIPS) {
      const ctx = contextFor(membership.id);
      if (!ctx.permissions.has("documents:view")) continue;
      await expect(mockDocumentsService.list(ctx, {})).resolves.toBeInstanceOf(Array);
      await expect(mockDocumentsService.workspaceChecklist(ctx)).resolves.toBeDefined();
    }
  });
});

describe("document items in the Needs You queue", () => {
  const northline = () => contextFor("mem_northline_owner");

  it("appears in the queue alongside the operational items", async () => {
    const ctx = northline();
    const items = await mockNeedsYouService.list(ctx, {});
    expect(items.some((i) => i.entity.kind === "document")).toBe(true);
    expect(items.some((i) => i.entity.kind !== "document")).toBe(true);
  });

  it("counts toward the open count the nav badge shows", async () => {
    const ctx = northline();
    const all = await mockNeedsYouService.list(ctx, { status: ["open", "escalated"] });
    const count = await mockNeedsYouService.openCount(ctx);
    expect(count).toBe(all.length);
    expect(count).toBeGreaterThan(0);
  });

  it("can be assigned, snoozed, unsnoozed, escalated, resolved and reopened", async () => {
    const ctx = northline();
    const item = (await mockNeedsYouService.list(ctx, {})).find((i) => i.entity.kind === "document")!;
    expect(item).toBeDefined();

    const assigned = await mockNeedsYouService.assign(ctx, item.id, "mem_northline_owner");
    expect(assigned.assigneeMembershipId).toBe("mem_northline_owner");

    const snoozed = await mockNeedsYouService.snooze(ctx, item.id, { hours: 1, reason: "Chasing the broker." });
    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.snoozeReason).toBe("Chasing the broker.");
    // The assignment survives the snooze: they are different facts.
    expect(snoozed.assigneeMembershipId).toBe("mem_northline_owner");

    const awake = await mockNeedsYouService.unsnooze(ctx, item.id);
    expect(awake.status).toBe("open");

    const escalated = await mockNeedsYouService.escalate(ctx, item.id, { note: "Blocking a load." });
    expect(escalated.status).toBe("escalated");

    const resolved = await mockNeedsYouService.resolve(ctx, item.id, "Renewed and filed.");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionNote).toBe("Renewed and filed.");

    const reopened = await mockNeedsYouService.reopen(ctx, item.id);
    expect(reopened.status).toBe("open");

    // Every action is in the history, in order.
    const actions = reopened.history.map((h) => h.action);
    expect(actions).toEqual([
      "created", "assigned", "snoozed", "unsnoozed", "escalated", "resolved", "reopened",
    ]);
  });

  it("keeps what a person did to it across reads", async () => {
    const ctx = northline();
    const item = (await mockNeedsYouService.list(ctx, {})).find((i) => i.entity.kind === "document")!;
    await mockNeedsYouService.snooze(ctx, item.id, { hours: 2, reason: "Waiting on the insurer." });

    const again = (await mockNeedsYouService.list(ctx, {})).find((i) => i.id === item.id)!;
    expect(again.status).toBe("snoozed");
    expect(again.snoozeReason).toBe("Waiting on the insurer.");
  });

  it("caps a snooze by severity, exactly as the operational items are capped", async () => {
    const ctx = northline();
    const critical = (await mockNeedsYouService.list(ctx, {}))
      .find((i) => i.entity.kind === "document" && i.severity === "critical")!;
    expect(critical).toBeDefined();
    await expect(
      mockNeedsYouService.snooze(ctx, critical.id, { hours: 48, reason: "Later." }),
    ).rejects.toThrow(/at most 2 hours/);
  });

  it("disappears from the queue once the document behind it is fixed", async () => {
    const ctx = northline();
    const missing = (await mockNeedsYouService.list(ctx, {}))
      .find((i) => i.entity.kind === "document" && /missing/i.test(i.title))!;
    expect(missing).toBeDefined();

    const checklist = await mockDocumentsService.workspaceChecklist(ctx);
    const gap = checklist.items.find((i) => i.status === "missing")!;
    await mockDocumentsService.addDocument(ctx, {
      typeKey: gap.requirement.typeKey,
      subject: { kind: "organization", id: ctx.organizationId, label: ctx.organizationName },
      requirementKey: gap.requirement.key,
      file: { name: "supplied.pdf", type: "application/pdf", size: 100 },
    });

    const after = await mockNeedsYouService.list(ctx, {});
    expect(after.find((i) => i.id === missing.id)).toBeUndefined();
  });

  it("does not put the carrier's own paperwork in a driver's queue", async () => {
    const ctx = contextFor("mem_cascade_driver");
    const items = await mockNeedsYouService.list(ctx, {});
    for (const item of items.filter((i) => i.entity.kind === "document")) {
      expect(item.entity.label).not.toMatch(/Cascade Haul$/);
    }
  });
});

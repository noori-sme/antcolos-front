import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import { auditLedger } from "@/lib/api/mock/audit-ledger";
import { projectionId } from "@/lib/audit/ingest";
import {
  BAXTER_OWNER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER, allEvents, audit,
  contextFor, resetAuditAndRisk, withOnly, withoutPermissions,
} from "./helpers";

/**
 * The ledger's whole value is that it cannot be edited. These tests are the
 * guard on that: not on how it renders, on whether an event can be changed.
 */

beforeEach(resetAuditAndRisk);

describe("the ledger is append-only", () => {
  it("exposes no way to update or delete an event", () => {
    const methods = Object.keys(audit);
    for (const forbidden of ["update", "delete", "remove", "purge", "edit"]) {
      expect(methods).not.toContain(forbidden);
    }
  });

  it("freezes every stored event, so a caller that holds one cannot rewrite it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const [event] = await allEvents(ctx);
    expect(Object.isFrozen(event)).toBe(true);
    // Frozen objects ignore writes in sloppy mode and throw in strict mode;
    // the modules are strict, so this throws. Either way the value stands.
    expect(() => {
      (event as { summary: string }).summary = "tampered";
    }).toThrow();
    const [again] = await allEvents(ctx);
    expect(again.summary).toBe(event.summary);
  });

  it("keeps the original intact when a correction is appended", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const before = await audit.get(ctx, "aev_seed_correction_target");
    expect(before.event.summary).toContain("118.4");

    const correction = await audit.correct(ctx, "aev_seed_correction_target", {
      reason: "The receipt reads 18.4 gallons.",
      changes: [{ field: "gallons", before: 118.4, after: 18.4 }],
    });

    const after = await audit.get(ctx, "aev_seed_correction_target");
    // The original still says what it always said.
    expect(after.event.summary).toBe(before.event.summary);
    expect(after.event.changes).toEqual(before.event.changes);
    // And the correction hangs off it, pointing back.
    expect(correction.correctsEventId).toBe("aev_seed_correction_target");
    expect(after.corrections.map((c) => c.id)).toContain(correction.id);
  });

  it("refuses a correction with no reason", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    await expect(
      audit.correct(ctx, "aev_seed_correction_target", { reason: "   " }),
    ).rejects.toThrow(/needs a reason/i);
  });

  it("treats correcting somebody else's event as investigative work", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const events = await allEvents(ctx);
    const somebodyElse = events.find((e) => e.membershipId !== ctx.membershipId)!;

    await expect(
      audit.correct(withoutPermissions(ctx, "risk:investigate"), somebodyElse.id, {
        reason: "Looks wrong to me.",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      audit.correct(ctx, somebodyElse.id, { reason: "Checked against the paperwork." }),
    ).resolves.toBeTruthy();
  });

  it("does not let an ending erase the history that led to it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    // One intent — ending a carrier relationship — that closed shares and froze
    // compliance records. Every step is still readable afterwards.
    const ended = (await allEvents(ctx)).find(
      (e) => e.action === "organization.relationship_ended",
    )!;
    const detail = await audit.get(ctx, ended.id);
    expect(detail.correlated.length).toBeGreaterThanOrEqual(2);
    expect(detail.correlated.some((e) => e.summary.includes("Nothing was deleted"))).toBe(true);
  });
});

describe("projection is idempotent and does not take ownership", () => {
  it("appends each module entry exactly once, however many times it is read", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const first = await allEvents(ctx);
    await allEvents(ctx);
    const third = await allEvents(ctx);
    // Reading three times adds nothing: the ledger id is derived from the
    // producing module plus its own entry id.
    expect(third.length).toBe(first.length);
    expect(new Set(third.map((e) => e.id)).size).toBe(third.length);
  });

  it("keeps the producing module's own record id and action key", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const projected = (await allEvents(ctx)).filter((e) => e.projection);
    expect(projected.length).toBeGreaterThan(0);
    for (const event of projected) {
      expect(event.projection!.recordId).toBeTruthy();
      expect(event.id).toBe(projectionId(event.projection!.module, event.projection!.entryId!));
      // The module's own vocabulary survives the projection.
      expect(event.sourceAction ?? "").not.toBe("");
    }
  });

  it("says which sources are mocks rather than letting an empty list imply nothing happened", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const sources = await audit.sources(ctx);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(typeof source.mock).toBe("boolean");
      expect(typeof source.readable).toBe("boolean");
    }
  });

  it("contributes nothing from a module the caller may not read", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const blind = withoutPermissions(ctx, "fuel:view");
    const sources = await audit.sources(blind);
    const fuel = sources.find((s) => s.module === "fuel")!;
    expect(fuel.readable).toBe(false);
  });
});

describe("organization scope", () => {
  it("never serves one organization's events through another", async () => {
    const northline = contextFor(NORTHLINE_OWNER);
    const baxter = contextFor(BAXTER_OWNER);

    const theirs = await allEvents(baxter);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((e) => e.organizationId === "org_baxter")).toBe(true);

    const ours = await allEvents(northline);
    expect(ours.every((e) => e.organizationId === "org_northline")).toBe(true);
    expect(ours.some((e) => theirs.some((t) => t.id === e.id))).toBe(false);
  });

  it("answers 'not found' for another organization's event, never 'forbidden'", async () => {
    const baxter = contextFor(BAXTER_OWNER);
    const theirs = (await allEvents(baxter))[0];
    // A 403 here would confirm the event exists, which is itself a disclosure.
    await expect(
      audit.get(contextFor(NORTHLINE_OWNER), theirs.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("writes an event into the acting organization and nowhere else", async () => {
    const meridian = contextFor(MERIDIAN_DISPATCHER);
    const event = await audit.record(meridian, {
      module: "documents",
      action: "documents.approved",
      entity: { kind: "document", id: "doc_x", label: "A document" },
      summary: "Approved a document",
    });
    expect(event.organizationId).toBe("org_meridian");
    expect(auditLedger.find("org_meridian", event.id)).toBeTruthy();
  });
});

describe("reading is gated; writing a refusal is not", () => {
  it("refuses the ledger without audit:view", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "audit:view");
    await expect(audit.list(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(audit.sources(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("records a refusal even for a membership that may read nothing", async () => {
    // The point: a ledger that needed permission to write down a refusal would
    // lose exactly the events somebody came looking for.
    const powerless = withOnly(contextFor(NORTHLINE_OWNER));
    const event = await audit.record(powerless, {
      module: "access",
      action: "access.permission_denied",
      outcome: "denied",
      entity: { kind: "settlement", id: "stl_x", label: "A settlement" },
      summary: "Tried to open a settlement",
      permissionContext: { required: ["settlements:view"], missing: ["settlements:view"] },
    });
    expect(event.outcome).toBe("denied");

    const owner = contextFor(NORTHLINE_OWNER);
    const found = (await allEvents(owner)).find((e) => e.id === event.id);
    expect(found).toBeTruthy();
  });

  it("gates export separately from reading, and records that one was prepared", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    await expect(
      audit.exportView(withoutPermissions(ctx, "audit:export")),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const view = await audit.exportView(ctx, { module: ["access"] });
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.notice).toMatch(/not certified/i);
    // Preparing an export is itself an audited act.
    const recorded = (await allEvents(ctx)).some((e) => e.action === "audit.export_prepared");
    expect(recorded).toBe(true);
  });
});

describe("filters, entity links and actor history", () => {
  it("reads back everything that happened to one record", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const page = await audit.forEntity(ctx, "trk_nl_118");
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    expect(page.items.every((e) =>
      e.entity.id === "trk_nl_118"
      || (e.relatedEntities ?? []).some((r) => r.id === "trk_nl_118"),
    )).toBe(true);
  });

  it("reads back everything one membership did", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const page = await audit.forActor(ctx, "mem_nl_dana");
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((e) => e.membershipId === "mem_nl_dana")).toBe(true);
  });

  it("pages without dropping or repeating an event", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const first = await audit.list(ctx, { limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).toBeTruthy();
    const second = await audit.list(ctx, { limit: 5, cursor: first.nextCursor });
    const ids = new Set([...first.items, ...second.items].map((e) => e.id));
    expect(ids.size).toBe(first.items.length + second.items.length);
  });

  it("every event carries a correlation id and its own request id", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const events = await allEvents(ctx);
    expect(events.every((e) => Boolean(e.correlationId))).toBe(true);
    const requestIds = events.map((e) => e.requestId);
    expect(new Set(requestIds).size).toBe(requestIds.length);
  });
});

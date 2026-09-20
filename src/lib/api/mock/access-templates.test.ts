import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { services } from "@/lib/api";
import { effectivePermissions } from "@/lib/permissions/effective";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { resetRoster, rosterSnapshot } from "@/lib/session/membership-store";
import { resetTemplateStore } from "./template-store";
import { resetMembershipDirectory } from "./membership-directory";
import { resetAccessStore } from "./access-store";
import { rosterOf } from "./access";
import type { ServiceContext } from "../contracts/context";
import type { Membership, PermissionKey } from "@/types";

/**
 * Roles as reusable templates — the flows an owner actually performs.
 *
 * ★ WHAT THESE TESTS ARE, AND ARE NOT ★
 * They assert the shape of a contract: that the same template applied twice
 * produces the same access twice, that editing it afterwards produces no change
 * for anybody, and that a person who cannot grant a permission cannot launder
 * it through a role. None of that is security — `ctx.permissions` is a set a
 * browser assembled, so a caller could simply pass a different one. The value
 * is that a server implementing this seam has an exact specification of which
 * refusals it owes and what each one must leave untouched.
 *
 * Every assertion about access goes through `effectivePermissions` over the
 * real Membership, so a test can never pass against a permission the product
 * would not actually grant.
 */

const NORTHLINE = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
const MERIDIAN = MOCK_ORGANIZATIONS.find((o) => o.id === "org_meridian")!;

function owner(): ServiceContext {
  return contextFor("org_northline");
}

function seat(membershipId: string): Membership {
  const found = rosterOf("org_northline").find((m) => m.id === membershipId);
  if (!found) throw new Error(`No seat ${membershipId}`);
  return found;
}

function can(membershipId: string): Set<PermissionKey> {
  return effectivePermissions(seat(membershipId), NORTHLINE);
}

/**
 * Two non-owner colleagues who start out with different access.
 *
 * Both already carry a seeded template — Paige is a Dispatcher, Tess is Safety
 * with her own extra grants — which is the realistic case and the awkward one:
 * a diff is only visible if the test picks permissions the person does not
 * already have. `EXTRA` below are keys the seeded Dispatcher template does not
 * contain, chosen so "added" and "removed" mean something for Paige.
 */
const PAIGE = "mem_northline_paige";      // Dispatcher
const TESS = "mem_northline_safety"; // Safety, with person-specific grants

beforeEach(() => {
  resetTemplateStore();
  resetAccessStore();
  resetRoster();
  resetMembershipDirectory();
});

/** Not in the seeded Dispatcher template, so a change to them is observable. */
const EXTRA: PermissionKey[] = ["customers:edit", "loads:export"];

async function createLimitedDispatcher(ctx = owner()) {
  const result = await services.access.createTemplate(ctx, {
    name: "Limited Dispatcher",
    description: "Moves freight. Never sees a rate.",
    permissions: [
      "loads:view", "loads:edit", "loads:status:update",
      "dispatch:view", "loads:assign",
      "drivers:view", "trucks:view", "documents:view",
      ...EXTRA,
    ],
  });
  if (result.status !== "saved") throw new Error(`Expected a saved template: ${result.message}`);
  return result.template;
}

describe("saving a role once and reusing it", () => {
  it("gives two different people the same permissions from one saved template", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);

    const first = await services.access.applyToMembership(ctx, PAIGE, template.id);
    const second = await services.access.applyToMembership(ctx, TESS, template.id);
    expect(first.status).toBe("applied");
    expect(second.status).toBe("applied");

    // The point of a template: the same selection reached two seats without
    // anybody ticking the same boxes twice.
    for (const key of template.permissions) {
      expect(can(PAIGE).has(key)).toBe(true);
      expect(can(TESS).has(key)).toBe(true);
    }

    // And both carry the same provenance, at the same version.
    for (const membershipId of [PAIGE, TESS]) {
      const applied = seat(membershipId).appliedTemplates
        .find((a) => a.templateId === template.id)!;
      expect(applied.templateName).toBe("Limited Dispatcher");
      expect(applied.version).toBe(1);
      expect(applied.appliedByMembershipId).toBe(ctx.membershipId);
    }
  });

  it("keeps what each person already had — a template adds, it does not replace", async () => {
    const ctx = owner();
    const before = new Set(can(TESS));
    const template = await createLimitedDispatcher(ctx);

    await services.access.applyToMembership(ctx, TESS, template.id);

    // Tess is Safety with her own extra grants. Applying a dispatcher template
    // must not have taken her compliance work away.
    for (const key of before) {
      expect(can(TESS).has(key)).toBe(true);
    }
    expect(can(TESS).has("compliance:manage")).toBe(true);
  });

  it("duplicates a template without carrying its people across", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);

    const copy = await services.access.duplicateTemplate(ctx, template.id);
    expect(copy.status).toBe("saved");
    if (copy.status !== "saved") return;
    expect(copy.template.name).toBe("Limited Dispatcher (copy)");
    expect(new Set(copy.template.permissions)).toEqual(new Set(template.permissions));
    expect(copy.template.version).toBe(1);

    const summaries = await services.access.templates(ctx);
    expect(summaries.find((s) => s.template.id === copy.template.id)!.memberCount).toBe(0);
    expect(summaries.find((s) => s.template.id === template.id)!.memberCount).toBe(1);
  });
});

describe("editing a saved template", () => {
  it("changes nobody's access, for either person holding it", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);
    await services.access.applyToMembership(ctx, TESS, template.id);

    const paigeBefore = new Set(can(PAIGE));
    const tessBefore = new Set(can(TESS));

    // A substantial edit: something added, something taken away.
    const edited = await services.access.updateTemplate(ctx, template.id, {
      name: "Limited Dispatcher",
      description: "Moves freight. Never sees a rate.",
      permissions: [
        "loads:view", "loads:status:update", "dispatch:view",
        "drivers:view", "trucks:view", "documents:view",
        // `customers:edit` and `loads:export` dropped, `drivers:edit` added.
        "drivers:edit",
      ],
    });
    expect(edited.status).toBe("saved");
    if (edited.status !== "saved") return;
    expect(edited.template.version).toBe(2);

    // ★ THE PROMISE ★ Not "mostly the same" — identical, for both of them.
    expect(can(PAIGE)).toEqual(paigeBefore);
    expect(can(TESS)).toEqual(tessBefore);
    // Including the permissions the edit removed, and excluding the one it added.
    expect(can(PAIGE).has("customers:edit")).toBe(true);
    expect(can(PAIGE).has("loads:export")).toBe(true);
    expect(can(PAIGE).has("drivers:edit")).toBe(false);

    // The seats still say which version they are on, so the difference is
    // visible rather than silent.
    for (const membershipId of [PAIGE, TESS]) {
      expect(
        seat(membershipId).appliedTemplates.find((a) => a.templateId === template.id)!.version,
      ).toBe(1);
    }
    const summary = (await services.access.templates(ctx))
      .find((s) => s.template.id === template.id)!;
    expect(summary.memberCount).toBe(2);
    expect(summary.behindCount).toBe(2);
  });

  it("does not bump the version when only the wording changed", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);

    const renamed = await services.access.updateTemplate(ctx, template.id, {
      name: "Night dispatcher",
      description: "Covers the overnight desk.",
      permissions: [...template.permissions],
    });
    expect(renamed.status).toBe("saved");
    if (renamed.status !== "saved") return;
    // Nobody's access depends on the name, so nobody is asked to review a
    // change to it.
    expect(renamed.template.version).toBe(1);
    expect(
      (await services.access.templates(ctx))
        .find((s) => s.template.id === template.id)!.behindCount,
    ).toBe(0);
  });

  it("moves one person onto the new version and leaves the other exactly as they were", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);
    await services.access.applyToMembership(ctx, TESS, template.id);
    const tessBefore = new Set(can(TESS));

    await services.access.updateTemplate(ctx, template.id, {
      name: "Limited Dispatcher",
      description: "Now edits drivers too.",
      permissions: [...template.permissions, "drivers:edit"],
    });

    // The preview says what will happen, before anything does.
    const preview = await services.access.previewApplication(ctx, PAIGE, template.id);
    expect(preview).not.toBeNull();
    expect(preview!.added).toEqual(["drivers:edit"]);
    expect(preview!.removed).toEqual([]);

    const applied = await services.access.applyToMembership(ctx, PAIGE, template.id);
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    // The preview and the outcome are the same value, not two descriptions.
    expect(applied.diff.added).toEqual(preview!.added);
    expect(applied.diff.removed).toEqual(preview!.removed);

    expect(can(PAIGE).has("drivers:edit")).toBe(true);
    // Tess was not part of this act and is untouched by it.
    expect(can(TESS)).toEqual(tessBefore);
    expect(can(TESS).has("drivers:edit")).toBe(false);
    expect(
      seat(TESS).appliedTemplates.find((a) => a.templateId === template.id)!.version,
    ).toBe(1);
  });

  it("replaces the seat's entry rather than stacking two versions of one template", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);

    await services.access.updateTemplate(ctx, template.id, {
      name: "Limited Dispatcher",
      description: "Smaller.",
      // Both EXTRA keys are gone.
      permissions: ["loads:view", "loads:status:update", "dispatch:view"],
    });
    await services.access.applyToMembership(ctx, PAIGE, template.id);

    const entries = seat(PAIGE).appliedTemplates.filter((a) => a.templateId === template.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe(2);
    // A union of both versions would have kept these, which is the whole point:
    // a permission removed in v2 must actually go. `loads:view` stays, because
    // Paige's seeded Dispatcher template carries it independently — an applied
    // template is removed from, not subtracted from the person.
    for (const key of EXTRA) expect(can(PAIGE).has(key)).toBe(false);
    expect(can(PAIGE).has("loads:view")).toBe(true);
  });
});

describe("what an unauthorized person cannot do", () => {
  /** Somebody who may manage roles and members but is not an owner. */
  function delegate(extra: PermissionKey[] = []): ServiceContext {
    return contextFor("org_northline", {
      permissions: [
        "members:view", "members:edit", "permissions:manage",
        "loads:view", "loads:edit", "documents:view",
        ...extra,
      ],
    });
  }

  it("refuses to save a role containing a permission the author does not hold", async () => {
    const ctx = delegate();
    const result = await services.access.createTemplate(ctx, {
      name: "Quietly powerful",
      description: "",
      // They hold neither.
      permissions: ["loads:view", "revenue:view", "settlements:pay"],
    });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusal).toBe("escalation");

    // Refused outright, not saved in a trimmed form: a template silently
    // shorter than what somebody ticked is one they hand out believing it does
    // something it does not.
    const saved = await services.access.templates(ctx);
    expect(saved.some((s) => s.template.name === "Quietly powerful")).toBe(false);
  });

  it("withholds the parts of an owner's role the applier does not hold", async () => {
    // The owner writes a role carrying money access.
    const rich = await services.access.createTemplate(owner(), {
      name: "Desk with books",
      description: "",
      permissions: ["loads:view", "documents:view", "revenue:view", "rates:view"],
    });
    if (rich.status !== "saved") throw new Error("setup");

    // A delegate without money access applies it.
    const ctx = delegate();
    const preview = await services.access.previewApplication(ctx, PAIGE, rich.template.id);
    expect(preview!.withheld).toEqual(["rates:view", "revenue:view"]);

    const result = await services.access.applyToMembership(ctx, PAIGE, rich.template.id);
    expect(result.status).toBe("applied");
    // The seat receives the intersection. The money keys never arrive.
    expect(can(PAIGE).has("documents:view")).toBe(true);
    expect(can(PAIGE).has("revenue:view")).toBe(false);
    expect(can(PAIGE).has("rates:view")).toBe(false);
  });

  it("refuses somebody without permissions:manage outright", async () => {
    const ctx = contextFor("org_northline", {
      permissions: ["members:view", "members:edit", "loads:view"],
    });
    const template = await createLimitedDispatcher();

    expect((await services.access.templates(ctx))).toEqual([]);
    const created = await services.access.createTemplate(ctx, {
      name: "Not allowed", description: "", permissions: ["loads:view"],
    });
    expect(created.status).toBe("refused");
    if (created.status === "refused") expect(created.refusal).toBe("not_permitted");

    const applied = await services.access.applyToMembership(ctx, PAIGE, template.id);
    expect(applied.status).toBe("refused");
    if (applied.status === "refused") expect(applied.refusal).toBe("not_permitted");
  });

  it("refuses an application to the applier's own seat", async () => {
    const ctx = delegate();
    const template = await createLimitedDispatcher();
    const result = await services.access.applyToMembership(ctx, ctx.membershipId, template.id);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    // Clamping would make this a no-op that looked like it worked. It is the
    // shortest path from `permissions:manage` to every permission there is.
    expect(result.refusal).toBe("self_escalation");
  });

  it("refuses to reach a seat in another organization", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    const meridianSeat = rosterSnapshot("demo").memberships
      .find((m) => m.organizationId === MERIDIAN.id && !m.isOwner)!;

    const result = await services.access.applyToMembership(ctx, meridianSeat.id, template.id);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusal).toBe("cross_organization");

    // Nothing was written to that seat, and Northline's template never reached
    // Meridian's workspace.
    const after = rosterSnapshot("demo").memberships.find((m) => m.id === meridianSeat.id)!;
    expect(after.appliedTemplates.some((a) => a.templateId === template.id)).toBe(false);
    expect(effectivePermissions(after, MERIDIAN))
      .toEqual(effectivePermissions(meridianSeat, MERIDIAN));
  });

  it("does not let a template in one organization be read from another", async () => {
    const template = await createLimitedDispatcher(owner());
    const meridian = contextFor("org_meridian");
    const summaries = await services.access.templates(meridian);
    expect(summaries.some((s) => s.template.id === template.id)).toBe(false);
  });

  it("refuses to put a role on an owner seat", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    const anotherOwner = rosterOf("org_northline").find(
      (m) => m.isOwner && m.id !== ctx.membershipId,
    ) ?? seat(ctx.membershipId);

    const result = await services.access.applyToMembership(ctx, anotherOwner.id, template.id);
    expect(result.status).toBe("refused");
  });

  it("refuses to hand out an archived role, and takes nothing from its holders", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);
    const paigeBefore = new Set(can(PAIGE));

    await services.access.setTemplateArchived(ctx, template.id, true);

    // Archiving is not a revocation.
    expect(can(PAIGE)).toEqual(paigeBefore);

    const result = await services.access.applyToMembership(ctx, TESS, template.id);
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("archived");
  });
});

describe("a role in a dispatch organization is not a way into a carrier", () => {
  /**
   * ★ TWO SEPARATE BASES, AND A ROLE IS ONLY ONE OF THEM ★
   *
   * A dispatch agency working a carrier's freight holds that reach per TRUCK,
   * as a `TruckDispatchAccess` the carrier granted. A permission says what a
   * seat may do inside its own workspace; it never says whose records it
   * reaches. So a dispatch organization's owner writing themselves the most
   * generous role they can still gets nothing of the carrier's, and the
   * permission that comes closest — precise locations — is documented as
   * necessary and not sufficient.
   */
  it("cannot write a role that reaches another organization's records", async () => {
    const summit = contextFor("org_summit");
    const created = await services.access.createTemplate(summit, {
      name: "Everything we can have",
      description: "As generous as a dispatch workspace allows.",
      permissions: [...summit.permissions],
    });
    expect(created.status).toBe("saved");
    if (created.status !== "saved") return;

    // Carrier-only keys are not in the catalog for this workspace, so they are
    // not in the template either — there was no value to pass that would have
    // put them there.
    for (const carrierOnly of ["trucks:create", "trailers:create", "eld:devices:manage"] as PermissionKey[]) {
      expect(created.template.permissions).not.toContain(carrierOnly);
    }

    // And the one key that does touch a carrier's trucks carries the caveat in
    // the catalog itself, rather than in a comment on a screen.
    const { permissionMeta } = await import("@/lib/permissions");
    expect(permissionMeta("eld:location:precise:view").scopeNote)
      .toMatch(/per-truck Dispatch delegation/);
  });

  it("cannot apply its role to anybody in the carrier it dispatches for", async () => {
    const summit = contextFor("org_summit");
    const created = await services.access.createTemplate(summit, {
      name: "Reach across", description: "", permissions: ["loads:view"],
    });
    if (created.status !== "saved") throw new Error("setup");

    const carrierSeat = rosterOf("org_northline").find((m) => !m.isOwner)!;
    const before = effectivePermissions(carrierSeat, NORTHLINE);

    const result = await services.access.applyToMembership(
      summit, carrierSeat.id, created.template.id,
    );
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("cross_organization");
    expect(effectivePermissions(seat(carrierSeat.id), NORTHLINE)).toEqual(before);
  });
});

describe("what deleting a template may not do", () => {
  it("refuses while people hold it, and offers the count", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    await services.access.applyToMembership(ctx, PAIGE, template.id);

    const result = await services.access.deleteTemplate(ctx, template.id);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusal).toBe("in_use");
    expect(result.memberCount).toBe(1);
  });

  it("refuses to delete one that came with the workspace", async () => {
    const ctx = owner();
    const seeded = (await services.access.templates(ctx))
      .find((s) => s.template.seeded && s.template.name === "Dispatcher")!;
    const result = await services.access.deleteTemplate(ctx, seeded.template.id);
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("reserved");
  });

  it("refuses to edit, archive or recreate Owner", async () => {
    const ctx = owner();
    const ownerTemplate = (await services.access.templates(ctx))
      .find((s) => s.template.name === "Owner")!;

    const edited = await services.access.updateTemplate(ctx, ownerTemplate.template.id, {
      name: "Owner", description: "hm", permissions: ["loads:view"],
    });
    expect(edited.status).toBe("refused");
    if (edited.status === "refused") expect(edited.refusal).toBe("reserved");

    const archived = await services.access.setTemplateArchived(ctx, ownerTemplate.template.id, true);
    expect(archived.status).toBe("refused");

    const recreated = await services.access.createTemplate(ctx, {
      name: "owner", description: "", permissions: ["loads:view"],
    });
    expect(recreated.status).toBe("refused");
    if (recreated.status === "refused") expect(recreated.refusal).toBe("reserved");
  });
});

describe("person-specific adjustments stay person-specific", () => {
  it("shows a revocation that will hide part of the role, and honours it", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);

    // Tess has person-specific grants in the fixtures; give the case a
    // revocation too, written the way the product writes one.
    const tess = seat(TESS);
    const { writeSeatAccess } = await import("./access");
    writeSeatAccess(tess, { revocations: [...tess.revocations, "loads:assign"] });

    const preview = await services.access.previewApplication(ctx, TESS, template.id);
    expect(preview!.adjustments.revocations).toContain("loads:assign");
    expect(preview!.adjustments.revocationsHidingTemplate).toContain("loads:assign");
    expect(preview!.added).not.toContain("loads:assign");

    await services.access.applyToMembership(ctx, TESS, template.id);
    // A revocation beats anything a role brings, which is what lets an owner
    // apply a template and still keep one thing away from one person.
    expect(can(TESS).has("loads:assign")).toBe(false);
    expect(can(TESS).has("loads:edit")).toBe(true);
  });

  it("leaves the adjustments in place when a template is taken back off", async () => {
    const ctx = owner();
    const template = await createLimitedDispatcher(ctx);
    const grantsBefore = [...seat(TESS).grants];
    await services.access.applyToMembership(ctx, TESS, template.id);

    const removed = await services.access.removeFromMembership(ctx, TESS, template.id);
    expect(removed.status).toBe("removed");
    expect(seat(TESS).grants).toEqual(grantsBefore);
    expect(seat(TESS).appliedTemplates.some((a) => a.templateId === template.id)).toBe(false);
  });
});

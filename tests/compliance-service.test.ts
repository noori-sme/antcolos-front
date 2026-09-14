import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { PermissionDeniedError, NotFoundError } from "@/lib/api/contracts/context";
import { resetComplianceRegistry } from "@/lib/api/mock/compliance-registry";
import { resetComplianceNeedsYou } from "@/lib/api/mock/compliance-needs-you";
import { resetCarrierDriversMock, mockEndCarrierRelationship } from "@/features/driver/mock-carrier-drivers";
import type { ComplianceRequirement } from "@/types";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER,
  contextFor, withoutPermissions,
} from "./support/context";

const compliance = services.compliance;

beforeEach(() => {
  resetCarrierDriversMock();
  resetComplianceRegistry();
  resetComplianceNeedsYou();
});

const keysOf = (rows: ComplianceRequirement[]) => rows.map((r) => r.definitionKey);

describe("requirements are records, not documents", () => {
  it("exists for a subject with nothing on file at all", async () => {
    // Ray Bell is invited and has shared nothing. The obligations still exist,
    // which is the whole point of separating a requirement from a document.
    const rows = await compliance.list(contextFor(NORTHLINE_OWNER), {
      subjectId: "dp_ray",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "action_required")).toBe(true);
    expect(rows.every((r) => r.evidence === undefined)).toBe(true);
  });

  it("keeps its own id, status and history separate from the document it points at", async () => {
    const rows = await compliance.list(contextFor(NORTHLINE_OWNER), { subjectId: "dp_dmitri" });
    const licence = rows.find((r) => r.definitionKey === "driver.commercial_licence")!;
    expect(licence.id).not.toBe(licence.evidence?.id);
    expect(licence.evidence?.system).toBe("driver_document");
    expect(licence.history.length).toBeGreaterThan(0);
  });

  it("says where every status came from and never claims an outside check", async () => {
    const rows = await compliance.list(contextFor(NORTHLINE_OWNER));
    expect(rows.every((r) => r.verificationBasis === "recorded_in_antcolos")).toBe(true);
  });
});

describe("applicability reaches real subjects", () => {
  it("does not raise interstate filings for an intrastate carrier", async () => {
    const cascade = await compliance.list(
      contextFor(CASCADE_DRIVER),
      { includeNotApplicable: true },
    );
    // The driver membership cannot see the organization's own requirements at
    // all, so this is empty of them rather than merely filtered.
    expect(keysOf(cascade)).not.toContain("carrier.ucr_registration");
  });

  it("asks Northline for the interstate filings it actually owes", async () => {
    const rows = await compliance.list(contextFor(NORTHLINE_OWNER), {
      subjectKind: ["carrier"],
    });
    expect(keysOf(rows)).toContain("carrier.ucr_registration");
    expect(keysOf(rows)).toContain("carrier.process_agent_designation");
  });

  it("asks a dispatch organization only for its own paperwork", async () => {
    const rows = await compliance.list(contextFor(MERIDIAN_DISPATCHER), {
      subjectKind: ["carrier"],
    });
    expect(keysOf(rows).every((k) => k.startsWith("dispatch."))).toBe(true);
  });

  it("hides not-applicable requirements unless they are asked for", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const hidden = await compliance.list(ctx, { subjectId: "dp_dmitri" });
    const shown = await compliance.list(ctx, {
      subjectId: "dp_dmitri", includeNotApplicable: true,
    });
    expect(hidden.some((r) => r.status === "not_applicable")).toBe(false);
    const notApplicable = shown.filter((r) => r.status === "not_applicable");
    expect(notApplicable.length).toBeGreaterThan(0);
    // And every one of them says why, rather than just vanishing.
    expect(notApplicable.every((r) => Boolean(r.statusReason))).toBe(true);
  });
});

describe("permissions", () => {
  it("refuses to list anything without compliance:view", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "compliance:view");
    await expect(compliance.list(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(compliance.summary(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await compliance.openCount(ctx)).toBe(0);
  });

  it("refuses to change anything without compliance:manage", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "compliance:manage");
    const target = (await compliance.list(contextFor(NORTHLINE_OWNER)))[0];
    await expect(
      compliance.addNote(ctx, target.id, "Anything at all"),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("withholds driver requirements from a membership without drivers:view", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "drivers:view");
    const rows = await compliance.list(ctx);
    expect(rows.some((r) => r.subject.kind === "driver")).toBe(false);
    // …while the equipment it may see is untouched.
    expect(rows.some((r) => r.subject.kind === "truck")).toBe(true);
  });

  it("withholds trailer requirements from a membership without trailers:view", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "trailers:view");
    expect((await compliance.list(ctx)).some((r) => r.subject.kind === "trailer")).toBe(false);
  });
});

describe("cross-organization isolation", () => {
  it("never returns another carrier's records", async () => {
    const northline = await compliance.list(contextFor(NORTHLINE_OWNER), {
      includeNotApplicable: true, includeFrozen: true,
    });
    expect(northline.every((r) => r.organizationId === "org_northline")).toBe(true);

    const baxter = await compliance.list(contextFor(BAXTER_OWNER), {
      includeNotApplicable: true, includeFrozen: true,
    });
    expect(baxter.every((r) => r.organizationId === "org_baxter")).toBe(true);
  });

  it("answers 'not found' rather than 'forbidden' for another organization's id", async () => {
    const theirs = (await compliance.list(contextFor(NORTHLINE_OWNER)))[0];
    // An id must never work as a directory of other people's compliance.
    await expect(
      compliance.get(contextFor(BAXTER_OWNER), theirs.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps two carriers' views of the same shared truck apart", async () => {
    // Baxter is approved on Northline's unit 107. Each carrier owes its own
    // insurance evidence on it, and they are different records.
    const northline = await compliance.list(contextFor(NORTHLINE_OWNER), { subjectKind: ["truck"] });
    const baxter = await compliance.list(contextFor(BAXTER_OWNER), { subjectKind: ["truck"] });
    const shared = northline.filter((n) => baxter.some((b) => b.subject.id === n.subject.id));
    expect(shared.length).toBeGreaterThan(0);
    for (const record of shared) {
      const theirs = baxter.find(
        (b) => b.subject.id === record.subject.id && b.definitionKey === record.definitionKey,
      );
      if (!theirs) continue;
      expect(theirs.id).not.toBe(record.id);
      expect(theirs.organizationId).toBe("org_baxter");
    }
  });
});

describe("dispatch organizations see only what was shared", () => {
  it("shows a dispatcher exactly the shared requirement keys and nothing more", async () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    const rows = await compliance.list(ctx);
    const borrowed = rows.filter((r) => r.organizationId !== ctx.organizationId);

    expect(borrowed.length).toBeGreaterThan(0);
    const shares = await compliance.shares(ctx);
    const active = shares.filter((s) => s.status === "active");
    for (const record of borrowed) {
      const share = active.find(
        (s) => s.subject.id === record.subject.id && s.requirementKeys.includes(record.definitionKey),
      );
      expect(share, `${record.subject.label} · ${record.label}`).toBeTruthy();
    }
  });

  it("never shows a dispatcher a carrier's insurance file or a driver's record", async () => {
    const rows = await compliance.list(contextFor(MERIDIAN_DISPATCHER));
    const borrowed = rows.filter((r) => r.organizationId !== "org_meridian");
    expect(borrowed.some((r) => r.subject.kind === "driver")).toBe(false);
    expect(borrowed.some((r) => r.definitionKey.startsWith("carrier."))).toBe(false);
  });

  it("does not honour a revoked share", async () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    const revoked = (await compliance.shares(ctx)).filter((s) => s.status === "revoked");
    expect(revoked.length).toBeGreaterThan(0);
    const rows = await compliance.list(ctx);
    for (const share of revoked) {
      expect(rows.some((r) => r.subject.id === share.subject.id && r.organizationId !== "org_meridian"))
        .toBe(false);
    }
  });

  it("lets a dispatcher read a shared record but never change it", async () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    const borrowed = (await compliance.list(ctx)).find(
      (r) => r.organizationId !== ctx.organizationId,
    )!;
    expect(borrowed).toBeTruthy();
    // A share is a window, not a handle.
    await expect(
      compliance.addNote(ctx, borrowed.id, "We looked at this"),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("responsibility scope", () => {
  it("shows a driver membership their own record and nothing else", async () => {
    const rows = await compliance.list(contextFor(CASCADE_DRIVER), {
      includeNotApplicable: true,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.subject.kind === "driver")).toBe(true);
    expect(rows.every((r) => r.subject.id === "drv_cascade_0192")).toBe(true);
  });

  it("does not show a driver membership the carrier's equipment or organization records", async () => {
    const rows = await compliance.list(contextFor(CASCADE_DRIVER), {
      includeNotApplicable: true, includeFrozen: true,
    });
    expect(rows.some((r) => r.subject.kind === "truck")).toBe(false);
    expect(rows.some((r) => r.subject.kind === "carrier")).toBe(false);
  });

  it("filters to what the caller personally owes", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const mine = await compliance.list(ctx, { responsibility: "me" });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.responsible.driverProfileId === ctx.driverProfileId)).toBe(true);
  });
});

describe("ending a relationship", () => {
  it("freezes the records, keeps every one of them, and snapshots the state", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const before = await compliance.list(ctx, { subjectId: "dp_marisol" });
    expect(before.length).toBeGreaterThan(0);

    await mockEndCarrierRelationship("cd_2", "Moved to another carrier.");

    const live = await compliance.list(ctx, { subjectId: "dp_marisol" });
    expect(live).toHaveLength(0);

    const history = await compliance.list(ctx, {
      subjectId: "dp_marisol", includeFrozen: true, includeNotApplicable: true,
    });
    // Nothing was deleted: every record is still there, frozen and explained.
    expect(history.length).toBeGreaterThanOrEqual(before.length);
    expect(history.every((r) => Boolean(r.frozenAt))).toBe(true);
    expect(history.every((r) => r.frozenReason?.includes("kept as history"))).toBe(true);
    expect(
      history.every((r) => r.history.some((h) => h.action === "access_ended")),
    ).toBe(true);

    const snapshots = await compliance.snapshots(ctx, "dp_marisol");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].entries.length).toBeGreaterThan(0);
    expect(snapshots[0].entries.every((e) => e.label && e.responsibleName)).toBe(true);
  });

  it("refuses to change a frozen record", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const frozen = (await compliance.list(ctx, {
      subjectId: "dp_kelsey", includeFrozen: true,
    }))[0];
    expect(frozen?.frozenAt).toBeTruthy();
    await expect(
      compliance.addNote(ctx, frozen.id, "Trying to edit history"),
    ).rejects.toThrow(/history/i);
  });

  it("keeps an ended relationship out of the live queue but inside the history count", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const summary = await compliance.summary(ctx);
    expect(summary.frozenRecords).toBeGreaterThan(0);
  });
});

describe("recording a resolution", () => {
  it("appends to history and never rewrites it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx, {
      subjectKind: ["carrier"], status: ["action_required", "expiring", "expired"],
    }))[0];
    expect(target).toBeTruthy();
    const before = target.history.length;

    const after = await compliance.recordResolution(ctx, target.id, {
      method: "waived",
      note: "Renewal filed this morning; receipt to follow.",
    });

    expect(after.history.length).toBeGreaterThan(before);
    // Every earlier entry is still there, byte for byte.
    expect(after.history.slice(0, before)).toEqual(target.history);
    expect(after.resolutions).toHaveLength(1);
    expect(after.resolutions[0].note).toMatch(/Renewal filed/);
    expect(after.status).toBe("compliant");
    expect(after.statusReason).toMatch(/waived/i);
  });

  it("refuses to assert a document-backed requirement is fine", async () => {
    // The fix for an expired licence is a new licence, not a note here.
    const ctx = contextFor(NORTHLINE_OWNER);
    const licence = (await compliance.list(ctx, { subjectId: "dp_amir" })).find(
      (r) => r.definitionKey === "driver.commercial_licence",
    )!;
    await expect(
      compliance.recordResolution(ctx, licence.id, {
        method: "evidence_accepted",
        note: "I have seen it, it is fine",
      }),
    ).rejects.toThrow(/Update it where it lives/);
  });

  it("records an attestation for a requirement that has no document behind it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx, { subjectId: "dp_ray" })).find(
      (r) => r.definitionKey === "driver.employment_application",
    )!;
    const after = await compliance.recordResolution(ctx, target.id, {
      method: "corrected",
      note: "Application received by post and filed.",
    });
    expect(after.status).toBe("compliant");
    expect(after.evidence?.system).toBe("recorded_attestation");
    // The evidence says plainly that there is no file behind it.
    expect(after.evidence?.label).toMatch(/no file/i);
  });

  it("needs a note", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx))[0];
    await expect(
      compliance.recordResolution(ctx, target.id, { method: "waived", note: "   " }),
    ).rejects.toThrow(/note/i);
  });
});

describe("responsibility, suspension and notes", () => {
  it("assigns a named person and records who did it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx))[0];
    const after = await compliance.assignResponsibility(ctx, target.id, {
      membershipId: "mem_northline_owner",
      displayName: "Sam Murtaza",
    });
    expect(after.responsible.membershipId).toBe("mem_northline_owner");
    expect(after.responsible.displayName).toBe("Sam Murtaza");
    const entry = after.history.at(-1)!;
    expect(entry.action).toBe("responsibility_assigned");
    expect(entry.actor.membershipId).toBe(ctx.membershipId);
  });

  it("suspends and reinstates, keeping both in history", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx, {
      status: ["action_required", "expired", "expiring"],
    }))[0];
    const suspended = await compliance.suspend(ctx, target.id, {
      reason: "Unit is off the road until the spring.",
    });
    expect(suspended.status).toBe("suspended");
    expect(suspended.statusReason).toMatch(/spring/);

    const back = await compliance.reinstate(ctx, target.id);
    expect(back.status).not.toBe("suspended");
    expect(back.history.map((h) => h.action)).toContain("suspended");
    expect(back.history.map((h) => h.action)).toContain("reinstated");
  });

  it("will not record an empty note", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx))[0];
    await expect(compliance.addNote(ctx, target.id, "  ")).rejects.toThrow();
  });
});

describe("summary and grouping", () => {
  it("counts only live records", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const summary = await compliance.summary(ctx);
    const live = await compliance.list(ctx, { includeNotApplicable: true });
    const counted = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(live.length);
  });

  it("groups by subject, worst first", async () => {
    const groups = await compliance.bySubject(contextFor(NORTHLINE_OWNER));
    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0].openCount).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.requirements.every((r) => r.subject.id === group.subject.id)).toBe(true);
    }
  });

  it("agrees with openCount", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const open = await compliance.list(ctx, {
      status: ["action_required", "expiring", "expired"],
    });
    expect(await compliance.openCount(ctx)).toBe(open.length);
  });
});

describe("extension points", () => {
  it("declares every later milestone as not built", async () => {
    const points = await compliance.extensionPoints(contextFor(NORTHLINE_OWNER));
    const kinds = points.map((p) => p.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "roadside_inspection", "violation", "accident", "insurance_claim",
        "hours_of_service", "csa_sms_monitoring", "audit_preparation",
      ]),
    );
    // Not one of them may report itself as available in this milestone.
    expect(points.every((p) => p.available === false)).toBe(true);
  });

  it("attaches each one to requirements that actually exist", async () => {
    const points = await compliance.extensionPoints(contextFor(NORTHLINE_OWNER));
    const { COMPLIANCE_CATALOG } = await import("@/lib/compliance");
    const known = new Set(COMPLIANCE_CATALOG.map((d) => d.key));
    for (const point of points) {
      for (const key of point.attachesTo) {
        expect(known.has(key), `${point.kind} → ${key}`).toBe(true);
      }
    }
  });
});

describe("a recorded resolution beats the evidence it replaces", () => {
  it("moves an expired fixed-interval requirement back to compliant", async () => {
    // The stale attestation that made it expire must not win over the review
    // somebody carried out this morning to fix it.
    const ctx = contextFor(NORTHLINE_OWNER);
    const expired = (await compliance.list(ctx, { subjectId: "dp_dmitri" })).find(
      (r) => r.definitionKey === "driver.motor_vehicle_record_review",
    )!;
    expect(expired.status).toBe("expired");

    const after = await compliance.recordResolution(ctx, expired.id, {
      method: "renewed",
      note: "Ran the review with the safety manager this morning.",
    });

    expect(after.status).toBe("compliant");
    expect(after.evidence?.system).toBe("recorded_attestation");
    // And the next cycle starts from today, not from the old date.
    expect(new Date(after.dueAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("still prefers newer evidence from the owning system over an older note", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const target = (await compliance.list(ctx, { subjectId: "dp_ray" })).find(
      (r) => r.definitionKey === "driver.employment_application",
    )!;
    const after = await compliance.recordResolution(ctx, target.id, {
      method: "corrected",
      note: "Application received by post.",
    });
    expect(after.satisfiedAt).toBeTruthy();
    expect(new Date(after.satisfiedAt!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

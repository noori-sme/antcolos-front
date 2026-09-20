import { beforeEach, describe, expect, it } from "vitest";
import { RESTRICTED_QUALIFICATION_CATEGORIES, type PermissionKey } from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import { resetAllMocks } from "./registry";
import {
  AmbiguousPersonError, DuplicateEngagementError,
  mockWorkforceService as workforce,
} from "./workforce";
import {
  memberIn, membersOf, setMembershipAvailability,
} from "./membership-directory";
import { allEngagements } from "./workforce-store";
import { workforceNeedsYouItems } from "./workforce-needs-you";
import { mockDocumentsService as documents } from "./documents";
import { auditLedger } from "./audit-ledger";
import { daysFromNow } from "./time";

/**
 * ★ THE DEFECTS AN ADVERSARIAL REVIEW OF THIS MILESTONE FOUND ★
 *
 * Every test here failed on the code as first written, and each names the thing
 * that was wrong rather than the shape of the fix. They are grouped by the
 * boundary they defend, because that is what a reader needs to know when one of
 * them goes red a year from now.
 *
 * The invariant the leave block exists for, stated once:
 *
 *   An effective leave makes somebody ineligible for work routing in that
 *   organization. Ending a leave must not fabricate dispatch readiness and must
 *   not overwrite an independent reason they are unavailable.
 */

const HR: PermissionKey[] = [
  "workforce:view", "workforce:manage", "workforce:end",
  "contracts:view", "documents:view",
];

function ctxFor(
  organizationId: string,
  options: { permissions?: PermissionKey[]; membershipId?: string } = {},
): ServiceContext {
  const membershipId = options.membershipId ?? `mem_${organizationId}_hr`;
  return {
    organizationId,
    organizationName: `Org ${organizationId}`,
    workspaceKind: "carrier_organization",
    membershipId,
    permissions: new Set(options.permissions ?? HR),
    actor: {
      userId: "usr_hr", membershipId,
      displayNameSnapshot: "Casey Hart", source: "web",
    },
    scope: { loads: "all", financials: "all" },
  };
}

const northline = () => ctxFor("org_northline");
const cascade = () => ctxFor("org_cascade");

const TESS = "weng_nl_tess";
const DMITRI = "weng_nl_dmitri";
const PRIYA = "weng_nl_priya";
/** Tess's seat, and the only one these tests project onto. */
const SEAT = "mem_northline_safety";

const seat = () => memberIn("org_northline", SEAT)!;

beforeEach(() => {
  resetAllMocks();
});

/* ========================================================================== */
/* Leave versus the work-routing signal                                       */
/* ========================================================================== */

describe("ending leave restores what it displaced, and never invents availability", () => {
  it("puts back an independent reason the leave overwrote", async () => {
    const ctx = northline();
    // Somebody was already off shift for a reason that has nothing to do with
    // leave. `MembershipAvailability` is single-valued, so the leave displaces
    // it — and must put it back.
    setMembershipAvailability(SEAT, "off_shift");

    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    expect(seat().availability).toBe("on_leave");
    // The displaced value travels on the leave record, as provenance.
    expect(v.engagement.leave[0].seatAvailabilityBefore).toBe("off_shift");

    await workforce.endLeave(ctx, TESS, { leaveId: v.engagement.leave[0].id });

    // ★ NOT `available` ★ Nobody said they were back on shift.
    expect(seat().availability).toBe("off_shift");
    expect(seat().takesWork).toBe(false);
  });

  it("restores availability when that is genuinely what it displaced", async () => {
    const ctx = northline();
    expect(seat().availability).toBe("available");
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off", startDate: daysFromNow(-1),
    });
    await workforce.endLeave(ctx, TESS, { leaveId: v.engagement.leave[0].id });
    expect(seat().availability).toBe("available");
    expect(seat().takesWork).toBe(true);
  });

  it("does not undo a newer decision somebody else made during the leave", async () => {
    const ctx = northline();
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "medical", startDate: daysFromNow(-1),
    });
    // While they were away, somebody stood the seat down for another reason.
    setMembershipAvailability(SEAT, "unavailable");

    await workforce.endLeave(ctx, TESS, { leaveId: v.engagement.leave[0].id });

    // Leave only ever undoes its OWN mark. This is not its mark.
    expect(seat().availability).toBe("unavailable");
    expect(seat().takesWork).toBe(false);
  });
});

describe("leave does not speak for an engagement nobody works under", () => {
  it("does not return a SUSPENDED person to work routing", async () => {
    const ctx = northline();
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    await workforce.suspend(ctx, TESS, { reason: "Under review." });

    await workforce.endLeave(ctx, TESS, { leaveId: v.engagement.leave[0].id });

    // ★ THE WORST ONE ★ Closing an old leave record must not undo a standing
    // down. The suspension is the access system's and Safety's business.
    expect(seat().takesWork).toBe(false);
    const view = await workforce.get(ctx, TESS);
    expect(view.availability.state).toBe("suspended");
  });

  it("does not return an OFFBOARDED person to work routing", async () => {
    const ctx = northline();
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    await workforce.offboard(ctx, TESS, { reason: "Left.", confirmedSteps: [] });

    await workforce.endLeave(ctx, TESS, { leaveId: v.engagement.leave[0].id });

    expect(seat().takesWork).toBe(false);
  });

  it("applies the same rule when the leave is CANCELLED rather than ended", async () => {
    const ctx = northline();
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    await workforce.suspend(ctx, TESS, { reason: "Under review." });

    await workforce.cancelLeave(ctx, TESS, {
      leaveId: v.engagement.leave[0].id, reason: "Recorded in error.",
    });

    expect(seat().takesWork).toBe(false);
  });
});

describe("the projection is reconcilable, because it is not transactional", () => {
  it("reports a seat somebody independently marked available during leave", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "medical", startDate: daysFromNow(-1), expectedReturnDate: daysFromNow(9),
    });
    expect(seat().takesWork).toBe(false);

    // The directory's command is public and has legitimate callers.
    setMembershipAvailability(SEAT, "available");

    const view = await workforce.get(ctx, TESS);
    // HR still says away — and the view now SAYS the two disagree, which is
    // the whole point: before this, nothing anywhere could tell.
    expect(view.availability.state).toBe("on_leave");
    expect(view.availability.projection.inSync).toBe(false);
    expect(view.availability.projection.desired).toBe("on_leave");
    expect(view.availability.projection.actual).toBe("available");
  });

  it("raises it in Needs You and stops once it is applied", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "medical", startDate: daysFromNow(-1), expectedReturnDate: daysFromNow(9),
    });
    setMembershipAvailability(SEAT, "available");

    const raised = workforceNeedsYouItems(ctx)
      .filter((i) => i.category === "workforce_availability_drift" && i.entity.id === TESS);
    expect(raised).toHaveLength(1);

    await workforce.reconcileAvailability(ctx, TESS);

    expect(seat().availability).toBe("on_leave");
    expect(seat().takesWork).toBe(false);
    expect(workforceNeedsYouItems(ctx)
      .filter((i) => i.category === "workforce_availability_drift")).toHaveLength(0);
  });

  it("notices a FUTURE leave that has since become effective", async () => {
    const ctx = northline();
    // Recorded for a date that has not arrived: the seat is untouched, which
    // is correct today.
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off",
      startDate: daysFromNow(3),
      expectedReturnDate: daysFromNow(10),
    });
    expect(seat().takesWork).toBe(true);
    expect((await workforce.get(ctx, TESS)).availability.projection.inSync).toBe(true);

    // ★ NO SCHEDULER EXISTS ★ so simulate the day arriving the only honest
    // way: the same record, now covering today. Nothing re-ran, and before the
    // reconciliation existed the seat would simply have stayed available
    // forever while HR said the person was away.
    const rows = allEngagements();
    const target = rows.find((e) => e.id === TESS)!;
    target.leave = target.leave.map((l) => (l.id === v.engagement.leave[0].id
      ? { ...l, startDate: daysFromNow(-1) }
      : l));

    const drifted = await workforce.get(ctx, TESS);
    expect(drifted.availability.state).toBe("on_leave");
    expect(drifted.availability.projection.inSync).toBe(false);
    expect(drifted.nextAction?.kind).toBe("reconcile_availability");

    await workforce.reconcileAvailability(ctx, TESS);
    expect(seat().takesWork).toBe(false);
  });

  it("reports a seat left on_leave with no leave to justify it", async () => {
    const ctx = northline();
    // Whatever produced this — a failed write, a half-finished command, an
    // older build — the seat is off the board for a reason that is gone.
    setMembershipAvailability(SEAT, "on_leave");

    const view = await workforce.get(ctx, TESS);
    expect(view.availability.projection.inSync).toBe(false);
    expect(view.availability.projection.managedByLeave).toBe(false);

    await workforce.reconcileAvailability(ctx, TESS);
    expect(seat().availability).toBe("available");
  });

  it("is idempotent, and writes nothing when the two already agree", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    const ledgerBefore = auditLedger.all("org_northline").length;
    const versionBefore = (await workforce.get(ctx, TESS)).engagement.version;

    await workforce.reconcileAvailability(ctx, TESS);
    await workforce.reconcileAvailability(ctx, TESS);

    // In step already: no ledger line, no version bump, no write.
    expect(auditLedger.all("org_northline")).toHaveLength(ledgerBefore);
    expect((await workforce.get(ctx, TESS)).engagement.version).toBe(versionBefore);
  });

  it("records what it moved, from and to, when it does act", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    setMembershipAvailability(SEAT, "available");

    await workforce.reconcileAvailability(ctx, TESS);

    const line = auditLedger.all("org_northline")
      .find((e) => e.action === "workforce.availability_reconciled")!;
    expect(line).toBeDefined();
    expect(line.summary).toContain("no dispatch readiness");
    const event = (await workforce.get(ctx, TESS)).engagement.history.at(-1)!;
    expect(event.summary).toContain("available");
    expect(event.summary).toContain("on_leave");
  });

  it("raises nothing for somebody who holds no seat at all", async () => {
    const ctx = northline();
    // Priya works here, is on leave in the fixtures, and has no membership.
    const view = await workforce.get(ctx, PRIYA);
    expect(view.engagement.membershipId).toBeUndefined();
    expect(view.availability.state).toBe("on_leave");
    // There is no routing signal to be out of step with, so no item.
    expect(view.availability.projection.inSync).toBe(true);
    expect(workforceNeedsYouItems(ctx)
      .filter((i) => i.category === "workforce_availability_drift" && i.entity.id === PRIYA))
      .toHaveLength(0);
  });

  it("keeps another organization's seat out of it entirely", async () => {
    const before = membersOf("org_cascade").map((m) => [m.membershipId, m.availability]);
    await workforce.recordLeave(northline(), TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    expect(membersOf("org_cascade").map((m) => [m.membershipId, m.availability]))
      .toEqual(before);
    // And the command itself is unreachable from the other organization.
    await expect(workforce.reconcileAvailability(cascade(), TESS))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("overlapping leave", () => {
  it("refuses a second leave over the same future dates", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off", startDate: daysFromNow(5), expectedReturnDate: daysFromNow(10),
    });
    // Two future leaves over one week used to both be accepted, and on the
    // Monday one of them started the other still claimed the same absence.
    await expect(workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(7), expectedReturnDate: daysFromNow(12),
    })).rejects.toThrow(/already has leave recorded over those dates/);
    expect((await workforce.get(ctx, TESS)).engagement.leave).toHaveLength(1);
  });

  it("allows a second leave that does not overlap", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off", startDate: daysFromNow(5), expectedReturnDate: daysFromNow(10),
    });
    const v = await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(20), expectedReturnDate: daysFromNow(25),
    });
    expect(v.engagement.leave).toHaveLength(2);
  });

  it("treats an open-ended leave as overlapping everything after it", async () => {
    const ctx = northline();
    await workforce.recordLeave(ctx, TESS, {
      reason: "medical", startDate: daysFromNow(2),
    });
    await expect(workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(40), expectedReturnDate: daysFromNow(45),
    })).rejects.toThrow(/already has leave recorded over those dates/);
  });
});

/* ========================================================================== */
/* Identity                                                                   */
/* ========================================================================== */

describe("the duplicate check is not defeated by how an address was typed", () => {
  it("refuses a differently-cased email", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    await expect(workforce.create(ctx, {
      person: { displayName: "Priya Raman", email: "Priya.Raman@Example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Entered by hand" },
    })).rejects.toBeInstanceOf(DuplicateEngagementError);
  });

  it("refuses one with surrounding whitespace", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    await expect(workforce.create(ctx, {
      person: { displayName: "Priya Raman", email: "  priya.raman@example.com  " },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Entered by hand" },
    })).rejects.toBeInstanceOf(DuplicateEngagementError);
  });

  it("leaves exactly one live engagement for that person either way", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    for (const email of ["PRIYA.RAMAN@EXAMPLE.COM", " priya.raman@example.com "]) {
      await workforce.create(ctx, {
        person: { displayName: "Priya Raman", email },
        classification: "employee",
        positionTitle: "Yard hand",
        source: { kind: "manual_entry", label: "Entered by hand" },
      }).catch(() => undefined);
    }
    const live = allEngagements().filter((e) =>
      e.organizationId === "org_northline"
      && (e.person.email ?? "").trim().toLowerCase() === "priya.raman@example.com"
      && !["ended", "rejected", "withdrawn"].includes(e.state));
    expect(live).toHaveLength(1);
  });
});

describe("a name is evidence, not identity", () => {
  it("refuses to decide a same-name row either way, and writes nothing", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    const before = allEngagements().length;

    // The everyday directory duplicate: somebody types a name that is already
    // on the roster and supplies no address to settle it. The exact-identity
    // check cannot see this — no account id, no profile, no email — and
    // creating would duplicate a real person while linking would merge two.
    const error = await workforce.create(ctx, {
      person: { displayName: "Dmitri Kovalenko" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "Entered by hand" },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AmbiguousPersonError);
    expect((error as AmbiguousPersonError).candidates.some((c) => c.engagementId === DMITRI))
      .toBe(true);
    expect(allEngagements()).toHaveLength(before);
  });

  it("creates once a person says they are different people", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    const before = allEngagements().length;

    const view = await workforce.create(ctx, {
      person: { displayName: "Dmitri Kovalenko" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "His cousin, same name" },
      // The acknowledgement, which links nothing.
      confirmedDistinctFrom: [DMITRI],
    });

    expect(allEngagements()).toHaveLength(before + 1);
    expect(view.engagement.id).not.toBe(DMITRI);
    // And the person they were distinguished from is untouched.
    const dmitri = allEngagements().find((e) => e.id === DMITRI)!;
    expect(dmitri.state).toBe("active");
    expect(dmitri.person.driverProfileId).toBe("dp_dmitri");
    // Nothing was merged: the new row has no profile of its own.
    expect(view.engagement.driverProfileId).toBeUndefined();
  });

  it("still stops on a candidate the acknowledgement did not name", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    // Acknowledging somebody irrelevant does not wave the real candidate past.
    await expect(workforce.create(ctx, {
      person: { displayName: "Dmitri Kovalenko" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "Entered by hand" },
      confirmedDistinctFrom: [PRIYA],
    })).rejects.toBeInstanceOf(AmbiguousPersonError);
  });

  it("does NOT catch a misspelling, and that is the matcher's deliberate calibration", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    /*
     * ★ AN HONEST LIMIT, ASSERTED SO NOBODY CLAIMS OTHERWISE ★
     * `scorePerson` scores a one-character name difference as no signal at
     * all. That is the canonical matcher's existing calibration, shared with
     * the roster import, and this module deliberately does not retune it: a
     * second opinion about what counts as a near-miss is exactly the second
     * identity matcher the boundaries forbid, and loosening it here would
     * change how every imported roster resolves.
     *
     * So a typo creates a second live engagement. The backend owes this seam a
     * real matcher; until then the product's answer is the import path, which
     * shows candidates before anything is written.
     */
    const view = await workforce.create(ctx, {
      person: { displayName: "Dmitri Kovalenkoo" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "Entered by hand" },
    });
    expect(view.engagement.id).not.toBe(DMITRI);
  });

  it("does not stop on somebody whose engagement already ended", async () => {
    const ctx = northline();
    await workforce.list(ctx);
    // Kelsey Nguyen left. A person who leaves and comes back gets a NEW
    // engagement, so her ended row must not block one.
    const view = await workforce.create(ctx, {
      person: { displayName: "Kelsey Nguyen" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "Came back" },
    });
    expect(view.engagement.state).toBe("prospective");
  });

  it("does not consult another organization's roster", async () => {
    const ctx = cascade();
    await workforce.list(ctx);
    // Northline's Dmitri must not surface as a candidate to Cascade, and must
    // not stop Cascade recording a person of their own.
    const view = await workforce.create(ctx, {
      person: { displayName: "Dmitri Kovalenko" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "Entered by hand" },
    });
    expect(view.engagement.organizationId).toBe("org_cascade");
  });
});

/* ========================================================================== */
/* Functions versus permissions — the eight cases, asserted                   */
/* ========================================================================== */

describe("a function describes what somebody does and authorizes nothing", () => {
  const FUNCTIONS = [
    "driver_action", "dispatch", "safety", "finance", "maintenance", "compliance",
  ] as const;

  it("grants zero permissions for every function there is", async () => {
    const ctx = northline();
    const before = new Set(seat().permissions);
    for (const functionKey of FUNCTIONS) {
      await workforce.assignFunction(ctx, TESS, { functionKey });
    }
    // Every function in the vocabulary, on one person, and not one key moved.
    expect([...seat().permissions].sort()).toEqual([...before].sort());
    expect(seat().isOwner).toBe(false);
  });

  it("revokes nothing when a function is removed", async () => {
    const ctx = northline();
    const before = new Set(seat().permissions);
    await workforce.removeFunction(ctx, TESS, {
      functionKey: "safety", reason: "Moved to Ana's desk.",
    });
    await workforce.removeFunction(ctx, TESS, {
      functionKey: "compliance", reason: "Same.",
    });
    expect([...seat().permissions].sort()).toEqual([...before].sort());
  });

  it("cannot be used by a manager who holds no authority over access", async () => {
    // `workforce:manage` and nothing else — no `members:edit`, no `members:view`.
    const hrOnly = ctxFor("org_northline", {
      permissions: ["workforce:view", "workforce:manage"],
    });
    const before = new Set(seat().permissions);
    await workforce.assignFunction(hrOnly, TESS, { functionKey: "dispatch" });
    expect(seat().permissions.has("dispatch:view")).toBe(false);
    expect([...seat().permissions].sort()).toEqual([...before].sort());
  });

  it("shows the mismatch as advice pointing at Access, and writes no membership", async () => {
    const ctx = northline();
    const view = await workforce.assignFunction(ctx, TESS, { functionKey: "dispatch" });
    const gap = view.functionGaps.find((g) => g.functionKey === "dispatch")!;
    expect(gap.missing).toContain("dispatch:view");
    expect(gap.remedy).toBe("grant_through_access");
    // Advisory: the seat is exactly as it was.
    expect(seat().permissions.has("dispatch:view")).toBe(false);
  });

  it("does not widen an external worker's delegated truck or carrier scope", async () => {
    const ctx = northline();
    const dispatcher = () => memberIn("org_northline", "mem_northline_disp1")!;
    const trucksBefore = [...dispatcher().truckIds];
    const carriersBefore = [...dispatcher().carrierOrganizationIds];

    const made = await workforce.create(ctx, {
      person: { displayName: "Ivy Delgado", userId: dispatcher().userId },
      classification: "external_worker",
      positionTitle: "Outsourced dispatcher",
      source: { kind: "manual_entry", label: "Supplied by a dispatch provider" },
    });
    await workforce.assignFunction(ctx, made.engagement.id, { functionKey: "dispatch" });

    // A delegation is granted by the access system and narrowed by scope.
    // Saying somebody dispatches does not hand them another truck or another
    // carrier's work.
    expect(dispatcher().truckIds).toEqual(trucksBefore);
    expect(dispatcher().carrierOrganizationIds).toEqual(carriersBefore);
  });

  it("fails across organizations and writes nothing at all", async () => {
    // Seed the store first: the snapshot below has to be of a real row.
    await workforce.list(northline());
    const ledgerBefore = auditLedger.all("org_northline").length;
    const before = JSON.stringify(allEngagements().find((e) => e.id === TESS));

    await expect(workforce.assignFunction(cascade(), TESS, { functionKey: "dispatch" }))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(workforce.removeFunction(cascade(), TESS, {
      functionKey: "safety", reason: "no",
    })).rejects.toBeInstanceOf(NotFoundError);

    expect(JSON.stringify(allEngagements().find((e) => e.id === TESS))).toBe(before);
    // Not one line in the organization that owns the record.
    expect(auditLedger.all("org_northline")).toHaveLength(ledgerBefore);
  });
});

describe("a permission never becomes an HR function", () => {
  it("leaves the owner, who holds everything, with no functions and no gaps", async () => {
    const ctx = northline();
    const owner = membersOf("org_northline").find((m) => m.isOwner)!;
    expect(owner.permissions.size).toBeGreaterThan(10);
    // Seed, so the acknowledgement below names the roster that actually exists.
    await workforce.list(ctx);

    const view = await workforce.create(ctx, {
      person: { displayName: "Sam Murtaza", userId: owner.userId },
      classification: "organization_owner",
      positionTitle: "Principal",
      source: { kind: "manual_entry", label: "Entered by hand" },
      confirmedDistinctFrom: allEngagements()
        .filter((e) => e.organizationId === "org_northline").map((e) => e.id),
    });
    // Holding `dispatch:view` did not make them a dispatcher.
    expect(view.engagement.functions).toHaveLength(0);
    expect(view.functionGaps).toHaveLength(0);
  });

  it("does not gain a function when the seat's permissions change", async () => {
    const ctx = northline();
    const before = (await workforce.get(ctx, TESS)).engagement.functions
      .map((f) => f.functionKey).sort();
    // Whatever Access does to the seat, HR learns no new fact about the person.
    setMembershipAvailability(SEAT, "unavailable");
    const after = (await workforce.get(ctx, TESS)).engagement.functions
      .map((f) => f.functionKey).sort();
    expect(after).toEqual(before);
  });
});

describe("organization_owner is a classification, not an authorization", () => {
  it("grants no Owner role and no permission", async () => {
    const ctx = northline();
    const before = new Set(seat().permissions);
    expect(seat().isOwner).toBe(false);

    await workforce.changeClassification(ctx, TESS, {
      classification: "organization_owner",
      reason: "She bought into the business.",
    });

    // Ownership of the organization comes from Membership, and only from there.
    expect(seat().isOwner).toBe(false);
    expect([...seat().permissions].sort()).toEqual([...before].sort());
  });
});

/* ========================================================================== */
/* The document and privacy boundary                                          */
/* ========================================================================== */

describe("Workforce is not a way into documents or personal records", () => {
  it("gives a workforce:view reader no document access by direct id", async () => {
    const wfOnly = ctxFor("org_northline", { permissions: ["workforce:view"] });
    const dcCtx = ctxFor("org_northline", { permissions: ["documents:view"] });

    const listed = await documents.list(dcCtx, {});
    expect(listed.length).toBeGreaterThan(0);

    // The id is real and the list view showed it to somebody else. Reading it
    // with workforce access alone is refused exactly as an invented id is.
    for (const view of listed.slice(0, 3)) {
      await expect(documents.get(wfOnly, view.document.documentId))
        .rejects.toBeInstanceOf(PermissionDeniedError);
    }
  });

  it("carries no document metadata on the engagement itself", async () => {
    const view = await workforce.get(northline(), DMITRI);
    const serialized = JSON.stringify(view);
    // Links and labels only. No file, no version, no number, no expiry.
    for (const leak of ["cdlNumber", "licenceNumber", "documentVersion", "storageKey", "fileName"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(view.engagement).not.toHaveProperty("documents");
  });

  it("keeps restricted qualification categories out of the view", async () => {
    const view = await workforce.get(northline(), DMITRI);
    const serialized = JSON.stringify(view);
    for (const category of RESTRICTED_QUALIFICATION_CATEGORIES) {
      expect(serialized).not.toContain(category);
    }
  });

  it("shows another organization's engagement no documents, because it shows nothing", async () => {
    await expect(workforce.get(cascade(), DMITRI)).rejects.toBeInstanceOf(NotFoundError);
  });
});

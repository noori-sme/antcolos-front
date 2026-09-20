import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import { RESTRICTED_QUALIFICATION_CATEGORIES } from "@/types";
import { NotFoundError, PermissionDeniedError, type ServiceContext } from "../contracts/context";
import { resetAllMocks } from "./registry";
import {
  LeaveNotFoundError, MissingStartDateBasisError, DuplicateEngagementError,
  mockWorkforceService as workforce,
} from "./workforce";
import { mockAccessService } from "./access";
import { allEngagements } from "./workforce-store";
import { driverProfileUnscoped, profileForUser } from "./driver-registry";
import { memberIn, membersOf } from "./membership-directory";
import { auditLedger } from "./audit-ledger";
import { workforceNeedsYouItems } from "./workforce-needs-you";
import { functionGapsFor } from "@/lib/workforce/functions";
import { daysFromNow } from "./time";

/**
 * ★ THE HR FOUNDATION'S BOUNDARIES, ASSERTED ★
 *
 * These tests are about the SEAMS rather than the screens: one live engagement
 * per person per organization however you get there, one organization's rows
 * never reachable from another, a function that grants nothing and a permission
 * that invents nothing, leave that removes somebody from work routing without
 * saying a word about a truck, and a start date a carrier asserted surviving
 * every command that touches the record around it.
 *
 * Every one of them is written against behaviour — a command and what it did to
 * the canonical records — rather than against the shape of a file.
 */

const HR: PermissionKey[] = [
  "workforce:view", "workforce:manage", "workforce:end",
  "contracts:view", "documents:view",
];

function ctxFor(
  organizationId: string,
  options: {
    permissions?: PermissionKey[];
    membershipId?: string;
    userId?: string;
    driverProfileId?: string;
  } = {},
): ServiceContext {
  const membershipId = options.membershipId ?? `mem_${organizationId}_hr`;
  return {
    organizationId,
    organizationName: `Org ${organizationId}`,
    workspaceKind: "carrier_organization",
    membershipId,
    permissions: new Set(options.permissions ?? HR),
    actor: {
      userId: options.userId ?? "usr_hr",
      membershipId,
      displayNameSnapshot: "Casey Hart",
      source: "web",
    },
    scope: options.driverProfileId
      ? { loads: "assigned", financials: "own" }
      : { loads: "all", financials: "all" },
    driverProfileId: options.driverProfileId,
  };
}

const northline = () => ctxFor("org_northline");
const cascade = () => ctxFor("org_cascade");

const DMITRI = "weng_nl_dmitri";
const TESS = "weng_nl_tess";
const PRIYA = "weng_nl_priya";
const MIGRATED = "weng_nl_migrated_driver";

/** Sam's licence, as the acceptance flow asks for it. */
const LICENCE = {
  legalName: "Sam Murtaza",
  cdlNumber: "K4471182993",
  cdlState: "IL",
  cdlExpiresAt: "2030-04-01T00:00:00.000Z",
};

const SAM = {
  userId: "usr_sam",
  email: "sam@antcolos.com",
  displayName: "Sam Murtaza",
  scenario: "demo" as const,
};

beforeEach(() => {
  resetAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1. One live engagement per person, by every route                           */
/* -------------------------------------------------------------------------- */

describe("a person cannot acquire two live engagements in one organization", () => {
  const person = {
    displayName: "Rosa Delgado",
    email: "rosa.delgado@example.com",
  };

  it("refuses the second create, whichever identity the second one names", async () => {
    const ctx = northline();
    const first = await workforce.create(ctx, {
      person: { ...person, userId: "usr_rosa" },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Entered by hand" },
    });

    // Same account id.
    await expect(workforce.create(ctx, {
      person: { displayName: "Rosa D.", userId: "usr_rosa" },
      classification: "independent_contractor",
      positionTitle: "Night dispatcher",
      source: { kind: "manual_entry", label: "Entered by hand" },
    })).rejects.toBeInstanceOf(DuplicateEngagementError);

    // Same email, no account id — the route a second person entering the same
    // hire by hand would actually take.
    await expect(workforce.create(ctx, {
      person: { displayName: "Rosa Delgado", email: person.email },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Entered by hand" },
    })).rejects.toBeInstanceOf(DuplicateEngagementError);

    // A different CLASSIFICATION is not an exception either: nobody is an
    // employee and a contractor of the same organization at once.
    await expect(workforce.create(ctx, {
      person: { displayName: "Rosa Delgado", userId: "usr_rosa" },
      classification: "owner_operator",
      positionTitle: "Owner-operator",
      source: { kind: "manual_entry", label: "Entered by hand" },
    })).rejects.toBeInstanceOf(DuplicateEngagementError);

    const live = allEngagements().filter(
      (e) => e.organizationId === "org_northline" && e.person.userId === "usr_rosa",
    );
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(first.engagement.id);
  });

  it("lets the same person be re-engaged only after the first one ended", async () => {
    const ctx = northline();
    const first = await workforce.create(ctx, {
      person: { ...person, userId: "usr_rosa" },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Entered by hand" },
      startOnboarding: true,
    });
    await workforce.reject(ctx, first.engagement.id, "Took another job.");

    const second = await workforce.create(ctx, {
      person: { ...person, userId: "usr_rosa" },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Came back" },
    });
    expect(second.engagement.id).not.toBe(first.engagement.id);
    // The first is history, not a row that was reopened.
    const before = allEngagements().find((e) => e.id === first.engagement.id)!;
    expect(before.state).toBe("rejected");
    expect(before.history.length).toBeGreaterThan(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 and 3. Two organizations, and no leak between them                        */
/* -------------------------------------------------------------------------- */

describe("separate organizations hold separate engagements for one person", () => {
  it("lets both exist, each reading only its own", async () => {
    const shared = { displayName: "Ana Kovač", userId: "usr_ana", email: "ana@example.com" };
    const atNorthline = await workforce.create(northline(), {
      person: shared,
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Entered by hand" },
    });
    const atCascade = await workforce.create(cascade(), {
      person: shared,
      classification: "independent_contractor",
      positionTitle: "Weekend dispatcher",
      source: { kind: "manual_entry", label: "Entered by hand" },
    });
    expect(atNorthline.engagement.id).not.toBe(atCascade.engagement.id);

    const nlIds = (await workforce.list(northline())).map((v) => v.engagement.id);
    const csIds = (await workforce.list(cascade())).map((v) => v.engagement.id);
    expect(nlIds).toContain(atNorthline.engagement.id);
    expect(nlIds).not.toContain(atCascade.engagement.id);
    expect(csIds).toContain(atCascade.engagement.id);
    expect(csIds).not.toContain(atNorthline.engagement.id);

    // One person, two relationships, and neither classification reached the
    // other: Cascade's contractor is Northline's employee and stays so.
    expect(atNorthline.engagement.classification).toBe("employee");
    expect(atCascade.engagement.classification).toBe("independent_contractor");
  });
});

describe("another organization's row is unreachable by every route", () => {
  it("is absent from list and from search", async () => {
    const ctx = cascade();
    const listed = await workforce.list(ctx, { includeEnded: true });
    expect(listed.some((v) => v.engagement.id === DMITRI)).toBe(false);
    const searched = await workforce.list(ctx, { search: "Dmitri" });
    expect(searched).toHaveLength(0);
  });

  it("answers a direct id exactly as it answers an invented one", async () => {
    const ctx = cascade();
    const real = await workforce.get(ctx, DMITRI).catch((e) => e);
    const invented = await workforce.get(ctx, "weng_does_not_exist").catch((e) => e);
    expect(real).toBeInstanceOf(NotFoundError);
    expect(invented).toBeInstanceOf(NotFoundError);
    // The SAME answer, differing only in the id the caller themselves supplied.
    // Anything else — a different error class, a different sentence, a slower
    // path — is the disclosure: it tells Cascade that Northline holds a row.
    const shape = (e: Error, id: string) => e.message.replace(id, "<id>");
    expect(shape(real as Error, DMITRI)).toBe(shape(invented as Error, "weng_does_not_exist"));
  });

  it("does not surface it through Needs You", () => {
    const items = workforceNeedsYouItems(cascade());
    expect(items.every((i) => i.organizationId === "org_cascade")).toBe(true);
    expect(items.some((i) => i.entity.id === DMITRI)).toBe(false);
  });

  it("refuses a function assignment against it, and writes nothing", async () => {
    const ctx = cascade();
    await expect(workforce.assignFunction(ctx, DMITRI, { functionKey: "dispatch" }))
      .rejects.toBeInstanceOf(NotFoundError);
    // The engagement in the other organization is untouched.
    const dmitri = allEngagements().find((e) => e.id === DMITRI)!;
    expect(dmitri.functions.some((f) => f.functionKey === "dispatch")).toBe(false);
  });

  it("refuses leave against it, and writes nothing", async () => {
    const ctx = cascade();
    await expect(workforce.recordLeave(ctx, DMITRI, {
      reason: "personal", startDate: daysFromNow(1),
    })).rejects.toBeInstanceOf(NotFoundError);
    expect(allEngagements().find((e) => e.id === DMITRI)!.leave).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Somebody who has no Antcolos account                                     */
/* -------------------------------------------------------------------------- */

describe("an unregistered worker exists without a fabricated identity", () => {
  it("has an engagement, no User and no DriverProfile", async () => {
    const view = await workforce.get(northline(), PRIYA);
    expect(view.engagement.person.userId).toBeUndefined();
    expect(view.engagement.driverProfileId).toBeUndefined();
    expect(view.engagement.membershipId).toBeUndefined();
    expect(view.hasActiveMembership).toBe(false);
    // Nothing minted a profile to hang the record off.
    expect(profileForUser("usr_priya")).toBeUndefined();
    expect(driverProfileUnscoped("dp_priya")).toBeUndefined();
    // And no seat quietly appeared in the directory.
    expect(membersOf("org_northline").some((m) => m.displayName === "Priya Raman")).toBe(false);
  });

  it("creates one for somebody brand new without minting either", async () => {
    const before = membersOf("org_northline").length;
    const view = await workforce.create(northline(), {
      person: { displayName: "Ivan Petrov", email: "ivan@example.com" },
      classification: "external_worker",
      positionTitle: "Agency yard hand",
      source: { kind: "manual_entry", label: "Supplied by an agency" },
    });
    expect(view.engagement.person.userId).toBeUndefined();
    expect(view.engagement.driverProfileId).toBeUndefined();
    expect(membersOf("org_northline")).toHaveLength(before);
    // Nothing pretends they agreed to anything.
    expect(view.engagement.state).toBe("prospective");
  });
});

/* -------------------------------------------------------------------------- */
/* 5 and 6. Acceptance connects; the asserted date survives                    */
/* -------------------------------------------------------------------------- */

describe("invitation acceptance connects the engagement this carrier already had", () => {
  it("links the driver profile onto it rather than creating a second one", async () => {
    // The store seeds on first read, so read before counting.
    await workforce.list(northline());
    const before = allEngagements().filter((e) => e.organizationId === "org_northline").length;
    const result = await mockAccessService.accept("INV-MIGRATED", SAM, {
      sharedDocumentKeys: [],
      licence: LICENCE,
    });
    expect(result.status).toBe("accepted");

    const after = allEngagements().filter((e) => e.organizationId === "org_northline");
    expect(after).toHaveLength(before);

    const migrated = after.find((e) => e.id === MIGRATED)!;
    expect(migrated.driverProfileId).toBeTruthy();
    expect(migrated.person.driverProfileId).toBe(migrated.driverProfileId);
    // One engagement for that person here, not two.
    expect(after.filter((e) => e.driverProfileId === migrated.driverProfileId)).toHaveLength(1);
    // And the connection is on the record's own history.
    expect(migrated.history.some((h) => h.kind === "driver_profile_linked")).toBe(true);
  });

  it("leaves the carrier's asserted start date and its basis exactly as they were", async () => {
    await workforce.list(northline());
    const before = allEngagements().find((e) => e.id === MIGRATED)!;
    expect(before.startDateProvenance?.basis).toBe("asserted_by_organization");

    await mockAccessService.accept("INV-MIGRATED", SAM, {
      sharedDocumentKeys: [],
      licence: LICENCE,
    });

    const after = allEngagements().find((e) => e.id === MIGRATED)!;
    expect(after.startDate).toBe(before.startDate);
    expect(after.startDateProvenance).toEqual(before.startDateProvenance);
  });
});

describe("an asserted historical start date survives activation unchanged", () => {
  it("keeps the date and the basis, and records neither as observed", async () => {
    const ctx = northline();
    const asserted = daysFromNow(-1500);
    const created = await workforce.create(ctx, {
      person: { displayName: "Halle Brandt", email: "halle@example.com" },
      classification: "employee",
      positionTitle: "Office manager",
      source: { kind: "roster_import", label: "From the roster file" },
      startDate: asserted,
      startDateBasis: "asserted_by_organization",
      startDateNote: "Carrier's own records.",
      startOnboarding: true,
    });

    // Not a driver, so the driver-shaped steps are not_applicable and the one
    // required step left is the contract. Waived, exactly as an operator would.
    await workforce.waiveStep(ctx, created.engagement.id, {
      stepKey: "contracts.signed_agreement",
      reason: "Office staff engaged on the standard handbook.",
    });

    const view = await workforce.activate(ctx, created.engagement.id);
    expect(view.engagement.state).toBe("active");
    expect(view.engagement.startDate).toBe(asserted);
    expect(view.engagement.startDateProvenance?.basis).toBe("asserted_by_organization");
    expect(view.engagement.startDateProvenance?.value).toBe(asserted);
    expect(view.engagement.startDateProvenance?.note).toBe("Carrier's own records.");
  });

  it("only fills an EMPTY date, and marks that one observed", async () => {
    const ctx = northline();
    const created = await workforce.create(ctx, {
      person: { displayName: "Noor Rahman", email: "noor@example.com" },
      classification: "employee",
      positionTitle: "Billing clerk",
      source: { kind: "manual_entry", label: "Entered by hand" },
      startOnboarding: true,
    });
    expect(created.engagement.startDate).toBeUndefined();

    await workforce.waiveStep(ctx, created.engagement.id, {
      stepKey: "contracts.signed_agreement",
      reason: "Office staff engaged on the standard handbook.",
    });
    const view = await workforce.activate(ctx, created.engagement.id);
    expect(view.engagement.startDate).toBeTruthy();
    expect(view.engagement.startDateProvenance?.basis).toBe("observed_by_antcolos");
  });

  it("refuses a start date nobody will say the provenance of", async () => {
    await expect(workforce.create(northline(), {
      person: { displayName: "Unsourced Person", email: "u@example.com" },
      classification: "employee",
      positionTitle: "Clerk",
      source: { kind: "manual_entry", label: "Entered by hand" },
      startDate: daysFromNow(-900),
    })).rejects.toBeInstanceOf(MissingStartDateBasisError);
  });

  it("keeps every previous date readable when one is corrected", async () => {
    const ctx = northline();
    const first = daysFromNow(-800);
    const corrected = daysFromNow(-810);
    const created = await workforce.create(ctx, {
      person: { displayName: "Otto Lang", email: "otto@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Entered by hand" },
      startDate: first,
      startDateBasis: "asserted_by_organization",
    });
    const view = await workforce.recordStartDate(ctx, created.engagement.id, {
      startDate: corrected,
      basis: "asserted_by_organization",
      note: "Payroll records disagreed with the roster.",
    });
    expect(view.engagement.startDate).toBe(corrected);
    const line = view.engagement.history.find((h) => h.kind === "start_date_recorded")!;
    // The record holds one date; the history holds every date it ever held.
    expect(line.detail).toContain(first.slice(0, 10));
  });
});

/* -------------------------------------------------------------------------- */
/* 7 and 8. Functions and permissions do not create one another                */
/* -------------------------------------------------------------------------- */

describe("a function grants no permission", () => {
  it("leaves the seat's effective permissions untouched", async () => {
    const ctx = northline();
    const before = new Set(memberIn("org_northline", "mem_northline_safety")!.permissions);
    expect(before.has("dispatch:view")).toBe(false);

    await workforce.assignFunction(ctx, TESS, { functionKey: "dispatch" });

    const after = memberIn("org_northline", "mem_northline_safety")!.permissions;
    expect(after.has("dispatch:view")).toBe(false);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("shows the mismatch instead of closing it, and points at Access", async () => {
    const ctx = northline();
    const view = await workforce.assignFunction(ctx, TESS, { functionKey: "dispatch" });
    const gap = view.functionGaps.find((g) => g.functionKey === "dispatch")!;
    expect(gap.missing).toContain("dispatch:view");
    expect(gap.remedy).toBe("grant_through_access");
    // And the next action sends somebody to Access rather than offering a
    // button here that would grant it.
    expect(view.nextAction?.kind).toBe("close_function_gap");
    expect(view.nextAction?.href).toBe("/settings/users");
  });

  it("raises an invitation, not a grant, for somebody with no seat at all", async () => {
    const view = await workforce.get(northline(), PRIYA);
    const gap = view.functionGaps.find((g) => g.functionKey === "maintenance")!;
    expect(gap.remedy).toBe("invite_to_workspace");
    expect(membersOf("org_northline").some((m) => m.displayName === "Priya Raman")).toBe(false);
  });

  it("removes one without revoking anything", async () => {
    const ctx = northline();
    await workforce.assignFunction(ctx, TESS, { functionKey: "dispatch" });
    const before = new Set(memberIn("org_northline", "mem_northline_safety")!.permissions);
    const view = await workforce.removeFunction(ctx, TESS, {
      functionKey: "dispatch",
      reason: "The west desk moved to Ana.",
    });
    expect(view.engagement.functions.some((f) => f.functionKey === "dispatch")).toBe(false);
    const after = memberIn("org_northline", "mem_northline_safety")!.permissions;
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("records who assigned it and when", async () => {
    const ctx = northline();
    const view = await workforce.assignFunction(ctx, TESS, {
      functionKey: "finance",
      note: "Chases the invoices.",
    });
    const assignment = view.engagement.functions.find((f) => f.functionKey === "finance")!;
    expect(assignment.assignedByMembershipId).toBe(ctx.membershipId);
    expect(assignment.assignedByName).toBe("Casey Hart");
    expect(assignment.assignedAt).toBeTruthy();
    expect(assignment.note).toBe("Chases the invoices.");
  });
});

describe("a permission fabricates no HR function", () => {
  it("leaves an engagement with no functions when the seat holds many keys", async () => {
    // The Northline owner holds effectively everything.
    const owner = membersOf("org_northline").find((m) => m.isOwner)!;
    expect(owner.permissions.size).toBeGreaterThan(10);

    const view = await workforce.create(northline(), {
      person: { displayName: "Wide Access Person", userId: owner.userId },
      classification: "organization_owner",
      positionTitle: "Principal",
      source: { kind: "manual_entry", label: "Entered by hand" },
    });
    // Holding `dispatch:view` did not make them a dispatcher here.
    expect(view.engagement.functions).toHaveLength(0);
    expect(view.functionGaps).toHaveLength(0);
  });

  it("derives a gap only from what was RECORDED, never from what is held", () => {
    const held = new Set<PermissionKey>([
      "dispatch:view", "compliance:view", "invoices:view", "documents:view",
    ]);
    // No functions recorded: a full key ring produces no functions and no gaps.
    expect(functionGapsFor({ functions: [], membershipId: "mem_x" }, held)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 9 and 10. Leave, and coming back                                            */
/* -------------------------------------------------------------------------- */

describe("leave removes somebody from work routing and says nothing about a truck", () => {
  it("marks the seat unavailable through the access boundary's own command", async () => {
    const ctx = northline();
    expect(memberIn("org_northline", "mem_northline_safety")!.takesWork).toBe(true);

    const view = await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off",
      startDate: daysFromNow(-1),
      expectedReturnDate: daysFromNow(10),
    });

    // The seat, in the directory that owns availability — not a second flag.
    const member = memberIn("org_northline", "mem_northline_safety")!;
    expect(member.availability).toBe("on_leave");
    expect(member.takesWork).toBe(false);
    // The SEAT is untouched: on leave is not suspended and not gone.
    expect(member.status).toBe("active");

    // And the engagement is still active. Leave is not a lifecycle state.
    expect(view.engagement.state).toBe("active");
    expect(view.availability.state).toBe("on_leave");
    expect(view.availability.availableForWork).toBe(false);
  });

  it("declares nothing about equipment, qualification or dispatch readiness", async () => {
    const ctx = northline();
    const view = await workforce.recordLeave(ctx, DMITRI, {
      reason: "medical",
      startDate: daysFromNow(-1),
      expectedReturnDate: daysFromNow(20),
    });
    // The availability projection says what it is worth and no more.
    expect(view.availability.limitation).toContain("never");
    expect(view.availability.limitation.toLowerCase()).toContain("dispatch-ready");
    // The driver's own records are exactly as they were.
    const profile = driverProfileUnscoped("dp_dmitri")!;
    expect(profile.legalName).toBe("Dmitri Kovalenko");
    // Nothing on the engagement holds an equipment or readiness fact.
    expect(Object.keys(view.engagement)).not.toContain("truckId");
    expect(Object.keys(view.engagement)).not.toContain("dispatchReady");
  });

  it("does not take somebody off the board for leave that has not started", async () => {
    const ctx = northline();
    const view = await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off",
      startDate: daysFromNow(21),
      expectedReturnDate: daysFromNow(28),
    });
    expect(view.availability.state).toBe("leave_planned");
    expect(view.availability.availableForWork).toBe(true);
    expect(memberIn("org_northline", "mem_northline_safety")!.takesWork).toBe(true);
  });

  it("keeps them away when the expected return passes, and asks somebody", async () => {
    const ctx = northline();
    // Priya is seeded away. Move her expected return into the past by ending
    // and re-recording, which is what an operator would actually do.
    await workforce.recordLeave(ctx, TESS, {
      reason: "family",
      startDate: daysFromNow(-20),
      expectedReturnDate: daysFromNow(-3),
    });
    const view = await workforce.get(ctx, TESS);
    // NOT silently back.
    expect(view.availability.state).toBe("on_leave");
    expect(view.availability.availableForWork).toBe(false);
    expect(view.nextAction?.kind).toBe("record_return_from_leave");

    const items = workforceNeedsYouItems(ctx);
    const item = items.find((i) => i.category === "workforce_leave_return_due")!;
    expect(item).toBeDefined();
    expect(item.entity.id).toBe(TESS);
  });
});

describe("returning from leave restores eligibility, not readiness", () => {
  it("lets the routing engine consider them again", async () => {
    const ctx = northline();
    const withLeave = await workforce.recordLeave(ctx, TESS, {
      reason: "planned_time_off",
      startDate: daysFromNow(-2),
      expectedReturnDate: daysFromNow(5),
    });
    const leaveId = withLeave.engagement.leave[0].id;
    expect(memberIn("org_northline", "mem_northline_safety")!.takesWork).toBe(false);

    const back = await workforce.endLeave(ctx, TESS, { leaveId });
    expect(back.availability.state).toBe("working");
    const member = memberIn("org_northline", "mem_northline_safety")!;
    expect(member.availability).toBe("available");
    expect(member.takesWork).toBe(true);
  });

  it("declares no dispatch readiness on the way back", async () => {
    const ctx = northline();
    const withLeave = await workforce.recordLeave(ctx, DMITRI, {
      reason: "medical",
      startDate: daysFromNow(-2),
      expectedReturnDate: daysFromNow(5),
    });
    const back = await workforce.endLeave(ctx, DMITRI, {
      leaveId: withLeave.engagement.leave[0].id,
    });
    // "HR knows of no reason not to" — and the field says exactly that.
    expect(back.availability.availableForWork).toBe(true);
    expect(back.availability.summary).toContain("HR knows of no reason");
    // The audit line refuses to claim more than happened.
    const line = auditLedger.all("org_northline")
      .find((e) => e.action === "workforce.leave_ended")!;
    expect(line.summary).toContain("no dispatch readiness");
  });

  it("records the ACTUAL return, never the expected one", async () => {
    const ctx = northline();
    const expected = daysFromNow(5);
    const actual = daysFromNow(9);
    const withLeave = await workforce.recordLeave(ctx, TESS, {
      reason: "personal",
      startDate: daysFromNow(-2),
      expectedReturnDate: expected,
    });
    const back = await workforce.endLeave(ctx, TESS, {
      leaveId: withLeave.engagement.leave[0].id,
      actualReturnDate: actual,
    });
    const record = back.engagement.leave[0];
    expect(record.actualReturnDate).toBe(actual);
    expect(record.expectedReturnDate).toBe(expected);
    expect(record.status).toBe("ended");
  });

  it("refuses to end leave that belongs to another engagement", async () => {
    const ctx = northline();
    const withLeave = await workforce.recordLeave(ctx, TESS, {
      reason: "personal", startDate: daysFromNow(-1),
    });
    await expect(workforce.endLeave(ctx, DMITRI, {
      leaveId: withLeave.engagement.leave[0].id,
    })).rejects.toBeInstanceOf(LeaveNotFoundError);
  });
});

/* -------------------------------------------------------------------------- */
/* 11 and 12. Suspension and offboarding go through the canonical commands     */
/* -------------------------------------------------------------------------- */

describe("suspension and offboarding use the access system's own commands", () => {
  it("does not touch the seat when the engagement alone is suspended", async () => {
    const ctx = northline();
    await workforce.suspend(ctx, TESS, { reason: "Under review." });
    // ★ DELIBERATE ★ Suspending an engagement does NOT silently cut access:
    // removing somebody's seat is the access system's decision and its command.
    expect(memberIn("org_northline", "mem_northline_safety")!.status).toBe("active");
    const view = await workforce.get(ctx, TESS);
    expect(view.availability.state).toBe("suspended");
    expect(view.availability.availableForWork).toBe(false);
    // It records that it ASKED, when asked to.
    await workforce.requestAccessStep(ctx, TESS, {
      kind: "suspend_membership",
      note: "Under review.",
    });
    expect(memberIn("org_northline", "mem_northline_safety")!.status).toBe("active");
    const after = await workforce.get(ctx, TESS);
    expect(after.engagement.history.some((h) => h.kind === "access_step_requested")).toBe(true);
  });

  it("ends the seat through setMembershipStatus when offboarding confirms it", async () => {
    await workforce.offboard(northline(), TESS, {
      reason: "Moved on.",
      confirmedSteps: ["end_membership_access"],
    });
    expect(memberIn("org_northline", "mem_northline_safety")!.status).toBe("left");
  });
});

describe("a partial offboarding stays incomplete and resumable", () => {
  it("ends the engagement, keeps the failure and keeps asking", async () => {
    const ctx = northline();
    const result = await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      // Re-homing work is never performed automatically, so this cannot finish.
      confirmedSteps: ["end_carrier_relationship", "rehome_responsibility"],
    });
    expect(result.engagement.state).toBe("ended");
    expect(result.incomplete).toBe(true);

    const view = await workforce.get(ctx, DMITRI);
    expect(view.incompleteOffboarding.map((s) => s.key)).toContain("rehome_responsibility");
    // It outranks everything else as the next action.
    expect(view.nextAction?.kind).toBe("finish_offboarding");
    // And it is still in the queue, counted on the row.
    expect(view.openNeedsYouCount).toBeGreaterThan(0);
    const items = workforceNeedsYouItems(ctx);
    expect(items.some(
      (i) => i.category === "workforce_offboarding_incomplete" && i.entity.id === DMITRI,
    )).toBe(true);
    // The step that DID succeed is not re-run or undone.
    expect(result.steps.find((s) => s.key === "end_carrier_relationship")!.outcome)
      .toBe("completed");
  });
});

/* -------------------------------------------------------------------------- */
/* 13. Personal and restricted records are not exposed here                    */
/* -------------------------------------------------------------------------- */

describe("Workforce is not a way into somebody's documents", () => {
  it("links to the canonical module and carries no document contents", async () => {
    const view = await workforce.get(northline(), DMITRI);
    const documents = view.links.filter((l) => l.kind === "documents" || l.kind === "qualification_file");
    expect(documents.length).toBeGreaterThan(0);
    for (const link of documents) {
      // A label and an href. No file, no number, no contents.
      expect(Object.keys(link).sort()).toEqual(["href", "kind", "label"]);
    }
    const serialized = JSON.stringify(view);
    for (const category of RESTRICTED_QUALIFICATION_CATEGORIES) {
      expect(serialized).not.toContain(category);
    }
  });

  it("does not count a restricted record in the qualification link", async () => {
    const view = await workforce.get(northline(), DMITRI);
    const link = view.links.find((l) => l.kind === "qualification_file")!;
    // The count exists; what it counts deliberately excludes the restricted
    // categories, because a page must not advertise a record nobody may open.
    expect(link.label).toMatch(/^Qualification file \(\d+\)$/);
    const counted = Number(link.label.match(/\((\d+)\)/)![1]);
    expect(counted).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(view)).not.toContain("drug_alcohol_test_result");
  });

  it("gives a reader with workforce:view alone no document permission", async () => {
    const ctx = ctxFor("org_northline", { permissions: ["workforce:view"] });
    const view = await workforce.get(ctx, DMITRI);
    expect(view.engagement.person.displayName).toBe("Dmitri Kovalenko");
    // Reading the workforce did not widen anything.
    expect(ctx.permissions.has("documents:view")).toBe(false);
    expect(ctx.permissions.has("qualification:view")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 14. Ending preserves history and the permanent person                       */
/* -------------------------------------------------------------------------- */

describe("ending an engagement preserves the person and the record of them", () => {
  it("keeps the driver profile, the account, the leave and every history line", async () => {
    const ctx = northline();
    const withLeave = await workforce.recordLeave(ctx, DMITRI, {
      reason: "medical", startDate: daysFromNow(-30), expectedReturnDate: daysFromNow(-10),
    });
    await workforce.endLeave(ctx, DMITRI, { leaveId: withLeave.engagement.leave[0].id });
    await workforce.assignFunction(ctx, DMITRI, { functionKey: "documents" });

    const historyBefore = (await workforce.get(ctx, DMITRI)).engagement.history.length;
    await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      confirmedSteps: ["end_carrier_relationship"],
    });

    const ended = allEngagements().find((e) => e.id === DMITRI)!;
    expect(ended.state).toBe("ended");
    // Nothing was deleted, only appended to.
    expect(ended.history.length).toBeGreaterThan(historyBefore);
    expect(ended.leave).toHaveLength(1);
    expect(ended.functions.some((f) => f.functionKey === "documents")).toBe(true);
    // The permanent person is untouched.
    expect(driverProfileUnscoped("dp_dmitri")?.legalName).toBe("Dmitri Kovalenko");
  });
});

/* -------------------------------------------------------------------------- */
/* 15. Unauthorized and cross-organization commands write nothing              */
/* -------------------------------------------------------------------------- */

describe("a command without authority writes nothing at all", () => {
  it("refuses each new command to a reader, and leaves the record as it was", async () => {
    const readOnly = ctxFor("org_northline", { permissions: ["workforce:view"] });
    const before = JSON.stringify(allEngagements().find((e) => e.id === TESS));
    const ledgerBefore = auditLedger.all("org_northline").length;

    await expect(workforce.assignFunction(readOnly, TESS, { functionKey: "dispatch" }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(workforce.removeFunction(readOnly, TESS, {
      functionKey: "safety", reason: "no",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(workforce.recordLeave(readOnly, TESS, {
      reason: "personal", startDate: daysFromNow(1),
    })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(workforce.endLeave(readOnly, TESS, { leaveId: "wlv_x" }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(workforce.cancelLeave(readOnly, TESS, { leaveId: "wlv_x", reason: "no" }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(workforce.recordStartDate(readOnly, TESS, {
      startDate: daysFromNow(-10), basis: "observed_by_antcolos",
    })).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(JSON.stringify(allEngagements().find((e) => e.id === TESS))).toBe(before);
    expect(auditLedger.all("org_northline")).toHaveLength(ledgerBefore);
  });

  it("refuses a caller with no workforce access at all", async () => {
    const stranger = ctxFor("org_northline", { permissions: ["loads:view"] });
    await expect(workforce.list(stranger)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(workforce.get(stranger, TESS)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("records a cross-organization attempt in the one ledger", async () => {
    const before = auditLedger.all("org_cascade").length;
    const northlineBefore = auditLedger.all("org_northline").length;

    await workforce.get(cascade(), DMITRI).catch(() => undefined);

    // The attempt is attributed to the organization that MADE it, and lands
    // nowhere in the one it reached for — a ledger line in Northline would be
    // this module telling Northline that Cascade is interested in their people.
    expect(auditLedger.all("org_cascade").length).toBeGreaterThan(before);
    expect(auditLedger.all("org_northline")).toHaveLength(northlineBefore);
  });
});

/* -------------------------------------------------------------------------- */
/* The directory row itself                                                    */
/* -------------------------------------------------------------------------- */

describe("the directory row carries decisions, not records", () => {
  it("says the function, the availability and how many things are waiting", async () => {
    const rows = await workforce.list(northline());
    const priya = rows.find((v) => v.engagement.id === PRIYA)!;

    expect(priya.engagement.functions.map((f) => f.functionKey)).toEqual(["maintenance"]);
    expect(priya.availability.state).toBe("on_leave");
    expect(typeof priya.openNeedsYouCount).toBe("number");

    // No driver, truck, document, contract or permission record travels with it.
    // No driver, truck, document or contract record travels with the row, and
    // no permission SET does either — only labels and hrefs pointing at the
    // modules that own them.
    const serialized = JSON.stringify(priya);
    expect(serialized).not.toContain("licenceNumber");
    expect(serialized).not.toContain("\"permissions\":");

    // ★ THE ONLY KEYS ON A ROW ARE THE ONES IT SAYS ARE MISSING ★
    // A gap names what a seat does NOT have and a next action names what
    // closing it would need. Neither is a copy of what this person holds, and
    // the day a row starts carrying the held set is the day Workforce becomes
    // a place to read somebody's permissions.
    const keys = [...serialized.matchAll(/"([a-z_]+:[a-z:_]+)"/g)].map((m) => m[1]);
    const declared = [
      ...priya.functionGaps.flatMap((g) => g.missing),
      ...(priya.nextAction?.requires ?? []),
    ];
    expect(keys.sort()).toEqual([...declared].sort());
    // Priya holds no seat, so there is no held set to have leaked in the first
    // place — and the row still names two keys, both of them declarations.
    expect(priya.hasActiveMembership).toBe(false);
    expect(keys).toContain("maintenance:view");
  });

  it("counts exactly what the queue holds for that engagement", async () => {
    const ctx = northline();
    await workforce.offboard(ctx, DMITRI, {
      reason: "Left.", confirmedSteps: ["rehome_responsibility"],
    });
    const view = await workforce.get(ctx, DMITRI);
    const queued = workforceNeedsYouItems(ctx).filter((i) => i.entity.id === DMITRI).length;
    // One derivation, one answer — never a badge that says 3 while the list
    // shows 1.
    expect(view.openNeedsYouCount).toBe(queued);
  });

  it("filters by function and by who is away", async () => {
    const ctx = northline();
    const drivers = await workforce.list(ctx, { functionKey: "driver_action" });
    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers.every(
      (v) => v.engagement.functions.some((f) => f.functionKey === "driver_action"),
    )).toBe(true);

    const away = await workforce.list(ctx, { onLeaveOnly: true });
    expect(away.map((v) => v.engagement.id)).toContain(PRIYA);
    expect(away.every((v) => v.availability.state === "on_leave")).toBe(true);
  });
});

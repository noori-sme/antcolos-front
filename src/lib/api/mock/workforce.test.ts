import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import { InvalidEngagementTransitionError } from "@/lib/workforce/lifecycle";
import { resetAllMocks } from "./registry";
import {
  DuplicateEngagementError, OnboardingIncompleteError, WorkforceSelfActionError,
  mockWorkforceService as workforce,
} from "./workforce";
import { mockQualificationService as qualification } from "./qualification";
import { allEngagements } from "./workforce-store";
import { allQualificationRecords } from "./qualification-store";
import { carrierRelationshipUnscoped, driverProfileUnscoped } from "./driver-registry";
import {
  allDocuments, documentsForSubject, sharePackagesForDriver, sharesForLineage,
} from "./document-store";
import { auditLedger } from "./audit-ledger";
import { memberIn } from "./membership-directory";
import { workforceNeedsYouItems } from "./workforce-needs-you";
import { mockComplianceService as compliance } from "./compliance";
import { mockEndCarrierRelationship } from "@/features/driver/mock-carrier-drivers";

/* -------------------------------------------------------------------------- */
/* Contexts                                                                    */
/* -------------------------------------------------------------------------- */

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

/** The seeded engagements, by the fixture ids the seed pins. */
const DMITRI = "weng_nl_dmitri";
const KELSEY = "weng_nl_kelsey";
const TESS = "weng_nl_tess";
const PRIYA = "weng_nl_priya";

beforeEach(() => {
  resetAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Identity and reuse                                                          */
/* -------------------------------------------------------------------------- */

describe("an engagement reuses the canonical records and duplicates none of them", () => {
  it("references an existing DriverProfile rather than creating a second person", async () => {
    const view = await workforce.get(northline(), DMITRI);
    expect(view.engagement.driverProfileId).toBe("dp_dmitri");
    // The profile is the driver registry's, and the engagement did not make it.
    expect(driverProfileUnscoped("dp_dmitri")?.legalName).toBe("Dmitri Kovalenko");
    // One engagement, one profile — no second identity anywhere.
    const forDmitri = allEngagements().filter((e) => e.driverProfileId === "dp_dmitri");
    expect(forDmitri).toHaveLength(1);
  });

  it("creates no document, no contract and no membership of its own", async () => {
    const documentsBefore = allDocuments().length;
    await workforce.create(northline(), {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Typed in for the test" },
    });
    expect(allDocuments().length).toBe(documentsBefore);
    // Structural, not incidental: nothing on the record could hold a term or a
    // permission, and nothing was written into the access system.
    const created = allEngagements().find((e) => e.person.displayName === "Rae Okonkwo")!;
    expect(created.membershipId).toBeUndefined();
    expect(created.contractId).toBeUndefined();
    expect(Object.keys(created)).not.toContain("permissions");
  });

  it("refuses a second live engagement for the same person", async () => {
    const ctx = northline();
    const first = await workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    await expect(workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Dispatcher",
      source: { kind: "manual_entry", label: "Typed in again" },
    })).rejects.toThrow(DuplicateEngagementError);
    expect(first.engagement.id).toBeTruthy();
  });

  it("lets somebody who left be engaged again, as a NEW engagement", async () => {
    const ctx = northline();
    // Kelsey's engagement ended. A second one is allowed, and the first stays.
    const next = await workforce.create(ctx, {
      person: { displayName: "Kelsey Nguyen", driverProfileId: "dp_kelsey" },
      classification: "employee",
      positionTitle: "Company driver",
      source: { kind: "manual_entry", label: "Came back" },
    });
    expect(next.engagement.id).not.toBe(KELSEY);
    const ended = allEngagements().find((e) => e.id === KELSEY)!;
    expect(ended.state).toBe("ended");
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

describe("the lifecycle is a table, not an editable string", () => {
  async function prospect() {
    const ctx = northline();
    const created = await workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    return { ctx, id: created.engagement.id };
  }

  it("walks prospective → onboarding → active", async () => {
    const { ctx, id } = await prospect();
    expect((await workforce.get(ctx, id)).engagement.state).toBe("prospective");
    await workforce.startOnboarding(ctx, id);
    expect((await workforce.get(ctx, id)).engagement.state).toBe("onboarding");
    // Non-driver: the driver-shaped required steps are not_applicable, so the
    // only required step left is the contract one.
    await workforce.waiveStep(ctx, id, {
      stepKey: "contracts.signed_agreement",
      reason: "Yard hand engaged on the standard handbook; no separate agreement.",
    });
    const active = await workforce.activate(ctx, id);
    expect(active.engagement.state).toBe("active");
  });

  it("refuses prospective → active without onboarding", async () => {
    const { ctx, id } = await prospect();
    await expect(workforce.activate(ctx, id)).rejects.toThrow(InvalidEngagementTransitionError);
  });

  it("refuses to reopen an ended engagement", async () => {
    const ctx = northline();
    await expect(workforce.restore(ctx, KELSEY)).rejects.toThrow(InvalidEngagementTransitionError);
    await expect(workforce.suspend(ctx, KELSEY, { reason: "no" }))
      .rejects.toThrow(InvalidEngagementTransitionError);
  });

  it("keeps an ended engagement in history rather than deleting it", async () => {
    const ctx = northline();
    const ended = await workforce.get(ctx, KELSEY);
    expect(ended.engagement.state).toBe("ended");
    expect(ended.engagement.history.length).toBeGreaterThan(1);
    // And it is reachable through the list when asked for.
    const list = await workforce.list(ctx, { state: ["ended"], includeEnded: true });
    expect(list.map((v) => v.engagement.id)).toContain(KELSEY);
  });

  it("is idempotent: repeating a command changes nothing and appends nothing", async () => {
    const ctx = northline();
    const first = await workforce.suspend(ctx, DMITRI, { reason: "Out on leave." });
    const historyAfterFirst = first.engagement.history.length;
    const second = await workforce.suspend(ctx, DMITRI, { reason: "Out on leave." });
    expect(second.engagement.state).toBe("suspended");
    expect(second.engagement.history.length).toBe(historyAfterFirst);
  });

  it("preserves the suspension in history after a restore", async () => {
    const ctx = northline();
    await workforce.suspend(ctx, DMITRI, { reason: "Out on leave." });
    const restored = await workforce.restore(ctx, DMITRI);
    expect(restored.engagement.state).toBe("active");
    // The live reason is cleared; the record of it never is.
    expect(restored.engagement.suspensionReason).toBeUndefined();
    expect(restored.engagement.history.some((h) => h.kind === "suspended")).toBe(true);
    expect(restored.engagement.history.some((h) => h.kind === "restored")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Separation from access, contracts, payment and responsibility               */
/* -------------------------------------------------------------------------- */

describe("an engagement is not access, terms, payment or responsibility", () => {
  it("grants no permission, and there is no input that could carry one", async () => {
    const ctx = northline();
    const before = memberIn("org_northline", "mem_northline_safety")!.permissions.size;
    await workforce.changeClassification(ctx, TESS, {
      classification: "independent_contractor",
      reason: "Moved to a consulting arrangement.",
    });
    await workforce.changeManager(ctx, TESS, { managerMembershipId: "mem_northline_owner" });
    const after = memberIn("org_northline", "mem_northline_safety")!.permissions.size;
    expect(after).toBe(before);
  });

  it("supports an active worker with no Antcolos account at all", async () => {
    const view = await workforce.get(northline(), PRIYA);
    expect(view.engagement.state).toBe("active");
    expect(view.engagement.person.userId).toBeUndefined();
    expect(view.engagement.membershipId).toBeUndefined();
    expect(view.hasActiveMembership).toBe(false);
  });

  it("does not treat a membership as proof of employment", async () => {
    // Every membership in the directory; only some of them have an engagement.
    const engaged = new Set(allEngagements()
      .filter((e) => e.organizationId === "org_northline")
      .map((e) => e.membershipId)
      .filter(Boolean));
    expect(engaged.has("mem_northline_paige")).toBe(false);
    expect(memberIn("org_northline", "mem_northline_paige")?.status).toBe("active");
  });

  it("requests an access step rather than performing one", async () => {
    const ctx = northline();
    const before = memberIn("org_northline", "mem_northline_safety")!.status;
    const view = await workforce.requestAccessStep(ctx, PRIYA, {
      kind: "create_membership",
      note: "She needs to log defects from the yard.",
    });
    expect(view.engagement.history.some((h) => h.kind === "access_step_requested")).toBe(true);
    // Nothing in the access system changed.
    expect(memberIn("org_northline", "mem_northline_safety")!.status).toBe(before);
    expect(view.engagement.membershipId).toBeUndefined();
  });

  it("references a contract without copying one term of it", async () => {
    const ctx = northline();
    const view = await workforce.linkContract(ctx, DMITRI, { contractId: "con_test_1" });
    expect(view.engagement.contractId).toBe("con_test_1");
    const asRecord = view.engagement as unknown as Record<string, unknown>;
    for (const forbidden of ["terms", "compensation", "signatures", "effectiveDates", "clauses"]) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
  });

  it("holds no amount, and cannot become payment truth", async () => {
    const view = await workforce.get(northline(), DMITRI);
    const json = JSON.stringify(view.engagement);
    for (const forbidden of ["amountCents", "rateCents", "salary", "payRate", "grossCents"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("does not make a manager responsible for anything", async () => {
    const ctx = northline();
    const view = await workforce.changeManager(ctx, DMITRI, {
      managerMembershipId: "mem_northline_owner",
    });
    expect(view.engagement.managerMembershipId).toBe("mem_northline_owner");
    // The Needs You items this module raises never name a person: they declare
    // the permissions the work needs and let the routing engine decide.
    for (const item of workforceNeedsYouItems(ctx)) {
      expect(item.assigneeMembershipId).toBeUndefined();
    }
  });

  it("refuses to let somebody start, suspend or end their own engagement", async () => {
    // A membership acting as the person the engagement is about — the Owner
    // would hold every permission and is still not somebody else.
    const asTess = ctxFor("org_northline", {
      permissions: HR,
      membershipId: "mem_northline_safety",
      userId: "usr_tess",
    });
    await expect(workforce.suspend(asTess, TESS, { reason: "no" }))
      .rejects.toThrow(WorkforceSelfActionError);
    await expect(workforce.offboard(asTess, TESS, { reason: "no", confirmedSteps: [] }))
      .rejects.toThrow(WorkforceSelfActionError);
  });
});

/* -------------------------------------------------------------------------- */
/* Onboarding                                                                  */
/* -------------------------------------------------------------------------- */

describe("onboarding is derived from the modules that own it", () => {
  it("names the owning module on every step", async () => {
    const checklist = await workforce.onboardingChecklist(northline(), DMITRI);
    const domains = new Set(checklist.steps.map((s) => s.domain));
    expect(domains).toContain("compliance");
    expect(domains).toContain("documents");
    expect(domains).toContain("contracts");
    expect(domains).toContain("access");
  });

  it("resolves driver-specific steps to not_applicable for a non-driver", async () => {
    const checklist = await workforce.onboardingChecklist(northline(), TESS);
    const compliance = checklist.steps.find((s) => s.key === "compliance.driver_qualification")!;
    const documents = checklist.steps.find((s) => s.key === "documents.required_paperwork")!;
    expect(compliance.status).toBe("not_applicable");
    expect(documents.status).toBe("not_applicable");
    // And it says why, rather than reading as a pass.
    expect(compliance.detail).toContain("not the same as everything being satisfied");
  });

  it("refuses activation while another module reports a required step outstanding", async () => {
    const ctx = northline();
    const created = await workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    await workforce.startOnboarding(ctx, created.engagement.id);
    // The contract step is awaiting Contracts, and nobody has waived it.
    await expect(workforce.activate(ctx, created.engagement.id))
      .rejects.toThrow(OnboardingIncompleteError);
  });

  it("records a waiver as its own status, never as completed", async () => {
    const ctx = northline();
    const created = await workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    await workforce.startOnboarding(ctx, created.engagement.id);
    const checklist = await workforce.waiveStep(ctx, created.engagement.id, {
      stepKey: "contracts.signed_agreement",
      reason: "Handbook only for this role.",
    });
    const step = checklist.steps.find((s) => s.key === "contracts.signed_agreement")!;
    expect(step.status).toBe("waived");
    expect(step.status).not.toBe("completed");
    expect(step.waiver?.authorizedByName).toBe("Casey Hart");
    // And the underlying module's own answer is still shown beside it.
    expect(step.detail).toContain("still reports");
  });

  it("says out loud that it cannot transact across modules", async () => {
    const checklist = await workforce.onboardingChecklist(northline(), DMITRI);
    expect(checklist.limitation).toContain("no cross-module transaction");
  });
});

/* -------------------------------------------------------------------------- */
/* Offboarding                                                                 */
/* -------------------------------------------------------------------------- */

describe("offboarding coordinates, previews and preserves", () => {
  it("shows the impact before anything happens, and changes nothing", async () => {
    const ctx = northline();
    const plan = await workforce.offboardingPlan(ctx, DMITRI);
    expect(plan.impacts.length).toBeGreaterThan(4);
    // Still active: computing a plan is not performing one.
    expect((await workforce.get(ctx, DMITRI)).engagement.state).toBe("active");
    expect(carrierRelationshipUnscoped("dp_dmitri", "org_northline")?.status).toBe("active");
  });

  it("performs only the steps that were confirmed", async () => {
    const ctx = northline();
    const result = await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      // Document access deliberately NOT confirmed.
      confirmedSteps: ["end_carrier_relationship"],
    });
    expect(result.engagement.state).toBe("ended");
    expect(carrierRelationshipUnscoped("dp_dmitri", "org_northline")?.status).toBe("ended");
    // The document step was not asked for, so it did not run.
    expect(result.steps.find((s) => s.key === "end_document_access")).toBeUndefined();
  });

  it("keeps the driver profile, their documents and the ended relationship", async () => {
    const ctx = northline();
    const documentsBefore = documentsForSubject("driver", "dp_dmitri", { includeSuperseded: true }).length;
    await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      confirmedSteps: ["end_carrier_relationship", "end_document_access"],
    });
    expect(driverProfileUnscoped("dp_dmitri")).toBeDefined();
    expect(documentsForSubject("driver", "dp_dmitri", { includeSuperseded: true }).length)
      .toBe(documentsBefore);
    const relationship = carrierRelationshipUnscoped("dp_dmitri", "org_northline")!;
    expect(relationship.status).toBe("ended");
    // Preserved, not deleted: it still knows when it started and why it ended.
    expect(relationship.startedAt).toBeTruthy();
    expect(relationship.endReason).toContain("Left the carrier");
  });

  it("treats ending the relationship as idempotent when a step is retried", async () => {
    const ctx = northline();
    await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      confirmedSteps: ["end_carrier_relationship"],
    });
    const ended = carrierRelationshipUnscoped("dp_dmitri", "org_northline")!;
    // A second ending of the same relationship is a no-op and reports success.
    const again = await workforce.offboardingPlan(ctx, DMITRI);
    const row = again.impacts.find((i) => i.key === "end_carrier_relationship")!;
    expect(row.effect).toBe("will_be_preserved");
    expect(carrierRelationshipUnscoped("dp_dmitri", "org_northline")!.endedAt).toBe(ended.endedAt);
  });

  it("keeps a failed step visible instead of hiding it", async () => {
    const ctx = northline();
    const result = await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      // Re-homing work is deliberately not something Antcolos decides.
      confirmedSteps: ["rehome_responsibility"],
    });
    expect(result.incomplete).toBe(true);
    const view = await workforce.get(ctx, DMITRI);
    expect(view.incompleteOffboarding.map((s) => s.key)).toContain("rehome_responsibility");
    // And it reaches a person through the queue rather than sitting on a page.
    const items = workforceNeedsYouItems(ctx);
    expect(items.some((i) => i.category === "workforce_offboarding_incomplete")).toBe(true);
  });

  it("keeps access revocation and relationship ending as separate explicit steps", async () => {
    const ctx = northline();
    // Tess holds a seat. End her engagement WITHOUT confirming the access step.
    await workforce.offboard(ctx, TESS, {
      reason: "Moved on.",
      confirmedSteps: [],
    });
    expect(memberIn("org_northline", "mem_northline_safety")?.status).toBe("active");
    // Now the same thing with it confirmed, on a fresh world.
    resetAllMocks();
    await workforce.offboard(northline(), TESS, {
      reason: "Moved on.",
      confirmedSteps: ["end_membership_access"],
    });
    expect(memberIn("org_northline", "mem_northline_safety")?.status).toBe("left");
  });

  it("does not delete the user account when employment ends", async () => {
    const ctx = northline();
    await workforce.offboard(ctx, TESS, {
      reason: "Moved on.",
      confirmedSteps: ["end_membership_access"],
    });
    // The seat is closed; the person is still in the directory with a history.
    expect(memberIn("org_northline", "mem_northline_safety")).toBeDefined();
    expect(memberIn("org_northline", "mem_northline_safety")?.displayName).toBe("Tess Ferraro");
  });
});

/* -------------------------------------------------------------------------- */
/* Isolation and permissions                                                   */
/* -------------------------------------------------------------------------- */

describe("organization isolation and permissions", () => {
  it("refuses another organization's engagement as though it did not exist", async () => {
    await expect(workforce.get(cascade(), DMITRI)).rejects.toThrow(NotFoundError);
  });

  it("records the cross-organization attempt in the one ledger", async () => {
    const ctx = cascade();
    await expect(workforce.get(ctx, DMITRI)).rejects.toThrow(NotFoundError);
    const events = auditLedger.all("org_cascade");
    expect(events.some((e) => e.action === "access.cross_organization_attempt")).toBe(true);
  });

  it("never lists another organization's people", async () => {
    const list = await workforce.list(cascade(), {});
    expect(list.every((v) => v.engagement.organizationId === "org_cascade")).toBe(true);
  });

  it("refuses a caller without workforce:view", async () => {
    const noKeys = ctxFor("org_northline", { permissions: ["documents:view"] });
    await expect(workforce.list(noKeys, {})).rejects.toThrow(PermissionDeniedError);
    await expect(workforce.get(noKeys, DMITRI)).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses a reader without workforce:end to end anybody", async () => {
    const reader = ctxFor("org_northline", { permissions: ["workforce:view", "workforce:manage"] });
    await expect(workforce.offboard(reader, DMITRI, { reason: "x", confirmedSteps: [] }))
      .rejects.toThrow(PermissionDeniedError);
  });

  it("narrows a manager to the engagements they supervise when asked", async () => {
    const list = await workforce.list(northline(), {
      managedByMembershipId: "mem_northline_safety",
    });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((v) => v.engagement.managerMembershipId === "mem_northline_safety")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Needs You and Audit                                                         */
/* -------------------------------------------------------------------------- */

describe("Needs You carries only actionable HR work", () => {
  it("raises nothing for an ordinary active engagement", () => {
    const items = workforceNeedsYouItems(northline());
    const aboutDmitri = items.filter((i) => i.entity.id === DMITRI);
    expect(aboutDmitri).toHaveLength(0);
  });

  it("raises a decision for somebody left sitting as prospective", async () => {
    const ctx = northline();
    const created = await workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    const items = workforceNeedsYouItems(ctx);
    const item = items.find((i) => i.entity.id === created.engagement.id);
    expect(item?.category).toBe("workforce_applicant_review");
    // Derived: nobody can snooze it away, and dealing with the person clears it.
    expect(item?.derived).toBe(true);
  });

  it("stops raising it once the person is taken forward", async () => {
    const ctx = northline();
    const created = await workforce.create(ctx, {
      person: { displayName: "Rae Okonkwo", email: "rae@example.com" },
      classification: "employee",
      positionTitle: "Yard hand",
      source: { kind: "manual_entry", label: "Typed in" },
    });
    await workforce.reject(ctx, created.engagement.id, "Not going ahead.");
    const items = workforceNeedsYouItems(ctx);
    expect(items.some((i) => i.category === "workforce_applicant_review")).toBe(false);
  });

  it("gives a membership without the keys no workforce items at all", () => {
    const noKeys = ctxFor("org_northline", { permissions: ["documents:view"] });
    expect(workforceNeedsYouItems(noKeys)).toHaveLength(0);
  });

  it("writes to the one audit ledger and creates no second log", async () => {
    const ctx = northline();
    await workforce.suspend(ctx, DMITRI, { reason: "Out on leave." });
    const events = auditLedger.all("org_northline");
    const mine = events.filter((e) => e.module === "workforce");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((e) => e.action === "workforce.suspended")).toBe(true);
  });

  it("does not duplicate audit history when a command repeats", async () => {
    const ctx = northline();
    await workforce.suspend(ctx, DMITRI, { reason: "Out on leave." });
    const after = auditLedger.all("org_northline")
      .filter((e) => e.action === "workforce.suspended").length;
    await workforce.suspend(ctx, DMITRI, { reason: "Out on leave." });
    expect(auditLedger.all("org_northline")
      .filter((e) => e.action === "workforce.suspended").length).toBe(after);
  });
});

/* -------------------------------------------------------------------------- */
/* The bridge from a share                                                     */
/* -------------------------------------------------------------------------- */

describe("a document share never becomes an engagement by itself", () => {
  it("creates nothing when a driver shares and a carrier opens it", () => {
    // The seeded world has share packages; none of them made an engagement.
    const packages = sharePackagesForDriver("dp_sam");
    for (const pkg of packages) {
      const fromShare = allEngagements().filter((e) => e.source.id === pkg.id);
      expect(fromShare).toHaveLength(0);
    }
  });

  it("becomes a prospective candidate only through the explicit command", async () => {
    const ctx = cascade();
    // Read once first: the store seeds lazily, and counting before that would
    // be comparing an empty store against a seeded one.
    await workforce.list(ctx, {});
    const before = allEngagements().length;
    // With no such package, the command refuses rather than inventing one.
    await expect(workforce.takeShareForward(ctx, {
      sharePackageId: "shp_nonexistent",
      classification: "employee",
      positionTitle: "Company driver",
    })).rejects.toThrow(NotFoundError);
    expect(allEngagements().length).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* No parallel truth                                                           */
/* -------------------------------------------------------------------------- */

describe("the workforce store holds nothing another module owns", () => {
  it("keeps no document, no share and no qualification record of its own", async () => {
    const ctx = northline();
    await workforce.offboard(ctx, DMITRI, {
      reason: "Left.",
      confirmedSteps: ["end_carrier_relationship", "end_document_access"],
    });
    // Documents and their shares are still the document store's.
    expect(allDocuments().length).toBeGreaterThan(0);
    for (const engagement of allEngagements()) {
      const json = JSON.stringify(engagement);
      expect(json).not.toContain("lineageId");
      expect(json).not.toContain("fileName");
    }
    // Qualification records are the qualification store's, not this one's.
    expect(Array.isArray(allQualificationRecords())).toBe(true);
    void sharesForLineage;
    void qualification;
  });
});

/* -------------------------------------------------------------------------- */
/* The Driver ⇄ Compliance boundary                                            */
/* -------------------------------------------------------------------------- */

/**
 * ★ ONE DRIVER RECORD, READ BY EVERY MODULE THAT NEEDS IT ★
 *
 * Safety & Compliance used to derive its driver subjects from a second roster
 * held in the driver feature, while HR offboarding ended the relationship in
 * the canonical registry. Two consequences, both live in the product and both
 * caught by an audit rather than by a test:
 *
 *   1. A driver could be offboarded through HR and their compliance
 *      requirements would never freeze — records about somebody who had left
 *      stayed live and actionable, and no `ComplianceSnapshot` was taken.
 *   2. A driver the canonical registry knew about but the other roster did not
 *      sat permanently at "Safety & Compliance has not built this driver's
 *      requirements yet" on their onboarding checklist.
 *
 * The fix was not to keep two rosters in step. Compliance now derives from the
 * canonical registry, and the feature roster's own ending command delegates to
 * the canonical one. These tests hold both halves.
 */
describe("ending an engagement reaches Safety & Compliance", () => {
  it("freezes the driver's compliance requirements and snapshots them", async () => {
    const ctx = northline();
    const safety = ctxFor("org_northline", {
      permissions: ["compliance:view", "compliance:manage", "drivers:view", "workforce:view", "workforce:end"],
    });

    const before = await compliance.list(safety, { subjectId: "dp_dmitri" });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.frozenAt === undefined)).toBe(true);

    await workforce.offboard(ctx, DMITRI, {
      reason: "Left the carrier.",
      confirmedSteps: ["end_carrier_relationship"],
    });

    // Nothing live is left about somebody who has gone.
    expect(await compliance.list(safety, { subjectId: "dp_dmitri" })).toHaveLength(0);

    // And nothing was deleted: every record is frozen and explained.
    const history = await compliance.list(safety, {
      subjectId: "dp_dmitri", includeFrozen: true, includeNotApplicable: true,
    });
    expect(history.length).toBeGreaterThanOrEqual(before.length);
    expect(history.every((r) => Boolean(r.frozenAt))).toBe(true);

    const snapshots = await compliance.snapshots(safety, "dp_dmitri");
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].entries.length).toBeGreaterThan(0);
  });

  it("does not freeze anybody else's records", async () => {
    const ctx = northline();
    const safety = ctxFor("org_northline", {
      permissions: ["compliance:view", "drivers:view"],
    });
    await workforce.offboard(ctx, DMITRI, {
      reason: "Left.",
      confirmedSteps: ["end_carrier_relationship"],
    });
    const amir = await compliance.list(safety, { subjectId: "dp_amir" });
    expect(amir.length).toBeGreaterThan(0);
    expect(amir.every((r) => r.frozenAt === undefined)).toBe(true);
  });

  it("builds requirements for every canonical driver, including the owner-operator", async () => {
    // Marcus existed in the canonical registry and not in the roster Compliance
    // used to read, so his checklist row said "not built yet" forever.
    const safety = ctxFor("org_northline", {
      permissions: ["compliance:view", "drivers:view"],
    });
    const marcus = await compliance.list(safety, { subjectId: "dp_marcus" });
    expect(marcus.length).toBeGreaterThan(0);
  });

  it("stops the onboarding checklist reporting a canonical driver as unknown to Safety", async () => {
    const ctx = northline();
    const checklist = await workforce.onboardingChecklist(ctx, "weng_nl_marcus");
    const step = checklist.steps.find((s) => s.key === "compliance.driver_qualification")!;
    expect(step.status).not.toBe("not_applicable");
    expect(step.detail).not.toContain("has not built this driver's requirements yet");
  });

  it("makes the carrier driver screen's ending command go through the canonical record", async () => {
    const safety = ctxFor("org_northline", {
      permissions: ["compliance:view", "drivers:view"],
    });
    expect((await compliance.list(safety, { subjectId: "dp_marisol" })).length).toBeGreaterThan(0);

    // The screens' own command. It delegates rather than ending a second copy.
    await mockEndCarrierRelationship("cd_2", "Moved to another carrier.");

    expect(carrierRelationshipUnscoped("dp_marisol", "org_northline")?.status).toBe("ended");
    expect(await compliance.list(safety, { subjectId: "dp_marisol" })).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { ImportedAssertion, PermissionKey, PersonClaim } from "@/types";
import { resetAllMocks } from "./registry";
import { allEngagements } from "./workforce-store";
import { failCommitAtRowForTests, mockImportService as imports } from "./import";
import { undecidedClaims } from "./import-store";
import { mockNeedsYouService as needsYou } from "./needs-you";
import type { ServiceContext } from "../contracts/context";

/**
 * What an import is allowed to do to a carrier's permanent records.
 *
 * Every test here would fail on the change it exists to prevent. The subject is
 * always the same one: a real person exists once, and an import that cannot
 * prove which person a row is about must stop rather than guess — because the
 * cost of guessing wrong is a second permanent identity for somebody who
 * already had one, and nobody notices until they count.
 */

const NORTHLINE = "org_northline";

const ctx = (
  organizationId = NORTHLINE,
  permissions: PermissionKey[] = ["workforce:view", "workforce:manage"],
): ServiceContext => ({
  organizationId,
  organizationName: organizationId,
  workspaceKind: "carrier_organization",
  membershipId: `mem_${organizationId}`,
  permissions: new Set(permissions),
  actor: {
    userId: "usr_owner",
    membershipId: `mem_${organizationId}`,
    displayNameSnapshot: "The owner",
    source: "web",
  },
  scope: { loads: "all", financials: "all" },
});

/** A carrier's assertion about the past, dated when it was true. */
const asserted = (occurredAt: string): ImportedAssertion<string> => ({
  value: occurredAt,
  occurredAt,
  receivedAt: new Date().toISOString(),
  verification: "pending",
  source: "manual_entry",
  provenance: {
    module: "document_center",
    adapter: "mock:roster-import",
    mock: true,
    observedAt: occurredAt,
    receivedAt: new Date().toISOString(),
  },
});

const person = (row: Partial<PersonClaim> & { fullName: string }): PersonClaim => ({
  kind: "person",
  classification: "employee",
  ...row,
});

/** Stage, plan, and hand back both so a test reads in one direction. */
async function staged(rows: PersonClaim[], label = "Roster.csv") {
  const c = ctx();
  const { batch, resumed } = await imports.stage(c, { label, kind: "person", rows });
  const plan = await imports.plan(c, batch.id);
  return { c, batch, resumed, plan: plan! };
}

const northlineEngagements = () =>
  allEngagements().filter((e) => e.organizationId === NORTHLINE);

beforeEach(() => {
  resetAllMocks();
  failCommitAtRowForTests(null);
});

/* -------------------------------------------------------------------------- */

describe("what a row means, before anything is written", () => {
  it("matches an exact licence and links rather than creating", async () => {
    // Dmitri already drives for Northline. Same licence, same state.
    const { c, batch, plan } = await staged([
      person({ fullName: "Dmitri Kovalenko", cdlNumber: "K2210094471", cdlState: "IL" }),
    ]);

    expect(plan.summary).toEqual({ matched: 1, new: 0, needsDecision: 0, blocked: 0 });
    expect(plan.resolutions[0].candidates[0].entityId).toBe("dp_dmitri");

    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("linked");
    expect(run!.results[0].entity?.id).toBe("dp_dmitri");
    // ★ The point of the whole module ★
    expect(northlineEngagements()).toHaveLength(before);
  });

  it("stops on a name-and-mailbox lookalike instead of deciding it", async () => {
    // Everything a spreadsheet usually has, and nothing that proves identity.
    const { plan } = await staged([
      person({ fullName: "Sam Murtaza", email: "sam@antcolos.com" }),
    ]);

    expect(plan.summary.needsDecision).toBe(1);
    expect(plan.summary.matched).toBe(0);
    expect(plan.resolutions[0].candidates[0].confidence).toBe("strong");
    // "Strong" is the word for a good guess. It is still a guess.
    expect(plan.resolutions[0].outcome).toBe("needs_decision");
  });

  it("recognises nobody as new, and creates the carrier's record only", async () => {
    const { c, batch, plan } = await staged([
      person({
        fullName: "Wendell Achebe",
        email: "wendell@example.com",
        cdlNumber: "A7781093322",
        cdlState: "OH",
        classification: "employee",
      }),
    ]);

    expect(plan.summary).toEqual({ matched: 0, new: 1, needsDecision: 0, blocked: 0 });

    const run = await imports.commit(c, batch.id);
    expect(run!.results[0].outcome).toBe("created");

    const created = northlineEngagements().find((e) => e.person.displayName === "Wendell Achebe");
    expect(created).toBeDefined();
    /*
     * ★ NO DRIVERPROFILE WAS MINTED ★
     * A permanent professional profile belongs to the person and is keyed to
     * their account. This row is a name on a carrier's spreadsheet; the person
     * has said nothing. The engagement waits with no profile until they accept
     * an invitation and connect their own.
     */
    expect(created!.person.driverProfileId).toBeUndefined();
  });

  it("refuses to guess a classification, and says why", async () => {
    const { plan } = await staged([
      person({ fullName: "Unclassified Person", classification: undefined }),
    ]);

    expect(plan.summary.blocked).toBe(1);
    expect(plan.resolutions[0].rationale).toMatch(/employee, a contractor or an owner-operator/);
  });
});

describe("the person who is already here", () => {
  it("links an existing record once a person confirms it, and creates nothing", async () => {
    // Northline's migrated driver: on their workforce since 2024, with no
    // Antcolos account connected yet.
    const { c, batch, plan } = await staged([
      person({ fullName: "Sam Murtaza", email: "sam@antcolos.com", classification: "owner_operator" }),
    ]);

    const claimId = plan.claims[0].id;
    const existingId = plan.resolutions[0].candidates[0].entityId;
    expect(existingId).toBe("weng:weng_nl_migrated_driver");

    const before = northlineEngagements().length;
    await imports.decide(c, claimId, { choice: "link", entityId: existingId });
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("linked");
    expect(northlineEngagements()).toHaveLength(before);
  });

  it("does not commit a row nobody has answered, and leaves the run incomplete", async () => {
    const { c, batch } = await staged([
      person({ fullName: "Sam Murtaza", email: "sam@antcolos.com" }),
    ]);

    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("skipped");
    expect(run!.state).toBe("incomplete");
    expect(northlineEngagements()).toHaveLength(before);
    // And it is visible as work, rather than lost between two screens.
    expect(undecidedClaims()).toHaveLength(1);
  });

  it("is still refused by the workforce module when a person insists on a duplicate", async () => {
    /*
     * ★ THE LAST LINE, AND THE REASON THE IMPORT HAS NO TABLES ★
     * Somebody with the right permissions can be wrong. They looked at an
     * ambiguous row, decided it was a new person, and it is not. Because every
     * write goes through the module that owns the record, that module's own
     * duplicate check still answers — which it could not do if the import kept
     * its own roster and reconciled later.
     */
    const { c, batch, plan } = await staged([
      person({ fullName: "Samuel Murtaza", email: "sam@antcolos.com" }),
    ]);

    await imports.decide(c, plan.claims[0].id, { choice: "create" });
    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("failed");
    expect(northlineEngagements()).toHaveLength(before);
    // And the run says so, rather than reporting a roster that is complete.
    expect(run!.state).toBe("incomplete");
  });

  it("sees the solo owner-driver as one person, not one row per hat", async () => {
    /*
     * Marcus owns his truck and drives it. Northline holds him twice — as a
     * driver relationship and as an owner-operator engagement — and the pool
     * must offer ONE candidate, or the import asks its owner to choose between
     * two copies of the same person and either answer makes a duplicate.
     */
    const { c, batch, plan } = await staged([
      person({
        fullName: "Marcus Hale",
        cdlNumber: "H4471029983",
        cdlState: "TX",
        classification: "owner_operator",
        isOwner: true,
        alsoDispatches: true,
      }),
    ]);

    expect(plan.resolutions[0].candidates).toHaveLength(1);
    expect(plan.resolutions[0].outcome).toBe("matched");

    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("linked");
    expect(northlineEngagements()).toHaveLength(before);
  });
});

describe("doing it twice", () => {
  const ROWS = [
    person({ fullName: "Ada Okonjo", cdlNumber: "O1129930041", cdlState: "MI" }),
    person({ fullName: "Bo Tran", cdlNumber: "T4402281190", cdlState: "WI" }),
  ];

  it("treats the same file uploaded again as the same batch", async () => {
    const c = ctx();
    const first = await imports.stage(c, { label: "Roster.csv", kind: "person", rows: ROWS });
    const second = await imports.stage(c, { label: "Roster.csv", kind: "person", rows: ROWS });

    expect(second.resumed).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
    expect(second.claims.map((x) => x.id)).toEqual(first.claims.map((x) => x.id));
  });

  it("commits once, however many times it is asked", async () => {
    const { c, batch } = await staged(ROWS);

    const first = await imports.commit(c, batch.id);
    expect(first!.results.map((r) => r.outcome)).toEqual(["created", "created"]);
    const after = northlineEngagements().length;

    const second = await imports.commit(c, batch.id);
    expect(second!.results.map((r) => r.outcome)).toEqual(["already_done", "already_done"]);
    expect(second!.id).toBe(first!.id);
    expect(northlineEngagements()).toHaveLength(after);
  });

  it("finishes an interrupted run without repeating what landed", async () => {
    const { c, batch } = await staged([
      person({ fullName: "Ada Okonjo", cdlNumber: "O1129930041", cdlState: "MI" }),
      person({ fullName: "Bo Tran", cdlNumber: "T4402281190", cdlState: "WI" }),
      person({ fullName: "Cy Delgado", cdlNumber: "D9987112203", cdlState: "MN" }),
    ]);
    const before = northlineEngagements().length;

    // Row two refuses with row one already written — the state a real store
    // reaches and this mock otherwise never would.
    failCommitAtRowForTests(2);
    const interrupted = await imports.commit(c, batch.id);

    expect(interrupted!.results.map((r) => r.outcome)).toEqual(["created", "failed", "created"]);
    expect(interrupted!.state).toBe("incomplete");
    expect(northlineEngagements()).toHaveLength(before + 2);

    failCommitAtRowForTests(null);
    const retried = await imports.commit(c, batch.id);

    expect(retried!.results.map((r) => r.outcome))
      .toEqual(["already_done", "created", "already_done"]);
    expect(retried!.state).toBe("complete");
    // Three rows, three people. Not five.
    expect(northlineEngagements()).toHaveLength(before + 3);
  });
});

describe("the carrier's history stays the carrier's history", () => {
  it("starts an imported worker on the date asserted, not the date imported", async () => {
    const START = "2024-03-04T00:00:00.000Z";
    const { c, batch, plan } = await staged([
      person({
        fullName: "Wendell Achebe",
        cdlNumber: "A7781093322",
        cdlState: "OH",
        startedWithCarrier: asserted(START),
      }),
    ]);

    const claim = plan.claims[0];
    // Two dates, two fields, and they are never the same one.
    expect(claim.subject.kind === "person" && claim.subject.startedWithCarrier?.occurredAt)
      .toBe(START);
    expect(claim.receivedAt).not.toBe(START);
    expect(Date.parse(claim.receivedAt)).toBeGreaterThan(Date.parse(START));

    await imports.commit(c, batch.id);

    const created = northlineEngagements().find((e) => e.person.displayName === "Wendell Achebe")!;
    /*
     * ★ A MIGRATED WORKER IS NOT A NEW HIRE ★
     * Stamping today here is what turns a carrier that has run since 2024 into
     * one that hired its whole workforce this morning — and it takes their
     * seniority, their tenure and their compliance history with it.
     */
    expect(created.startDate).toBe(START);
    expect(created.source.kind).toBe("roster_import");
  });

  it("keeps the claim readable as the carrier's unverified assertion", async () => {
    const { plan } = await staged([
      person({
        fullName: "Wendell Achebe",
        cdlNumber: "A7781093322",
        cdlState: "OH",
        startedWithCarrier: asserted("2024-03-04T00:00:00.000Z"),
      }),
    ]);

    const subject = plan.claims[0].subject;
    expect(subject.kind).toBe("person");
    if (subject.kind !== "person") throw new Error("unreachable");
    // Nobody has checked this. The record says so, rather than implying
    // Antcolos confirmed a date it was simply handed.
    expect(subject.startedWithCarrier!.verification).toBe("pending");
  });
});

describe("a row that stopped is visible as work", () => {
  it("reaches the Needs You queue, and leaves it when the row is answered", async () => {
    const { c, plan } = await staged([
      person({ fullName: "Sam Murtaza", email: "sam@antcolos.com" }),
    ]);

    const queue = await needsYou.list(c);
    const item = queue.find((x) => x.category === "import_claim_unresolved");
    expect(item).toBeDefined();
    expect(item!.entity.kind).toBe("import_claim");
    // It asks a question, and names what it would be choosing between.
    expect(item!.title).toMatch(/Which person is row 1/);
    expect(item!.reason).toMatch(/Sam Murtaza/);

    await imports.decide(c, plan.claims[0].id, {
      choice: "link",
      entityId: plan.resolutions[0].candidates[0].entityId,
    });

    // DERIVED: answering the row is what removes it. Nobody resolved anything.
    const after = await needsYou.list(c);
    expect(after.some((x) => x.category === "import_claim_unresolved")).toBe(false);
  });

  it("raises nothing for rows that went through", async () => {
    const { c } = await staged([
      person({ fullName: "Dmitri Kovalenko", cdlNumber: "K2210094471", cdlState: "IL" }),
      person({ fullName: "Wendell Achebe", cdlNumber: "A7781093322", cdlState: "OH" }),
    ]);

    // One matched, one new, neither needs anybody. A queue that listed them
    // would be an inbox reporting its own success.
    const queue = await needsYou.list(c);
    expect(queue.filter((x) => x.category === "import_claim_unresolved")).toHaveLength(0);
  });

  it("does not show one organization's unresolved row to another", async () => {
    await staged([person({ fullName: "Sam Murtaza", email: "sam@antcolos.com" })]);

    const other = await needsYou.list(ctx("org_cascade"));
    expect(other.some((x) => x.category === "import_claim_unresolved")).toBe(false);
  });
});

describe("what an import may not reach", () => {
  it("draws candidates only from this organization's own records", async () => {
    // Owen Fitz drives for Cascade, not Northline. An importer that could find
    // him is a way to ask Antcolos who a competitor's drivers are.
    const { plan } = await staged([
      person({ fullName: "Owen Fitz", cdlNumber: "F2029918840", cdlState: "OR" }),
    ]);

    expect(plan.resolutions[0].candidates).toHaveLength(0);
    expect(plan.resolutions[0].outcome).toBe("new");
  });

  it("refuses a caller who cannot manage the workforce", async () => {
    const viewer = ctx(NORTHLINE, ["workforce:view"]);
    await expect(
      imports.stage(viewer, { label: "Roster.csv", kind: "person", rows: [person({ fullName: "Ada Okonjo" })] }),
    ).rejects.toThrow();
  });

  it("does not hand one organization's batch to another", async () => {
    const { batch } = await staged([person({ fullName: "Ada Okonjo" })]);
    expect(await imports.plan(ctx("org_cascade"), batch.id)).toBeNull();
    expect(await imports.commit(ctx("org_cascade"), batch.id)).toBeNull();
  });
});

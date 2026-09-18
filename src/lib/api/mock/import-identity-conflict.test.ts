import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey, PersonClaim } from "@/types";
import { resetAllMocks } from "./registry";
import { allEngagements } from "./workforce-store";
import { mockImportService as imports } from "./import";
import { mockAuditService as audit } from "./audit";
import { InvalidDecisionError } from "../contracts/import";
import { mockNeedsYouService as needsYou } from "./needs-you";
import { putResolution } from "./import-store";
import type { ServiceContext } from "../contracts/context";

/**
 * ★ A DIFFERENT LICENCE NUMBER IS NOT PROOF OF A DIFFERENT PERSON ★
 *
 * The first version of this matcher treated a conflicting CDL as positive
 * evidence of two people and DROPPED the candidate. The reasoning sounded
 * right — a licence is issued to one holder — and it is wrong in the direction
 * that costs the most.
 *
 * Two ordinary things break it. People move: a driver who leaves Illinois for
 * Texas surrenders one licence and is issued another, and the same person now
 * has two numbers. And files are typed by hand: one wrong character in a
 * fifteen-character string is the single most common defect in any roster
 * anybody has ever exported.
 *
 * In both cases the old rule eliminated the one record that WAS this person,
 * left nothing plausible behind, and the plan therefore called the row new —
 * so the import created a second engagement for somebody already on the
 * roster, silently, with nobody asked. That is precisely the duplicate this
 * whole module exists to prevent, arrived at through the code that was
 * supposed to prevent it.
 *
 * Every test below fails on `cd79550` and passes after the fix.
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

const person = (row: Partial<PersonClaim> & { fullName: string }): PersonClaim => ({
  kind: "person",
  classification: "employee",
  ...row,
});

async function staged(rows: PersonClaim[], label = "Roster.csv") {
  const c = ctx();
  const { batch } = await imports.stage(c, { label, kind: "person", rows });
  const plan = await imports.plan(c, batch.id);
  return { c, batch, plan: plan! };
}

const northlineEngagements = () =>
  allEngagements().filter((e) => e.organizationId === NORTHLINE);

/*
 * Northline already has Dmitri. Everything below reuses his real fixture:
 * dp_dmitri, licence IL K2210094471, dmitri.kovalenko@example.com,
 * +1 (312) 555-0181.
 */
const DMITRI = {
  name: "Dmitri Kovalenko",
  email: "dmitri.kovalenko@example.com",
  phone: "+1 (312) 555-0181",
  cdl: "K2210094471",
  state: "IL",
};

beforeEach(() => {
  resetAllMocks();
});

describe("a licence that does not match the one on file", () => {
  it("does not create a second engagement when the driver moved state", async () => {
    // He moved to Texas and was issued a new number. Same man, same mailbox,
    // same phone, new licence.
    const { c, batch, plan } = await staged([
      person({
        fullName: DMITRI.name,
        email: DMITRI.email,
        phone: DMITRI.phone,
        cdlNumber: "K8830221145",
        cdlState: "TX",
      }),
    ]);

    // He must still be on the table. Dropping him is what makes the row "new".
    expect(plan.resolutions[0].candidates.map((x) => x.entityId)).toContain("dp_dmitri");
    expect(plan.resolutions[0].outcome).toBe("needs_decision");
    expect(plan.summary.new).toBe(0);

    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("skipped");
    expect(northlineEngagements()).toHaveLength(before);
  });

  it("does not create a second engagement for one mistyped character", async () => {
    // K2210094471 → K221009447**2**. One key.
    const { c, batch, plan } = await staged([
      person({
        fullName: DMITRI.name,
        email: DMITRI.email,
        cdlNumber: "K2210094472",
        cdlState: DMITRI.state,
      }),
    ]);

    expect(plan.resolutions[0].outcome).toBe("needs_decision");
    expect(plan.summary.new).toBe(0);

    const before = northlineEngagements().length;
    await imports.commit(c, batch.id);
    expect(northlineEngagements()).toHaveLength(before);
  });

  it("names the conflict rather than hiding it, so the reviewer can judge", async () => {
    const { plan } = await staged([
      person({
        fullName: DMITRI.name,
        email: DMITRI.email,
        cdlNumber: "K2210094472",
        cdlState: DMITRI.state,
      }),
    ]);

    const dmitri = plan.resolutions[0].candidates.find((x) => x.entityId === "dp_dmitri")!;
    // Named as the typing error it is, rather than as a flat "different".
    expect(dmitri.conflicts.map((x) => x.code)).toContain("cdl_near_miss");
    expect(dmitri.conflicts[0].label).toMatch(/K2210094471/);
    // The evidence that made him plausible survives alongside the conflict.
    expect(dmitri.signals.map((s) => s.code)).toEqual(
      expect.arrayContaining(["email", "name_exact"]),
    );
    // And it is not presented as an identity match.
    expect(dmitri.confidence).not.toBe("exact");
  });

  it("puts the contested row in front of somebody instead of resolving it", async () => {
    const { c } = await staged([
      person({
        fullName: DMITRI.name,
        email: DMITRI.email,
        cdlNumber: "K2210094472",
        cdlState: DMITRI.state,
      }),
    ]);

    const item = (await needsYou.list(c))
      .find((x) => x.category === "import_claim_unresolved");
    expect(item).toBeDefined();

    // It must ask the REAL question. "Which person is this?" invites somebody to
    // recognise a name; the row actually needs them to go and check a document.
    expect(item!.title).toMatch(/somebody you already have/);
    expect(item!.reason).toMatch(/Dmitri Kovalenko/);
    expect(item!.reason).toMatch(/K2210094471/);
    expect(item!.reason).toMatch(/both permanent/);
  });
});

describe("resolving a contested row, explicitly", () => {
  const MISTYPED = () => person({
    fullName: DMITRI.name,
    email: DMITRI.email,
    cdlNumber: "K2210094472",
    cdlState: DMITRI.state,
  });

  it("lets somebody say it IS the existing person, and links without creating", async () => {
    const { c, batch, plan } = await staged([MISTYPED()]);
    const before = northlineEngagements().length;

    await imports.decide(c, plan.claims[0].id, {
      choice: "link",
      entityId: "dp_dmitri",
      note: "Checked his licence in the folder — the file has a typo.",
    });
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("linked");
    expect(run!.results[0].entity?.id).toBe("dp_dmitri");
    expect(northlineEngagements()).toHaveLength(before);
    expect(run!.state).toBe("complete");
  });

  it("lets somebody say it is genuinely somebody new, and creates once", async () => {
    const { c, batch, plan } = await staged([MISTYPED()]);
    const before = northlineEngagements().length;

    await imports.decide(c, plan.claims[0].id, {
      choice: "create",
      note: "Different man. Dmitri's cousin, same name, works here too.",
    });
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("created");
    expect(northlineEngagements()).toHaveLength(before + 1);
  });

  it("keeps the decision, the evidence and the actor for audit", async () => {
    const { c, plan } = await staged([MISTYPED()]);

    const resolved = await imports.decide(c, plan.claims[0].id, {
      choice: "link",
      entityId: "dp_dmitri",
      note: "Checked the folder.",
    });

    const decision = resolved!.decision!;
    expect(decision.choice).toBe("link");
    expect(decision.decidedBy.userId).toBe("usr_owner");
    expect(decision.decidedAt).toBeTruthy();

    /*
     * The evidence is a SNAPSHOT. Resolutions are re-derived on every plan, so
     * without this the candidate list and the conflict that justified somebody's
     * answer would be replaced by whatever the registry looks like later, and an
     * audit would show a decision with nothing behind it.
     */
    expect(decision.evidence!.contested).toBe(true);
    expect(decision.evidence!.plannedOutcome).toBe("needs_decision");
    expect(decision.evidence!.candidates.some(
      (x) => x.entityId === "dp_dmitri" && x.conflicts.some((y) => y.code === "cdl_near_miss"),
    )).toBe(true);

    const ledger = await audit.list(
      ctx(NORTHLINE, ["workforce:view", "workforce:manage", "audit:view"]),
      { filters: { action: ["workforce.import_identity_resolved"] } },
    );
    expect(ledger.items).toHaveLength(1);
    const line = ledger.items[0];
    expect(line.actor.userId).toBe("usr_owner");
    expect(line.summary).toMatch(/Dmitri Kovalenko/);
    // The line says the row was CONTESTED, not merely that somebody chose.
    expect(line.summary).toMatch(/conflicting identifier/);
    // And the records they were choosing between are in the ledger too, so the
    // answer stays reviewable long after the file and the plan are gone.
    const offered = line.changes?.changes.find((ch) => ch.field === "candidate.1");
    expect(offered?.redacted).toBe(false);
    expect(offered?.label).toMatch(/Dmitri Kovalenko/);
    expect(String(offered?.after)).toMatch(/cdl_near_miss/);
    expect(String(offered?.after)).toMatch(/agrees on/);
  });

  it("survives a re-plan: the answer is not asked for twice", async () => {
    const { c, batch, plan } = await staged([MISTYPED()]);
    await imports.decide(c, plan.claims[0].id, { choice: "link", entityId: "dp_dmitri" });

    // Re-planning replaces the resolution wholesale. The decision must not go
    // with it, or every re-plan would silently reopen a settled question.
    const replanned = await imports.plan(c, batch.id);
    expect(replanned!.resolutions[0].decision?.choice).toBe("link");

    const run = await imports.commit(c, batch.id);
    expect(run!.results[0].outcome).toBe("linked");
  });

  it("refuses a decision naming a record that is not a candidate", async () => {
    const { c, plan } = await staged([MISTYPED()]);

    // An id from a stale screen, or simply invented. Accepting it would let a
    // caller link an imported row to any entity id they could name.
    await expect(
      imports.decide(c, plan.claims[0].id, { choice: "link", entityId: "dp_owen" }),
    ).rejects.toThrow(InvalidDecisionError);

    await expect(
      imports.decide(c, plan.claims[0].id, { choice: "link" }),
    ).rejects.toThrow(InvalidDecisionError);
  });

  it("refuses to commit a link whose record stopped being a candidate", async () => {
    const { c, batch, plan } = await staged([MISTYPED()]);
    await imports.decide(c, plan.claims[0].id, { choice: "link", entityId: "dp_dmitri" });

    // The decision stands, but the candidate list no longer offers it. Failing
    // closed is the only safe answer: the row goes back to a person.
    const stale = { ...plan.resolutions[0], candidates: [], decision: (await imports.plan(c, batch.id))!.resolutions[0].decision };
    putResolution(stale);

    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("skipped");
    expect(run!.results[0].detail).toMatch(/no longer one of its candidates/);
    expect(northlineEngagements()).toHaveLength(before);
    expect(run!.state).toBe("incomplete");
  });

  it("finishes a contested row on retry, once it has been answered", async () => {
    const { c, batch, plan } = await staged([
      MISTYPED(),
      person({ fullName: "Ada Okonjo", cdlNumber: "O1129930041", cdlState: "MI" }),
    ]);
    const before = northlineEngagements().length;

    // First pass: the clean row lands, the contested one waits.
    const first = (await imports.commit(c, batch.id))!;
    expect(first.results.map((r) => r.outcome)).toEqual(["skipped", "created"]);
    expect(first.state).toBe("incomplete");
    expect(northlineEngagements()).toHaveLength(before + 1);

    await imports.decide(c, plan.claims[0].id, { choice: "link", entityId: "dp_dmitri" });

    const second = (await imports.commit(c, batch.id))!;
    expect(second.results.map((r) => r.outcome)).toEqual(["linked", "already_done"]);
    expect(second.state).toBe("complete");
    // Ada was not created twice, and Dmitri was never created at all.
    expect(northlineEngagements()).toHaveLength(before + 1);
  });
});

describe("the cases the new rule must not have broken", () => {
  it("still links an exact licence automatically, with no question asked", async () => {
    const { c, batch, plan } = await staged([
      person({ fullName: DMITRI.name, cdlNumber: DMITRI.cdl, cdlState: DMITRI.state }),
    ]);

    // The whole point of a decisive identifier: when it agrees, nobody is asked.
    expect(plan.resolutions[0].outcome).toBe("matched");
    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);

    expect(run!.results[0].outcome).toBe("linked");
    expect(northlineEngagements()).toHaveLength(before);
    expect(await needsYou.list(c).then(
      (q) => q.some((x) => x.category === "import_claim_unresolved"),
    )).toBe(false);
  });

  it("still creates a genuinely new person without stopping", async () => {
    // Nothing in common with anybody: a different name, a different mailbox,
    // and a licence that is not a near miss of any on file. Stopping here would
    // make the queue useless and the import unusable.
    const { c, batch, plan } = await staged([
      person({
        fullName: "Wendell Achebe", email: "wendell@example.com",
        cdlNumber: "A7781093322", cdlState: "OH",
      }),
    ]);

    expect(plan.resolutions[0].outcome).toBe("new");
    expect(plan.resolutions[0].candidates).toHaveLength(0);

    const before = northlineEngagements().length;
    const run = await imports.commit(c, batch.id);
    expect(run!.results[0].outcome).toBe("created");
    expect(northlineEngagements()).toHaveLength(before + 1);
  });

  it("keeps the solo owner-driver one person even when the file mistypes his licence", async () => {
    /*
     * Marcus owns his truck and drives it, so Northline holds him twice — as a
     * driver relationship and as an owner-operator engagement — and the pool
     * offers one candidate. Under the OLD rule a wrong character eliminated
     * that candidate and the owner of the company was imported as a new hire.
     */
    const { c, batch, plan } = await staged([
      person({
        fullName: "Marcus Hale",
        cdlNumber: "H4471029984", // real: H4471029983
        cdlState: "TX",
        classification: "owner_operator",
        isOwner: true,
        alsoDispatches: true,
      }),
    ]);

    expect(plan.resolutions[0].candidates).toHaveLength(1);
    expect(plan.resolutions[0].outcome).toBe("needs_decision");
    expect(plan.summary.new).toBe(0);

    const before = northlineEngagements().length;
    await imports.commit(c, batch.id);
    expect(northlineEngagements()).toHaveLength(before);

    await imports.decide(c, plan.claims[0].id, { choice: "link", entityId: "dp_marcus" });
    const run = await imports.commit(c, batch.id);
    expect(run!.results[0].outcome).toBe("linked");
    expect(northlineEngagements()).toHaveLength(before);
  });

  it("leaves a blocked row blocked on every retry, and never quietly creates it", async () => {
    /*
     * Blocked is not contested: the row is missing something the carrier has to
     * supply, and a claim is immutable evidence so retrying cannot fix it. What
     * matters is that retrying does not eventually give up and create somebody.
     */
    const { c, batch, plan } = await staged([
      person({ fullName: "Unclassified Person", classification: undefined }),
      person({ fullName: "Ada Okonjo", cdlNumber: "O1129930041", cdlState: "MI" }),
    ]);
    expect(plan.resolutions[0].outcome).toBe("blocked");
    const before = northlineEngagements().length;

    const first = (await imports.commit(c, batch.id))!;
    expect(first.results.map((r) => r.outcome)).toEqual(["skipped", "created"]);
    expect(first.state).toBe("incomplete");

    const second = (await imports.commit(c, batch.id))!;
    expect(second.results.map((r) => r.outcome)).toEqual(["skipped", "already_done"]);
    expect(second.state).toBe("incomplete");

    // One person created across two runs, and the blocked row is still nobody.
    expect(northlineEngagements()).toHaveLength(before + 1);
  });

  it("does not stop a clean row because another row in the file is contested", async () => {
    const { c, batch, plan } = await staged([
      person({
        fullName: DMITRI.name, email: DMITRI.email,
        cdlNumber: "K2210094472", cdlState: DMITRI.state,
      }),
      person({ fullName: "Ada Okonjo", cdlNumber: "O1129930041", cdlState: "MI" }),
      person({ fullName: "Marisol Ortiz", cdlNumber: "O8840112238", cdlState: "IL" }),
    ]);

    expect(plan.summary).toEqual({ matched: 1, new: 1, needsDecision: 1, blocked: 0 });

    const run = await imports.commit(c, batch.id);
    expect(run!.results.map((r) => r.outcome)).toEqual(["skipped", "created", "linked"]);
    expect(run!.state).toBe("incomplete");
  });
});

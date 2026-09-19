import test from "node:test";
import assert from "node:assert/strict";
import { cycleStages, openStageOf } from "@/features/mt-loop/cycle-stages";
import type { MtLoopBlocker } from "@/types";
import type { TruckOpportunities } from "@/lib/api/mock/opportunity-service";

/**
 * The cycle spine on a truck's own page.
 *
 * ★ WHAT THESE EXIST TO STOP HAPPENING ★
 *
 * The inner page used to be seven full-width panels in a column, every one the
 * same weight whether it was the work in hand or a stage nobody had reached. A
 * spine only beats that if its shape is TRUE, and there are three ways for the
 * shape to lie:
 *
 *   Drawing a wizard   The cycle is not a sequence. Brokers answer while a
 *                      driver is still looking, and a booked load can sit on a
 *                      truck whose search was refused. More than one stage is
 *                      live at once and a later stage can be done while an
 *                      earlier one is not.
 *
 *   Silent skipping    A carrier that does not ask its drivers skips that
 *                      stage — always, by their rule, not ours. A gap with no
 *                      reason reads as a step somebody forgot, and a
 *                      dispatcher cannot tell that from a bug.
 *
 *   A polite refusal   A truck nobody can dispatch does not get a greyed-out
 *                      search button. It gets a refusal with the reason on it,
 *                      because the alternative is somebody spending an hour
 *                      finding freight for a truck with no driver.
 */

const blocker = (over: Partial<MtLoopBlocker> = {}): MtLoopBlocker => ({
  key: "no_driver",
  label: "No driver",
  detail: "Nobody is on unit A-12.",
  owner: "carrier",
  severity: "medium",
  stopsDispatch: true,
  ...over,
});

/** Only the fields the spine reads. The rest of the payload is not its business. */
const opportunities = (over: Partial<TruckOpportunities> = {}) => ({
  top: [], rest: [], drafts: [], negotiations: [], driverReviews: [],
  driverVisibility: [], communications: {}, ranking: {},
  counts: { considered: 0, eligible: 0, ineligible: 0, shortlisted: 0 },
  ...over,
} as unknown as TruckOpportunities);

const stage = (stages: ReturnType<typeof cycleStages>, key: string) => {
  const found = stages.find((s) => s.key === key);
  assert.ok(found, `there is a ${key} stage`);
  return found;
};

/* -------------------------------------------------------------------------- */

test("a truck that cannot be dispatched is refused a search, with the reason", () => {
  const stages = cycleStages({ blockers: [blocker()] });
  const search = stage(stages, "search");

  assert.equal(search.state, "stopped");
  // Not a greyed-out button and not a shrug: the sentence says Antcolos will
  // not do it, and the next line says why.
  assert.match(search.summary, /will not look for freight it could not dispatch/);
  assert.equal(search.reason, "Nobody is on unit A-12.", "in the blocker's own words");
});

test("the rate confirmation being outstanding does not refuse the search", () => {
  // It stops a DISPATCH and is exactly the work in hand — the same exclusion
  // the board's lane test makes, for the same reason.
  const stages = cycleStages({
    blockers: [blocker({ key: "unconfirmed_load", label: "Rate confirmation outstanding" })],
  });
  assert.notEqual(stage(stages, "search").state, "stopped");
});

test("a carrier that does not ask its drivers skips that stage, and says whose rule it is", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities(),
    driverConsentRequired: false,
    carrierName: "Baxter Transit",
  });
  const driver = stage(stages, "driver");

  assert.equal(driver.state, "skipped");
  assert.ok(driver.reason, "a skipped stage is never silent");
  // ★ Whose rule, not ours. ★
  assert.match(driver.reason!, /carrier record/i);
  assert.match(driver.reason!, /not a setting in this workspace/i);
});

test("a carrier's own wording of the rule is used where the record carries one", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities(),
    driverConsentRequired: false,
    carrierName: "Ridgeway Carriers",
    driverConsentRule: "Ridgeway drivers accept their own loads.",
  });
  assert.equal(stage(stages, "driver").reason, "Ridgeway drivers accept their own loads.");
});

test("a carrier that DOES ask its drivers never shows the stage as skipped", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities(),
    driverConsentRequired: true,
    carrierName: "Cascade Haul",
  });
  assert.equal(stage(stages, "driver").state, "upcoming");
});

test("stages run together: a load can be booked while the search is refused", () => {
  // The real shape of a truck that is loaded and moving while its records say
  // there is no driver and no trailer on it. A wizard cannot draw this; the
  // spine has to.
  const stages = cycleStages({
    blockers: [blocker(), blocker({ key: "no_trailer", label: "No trailer" })],
    opportunities: opportunities({ booking: { bookingId: "bk_1" } as never }),
    card: { loadReference: "MD-9042" } as never,
  });

  assert.equal(stage(stages, "search").state, "stopped");
  assert.equal(stage(stages, "book").state, "done", "a later stage may be done");
  assert.match(stage(stages, "book").summary, /MD-9042/);
  // And the paper is still owed, which is the thing somebody has to chase.
  assert.equal(stage(stages, "ratecon").state, "waiting");
});

test("a search nobody has answered waits; a broker coming back is your turn", () => {
  const waiting = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [
        { negotiation: { status: "waiting_on_broker" } },
        { negotiation: { status: "waiting_on_broker" } },
      ] as never,
    }),
  });
  assert.equal(stage(waiting, "brokers").state, "waiting");
  assert.equal(stage(waiting, "brokers").count, 2);

  const yourTurn = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [
        { negotiation: { status: "waiting_on_you" } },
        { negotiation: { status: "waiting_on_broker" } },
      ] as never,
    }),
  });
  assert.equal(stage(yourTurn, "brokers").state, "active");
  assert.match(stage(yourTurn, "brokers").summary, /1 of 2 have come back/);
});

test("a conversation that is lost or withdrawn is not counted as live", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [
        { negotiation: { status: "lost" } },
        { negotiation: { status: "withdrawn" } },
      ] as never,
    }),
  });
  const brokers = stage(stages, "brokers");
  assert.equal(brokers.state, "upcoming");
  // Said, rather than shown as "nothing has happened" — two brokers were asked.
  assert.match(brokers.summary, /2 conversations finished, none open/);
});

test("what cannot be sent is admitted on the stage that would send it", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [{ negotiation: { status: "waiting_on_you" } }] as never,
    }),
  });
  // ★ No mailbox is connected, and the stage that would use one says so. ★
  assert.match(stage(stages, "brokers").caveat ?? "", /Nothing is emailed from Antcolos/);
});

test("booking says the check happens at the moment of booking, not from this screen", () => {
  const stages = cycleStages({ blockers: [], opportunities: opportunities() });
  assert.match(
    stage(stages, "book").caveat ?? "",
    /re-checked at the moment of booking/,
  );
});

test("a search that found nothing is still where the work is", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities({
      session: {
        status: "running",
        sources: [{ status: "searched" }, { status: "not_connected" }],
        counts: { listingsSeen: 12, duplicatesFolded: 0, matchesCreated: 0, eligible: 0 },
      } as never,
    }),
  });
  const search = stage(stages, "search");
  assert.equal(search.state, "active");
  // ★ A source that is not connected is not a source that found nothing. ★
  assert.match(search.caveat ?? "", /1 not connected/);
});

test("the page opens on the refusal before it opens on the work", () => {
  const stopped = cycleStages({ blockers: [blocker()] });
  assert.equal(openStageOf(stopped), "search", "a refusal is the thing to read");

  const working = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [{ negotiation: { status: "waiting_on_you" } }] as never,
      session: {
        status: "running",
        sources: [],
        counts: { listingsSeen: 9, duplicatesFolded: 0, matchesCreated: 4, eligible: 2 },
      } as never,
      counts: { considered: 4, eligible: 2, ineligible: 2, shortlisted: 0 },
      drafts: [{ id: "d1" }] as never,
    }),
  });
  assert.equal(openStageOf(working), "brokers", "otherwise, where the ball is");
});

test("every stage says something, whatever state it is in", () => {
  for (const input of [
    { blockers: [] },
    { blockers: [blocker()] },
    { blockers: [], opportunities: opportunities() },
  ]) {
    for (const s of cycleStages(input)) {
      assert.ok(s.title, `${s.key} has a title`);
      assert.ok(s.summary, `${s.key} says what is happening`);
      // A skipped stage or a refusal without a reason is the failure mode this
      // whole file exists to stop.
      if (s.state === "skipped" || s.state === "stopped") {
        assert.ok(s.reason, `${s.key} says why it is ${s.state}`);
      }
    }
  }
});

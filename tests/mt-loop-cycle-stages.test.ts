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

/**
 * Only the fields the spine reads. The rest of the payload is not its business.
 *
 * A negotiation fixture carries `rounds`, because the spine counts them — the
 * real type always has the array, so a component guarding against its absence
 * would be defending a case production cannot produce.
 */
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
  assert.equal(search.summary, "Refused");
  // The cause is in the blocker's own words, and stays ON the page rather
  // than in a tooltip: it is the one thing here a reader has to act on.
  assert.equal(search.note, "Nobody is on unit A-12.");
  assert.equal(search.noteVisible, true, "a refusal is never hover-only");
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
  assert.equal(driver.summary, "Not required");
  assert.ok(driver.note, "a skipped stage is never silent");
  assert.equal(driver.noteVisible, true, "and its reason is not hidden behind a hover");
  // ★ Whose rule, not ours. ★
  assert.match(driver.note!, /carrier record/i);
  assert.match(driver.note!, /not set here/i);
});

test("a carrier's own wording of the rule is used where the record carries one", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities(),
    driverConsentRequired: false,
    carrierName: "Ridgeway Carriers",
    driverConsentRule: "Ridgeway drivers accept their own loads.",
  });
  assert.equal(stage(stages, "driver").note, "Ridgeway drivers accept their own loads.");
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
  assert.ok(
    stage(stages, "book").metrics?.some((m) => m.value === "MD-9042"),
    "and names the load it booked, as a value rather than a sentence",
  );
  // And the paper is still owed, which is the thing somebody has to chase.
  assert.equal(stage(stages, "ratecon").state, "waiting");
});

test("a search nobody has answered waits; a broker coming back is your turn", () => {
  const waiting = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [
        { negotiation: { status: "waiting_on_broker", rounds: [] } },
        { negotiation: { status: "waiting_on_broker", rounds: [] } },
      ] as never,
    }),
  });
  assert.equal(stage(waiting, "brokers").state, "waiting");
  assert.equal(stage(waiting, "brokers").summary, "Waiting on brokers");
  assert.equal(stage(waiting, "brokers").count, 2);

  const yourTurn = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [
        { negotiation: { status: "waiting_on_you", rounds: [{}] } },
        { negotiation: { status: "waiting_on_broker", rounds: [] } },
      ] as never,
    }),
  });
  assert.equal(stage(yourTurn, "brokers").state, "active");
  assert.equal(stage(yourTurn, "brokers").summary, "Your turn");
  assert.ok(
    stage(yourTurn, "brokers").metrics?.some((m) => m.label === "Replied" && m.value === "1/2"),
    "with how many came back as a metric",
  );
});

test("a conversation that is lost or withdrawn is not counted as live", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [
        { negotiation: { status: "lost", rounds: [] } },
        { negotiation: { status: "withdrawn", rounds: [] } },
      ] as never,
    }),
  });
  const brokers = stage(stages, "brokers");
  assert.equal(brokers.state, "upcoming");
  // Counted, rather than shown as "nothing has happened" — two were asked.
  assert.equal(brokers.summary, "All closed");
  assert.ok(brokers.metrics?.some((m) => m.label === "Closed" && m.value === "2"));
});

test("what cannot be sent is admitted on the stage that would send it", () => {
  const stages = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [{ negotiation: { status: "waiting_on_you", rounds: [{}] } }] as never,
    }),
  });
  // ★ No mailbox is connected, and the stage that would use one says so. ★
  // In the tip rather than the layout — it explains something already on
  // screen, and is repeated in the actions panel for anybody who cannot hover.
  assert.match(stage(stages, "brokers").note ?? "", /Nothing is emailed from Antcolos/);
  assert.notEqual(stage(stages, "brokers").noteVisible, true);
});

test("booking says the check happens at the moment of booking, not from this screen", () => {
  const stages = cycleStages({ blockers: [], opportunities: opportunities() });
  assert.match(stage(stages, "book").note ?? "", /re-checked at the moment of booking/);
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
  assert.equal(search.summary, "Nothing found");
  // ★ A source that is not connected is not a source that found nothing. ★
  // Carried as a warn-toned metric, so the gap is SEEN rather than read.
  const sources = search.metrics?.find((m) => m.label === "Sources");
  assert.equal(sources?.value, "1/2", "how many of the sources were actually read");
  assert.equal(sources?.tone, "warn");
  assert.match(sources?.title ?? "", /1 not connected/);
});

test("the page opens on the refusal before it opens on the work", () => {
  const stopped = cycleStages({ blockers: [blocker()] });
  assert.equal(openStageOf(stopped), "search", "a refusal is the thing to read");

  const working = cycleStages({
    blockers: [],
    opportunities: opportunities({
      negotiations: [{ negotiation: { status: "waiting_on_you", rounds: [{}] } }] as never,
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
      // ★ THE DENSITY RULE, ENFORCED ★
      // A stage summary is a label, not a sentence. The numbers live in
      // `metrics` and the explanations live in `note`.
      assert.ok(
        s.summary.split(/\s+/).length <= 4,
        `${s.key}: "${s.summary}" is a sentence, not a label`,
      );
      assert.ok(!s.summary.endsWith("."), `${s.key}: a label does not end in a full stop`);
      // A skipped stage or a refusal without a reason is the failure mode this
      // whole file exists to stop — and neither may be hover-only.
      if (s.state === "skipped" || s.state === "stopped") {
        assert.ok(s.note, `${s.key} says why it is ${s.state}`);
        assert.equal(s.noteVisible, true, `${s.key}'s reason stays on the page`);
      }
    }
  }
});

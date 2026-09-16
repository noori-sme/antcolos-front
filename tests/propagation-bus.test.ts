import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDomainEvent, domainEventId, propagationBus, resetPropagationBus,
} from "@/lib/propagation";
import type {
  ActorRef, DomainEvent, ProjectionOutcome, ProjectionSubscriber, Provenance,
} from "@/types";

/**
 * The guarantees the propagation layer makes, tested directly.
 *
 * These are the four properties the whole zero-entry design rests on, and they
 * are worth testing away from the real projections: publishing twice does
 * nothing twice, one failing projection cannot stop the others, a payload
 * version a subscriber has not been taught is a question rather than a guess,
 * and a failure is retryable without republishing the event.
 */

const ACTOR: ActorRef = {
  userId: "usr_test",
  membershipId: "mem_test",
  displayNameSnapshot: "Test Caller",
  source: "web",
};

const PROVENANCE: Provenance = {
  module: "load",
  adapter: "mock:test",
  mock: true,
  observedAt: "2026-09-15T00:00:00.000Z",
  receivedAt: "2026-09-15T00:00:00.000Z",
};

function event(key: string, version = 1): DomainEvent<{ n: number }> {
  return buildDomainEvent<{ n: number }>({
    kind: "load.finalized",
    version,
    scope: { organizationId: "org_test" },
    subjectId: "ld_test",
    subjectKind: "load",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: ACTOR,
    idempotencyKey: key,
    provenance: PROVENANCE,
    payload: { n: 1 },
  });
}

/** A subscriber that counts its runs, so double-running is visible. */
function counting(
  id: string,
  outcome: () => ProjectionOutcome,
  opts: { versions?: number[] } = {},
): ProjectionSubscriber<{ n: number }> & { runs: number } {
  const sub = {
    id,
    label: id,
    targetModule: "load" as const,
    handles: ["load.finalized"] as const,
    versions: opts.versions ?? [1],
    mock: false,
    runs: 0,
    project() {
      sub.runs += 1;
      return outcome();
    },
  };
  return sub;
}

const ok = (detail = "done"): ProjectionOutcome => ({ state: "processed", detail });

/**
 * `resetPropagationBus` clears what HAPPENED — events and projection records —
 * and deliberately keeps who is listening. Subscribers are architecture, not
 * data, and a reset that unwired the bus would leave the next publish silently
 * dropping events.
 *
 * Which means the subscribers each test registers persist into the ones after
 * it. That is the real behaviour, so these tests assert by subscriber id rather
 * than by position, and never on the total number of projections.
 */
test.beforeEach(() => resetPropagationBus());

/** One subscriber's record from a publish result. */
function outcomeOf(
  result: { projections: { subscriberId: string }[] },
  subscriberId: string,
) {
  const row = result.projections.find((p) => p.subscriberId === subscriberId);
  assert.ok(row, `${subscriberId} was offered the event`);
  return row as typeof row & {
    state: string; attempts: number; reason?: string; retryable: boolean;
    firstAttemptAt?: string;
  };
}

/* -------------------------------------------------------------------------- */

test("the event id is derived from the kind, the version and the idempotency key", () => {
  assert.equal(
    domainEventId("load.finalized", 1, "abc"),
    domainEventId("load.finalized", 1, "abc"),
  );
  assert.notEqual(
    domainEventId("load.finalized", 1, "abc"),
    domainEventId("fuel_transaction.confirmed", 1, "abc"),
  );
  // Nothing parses it; only equality matters. But it must not collide across
  // kinds, because two modules retrying different intents must not cancel out.
  assert.notEqual(
    domainEventId("load.finalized", 1, "abc"),
    domainEventId("load.finalized", 1, "abd"),
  );
  // And it must not collide across versions, or a v2 of an intent already
  // published at v1 is discarded as a duplicate before any subscriber sees it.
  assert.notEqual(
    domainEventId("load.finalized", 1, "abc"),
    domainEventId("load.finalized", 2, "abc"),
  );
});

/* -------------------------------------------------------------------------- */
/* Version is part of identity                                                 */
/* -------------------------------------------------------------------------- */

test("the same kind, version and key is one event", async () => {
  const a = counting("ident_same", () => ok());
  propagationBus.subscribe(a as never);

  const first = await propagationBus.publish(event("same-key", 1));
  const second = await propagationBus.publish(event("same-key", 1));

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.event.eventId, first.event.eventId);
  assert.equal(a.runs, 1);
});

test("a newer version of the same intent is not swallowed as a duplicate", async () => {
  // The hole this closes. Before the version was part of the identity, this
  // second publish came back `duplicate: true` and the v2 payload was dropped
  // on the floor — no record, no projection, no way to find out.
  const a = counting("ident_v1_only", () => ok(), { versions: [1] });
  propagationBus.subscribe(a as never);

  const v1 = await propagationBus.publish(event("shared-key", 1));
  const v2 = await propagationBus.publish(event("shared-key", 2));

  assert.equal(v1.duplicate, false);
  assert.equal(v2.duplicate, false);
  assert.notEqual(v2.event.eventId, v1.event.eventId);

  // Two events, each with its own projection record.
  assert.equal(propagationBus.events("org_test").length, 2);
});

test("an unsupported version reaches the subscriber guard instead of being deduped away", async () => {
  const a = counting("ident_guard", () => ok(), { versions: [1] });
  propagationBus.subscribe(a as never);

  await propagationBus.publish(event("guard-key", 1));
  assert.equal(a.runs, 1);

  const v2 = await propagationBus.publish(event("guard-key", 2));

  // It was OFFERED, and the guard answered. That is the whole point: the
  // subscriber says "I do not understand v2" out loud rather than the bus
  // silently deciding it had already seen this.
  const row = outcomeOf(v2, "ident_guard");
  assert.equal(row.state, "needs_review");
  assert.match(row.reason ?? "", /version/i);
  // And it did not run the v1 code against a v2 payload.
  assert.equal(a.runs, 1);
});

test("replaying the exact same version stays idempotent", async () => {
  const a = counting("ident_replay", () => ok());
  propagationBus.subscribe(a as never);

  const original = await propagationBus.publish(event("replay-key", 1));
  for (let i = 0; i < 5; i++) {
    const again = await propagationBus.publish(event("replay-key", 1));
    assert.equal(again.duplicate, true);
    assert.equal(again.event.eventId, original.event.eventId);
  }

  assert.equal(a.runs, 1);
  assert.equal(outcomeOf(original, "ident_replay").attempts, 1);
  assert.equal(
    propagationBus.events("org_test").filter((e) => e.idempotencyKey === "replay-key").length,
    1,
  );
});

test("a projection record keys on the corrected event id", async () => {
  const a = counting("ident_record", () => ok());
  propagationBus.subscribe(a as never);

  const result = await propagationBus.publish(event("record-key", 3));
  const expected = domainEventId("load.finalized", 3, "record-key");

  assert.equal(result.event.eventId, expected);
  assert.equal(outcomeOf(result, "ident_record").eventId, expected);
  assert.equal(propagationBus.projectionsFor(expected).length > 0, true);
  assert.ok(propagationBus.event("org_test", expected));
});

/* -------------------------------------------------------------------------- */
/* A published event cannot be changed afterwards                              */
/* -------------------------------------------------------------------------- */

/** A payload with something nested to reach for. */
function nestedEvent(key: string) {
  return buildDomainEvent<{ inner: { value: string }; list: number[] }>({
    kind: "load.finalized",
    version: 1,
    scope: { organizationId: "org_test" },
    subjectId: "ld_nested",
    subjectKind: "load",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: ACTOR,
    idempotencyKey: key,
    provenance: PROVENANCE,
    payload: { inner: { value: "original" }, list: [1, 2, 3] },
  });
}

test("nested payload values cannot be changed after publication", async () => {
  const result = await propagationBus.publish(nestedEvent("frozen-1"));
  const stored = result.event as DomainEvent<{ inner: { value: string }; list: number[] }>;

  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.payload), true);
  assert.equal(Object.isFrozen(stored.payload.inner), true);
  assert.equal(Object.isFrozen(stored.payload.list), true);
  // The envelope's other nested values too — a scope somebody could widen is
  // the same problem wearing a different name.
  assert.equal(Object.isFrozen(stored.scope), true);
  assert.equal(Object.isFrozen(stored.provenance), true);

  assert.throws(() => { stored.payload.inner.value = "changed"; }, TypeError);
  assert.throws(() => { stored.payload.list.push(4); }, TypeError);
  assert.equal(stored.payload.inner.value, "original");
});

test("mutating the caller's own object afterwards cannot alter what was published", async () => {
  const original = nestedEvent("frozen-2");
  const result = await propagationBus.publish(original);

  // The publisher still holds its own object and is free to change it. It is
  // not frozen out of its own data as a side effect of publishing.
  assert.equal(Object.isFrozen(original.payload), false);
  original.payload.inner.value = "MUTATED BY CALLER";
  original.payload.list.push(99);

  const stored = propagationBus.event("org_test", result.event.eventId) as
    DomainEvent<{ inner: { value: string }; list: number[] }>;
  assert.equal(stored.payload.inner.value, "original");
  assert.deepEqual(stored.payload.list, [1, 2, 3]);
});

test("a subscriber cannot change the payload the next subscriber reads", async () => {
  const seen: string[] = [];
  const meddler: ProjectionSubscriber<{ inner: { value: string } }> = {
    id: "frozen_meddler",
    label: "meddler",
    targetModule: "load",
    handles: ["load.finalized"],
    versions: [1],
    mock: false,
    project(e) {
      // Projections run sequentially so a replay is reproducible. A mutable
      // payload would undo exactly that.
      assert.throws(() => { e.payload.inner.value = "tampered"; }, TypeError);
      return ok();
    },
  };
  const reader: ProjectionSubscriber<{ inner: { value: string } }> = {
    id: "frozen_reader",
    label: "reader",
    targetModule: "load",
    handles: ["load.finalized"],
    versions: [1],
    mock: false,
    project(e) {
      seen.push(e.payload.inner.value);
      return ok();
    },
  };
  propagationBus.subscribe(meddler as never);
  propagationBus.subscribe(reader as never);

  await propagationBus.publish(nestedEvent("frozen-3"));
  assert.deepEqual(seen, ["original"]);
});

/* -------------------------------------------------------------------------- */
/* The accepted payload contract                                               */
/* -------------------------------------------------------------------------- */

/** Publish a payload of any shape, and hand back whatever happened. */
async function publishPayload(key: string, payload: unknown) {
  const ev = buildDomainEvent({
    kind: "load.finalized",
    version: 1,
    scope: { organizationId: "org_test" },
    subjectId: "ld_contract",
    subjectKind: "load",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: ACTOR,
    idempotencyKey: key,
    provenance: PROVENANCE,
    payload: payload as never,
  });
  try {
    const result = await propagationBus.publish(ev);
    return { accepted: true as const, result, eventId: ev.eventId, error: undefined };
  } catch (error) {
    return { accepted: false as const, result: undefined, eventId: ev.eventId, error: error as Error };
  }
}

/** Nothing was stored, nothing ran, nothing claims it did. */
function assertNothingHappened(eventId: string, runsBefore: number, sub: { runs: number }) {
  assert.equal(propagationBus.event("org_test", eventId), undefined);
  assert.equal(propagationBus.projectionsFor(eventId).length, 0);
  assert.equal(
    propagationBus.events("org_test").some((e) => e.eventId === eventId),
    false,
  );
  assert.equal(sub.runs, runsBefore, "no subscriber ran");
}

test("accepts null, strings, booleans, finite numbers, arrays and plain objects", async () => {
  const a = counting("contract_ok", () => ok());
  propagationBus.subscribe(a as never);

  const outcome = await publishPayload("contract-ok", {
    nothing: null,
    text: "a string",
    flag: false,
    whole: 42,
    fractional: -1.5,
    zero: 0,
    list: [1, "two", true, null, { deep: "value" }],
    nested: { inner: { deeper: ["x"] } },
    // A plain object with a null prototype is still plain data.
    bare: Object.assign(Object.create(null), { k: "v" }),
  });

  assert.equal(outcome.accepted, true, outcome.error?.message);
  assert.equal(a.runs, 1);
});

test("drops an absent optional field rather than storing 'present and undefined'", async () => {
  // JSON has no way to say "present and undefined", so the stored copy says
  // what a durable record would. No reader can tell: both read `undefined`.
  const outcome = await publishPayload("contract-undef", { given: "yes", absent: undefined });
  assert.equal(outcome.accepted, true, outcome.error?.message);

  const stored = propagationBus.event("org_test", outcome.eventId) as
    DomainEvent<Record<string, unknown>>;
  assert.equal(Object.hasOwn(stored.payload, "absent"), false);
  assert.equal(stored.payload.absent, undefined);
  assert.equal(stored.payload.given, "yes");
});

/**
 * Every value form, decided on purpose.
 *
 * The four in the middle are the reason this exists: `Object.freeze` does NOT
 * stop `Map.set`, `Set.add` or `Date.setTime`, so freezing one and calling the
 * event immutable would be a claim the code cannot keep.
 */
const REFUSED: [name: string, value: unknown, expected: RegExp][] = [
  ["undefined in an array", { list: ["a", undefined, "b"] }, /undefined inside an array/],
  ["NaN", { n: Number.NaN }, /the number NaN/],
  ["Infinity", { n: Number.POSITIVE_INFINITY }, /the number Infinity/],
  ["negative Infinity", { n: Number.NEGATIVE_INFINITY }, /the number -Infinity/],
  ["a bigint", { n: 10n }, /a bigint/],
  ["a symbol", { s: Symbol("x") }, /a symbol/],
  ["a function", { fn: () => undefined }, /a function/],
  ["a Date", { when: new Date("2026-01-01") }, /a Date .*ISO strings/],
  ["a Map", { m: new Map([["a", 1]]) }, /a Map .*set\(\)/],
  ["a Set", { s: new Set(["x"]) }, /a Set .*add\(\)/],
  ["a RegExp", { r: /x/g }, /a RegExp instance/],
  ["a typed array", { t: new Uint8Array([1, 2]) }, /a Uint8Array instance/],
  ["a class instance", { c: new (class Thing { value = 1; })() }, /a Thing instance/],
];

for (const [name, payload, expected] of REFUSED) {
  test(`refuses ${name}, and records nothing`, async () => {
    const a = counting(`refuse_${name.replace(/\W+/g, "_")}`, () => ok());
    propagationBus.subscribe(a as never);
    const before = a.runs;

    const outcome = await publishPayload(`refuse-${name}`, payload);

    assert.equal(outcome.accepted, false, `${name} was accepted`);
    assert.ok(outcome.error instanceof TypeError);
    assert.match(outcome.error.message, expected);
    // The path is in the message, so an author can find the field.
    assert.match(outcome.error.message, /^event\.payload/);
    assertNothingHappened(outcome.eventId, before, a);
  });
}

test("freezing a Map, a Set or a Date would not have made them immutable", () => {
  // The reason the boundary rejects rather than freezes. If any of these were
  // accepted and frozen, the event would still be mutable through its own
  // methods, and calling it immutable would be a claim the code cannot keep.
  const map = Object.freeze(new Map<string, number>());
  const set = Object.freeze(new Set<string>());
  const date = Object.freeze(new Date("2026-01-01T00:00:00.000Z"));

  map.set("smuggled", 1);
  set.add("smuggled");
  date.setTime(0);

  assert.equal(Object.isFrozen(map), true);
  assert.equal(map.get("smuggled"), 1, "a frozen Map still accepts set()");
  assert.equal(set.has("smuggled"), true, "a frozen Set still accepts add()");
  assert.equal(date.getTime(), 0, "a frozen Date still accepts setTime()");
});

test("refuses a cyclic payload, and records nothing", async () => {
  const a = counting("refuse_cyclic", () => ok());
  propagationBus.subscribe(a as never);
  const before = a.runs;

  type Cyc = { name: string; self?: Cyc };
  const cyclic: Cyc = { name: "loop" };
  cyclic.self = cyclic;

  const outcome = await publishPayload("refuse-cyclic", cyclic);

  assert.equal(outcome.accepted, false);
  assert.match(outcome.error!.message, /cyclic reference/);
  assert.match(outcome.error!.message, /log or an outbox/);
  assertNothingHappened(outcome.eventId, before, a);
});

test("allows the same object in two places, which is sharing rather than a cycle", async () => {
  const shared = { label: "same" };
  const outcome = await publishPayload("contract-shared", { a: shared, b: shared });

  assert.equal(outcome.accepted, true, outcome.error?.message);
  const stored = propagationBus.event("org_test", outcome.eventId) as
    DomainEvent<{ a: { label: string }; b: { label: string } }>;
  assert.equal(stored.payload.a.label, "same");
  assert.equal(stored.payload.b.label, "same");
  // Copied, so they are equal in value and no longer the same object.
  assert.notEqual(stored.payload.a, stored.payload.b);
});

test("publishing the same event twice runs no subscriber twice", async () => {
  const a = counting("a", () => ok());
  propagationBus.subscribe(a as never);

  const first = await propagationBus.publish(event("k1"));
  assert.equal(first.duplicate, false);
  assert.equal(a.runs, 1);
  assert.equal(outcomeOf(first, "a").attempts, 1);

  // The retry a flaky network, a double-tapped button or a replayed webhook
  // produces. The first publication's outcomes stand, exactly as they were.
  const second = await propagationBus.publish(event("k1"));
  assert.equal(second.duplicate, true);
  assert.equal(a.runs, 1, "nothing ran again");
  assert.equal(
    outcomeOf(second, "a").attempts, 1,
    "and the attempt count did not move",
  );
});

test("one projection throwing does not stop the others", async () => {
  const before = counting("before", () => ok("ran first"));
  const boom = counting("boom", () => {
    throw new Error("the accounting module is not there");
  });
  const after = counting("after", () => ok("ran anyway"));
  propagationBus.subscribe(before as never);
  propagationBus.subscribe(boom as never);
  propagationBus.subscribe(after as never);

  // The publish itself does NOT reject: the caller's own write already
  // succeeded, and reporting a failure would be a lie about their work.
  const result = await propagationBus.publish(event("k2"));
  assert.equal(before.runs, 1);
  assert.equal(boom.runs, 1);
  assert.equal(after.runs, 1, "the subscriber after the failure still ran");

  const states = Object.fromEntries(result.projections.map((p) => [p.subscriberId, p]));
  assert.equal(states.before.state, "processed");
  assert.equal(states.boom.state, "failed");
  assert.equal(states.boom.reason, "the accounting module is not there");
  assert.equal(states.boom.retryable, true, "a throw is retryable by default");
  assert.equal(states.after.state, "processed");
});

test("a failure can be retried without republishing the event", async () => {
  let fail = true;
  const flaky = counting("flaky", () => {
    if (fail) throw new Error("not yet");
    return ok("second time lucky");
  });
  propagationBus.subscribe(flaky as never);

  const published = await propagationBus.publish(event("k3"));
  assert.equal(outcomeOf(published, "flaky").state, "failed");
  assert.equal(outcomeOf(published, "flaky").attempts, 1);

  fail = false;
  const retried = await propagationBus.retry(published.event.eventId, "flaky");
  assert.ok(retried);
  assert.equal(retried.state, "processed");
  assert.equal(retried.attempts, 2, "the attempt count is the history of trying");
  assert.ok(retried.firstAttemptAt, "and the first attempt is remembered");

  // The event itself is untouched: it is a statement about the past, and
  // retrying a projection is not a new fact.
  assert.equal(propagationBus.events("org_test").length, 1);
});

test("a projection marked not retryable is not re-run", async () => {
  const asks = counting("asks", () => ({
    state: "needs_review",
    detail: "two profiles fit",
    reason: "a person has to pick",
    retryable: false,
  }));
  propagationBus.subscribe(asks as never);

  const published = await propagationBus.publish(event("k4"));
  const again = await propagationBus.retry(published.event.eventId, "asks");
  assert.equal(asks.runs, 1, "running it again would ask the same question");
  assert.equal(again?.state, "needs_review");
  assert.equal(again?.attempts, 1);
});

test("an unknown payload version is a question, never a guess", async () => {
  const v1Only = counting("v1_only", () => ok(), { versions: [1] });
  propagationBus.subscribe(v1Only as never);

  const result = await propagationBus.publish(event("k5", 2));
  assert.equal(v1Only.runs, 0, "it was never asked to read a shape it has not agreed");
  const row = outcomeOf(result, "v1_only");
  assert.equal(row.state, "needs_review");
  assert.match(row.reason ?? "", /version/i);
  assert.equal(row.retryable, false, "a retry would ask the same");
});

test("a subscriber is only offered the kinds it handles", async () => {
  const loadOnly = counting("load_only", () => ok());
  const fuelOnly: ProjectionSubscriber<{ n: number }> & { runs: number } = {
    id: "fuel_only",
    label: "fuel_only",
    targetModule: "fuel",
    handles: ["fuel_transaction.confirmed"],
    versions: [1],
    mock: false,
    runs: 0,
    project() {
      fuelOnly.runs += 1;
      return ok();
    },
  };
  propagationBus.subscribe(loadOnly as never);
  propagationBus.subscribe(fuelOnly as never);

  await propagationBus.publish(event("k6"));
  assert.equal(loadOnly.runs, 1);
  assert.equal(fuelOnly.runs, 0);
});

test("events and projections never cross the organization boundary", async () => {
  propagationBus.subscribe(counting("a", () => ok()) as never);
  await propagationBus.publish(event("k7"));

  assert.equal(propagationBus.events("org_test").length, 1);
  assert.equal(propagationBus.events("org_other").length, 0);
  assert.equal(propagationBus.projections("org_other").length, 0);

  // The id of the event that WAS published — `event()` builds it at v1. Asserted
  // present for its own organization first, so that the absence below is about
  // the boundary rather than about having asked for an id nobody ever minted.
  const published = domainEventId("load.finalized", 1, "k7");
  assert.ok(propagationBus.event("org_test", published));
  assert.equal(
    propagationBus.event("org_other", published),
    undefined,
    "another organization's event is absent, not forbidden",
  );
});

test("projections can be filtered by state, for a queue of exceptions", async () => {
  propagationBus.subscribe(counting("good", () => ok()) as never);
  propagationBus.subscribe(counting("bad", () => {
    throw new Error("no");
  }) as never);
  propagationBus.subscribe(counting("asks", () => ({
    state: "needs_review", detail: "d", reason: "r",
  })) as never);

  await propagationBus.publish(event("k8"));

  const mine = new Set(["good", "bad", "asks"]);
  const exceptions = propagationBus
    .projections("org_test", { state: ["failed", "needs_review"] })
    .filter((p) => mine.has(p.subscriberId));
  assert.deepEqual(exceptions.map((p) => p.subscriberId).sort(), ["asks", "bad"]);
  assert.deepEqual(
    propagationBus.projections("org_test", { state: ["processed"] })
      .filter((p) => mine.has(p.subscriberId))
      .map((p) => p.subscriberId),
    ["good"],
  );
});

test("resubscribing the same id replaces rather than duplicates", async () => {
  const first = counting("same", () => ok("first"));
  const second = counting("same", () => ok("second"));
  propagationBus.subscribe(first as never);
  propagationBus.subscribe(second as never);

  const result = await propagationBus.publish(event("k9"));
  assert.equal(
    result.projections.filter((p) => p.subscriberId === "same").length, 1,
    "one entry for that id, not two",
  );
  assert.equal(first.runs, 0, "the replaced subscriber is gone, not kept beside it");
  assert.equal(second.runs, 1);
});

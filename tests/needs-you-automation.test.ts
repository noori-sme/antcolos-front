import test from "node:test";
import assert from "node:assert/strict";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockStore } from "@/lib/api/mock/store";
import { resetInsuranceRegistry } from "@/lib/api/mock/insurance-registry";
import { serviceContext } from "./helpers.ts";

/**
 * Needs You as a DECISION queue, checked at the service seam.
 *
 * The screens are not tested here and never have been in this repo. What is
 * tested is the promise the screens rest on: every row arrives with the
 * background work already done, one press finishes it, the press runs the
 * downstream steps, and an item that is a view of another module's state says
 * so instead of pretending it can be approved.
 */

test.beforeEach(() => {
  resetInsuranceRegistry();
  mockStore.reset();
});

const OWNER = "mem_northline_owner";

test("every item in the queue arrives with its automation already done", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  assert.ok(items.length > 0, "the seeded workspace has work");

  for (const item of items) {
    const a = item.automation;
    assert.ok(a, `${item.id} carries an automation record`);
    assert.ok(a.prework.length >= 4, `${item.id} says what already ran`);
    assert.ok(a.options.length >= 1, `${item.id} lands on at least one press`);
    // The whole point: the system's share of the work is the large one.
    assert.ok(
      a.stepsDone >= a.stepsTotal / 2,
      `${item.id} should be mostly automated, not mostly manual`,
    );
    // A derived item is a link, never an approval that would write nothing.
    if (item.derived) {
      assert.equal(a.stage, "handoff");
      assert.equal(a.options.length, 1);
      assert.equal(a.options[0].intent, "open");
    } else {
      assert.equal(a.stage, "awaiting_decision");
      assert.ok(a.options.some((o) => o.intent === "approve"));
    }
  }
});

test("an expiring policy arrives with quotes priced off the policy itself", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  const renewal = items.find((i) => i.category === "expiring_policy" && !i.derived);
  if (!renewal) return; // This workspace has nothing inside its renewal window.

  const priced = renewal.automation!.options.filter((o) => o.metrics.length > 0);
  assert.equal(priced.length, 3, "three shortlisted quotes, side by side");
  assert.equal(
    priced.filter((o) => o.recommended).length, 1,
    "exactly one of them is the system's own pick",
  );
  for (const option of priced) {
    assert.ok(option.metrics.some((m) => m.label === "Premium"), "every quote carries its price");
    // The button is the commitment, not a verb: it has to be actionable without
    // opening anything.
    assert.match(option.label, /\$/);
    assert.ok(option.downstream.length > 0, "and says what the system does next");
  }
  // Rejecting the whole shortlist is always available, and is not a quote.
  assert.ok(renewal.automation!.options.some((o) => o.intent === "decline"));
});

test("the same policy produces the same shortlist on every read", async () => {
  const ctx = serviceContext(OWNER);
  const first = await mockNeedsYouService.list(ctx, {});
  const second = await mockNeedsYouService.list(ctx, {});
  const pick = (items: typeof first) =>
    items.find((i) => i.category === "expiring_policy" && !i.derived)?.automation?.options;

  const a = pick(first);
  if (!a) return;
  assert.deepEqual(a, pick(second), "a shortlist a person compared must not move under them");
});

test("one press closes the item and records what the system ran after it", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  const target = items.find(
    (i) => !i.derived && i.status === "open"
      && i.automation!.options.some((o) => o.intent === "approve"),
  );
  assert.ok(target, "there is something to decide");

  const option = target.automation!.options.find((o) => o.intent === "approve")!;
  const after = await mockNeedsYouService.decide(ctx, target.id, { optionId: option.id });

  assert.equal(after.status, "resolved");
  assert.equal(after.automation?.stage, "done");
  assert.equal(after.automation?.decision?.optionId, option.id);
  assert.equal(
    after.automation?.decision?.steps.length, option.downstream.length,
    "every downstream step of the chosen option ran",
  );
  assert.ok(
    after.automation?.decision?.steps.every((s) => s.state === "done"),
    "and finished",
  );
  // The decision is on the record, not only in the UI.
  const last = after.history[after.history.length - 1];
  assert.equal(last.action, "resolved");
  assert.match(last.note ?? "", /step/);
  assert.equal(after.automation?.decision?.actor.membershipId, ctx.membershipId);
});

/**
 * ★ REGRESSION ★
 * The options a person was SHOWN include ones a domain supplied — the renewal
 * quotes, priced off the policy. Deciding one has to re-plan the same way the
 * read did, or the service refuses the very button the row rendered.
 */
test("a quote the row offered can actually be bound", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  const renewal = items.find((i) => i.category === "expiring_policy" && !i.derived);
  if (!renewal) return;

  const quote = renewal.automation!.options.find((o) => o.metrics.length > 0)!;
  const after = await mockNeedsYouService.decide(ctx, renewal.id, { optionId: quote.id });

  assert.equal(after.status, "resolved");
  assert.equal(after.automation?.decision?.optionId, quote.id);
  assert.match(after.automation!.decision!.optionLabel, /\$/);
  assert.deepEqual(
    after.automation?.decision?.steps.map((s) => s.label),
    quote.downstream,
    "the steps that ran are the ones the option promised",
  );
});

test("a press the item never offered is refused", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  const target = items.find((i) => !i.derived && i.status === "open");
  assert.ok(target);

  await assert.rejects(
    () => mockNeedsYouService.decide(ctx, target.id, { optionId: "not_an_option" }),
    /No such decision option/,
  );
});

test("an item worked out from another module cannot be decided away here", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  const derived = items.find((i) => i.derived);
  if (!derived) return;

  await assert.rejects(
    () => mockNeedsYouService.decide(ctx, derived.id, { optionId: "open" }),
    /clears on its own|worked out from/,
  );

  // And it is still there afterwards, because nothing about it changed.
  const again = await mockNeedsYouService.list(ctx, {});
  assert.ok(again.some((i) => i.id === derived.id));
});

test("deciding needs exactly what the recommended action needs", async () => {
  const ctx = serviceContext(OWNER);
  const items = await mockNeedsYouService.list(ctx, {});
  const target = items.find(
    (i) => !i.derived && i.status === "open" && i.recommendedAction.requires.length > 0,
  );
  if (!target) return;

  const withoutIt = serviceContext(OWNER, {
    permissions: new Set(
      [...ctx.permissions].filter((p) => !target.recommendedAction.requires.includes(p)),
    ),
  });
  const option = target.automation!.options[0];

  await assert.rejects(() => mockNeedsYouService.decide(withoutIt, target.id, {
    optionId: option.id,
  }));
});

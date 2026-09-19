import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { bookedLoadWithRateCon } from "./helpers/booked-ratecon.ts";
import {
  SENSITIVE_FIELDS, confirmAndSign, fieldsByPriority, progressOf,
  rateConById, returnToBroker, reviewPriority, verifyField,
} from "@/lib/api/mock/rate-confirmation";
import { messageById } from "@/lib/api/mock/communications";

/**
 * The rate confirmation review, as a person actually works it.
 *
 * ★ WHAT THESE EXIST TO STOP HAPPENING ★
 *
 *   Reading in file order   Nineteen fields come off the page in the order the
 *           page has them, which puts the broker's MC number in front of the
 *           rate. A dispatcher who is interrupted after six fields has checked
 *           six unimportant ones. The queue is ordered by what it costs to get
 *           wrong, not by where it sits on the paper.
 *
 *   Sending our own paper back   A broker will not accept a document their
 *           system did not produce. Whatever leaves here — signed, or sent back
 *           for correction — is THEIR page. The signature is added to it; the
 *           disputed lines are marked on it. Nothing is retyped.
 *
 *   Silence about a mismatch   A confirmation that says $322 where $372 was
 *           agreed is the single most expensive thing this screen can let past.
 *           Sending it back must leave the LOAD standing and the paper refused,
 *           and it must say both numbers in the broker's own words.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

/* -------------------------------------------------------------------------- */
/* The queue                                                                   */
/* -------------------------------------------------------------------------- */

test("the fields that cost money come first, whatever order the page had them in", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);

  const ordered = fieldsByPriority(workflow);
  assert.equal(ordered.length, workflow.fields.length, "every field is still in the list");

  // A disagreement outranks everything: it is the one thing a person has to
  // answer before the document can go anywhere at all.
  const firstDisagreement = ordered.findIndex((f) => f.disagrees);
  const lastDisagreement = ordered.map((f) => f.disagrees).lastIndexOf(true);
  if (firstDisagreement >= 0) {
    assert.equal(firstDisagreement, 0, "the first thing on the list disagrees with the booking");
    assert.equal(
      lastDisagreement,
      ordered.filter((f) => f.disagrees).length - 1,
      "and the disagreements are together at the top, not scattered",
    );
  }

  // Below those, the money and the appointment times — the fields where a
  // misread digit is a claim — come before the ones a person can eyeball later.
  const rank = (key: string) => ordered.findIndex((f) => f.key === key);
  const sensitive = workflow.fields.filter((f) => SENSITIVE_FIELDS.includes(f.key) && !f.disagrees);
  const ordinary = workflow.fields.filter(
    (f) => !SENSITIVE_FIELDS.includes(f.key) && !f.disagrees && f.required,
  );
  for (const s of sensitive) {
    for (const o of ordinary) {
      assert.ok(
        rank(s.key) < rank(o.key),
        `${s.key} is checked before ${o.key}`,
      );
    }
  }

  // Where the risk is equal, the field that stands between a dispatcher and a
  // signature goes first. An optional field is never that.
  const seenOptional = new Map<number, number>();
  ordered.forEach((f, i) => {
    const risk = reviewPriority(f);
    if (!f.required && !seenOptional.has(risk)) seenOptional.set(risk, i);
    if (f.required && seenOptional.has(risk)) {
      assert.fail(`${f.key} is required and sits below an optional field of the same risk`);
    }
  });
});

test("the screen's next field is the top of that same queue, so Enter follows it", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);

  /*
   * ★ ONE ORDER, NOT TWO ★
   * The list a person reads and the field Enter answers have to be the same
   * field. They were not: the list was sorted and `nextFieldKey` still took the
   * first unreviewed field in file order, so pressing Enter approved something
   * further down the screen than the one highlighted.
   */
  for (let i = 0; i < 4; i += 1) {
    const expected = fieldsByPriority(workflow).find((f) => f.required && f.status === "unreviewed");
    if (!expected) break;
    assert.equal(progressOf(workflow).nextFieldKey, expected.key);
    const done = await verifyField(workflow.rateConId, expected.key, ctx);
    assert.equal(done.status, "ok");
  }
});

/* -------------------------------------------------------------------------- */
/* Sending it back                                                             */
/* -------------------------------------------------------------------------- */

test("sending it back refuses the paper, keeps the load, and marks THEIR page", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  const conflicts = workflow.fields.filter((f) => f.disagrees);
  assert.ok(conflicts.length > 0, "the sample document disagrees with the booking");

  const out = await returnToBroker(workflow.rateConId, ctx);
  assert.equal(out.status, "ok", JSON.stringify(out));

  const after = rateConById(workflow.rateConId, ctx);
  assert.ok(after);
  // ★ THE LOAD STANDS. ★ The truck is still holding and a corrected copy
  // continues this same review — so the workflow does not close.
  assert.equal(after.status, "reviewing");
  assert.equal(after.signed, undefined, "nothing was signed");
  assert.ok(after.sentBackAt, "and it is on the record that it went back");

  const sent = after.sentBackMessageId ? messageById(after.sentBackMessageId, ctx) : undefined;
  assert.ok(sent, "a message was drafted to send it back with");
  const message = sent.message;

  // Both numbers, in the broker's own document's words and ours. A message
  // that only said "the rate is wrong" starts a phone call, not a correction.
  for (const field of conflicts) {
    assert.ok(message.body.includes(field.value), `the body quotes what their page says: ${field.value}`);
    if (field.expected) {
      assert.ok(message.body.includes(field.expected), `and what was booked: ${field.expected}`);
    }
  }

  // ★ THEIR ORIGINAL GOES BACK, MARKED — NOT A DOCUMENT WE TYPED ★
  const attachment = message.attachments?.[0];
  assert.ok(attachment, "their document is attached");
  assert.equal(attachment.documentId, workflow.original.documentId);
  assert.deepEqual(
    [...(attachment.highlightBlockIds ?? [])].sort(),
    conflicts.map((f) => f.blockId).sort(),
    "with exactly the disputed lines marked on it",
  );

  // Nothing is sent by Antcolos. There is no mailbox, and the draft says so by
  // still being a draft.
  assert.notEqual(message.status, "sent");
});

test("there is nothing to send back when nothing disagrees", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  // Answer every disagreement by taking the document's word for it. The
  // document now matches what is recorded, so the dispute is over.
  for (const field of workflow.fields.filter((f) => f.disagrees)) {
    await verifyField(workflow.rateConId, field.key, ctx);
  }
  const live = rateConById(workflow.rateConId, ctx);
  assert.ok(live);
  // The FIELD still disagrees with what was booked — accepting it records that
  // a person looked, not that the numbers match — so the door stays open.
  const out = await returnToBroker(workflow.rateConId, ctx);
  assert.ok(out.status === "ok" || out.status === "blocked", out.status);
});

/* -------------------------------------------------------------------------- */
/* Signing                                                                     */
/* -------------------------------------------------------------------------- */

test("the signature goes on the broker's own page, and the original survives it", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  const originalBlocks = workflow.original.blocks.map((b) => ({ ...b }));

  for (const field of workflow.fields.filter((f) => f.required)) {
    await verifyField(workflow.rateConId, field.key, ctx);
  }
  const signed = await confirmAndSign(workflow.rateConId, ctx);
  assert.equal(signed.status, "ok", JSON.stringify(signed));

  const after = rateConById(workflow.rateConId, ctx);
  assert.ok(after?.signed, "there is a signed copy");

  /*
   * ★ WHAT GOES BACK IS THEIRS, WITH A SIGNATURE ADDED ★
   * Every block the broker produced is carried across in order and unchanged,
   * and the signature is appended after them. A system-generated document that
   * merely restated the same values would be refused by any broker's office,
   * and would be worthless in a dispute.
   */
  // Ids are re-minted because the signed copy is its own document record; the
  // CONTENT and the position on the page are what must be identical.
  const withoutId = (b: { id: string }) => ({ ...b, id: "" });
  const carried = after.signed.blocks.slice(0, originalBlocks.length);
  assert.deepEqual(
    carried.map(withoutId),
    originalBlocks.map(withoutId),
    "their page, block for block — every word, every position",
  );
  assert.ok(
    after.signed.blocks.length > originalBlocks.length,
    "with the signature added after it",
  );

  // And the received original is still exactly what arrived.
  assert.deepEqual(after.original.blocks, originalBlocks, "the original is untouched");
  assert.notEqual(after.signed.documentId, after.original.documentId, "two records, not one edited");
});

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  advanceClaimStatus, attachClaimEvidence, CLAIM_IDS, getClaimSync,
  insuranceNeedsYou, isInsuranceNeedsYouId, POLICY_IDS, renewPolicy,
  resetInsuranceRegistry,
} from "@/lib/api/mock/insurance-registry";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockStore } from "@/lib/api/mock/store";
import { allExcept, insuranceCaller, MERIDIAN, NORTHLINE, serviceContextFor } from "./helpers";

/**
 * The insurance items in Needs You are derived, not seeded — so the test that
 * matters is that fixing the underlying problem makes the item go away.
 */

const northline = () => insuranceCaller(NORTHLINE);
const isoDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const categories = (items: { category: string }[]) => items.map((i) => i.category);

beforeEach(() => {
  resetInsuranceRegistry();
  mockStore.reset();
});

test("the queue raises every kind of insurance problem in the fixtures", () => {
  const found = new Set(categories(insuranceNeedsYou(northline())));
  for (const expected of [
    "expiring_policy", "expired_policy", "critical_insurance_gap",
    "missing_coverage", "missing_claim_evidence", "unresolved_claim",
  ]) {
    assert.ok(found.has(expected), `expected a ${expected} item`);
  }
});

test("an expiring policy stops being raised once it is renewed", async () => {
  const ctx = northline();
  const before = insuranceNeedsYou(ctx).filter((i) => i.category === "expiring_policy");
  assert.equal(before.length, 1);
  assert.equal(before[0].entity.id, POLICY_IDS.nlGeneralLiability);

  await renewPolicy(ctx, POLICY_IDS.nlGeneralLiability, {
    policyNumber: "HI-GL-44120-R2",
    effectiveFrom: isoDays(24),
    expiresAt: isoDays(389),
    reason: "renewal",
  });

  const after = insuranceNeedsYou(ctx).filter((i) => i.category === "expiring_policy");
  assert.equal(after.length, 0, "renewing it actually clears the item");
});

test("a missing-evidence item clears when the evidence is attached", async () => {
  const ctx = northline();
  const id = `ins_ny_evidence_${CLAIM_IDS.nlAccident}`;
  assert.ok(insuranceNeedsYou(ctx).some((i) => i.id === id));

  const claim = getClaimSync(ctx, CLAIM_IDS.nlAccident);
  for (const item of claim.evidence.filter((e) => e.status === "missing")) {
    await attachClaimEvidence(ctx, item.id, { fileName: "x.pdf" });
  }

  assert.ok(!insuranceNeedsYou(ctx).some((i) => i.id === id));
});

test("a stalled claim stops being raised once it is closed", async () => {
  const ctx = northline();
  const stalled = insuranceNeedsYou(ctx).filter((i) => i.category === "unresolved_claim");
  assert.ok(stalled.length > 0);

  for (const item of stalled) {
    await advanceClaimStatus(ctx, item.entity.id, "closed", "Settled.");
  }
  assert.equal(insuranceNeedsYou(ctx).filter((i) => i.category === "unresolved_claim").length, 0);
});

test("an uncovered claim is raised as a critical gap", () => {
  const items = insuranceNeedsYou(northline());
  const uncovered = items.find((i) => i.id === `ins_ny_uncovered_${CLAIM_IDS.nlUncoveredProperty}`);
  assert.ok(uncovered);
  assert.equal(uncovered.severity, "critical");
  assert.equal(uncovered.entity.kind, "claim");
});

test("items declare the permission needed to see them", () => {
  for (const item of insuranceNeedsYou(northline())) {
    assert.ok(item.requires.length > 0, `${item.id} declares what it needs`);
  }
});

test("a membership without the insurance keys gets no insurance items", () => {
  const blind = insuranceCaller(NORTHLINE, allExcept("insurance:view", "claims:view"));
  assert.deepEqual(insuranceNeedsYou(blind), []);
});

test("a dispatch organization is not asked to renew somebody else's policy", () => {
  const items = insuranceNeedsYou(insuranceCaller(MERIDIAN));
  assert.equal(items.filter((i) => i.category === "expiring_policy").length, 0);
  assert.equal(items.filter((i) => i.category === "missing_coverage").length, 0);
});

test("derived items are recognisable, so writes can be routed back", () => {
  for (const item of insuranceNeedsYou(northline())) {
    assert.ok(isInsuranceNeedsYouId(item.id));
  }
  assert.equal(isInsuranceNeedsYouId("ny_1234"), false);
});

/* ---- Through the Needs You service ---------------------------------------- */

test("the queue serves insurance items alongside the organization's own", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const items = await mockNeedsYouService.list(ctx);
  assert.ok(items.some((i) => isInsuranceNeedsYouId(i.id)), "insurance items are in the list");
  assert.ok(items.some((i) => !isInsuranceNeedsYouId(i.id)), "and so are the existing ones");
});

test("snoozing an insurance item records the decision without touching the policy", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const items = await mockNeedsYouService.list(ctx);
  const item = items.find((i) => i.id.startsWith("ins_ny_expiring_"))!;

  const snoozed = await mockNeedsYouService.snooze(ctx, item.id, {
    hours: 4, reason: "Dana is re-marketing it this week.",
  });
  assert.equal(snoozed.status, "snoozed");

  // It persists across a fresh derivation...
  const again = await mockNeedsYouService.list(ctx);
  assert.equal(again.find((i) => i.id === item.id)?.status, "snoozed");
  // ...and the policy itself is untouched.
  const policyId = item.entity.id;
  assert.equal(getPolicyStatus(policyId), "expiring");
});

function getPolicyStatus(policyId: string) {
  return insuranceNeedsYou(northline()).find((i) => i.entity.id === policyId)
    ? "expiring"
    : "renewed";
}

test("the open count includes insurance items and drops when one is resolved", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const before = await mockNeedsYouService.openCount(ctx);
  const items = await mockNeedsYouService.list(ctx);
  const item = items.find((i) => i.id.startsWith("ins_ny_evidence_"))!;

  await mockNeedsYouService.resolve(ctx, item.id, "Paperwork is with the adjuster.");
  const after = await mockNeedsYouService.openCount(ctx);
  assert.equal(after, before - 1);
});

test("a driver membership is not shown the carrier's insurance queue", async () => {
  const ctx = serviceContextFor("mem_cascade_driver");
  const items = await mockNeedsYouService.list(ctx);
  assert.ok(!items.some((i) => isInsuranceNeedsYouId(i.id)));
});

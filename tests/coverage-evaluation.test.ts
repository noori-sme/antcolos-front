import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageStateAt, evaluateCoverage, policyInForceAt, policyStateAt,
  subjectScheduledAt, type CoverageEvaluationData,
} from "@/lib/insurance/coverage";
import type {
  InsuranceCoverage, InsurancePolicy, PolicySubject,
} from "@/types";

/**
 * The rules, on their own, with dates chosen by hand.
 *
 * These are the tests that matter most in the module: if any of them regress,
 * a historical claim silently changes what it was covered by.
 */

const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

const policy = (over: Partial<InsurancePolicy> = {}): InsurancePolicy => ({
  policyId: "p1", policyChainId: "chain", versionNumber: 1,
  carrierOrganizationId: "org_a", carrierName: "Carrier A",
  policyNumber: "POL-1",
  insurer: { id: "i", name: "Insurer", verification: { state: "unverified" } },
  recordedStatus: "active",
  effectiveFrom: day(1), expiresAt: day(100),
  createdAt: day(1), createdByMembershipId: "m", createdByName: "M",
  ...over,
});

const line = (over: Partial<InsuranceCoverage> = {}): InsuranceCoverage => ({
  coverageId: "c1", policyId: "p1", coverageType: "auto_liability",
  limitPerOccurrence: { amount: 100_000_000, currency: "USD" },
  deductible: { amount: 250_000, currency: "USD" },
  effectiveFrom: day(1), expiresAt: day(100), recordedStatus: "active",
  ...over,
});

const row = (over: Partial<PolicySubject> = {}): PolicySubject => ({
  id: "s1", policyId: "p1", subjectKind: "truck", subjectId: "truck-1",
  subjectLabel: "Unit 1", addedAt: day(1),
  ...over,
});

const ask = (at: string) => ({
  at,
  carrierOrganizationId: "org_a",
  subjectKind: "truck" as const,
  subjectId: "truck-1",
  coverageType: "auto_liability" as const,
});

test("a policy reads as pending before its term and expired after it", () => {
  const p = policy();
  assert.equal(policyStateAt(p, day(-5)), "pending");
  assert.equal(policyStateAt(p, day(50)), "active");
  assert.equal(policyStateAt(p, day(95)), "expiring");
  assert.equal(policyStateAt(p, day(120)), "expired");
});

test("a policy recorded as pending never comes into force, whatever the date", () => {
  const p = policy({ recordedStatus: "pending" });
  assert.equal(policyStateAt(p, day(50)), "pending");
  assert.equal(policyInForceAt(p, day(50)), false);
});

test("supersession is dated: a policy superseded in June was in force in March", () => {
  const p = policy({
    recordedStatus: "superseded", supersededAt: day(60), supersededByPolicyId: "p2",
  });
  assert.equal(policyStateAt(p, day(30)), "active");
  assert.equal(policyInForceAt(p, day(30)), true);
  assert.equal(policyStateAt(p, day(70)), "superseded");
  assert.equal(policyInForceAt(p, day(70)), false);
});

test("cancellation is dated the same way", () => {
  const p = policy({ recordedStatus: "cancelled", cancelledAt: day(40) });
  assert.equal(policyStateAt(p, day(20)), "active");
  assert.equal(policyStateAt(p, day(41)), "cancelled");
});

test("a coverage line superseded later still answered for its own term", () => {
  const c = line({ recordedStatus: "superseded", supersededAt: day(60) });
  assert.equal(coverageStateAt(c, day(30)), "active");
  assert.equal(coverageStateAt(c, day(61)), "superseded");
});

test("a schedule row covers up to the instant it is closed, and not after", () => {
  const s = row({ addedAt: day(10), removedAt: day(50) });
  assert.equal(subjectScheduledAt(s, day(9)), false);
  assert.equal(subjectScheduledAt(s, day(10)), true);
  assert.equal(subjectScheduledAt(s, day(49)), true);
  assert.equal(subjectScheduledAt(s, day(50)), false);
});

test("a scheduled unit inside the term is covered", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()], coverages: [line()], subjects: [row()],
  };
  const result = evaluateCoverage(ask(day(40)), data);
  assert.equal(result.covered, true);
  assert.equal(result.outcome, "covered");
  assert.equal(result.policyNumber, "POL-1");
  assert.equal(result.deductible?.amount, 250_000);
});

test("taking a unit off the schedule changes nothing for an earlier date", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()],
    coverages: [line()],
    subjects: [row({ removedAt: day(50), removalReason: "Moved to the owner's own policy." })],
  };
  assert.equal(evaluateCoverage(ask(day(40)), data).covered, true);

  const after = evaluateCoverage(ask(day(60)), data);
  assert.equal(after.covered, false);
  assert.equal(after.outcome, "not_scheduled");
  // The reason names the date and the explanation, not just "no".
  assert.match(after.reason, /Taken off policy POL-1's schedule/);
  assert.match(after.reason, /owner's own policy/);
});

test("a blanket row covers a unit the policy never names", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()],
    coverages: [line({ appliesToSubjectKinds: ["truck"] })],
    subjects: [row({ subjectKind: "carrier", subjectId: "org_a", subjectLabel: "Carrier A" })],
  };
  const result = evaluateCoverage(ask(day(40)), data);
  assert.equal(result.covered, true);
  assert.equal(result.subjectLabel, "Carrier A");
});

test("a blanket row does not reach a kind of unit the coverage line excludes", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()],
    coverages: [line({ appliesToSubjectKinds: ["trailer"] })],
    subjects: [row({ subjectKind: "carrier", subjectId: "org_a", subjectLabel: "Carrier A" })],
  };
  assert.equal(evaluateCoverage(ask(day(40)), data).outcome, "not_scheduled");
});

test("a blanket row stops speaking for a unit the policy has explicitly de-scheduled", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()],
    coverages: [line({ appliesToSubjectKinds: ["truck"] })],
    subjects: [
      row({ id: "blanket", subjectKind: "carrier", subjectId: "org_a", subjectLabel: "Carrier A" }),
      row({ id: "named", removedAt: day(50) }),
    ],
  };
  assert.equal(evaluateCoverage(ask(day(40)), data).covered, true);
  assert.equal(evaluateCoverage(ask(day(60)), data).outcome, "not_scheduled");
});

test("a renewal answers for the new term and the old version for the old one", () => {
  const v1 = policy({
    policyId: "p1", versionNumber: 1, policyNumber: "POL-1",
    effectiveFrom: day(1), expiresAt: day(100),
    recordedStatus: "superseded", supersededAt: day(100), supersededByPolicyId: "p2",
  });
  const v2 = policy({
    policyId: "p2", versionNumber: 2, policyNumber: "POL-1-R",
    effectiveFrom: day(100), expiresAt: day(200), supersedesPolicyId: "p1",
  });
  const data: CoverageEvaluationData = {
    policies: [v1, v2],
    coverages: [
      line({ coverageId: "c1", policyId: "p1", recordedStatus: "superseded", supersededAt: day(100) }),
      line({ coverageId: "c2", policyId: "p2", effectiveFrom: day(100), expiresAt: day(200) }),
    ],
    subjects: [
      row({ id: "s1", policyId: "p1", removedAt: day(100) }),
      row({ id: "s2", policyId: "p2", addedAt: day(100) }),
    ],
  };

  assert.equal(evaluateCoverage(ask(day(40)), data).policyNumber, "POL-1");
  assert.equal(evaluateCoverage(ask(day(150)), data).policyNumber, "POL-1-R");
});

test("a carrier's own policies are the only ones considered", () => {
  const data: CoverageEvaluationData = {
    policies: [policy({ carrierOrganizationId: "org_b" })],
    coverages: [line()],
    subjects: [row()],
  };
  const result = evaluateCoverage(ask(day(40)), data);
  assert.equal(result.covered, false);
  assert.equal(result.outcome, "no_policy");
});

test("a missing coverage line is reported as absent, not as out of term", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()], coverages: [line({ coverageType: "cargo" })], subjects: [row()],
  };
  assert.equal(evaluateCoverage(ask(day(40)), data).outcome, "coverage_type_absent");
});

test("a line that lapsed inside a live policy is reported against the line", () => {
  const data: CoverageEvaluationData = {
    policies: [policy()],
    coverages: [line({ expiresAt: day(30) })],
    subjects: [row()],
  };
  assert.equal(evaluateCoverage(ask(day(40)), data).outcome, "outside_coverage_term");
});

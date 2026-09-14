import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  addPolicySubject, cancelPolicy, CLAIM_IDS, evaluateCoverageAt,
  getClaimSync, getPolicyProfile, POLICY_IDS, recordCertificate,
  removePolicySubject, renewPolicy, resetInsuranceRegistry,
} from "@/lib/api/mock/insurance-registry";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { allExcept, insuranceCaller, NORTHLINE } from "./helpers";

/**
 * Renewal, replacement and re-scheduling must add to history, never rewrite it.
 */

const northline = () => insuranceCaller(NORTHLINE);
const isoDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeEach(() => resetInsuranceRegistry());

test("renewing writes a new version and keeps the previous one whole", async () => {
  const ctx = northline();
  const before = await getPolicyProfile(ctx, POLICY_IDS.nlPrimaryV2);
  const beforeCoverage = before.policy.coverage.length;
  const beforeScheduled = before.subjects.filter((s) => !s.removedAt).length;

  const renewed = await renewPolicy(ctx, POLICY_IDS.nlPrimaryV2, {
    policyNumber: "GPM-AL-889120-R3",
    effectiveFrom: isoDays(200),
    expiresAt: isoDays(565),
    reason: "renewal",
  });

  assert.equal(renewed.versionNumber, 3);
  assert.equal(renewed.supersedesPolicyId, POLICY_IDS.nlPrimaryV2);
  assert.notEqual(renewed.policyId, POLICY_IDS.nlPrimaryV2);

  // The coverage and the schedule travel; nobody re-keys them.
  assert.equal(renewed.coverage.length, beforeCoverage);
  assert.equal(renewed.subjectCount, beforeScheduled);

  const old = await getPolicyProfile(ctx, POLICY_IDS.nlPrimaryV2);
  assert.equal(old.policy.supersededByPolicyId, renewed.policyId);
  assert.equal(old.policy.policyNumber, "GPM-AL-889120-R2", "the old number is untouched");
  assert.equal(old.policy.effectiveFrom, before.policy.effectiveFrom);
  assert.equal(old.policy.expiresAt, before.policy.expiresAt);
  assert.equal(old.certificates.length, before.certificates.length,
    "certificates issued against the old version stay with it");
});

test("both versions appear in the chain, from either end", async () => {
  const ctx = northline();
  const renewed = await renewPolicy(ctx, POLICY_IDS.nlPrimaryV2, {
    policyNumber: "GPM-AL-889120-R3",
    effectiveFrom: isoDays(200), expiresAt: isoDays(565), reason: "renewal",
  });

  const fromNew = await getPolicyProfile(ctx, renewed.policyId);
  const fromOld = await getPolicyProfile(ctx, POLICY_IDS.nlPrimaryV1);
  assert.equal(fromNew.versions.length, 3);
  assert.deepEqual(
    fromNew.versions.map((v) => v.versionNumber),
    fromOld.versions.map((v) => v.versionNumber),
  );
});

test("a renewal does not change what a past claim was attributed to", async () => {
  const ctx = northline();
  const before = getClaimSync(ctx, CLAIM_IDS.nlAccident).attribution;

  await renewPolicy(ctx, POLICY_IDS.nlPrimaryV2, {
    policyNumber: "GPM-AL-889120-R3",
    effectiveFrom: isoDays(200), expiresAt: isoDays(565), reason: "renewal",
  });

  const after = getClaimSync(ctx, CLAIM_IDS.nlAccident).attribution;
  assert.deepEqual(after, before);
});

test("a claim from the previous term still names the previous policy version", () => {
  const claim = getClaimSync(northline(), CLAIM_IDS.nlHistoricCargo);
  assert.equal(claim.attribution.outcome, "covered");
  assert.equal(claim.attribution.policyId, POLICY_IDS.nlPrimaryV1);
  assert.equal(claim.attribution.policyVersionNumber, 1);
});

test("coverage read at a past date still resolves after a renewal", async () => {
  const ctx = northline();
  const at = isoDays(-20);
  const before = evaluateCoverageAt(ctx, {
    at, subjectKind: "truck", subjectId: TRUCK_IDS.nl115, coverageType: "auto_liability",
  });
  assert.equal(before.covered, true);

  await renewPolicy(ctx, POLICY_IDS.nlPrimaryV2, {
    policyNumber: "GPM-AL-889120-R3",
    effectiveFrom: isoDays(200), expiresAt: isoDays(565), reason: "renewal",
  });

  const after = evaluateCoverageAt(ctx, {
    at, subjectKind: "truck", subjectId: TRUCK_IDS.nl115, coverageType: "auto_liability",
  });
  assert.equal(after.covered, true);
  assert.equal(after.policyId, before.policyId);
});

test("a version that has already been replaced cannot be renewed again", async () => {
  await assert.rejects(
    () => renewPolicy(northline(), POLICY_IDS.nlPrimaryV1, {
      policyNumber: "X", effectiveFrom: isoDays(1), expiresAt: isoDays(10), reason: "renewal",
    }),
    /already been replaced/,
  );
});

test("a term that ends before it starts is refused", async () => {
  await assert.rejects(
    () => renewPolicy(northline(), POLICY_IDS.nlPrimaryV2, {
      policyNumber: "X", effectiveFrom: isoDays(10), expiresAt: isoDays(5), reason: "renewal",
    }),
    /end after it starts/,
  );
});

test("taking a unit off the schedule closes the row rather than deleting it", async () => {
  const ctx = northline();
  const before = await getPolicyProfile(ctx, POLICY_IDS.nlPrimaryV2);
  const row = before.subjects.find((s) => s.subjectId === TRUCK_IDS.nl111 && !s.removedAt)!;
  const rowCount = before.subjects.length;

  await removePolicySubject(ctx, row.id, "Sold.");

  const after = await getPolicyProfile(ctx, POLICY_IDS.nlPrimaryV2);
  assert.equal(after.subjects.length, rowCount, "no row disappeared");
  const closed = after.subjects.find((s) => s.id === row.id)!;
  assert.ok(closed.removedAt);
  assert.equal(closed.removalReason, "Sold.");
});

test("re-scheduling a unit does not resurrect cover for the gap in between", async () => {
  const ctx = northline();
  const profile = await getPolicyProfile(ctx, POLICY_IDS.nlPrimaryV2);
  const removed = profile.subjects.find((s) => s.subjectId === TRUCK_IDS.nl118 && s.removedAt)!;
  assert.ok(removed, "unit 118 came off the schedule in the fixtures");

  // The event ten days ago, while it was off cover.
  const before = evaluateCoverageAt(ctx, {
    at: isoDays(-10), subjectKind: "truck", subjectId: TRUCK_IDS.nl118, coverageType: "auto_liability",
  });
  assert.equal(before.covered, false);

  await addPolicySubject(ctx, POLICY_IDS.nlPrimaryV2, {
    subjectKind: "truck", subjectId: TRUCK_IDS.nl118, subjectLabel: "Unit 118",
  });

  const stillUncovered = evaluateCoverageAt(ctx, {
    at: isoDays(-10), subjectKind: "truck", subjectId: TRUCK_IDS.nl118, coverageType: "auto_liability",
  });
  assert.equal(stillUncovered.covered, false, "putting it back on today does not backdate cover");

  const nowCovered = evaluateCoverageAt(ctx, {
    at: new Date().toISOString(), subjectKind: "truck", subjectId: TRUCK_IDS.nl118,
    coverageType: "auto_liability",
  });
  assert.equal(nowCovered.covered, true);
});

test("the same unit cannot be scheduled twice at once", async () => {
  await assert.rejects(
    () => addPolicySubject(northline(), POLICY_IDS.nlPrimaryV2, {
      subjectKind: "truck", subjectId: TRUCK_IDS.nl104, subjectLabel: "Unit 104",
    }),
    /already on this schedule/,
  );
});

test("cancelling is dated, so cover before the cancellation stands", async () => {
  const ctx = northline();
  const before = evaluateCoverageAt(ctx, {
    at: isoDays(-20), subjectKind: "truck", subjectId: TRUCK_IDS.nl115,
    coverageType: "auto_liability",
  });
  assert.equal(before.covered, true);

  await cancelPolicy(ctx, POLICY_IDS.nlPrimaryV2, "Moved to a new insurer.");

  const stillCovered = evaluateCoverageAt(ctx, {
    at: isoDays(-20), subjectKind: "truck", subjectId: TRUCK_IDS.nl115,
    coverageType: "auto_liability",
  });
  assert.equal(stillCovered.covered, true, "last month is unaffected");

  const notNow = evaluateCoverageAt(ctx, {
    at: isoDays(1), subjectKind: "truck", subjectId: TRUCK_IDS.nl115,
    coverageType: "auto_liability",
  });
  assert.equal(notNow.covered, false);
  assert.equal(notNow.outcome, "policy_cancelled");
});

test("a certificate can only evidence coverage on its own policy", async () => {
  await assert.rejects(
    () => recordCertificate(northline(), POLICY_IDS.nlPrimaryV2, {
      certificateNumber: "COI-X", holderName: "Somebody", holderKind: "broker",
      coverageIds: ["cov_nl_gl"],
      effectiveFrom: isoDays(0), expiresAt: isoDays(90), additionalInsured: false,
    }),
    /only evidence coverage on its own policy/,
  );
});

test("managing insurance needs the management key, not just the view key", async () => {
  const viewer = insuranceCaller(NORTHLINE, allExcept("insurance:manage"));
  await assert.rejects(
    () => renewPolicy(viewer, POLICY_IDS.nlPrimaryV2, {
      policyNumber: "X", effectiveFrom: isoDays(1), expiresAt: isoDays(10), reason: "renewal",
    }),
    (e: Error) => e.name === "InsurancePermissionError",
  );
});

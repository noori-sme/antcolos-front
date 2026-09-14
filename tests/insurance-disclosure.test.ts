import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  CLAIM_IDS, getClaimSync, getPolicyProfile, insuranceDashboardSync,
  InsuranceNotFoundError, listClaimsSync, listPoliciesSync, POLICY_IDS,
  resetInsuranceRegistry, revokePolicyShare, sharePolicy,
} from "@/lib/api/mock/insurance-registry";
import { allExcept, BAXTER, CASCADE, insuranceCaller, MERIDIAN, NORTHLINE } from "./helpers";

/**
 * Who may see what.
 *
 * The rule under test is the one the brief is strictest about: a dispatch
 * organization sees only what a carrier has deliberately shared, and never
 * claim money or private policy detail.
 */

beforeEach(() => resetInsuranceRegistry());

test("a carrier sees its own policies in full", () => {
  const [first] = listPoliciesSync(insuranceCaller(NORTHLINE), {});
  assert.equal(first.disclosure, "full");
  assert.ok(first.premium, "the holder sees the premium");
  assert.ok(first.coverage.every((c) => c.deductible), "the holder sees deductibles");
});

test("a carrier cannot see another carrier's policies at all", () => {
  const baxterPolicies = listPoliciesSync(insuranceCaller(BAXTER), { includeSuperseded: true });
  assert.ok(baxterPolicies.length > 0);
  assert.ok(
    baxterPolicies.every((p) => p.carrierOrganizationId === BAXTER),
    "no Northline or Cascade policy leaks into Baxter's list",
  );

  const cascade = listPoliciesSync(insuranceCaller(CASCADE), { includeSuperseded: true });
  assert.ok(cascade.every((p) => p.carrierOrganizationId === CASCADE));
});

test("a dispatch organization sees only the policy explicitly shared with it", () => {
  const shared = listPoliciesSync(insuranceCaller(MERIDIAN), {});
  assert.equal(shared.length, 1);
  assert.equal(shared[0].policyId, POLICY_IDS.baxterPrimary);
  assert.equal(shared[0].disclosure, "shared_summary");
});

test("a shared policy carries no premium, no private notes and no deductibles", () => {
  const [shared] = listPoliciesSync(insuranceCaller(MERIDIAN), {});
  // Absent, not zeroed: an absent field cannot be accidentally rendered as $0.
  assert.equal(shared.premium, undefined);
  assert.equal(shared.premiumInterval, undefined);
  assert.equal(shared.notes, undefined);
  assert.equal(shared.agentName, undefined);
  assert.equal(shared.openClaimCount, undefined);
  assert.ok(shared.coverage.length > 0, "the cover itself is shared");
  assert.ok(shared.coverage.every((c) => c.deductible === undefined));
  assert.ok(shared.sharePurpose, "and it says why it was shared");
});

test("a dispatch organization cannot open a policy that was never shared", async () => {
  await assert.rejects(
    () => getPolicyProfile(insuranceCaller(MERIDIAN), POLICY_IDS.nlPrimaryV2),
    InsuranceNotFoundError,
  );
});

test("an unknown id and a forbidden id give the same answer", async () => {
  const forbidden = await getPolicyProfile(insuranceCaller(MERIDIAN), POLICY_IDS.nlPrimaryV2)
    .then(() => null, (e: Error) => e.message);
  const unknown = await getPolicyProfile(insuranceCaller(MERIDIAN), "no-such-policy")
    .then(() => null, (e: Error) => e.message);
  assert.equal(forbidden, unknown);
});

test("a dispatch organization sees only the claim shared with it, without the money", () => {
  const rows = listClaimsSync(insuranceCaller(MERIDIAN));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].claimId, CLAIM_IDS.baxterCargo);

  const claim = getClaimSync(insuranceCaller(MERIDIAN), CLAIM_IDS.baxterCargo);
  assert.equal(claim.disclosure, "shared_summary");
  assert.equal(claim.financials, undefined, "no claim financials");
  assert.equal(claim.costs, undefined, "no cost lines");
  assert.equal(claim.responsibleParty, undefined, "fault stays with the carrier");
  assert.equal(claim.attribution.limitPerOccurrence, undefined);
  assert.equal(claim.attribution.deductible, undefined);
  assert.ok(claim.attribution.insurerName, "but it can say who the insurer is");
});

test("a shared claim hides internal notes and money entries in the history", () => {
  const mine = getClaimSync(insuranceCaller(BAXTER), CLAIM_IDS.baxterCargo);
  const theirs = getClaimSync(insuranceCaller(MERIDIAN), CLAIM_IDS.baxterCargo);

  assert.ok(mine.notes.length >= theirs.notes.length);
  assert.ok(theirs.notes.every((n) => n.visibility === "operational"));
  assert.ok(theirs.history.every((e) => !e.financial));
});

test("holding the claim but not the financial key still withholds the money", () => {
  const withoutMoney = insuranceCaller(NORTHLINE, allExcept("claims:financials:view"));
  const claim = getClaimSync(withoutMoney, CLAIM_IDS.nlAccident);
  assert.equal(claim.disclosure, "full");
  assert.equal(claim.financials, undefined);
  assert.equal(claim.costs, undefined);
});

test("holding the policy but not the sensitive key withholds the premium", () => {
  const withoutPrivates = insuranceCaller(NORTHLINE, allExcept("insurance:sensitive:view"));
  const [policy] = listPoliciesSync(withoutPrivates, {});
  assert.equal(policy.disclosure, "full");
  assert.equal(policy.premium, undefined);
  assert.equal(policy.notes, undefined);
  // Cover and deductibles are operational, and stay.
  assert.ok(policy.coverage.every((c) => c.deductible));
});

test("without insurance:view there is nothing to see and nothing to guess at", async () => {
  const blind = insuranceCaller(NORTHLINE, allExcept("insurance:view"));
  assert.deepEqual(listPoliciesSync(blind, {}), []);
  await assert.rejects(
    () => getPolicyProfile(blind, POLICY_IDS.nlPrimaryV2),
    (e: Error) => e.name === "InsurancePermissionError",
  );
});

test("without claims:view the claim list is empty", () => {
  const blind = insuranceCaller(NORTHLINE, allExcept("claims:view"));
  assert.deepEqual(listClaimsSync(blind), []);
});

test("revoking a share takes the policy away again", async () => {
  const baxter = insuranceCaller(BAXTER);
  const profile = await getPolicyProfile(baxter, POLICY_IDS.baxterPrimary);
  const [share] = profile.shares;
  assert.ok(share);

  await revokePolicyShare(baxter, share.id);
  assert.deepEqual(listPoliciesSync(insuranceCaller(MERIDIAN), {}), []);
});

test("a share needs a stated purpose", async () => {
  await assert.rejects(
    () => sharePolicy(insuranceCaller(NORTHLINE), POLICY_IDS.nlPrimaryV2, {
      organizationId: MERIDIAN, organizationName: "Meridian Dispatch",
      purpose: "   ", scope: "coverage_summary",
    }),
    /why this organization needs to see the policy/,
  );
});

test("a dispatch organization cannot share a carrier's policy onward", async () => {
  await assert.rejects(
    () => sharePolicy(insuranceCaller(MERIDIAN), POLICY_IDS.baxterPrimary, {
      organizationId: "org_summit", organizationName: "Summit Dispatch",
      purpose: "We would like to pass it on.", scope: "coverage_summary",
    }),
    InsuranceNotFoundError,
  );
});

test("the dashboard a dispatch organization gets is made only of what was shared", () => {
  const dash = insuranceDashboardSync(insuranceCaller(MERIDIAN));
  assert.equal(dash.disclosure, "shared_summary");
  assert.equal(dash.policies.active + dash.policies.expiring, 1);
  assert.equal(dash.coverageGaps.length, 0, "a dispatcher has no fleet of its own to leave uncovered");
  assert.equal(dash.claimFinancials?.totalIncurred.amount, 0,
    "and no money, because none of the claims are theirs");
});

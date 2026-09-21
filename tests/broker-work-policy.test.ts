import test from "node:test";
import assert from "node:assert/strict";
import {
  APEX_MC, BAXTER, BAXTER_OWNER, MERIDIAN, MERIDIAN_DISPATCHER, MERIDIAN_OWNER,
  NORTHLINE, NORTHLINE_DISPATCHER, NORTHLINE_OWNER, TANDEM_MC, brokerPartyByMc,
  policyContextFor, resetPolicyWorld, withoutKeys,
} from "./broker-policy-harness.ts";
import {
  BrokerPolicyError, approveBrokerPolicySync, attachBrokerPolicyEvidence,
  brokerPoliciesFor,
  brokerPoliciesForTests, evaluateBrokerPolicyFor,
  grantBrokerPolicyExceptionSync, proposeBrokerPolicySync,
  policyAuthorityFor, recordFactoringRejection, rejectBrokerPolicySync,
  revokeBrokerPolicy, updateBrokerPolicyDefaults, verdictForBooking,
} from "@/lib/api/mock/broker-policy-registry";
import { brokerPolicyNeedsYouItems } from "@/lib/api/mock/broker-policy-needs-you";
import { getPartyProfile, listDirectory } from "@/lib/api/mock/party-registry";
import { setMembershipStatus } from "@/lib/api/mock/membership-directory";
import { services } from "@/lib/api";
import {
  FACTORING_EVIDENCE_FRESH_DAYS, MAX_TEMPORARY_HOLD_HOURS, effectiveStatus,
  isEnforceable, isStaleEvidence,
} from "@/types";
import type { Listing } from "@/types";

/**
 * ★ BROKER WORK POLICIES: AUTHORITY, ROUTING, ISOLATION AND PRIVACY ★
 *
 * The enforcement half — what a policy does to Load Search, an Opportunity and
 * a booking — is in `broker-policy-enforcement.test.ts`. This file proves the
 * half that decides WHOSE decision a policy is, WHO may take it, and who may
 * never see it.
 *
 * Every caller comes from the real membership roster through the real
 * permission resolver, so nothing below can pass by granting itself an
 * authority the product would refuse.
 */

/** A listing shaped exactly as the load-board ingest produces one. */
function listingFor(mcNumber: string, name: string): Pick<Listing, "broker"> {
  return { broker: { name, mcNumber } };
}

const APEX = () => listingFor(APEX_MC, "Apex Logistics");

/* ========================================================================== */
/* 1. A Carrier Owner can create a carrier policy directly                    */
/* ========================================================================== */

test("1 · a Carrier Owner creates a carrier policy directly, in force at once", () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const outcome = proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: "Two short-paid invoices and no answer since June.",
  });

  assert.equal(outcome.createdDirectly, true, "the owner did not need anybody");
  assert.equal(outcome.awaitingApproval, false);
  assert.equal(outcome.policy.status, "active");
  assert.equal(outcome.policy.organizationId, NORTHLINE, "it is Northline's decision");
  assert.equal(outcome.policy.scope, "carrier");
  assert.ok(outcome.policy.approvedBy, "an owner's own creation is approved by them");

  // It names the CANONICAL broker, not a string off a load board.
  assert.equal(outcome.policy.brokerPartyId, apex.partyId);
  assert.equal(outcome.policy.reportedMcNumber, "612884");

  // Provenance and history exist from the first moment, and the history is a
  // record of what happened rather than a restatement of the current state.
  assert.equal(outcome.policy.history.length, 1);
  assert.equal(outcome.policy.history[0].kind, "created");
  assert.equal(outcome.policy.history[0].actor.membershipId, owner.membershipId);

  // And it actually bites.
  const evaluation = evaluateBrokerPolicyFor(owner, APEX(), {
    carrierOrganizationId: NORTHLINE,
  });
  assert.equal(evaluation.effect, "blocked");
});

/* ========================================================================== */
/* 2. A delegated dispatcher creates only a proposal                          */
/* ========================================================================== */

test("2 · a delegated dispatcher's carrier policy is a proposal and nothing else", () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  const outcome = proposeBrokerPolicySync(dispatcher, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "suspected_fraud",
    explanation: "The dispatch email domain does not match the MC on file.",
  });

  assert.equal(outcome.createdDirectly, false);
  assert.equal(outcome.policy.status, "proposed");
  assert.equal(outcome.policy.approvedBy, undefined);

  // ★ INERT ★ A proposal is not a soft block. It does nothing at all.
  assert.equal(isEnforceable(outcome.policy, new Date().toISOString()), false);
  const evaluation = evaluateBrokerPolicyFor(dispatcher, APEX(), {
    carrierOrganizationId: BAXTER,
  });
  assert.equal(evaluation.effect, "none", "a proposal filters nothing");
  assert.deepEqual(evaluation.notices, []);

  // The same dispatcher cannot then approve their own proposal.
  assert.throws(
    () => approveBrokerPolicySync(dispatcher, outcome.policy.policyId),
    (error: unknown) => error instanceof BrokerPolicyError && error.code === "not_authorized",
  );
  assert.equal(
    brokerPoliciesForTests(BAXTER)[0].status, "proposed",
    "the refused approval changed nothing",
  );
});

test("2b · a carrier employee who is not the Owner also only proposes", () => {
  resetPolicyWorld();
  const paige = policyContextFor(NORTHLINE_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  // She genuinely holds the permission — this is not a refusal for want of one.
  assert.equal(paige.permissions.has("customers:private:manage"), true);

  const outcome = proposeBrokerPolicySync(paige, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "service_dispute",
    explanation: "They left unit 118 on a dock for eleven hours and refused detention.",
  });

  assert.equal(outcome.policy.status, "proposed");
  assert.equal(outcome.policy.approverMembershipId, NORTHLINE_OWNER);
});

/* ========================================================================== */
/* 3. The proposal reaches the correct Carrier Owner in Needs You             */
/* ========================================================================== */

test("3 · a carrier proposal routes to THAT carrier's Owner, not the proposer's", async () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(dispatcher, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "suspected_fraud",
    explanation: "The dispatch email domain does not match the MC on file.",
  });

  // ★ THE ROUTING RULE ★ It is Baxter's decision, so it waits on Baxter.
  assert.equal(policy.organizationId, BAXTER);
  assert.equal(policy.approverMembershipId, BAXTER_OWNER);
  assert.equal(policy.approverOrganizationId, BAXTER);

  // It reaches Baxter's Owner in the EXISTING Needs You queue.
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const items = await services.needsYou.list(baxterOwner, {});
  const item = items.find((i) => i.entity.id === policy.policyId);
  assert.ok(item, "Baxter's Owner has the decision in Needs You");
  assert.equal(item.category, "broker_policy_approval");
  assert.equal(item.organizationId, BAXTER);
  assert.equal(item.assigneeMembershipId, BAXTER_OWNER);
  assert.equal(item.entity.kind, "broker_policy");

  // It does NOT land in the proposer's own workspace. Meridian's Owner has no
  // say over what Baxter hauls, and a queue that said otherwise would be
  // routing on who happened to be signed in.
  const meridianOwner = policyContextFor(MERIDIAN_OWNER);
  const meridianItems = await services.needsYou.list(meridianOwner, {});
  assert.equal(
    meridianItems.some((i) => i.entity.id === policy.policyId), false,
    "a carrier's decision is not raised in the dispatch company's queue",
  );

  // And the owner's one press decides it, through the queue's own seam.
  const decided = await services.needsYou.decide(baxterOwner, item.id, { optionId: "approve" });
  assert.equal(decided.status, "resolved");
  assert.equal(brokerPoliciesForTests(BAXTER)[0].status, "active");
  assert.equal(brokerPoliciesForTests(BAXTER)[0].approvedBy?.membershipId, BAXTER_OWNER);
});

/* ========================================================================== */
/* 4. A dispatch employee's organization policy routes to the Dispatch Owner  */
/* ========================================================================== */

test("4 · a dispatch employee's organization policy waits on the Dispatch Company Owner", async () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(dispatcher, {
    scope: "dispatch_organization",
    brokerPartyId: apex.partyId,
    action: "deprioritize",
    reason: "service_dispute",
    explanation: "Their after-hours desk never answers and we lose the load.",
  });

  assert.equal(policy.status, "proposed");
  assert.equal(policy.organizationId, MERIDIAN);
  assert.equal(policy.approverMembershipId, MERIDIAN_OWNER, "Nadia, not the dispatcher");

  const nadia = policyContextFor(MERIDIAN_OWNER);
  const items = await services.needsYou.list(nadia, {});
  const item = items.find((i) => i.entity.id === policy.policyId);
  assert.ok(item, "Meridian's Owner has it");
  assert.equal(item.assigneeMembershipId, MERIDIAN_OWNER);

  // Baxter, whose trucks Meridian dispatches, is not asked about Meridian's
  // internal preference and never sees it.
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const baxterItems = await services.needsYou.list(baxterOwner, {});
  assert.equal(baxterItems.some((i) => i.entity.id === policy.policyId), false);
});

test("4b · a Dispatch Company Owner creates their own organization policy directly", () => {
  resetPolicyWorld();
  const nadia = policyContextFor(MERIDIAN_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const outcome = proposeBrokerPolicySync(nadia, {
    scope: "dispatch_organization",
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "carrier_preference",
    explanation: "We stopped working them in August.",
  });
  assert.equal(outcome.createdDirectly, true);
  assert.equal(outcome.policy.status, "active");
  assert.equal(outcome.policy.organizationId, MERIDIAN);
});

/* ========================================================================== */
/* 5. A dispatch-organization policy is not misrepresented as a carrier's     */
/* ========================================================================== */

test("5 · a dispatch organization's policy is labelled as its own, never the carrier's", () => {
  resetPolicyWorld();
  const nadia = policyContextFor(MERIDIAN_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  proposeBrokerPolicySync(nadia, {
    scope: "dispatch_organization",
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "carrier_preference",
    explanation: "We stopped working them in August.",
  });

  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const evaluation = evaluateBrokerPolicyFor(dispatcher, APEX(), {
    carrierOrganizationId: BAXTER,
  });

  assert.equal(evaluation.effect, "blocked");
  assert.equal(evaluation.notices.length, 1);
  const notice = evaluation.notices[0];
  assert.equal(notice.scope, "dispatch_organization");
  assert.equal(notice.owningOrganizationId, MERIDIAN);
  assert.equal(notice.owningOrganizationName, "Meridian Dispatch");
  assert.notEqual(notice.owningOrganizationId, BAXTER, "it is not Baxter's policy");

  // Baxter itself holds no policy at all — the carrier has taken no decision.
  assert.equal(brokerPoliciesForTests(BAXTER).length, 0);

  // And the carrier, working its own truck, is not governed by it.
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const asCarrier = evaluateBrokerPolicyFor(baxterOwner, APEX(), {
    carrierOrganizationId: BAXTER,
  });
  assert.equal(
    asCarrier.effect, "none",
    "a dispatch company's preference is not the carrier's decision",
  );
});

/* ========================================================================== */
/* 6. Carrier A's block does not affect Carrier B                             */
/* ========================================================================== */

test("6 · Northline's block is Northline's alone — Baxter is untouched", () => {
  resetPolicyWorld();
  const northlineOwner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  proposeBrokerPolicySync(northlineOwner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: "Two short-paid invoices and no answer since June.",
  });

  assert.equal(
    evaluateBrokerPolicyFor(northlineOwner, APEX(), { carrierOrganizationId: NORTHLINE }).effect,
    "blocked",
  );

  const baxterOwner = policyContextFor(BAXTER_OWNER);
  assert.equal(
    evaluateBrokerPolicyFor(baxterOwner, APEX(), { carrierOrganizationId: BAXTER }).effect,
    "none",
    "one carrier's experience is not evidence about another carrier's",
  );

  // Nor can Baxter read it, or even learn that it exists.
  const baxterView = brokerPoliciesFor(baxterOwner, {});
  assert.equal(baxterView.length, 0);

  // ★ THERE IS NO GLOBAL LIST TO LAND ON ★
  // The broker's own canonical profile is untouched by any of it.
  const party = brokerPartyByMc(APEX_MC);
  assert.equal(party.status, "active");
  assert.equal(party.reviewReason, undefined);
});

/* ========================================================================== */
/* 7. A dispatch organization cannot override a carrier hard block            */
/* ========================================================================== */

test("7 · a dispatch organization cannot except a carrier's hard block", () => {
  resetPolicyWorld();
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(baxterOwner, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "contract_restriction",
    explanation: "Our shipper agreement forbids re-brokered freight from them.",
  });

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

  // Meridian's OWNER — the most senior person in the dispatch company — cannot.
  const nadia = policyContextFor(MERIDIAN_OWNER);
  assert.throws(
    () => grantBrokerPolicyExceptionSync(nadia, {
      policyId: policy.policyId,
      reason: "The customer is waiting and we will take the risk.",
      expiresAt: tomorrow,
      carrierOrganizationId: BAXTER,
    }),
    (error: unknown) => error instanceof BrokerPolicyError && error.code === "not_authorized",
  );

  // Nor can a dispatcher working under Baxter's own grant.
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  assert.throws(
    () => grantBrokerPolicyExceptionSync(dispatcher, {
      policyId: policy.policyId,
      reason: "We will take the risk.",
      expiresAt: tomorrow,
    }),
    (error: unknown) => error instanceof BrokerPolicyError && error.code === "not_authorized",
  );

  // Nothing was written, and the block still blocks the dispatcher.
  assert.equal(brokerPoliciesForTests(BAXTER)[0].exceptions.length, 0);
  assert.equal(
    evaluateBrokerPolicyFor(dispatcher, APEX(), { carrierOrganizationId: BAXTER }).effect,
    "blocked",
  );

  // Neither can a dispatch organization approve a carrier's proposal.
  assert.throws(
    () => approveBrokerPolicySync(nadia, policy.policyId),
    (error: unknown) => error instanceof BrokerPolicyError,
  );
});

test("7b · a carrier owner may free their own carrier from a dispatch policy, and that is a conflict, not an order", () => {
  resetPolicyWorld();
  const nadia = policyContextFor(MERIDIAN_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(nadia, {
    scope: "dispatch_organization",
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "carrier_preference",
    explanation: "We stopped working them in August.",
  });

  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const outcome = grantBrokerPolicyExceptionSync(baxterOwner, {
    policyId: policy.policyId,
    reason: "This is a shipper we cannot refuse.",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    carrierOrganizationId: BAXTER,
  });

  assert.equal(outcome.status, "conflict");
  assert.equal(outcome.exception.carrierOverrideOfDispatchPolicy, true);
  assert.match(outcome.detail, /cannot be made to take work it refuses/);

  // Meridian is still refusing. The carrier decided for the carrier, and the
  // dispatch company's own decision stands for the dispatch company.
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  assert.equal(
    evaluateBrokerPolicyFor(dispatcher, APEX(), { carrierOrganizationId: BAXTER }).effect,
    "blocked",
  );
});

/* ========================================================================== */
/* 8. Proposed, rejected, expired and revoked policies do not filter loads     */
/* ========================================================================== */

test("8 · only an active policy filters anything", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const paige = policyContextFor(NORTHLINE_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);
  const blocked = () =>
    evaluateBrokerPolicyFor(owner, APEX(), { carrierOrganizationId: NORTHLINE }).effect;

  const write = (explanation: string) => proposeBrokerPolicySync(paige, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation,
  }).policy;

  /* ---- proposed ---- */
  const proposed = write("Waiting on the owner.");
  assert.equal(proposed.status, "proposed");
  assert.equal(blocked(), "none", "proposed filters nothing");

  /* ---- rejected ---- */
  rejectBrokerPolicySync(owner, proposed.policyId, "We are staying with them.");
  assert.equal(proposed.status, "rejected");
  assert.equal(blocked(), "none", "rejected filters nothing");

  /* ---- expired ---- */
  const expiring = write("Short-dated while we chase the invoice.");
  approveBrokerPolicySync(owner, expiring.policyId, {
    expiresAt: new Date(Date.now() + 40).toISOString(),
  });
  assert.equal(blocked(), "blocked", "it blocks while it is in force");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(effectiveStatus(expiring, new Date().toISOString()), "expired");
  assert.equal(blocked(), "none", "expired filters nothing");

  /* ---- revoked ---- */
  const revocable = write("Second thoughts pending.");
  approveBrokerPolicySync(owner, revocable.policyId);
  assert.equal(blocked(), "blocked");
  await revokeBrokerPolicy(owner, revocable.policyId, "They settled in full.");
  assert.equal(revocable.status, "revoked");
  assert.equal(blocked(), "none", "revoked filters nothing");

  // Every one of them is still on the record. Nothing was deleted to make the
  // filtering stop; the filtering stopped because the status says so.
  assert.equal(brokerPoliciesForTests(NORTHLINE).length, 3);
  for (const policy of brokerPoliciesForTests(NORTHLINE)) {
    assert.ok(policy.history.length >= 2, "its history survived the decision");
  }
});

/* ========================================================================== */
/* 12. A temporary safety hold                                                */
/* ========================================================================== */

test("12 · a temporary hold blocks at once, must expire, and never becomes permanent unapproved", async () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  const outcome = proposeBrokerPolicySync(dispatcher, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "temporary_safety_hold",
    reason: "identity_conflict",
    explanation: "The rate con's MC and the dispatch domain disagree. Stop until somebody checks.",
    // A caller may always ask for LESS than the ceiling, which is what makes
    // the lapse observable here without waiting out a real hold.
    expiresAt: new Date(Date.now() + 40).toISOString(),
  });
  const hold = outcome.policy;

  /* ---- Immediate ---- */
  assert.equal(hold.status, "active");
  assert.equal(outcome.createdDirectly, false, "a dispatcher did not approve anything");
  assert.equal(hold.approvedBy, undefined);
  assert.equal(
    evaluateBrokerPolicyFor(dispatcher, APEX(), { carrierOrganizationId: BAXTER }).effect,
    "blocked",
    "a hold blocks from the moment it is placed",
  );

  /* ---- Mandatory expiry ---- */
  assert.ok(hold.expiresAt, "a hold without an expiry is a permanent block");
  assert.ok(Date.parse(hold.expiresAt) > Date.now());

  /* ---- Urgent, and routed to the right owner ---- */
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const items = brokerPolicyNeedsYouItems(baxterOwner);
  const item = items.find((i) => i.entity.id === hold.policyId);
  assert.ok(item);
  assert.equal(item.severity, "critical");
  assert.equal(item.assigneeMembershipId, BAXTER_OWNER);
  assert.equal(item.dueAt, hold.expiresAt, "the hold's own expiry is the deadline");

  /* ---- It lapses on its own ---- */
  await new Promise((r) => setTimeout(r, 60));
  const reread = brokerPoliciesFor(baxterOwner, {}).find((r) => r.policy.policyId === hold.policyId);
  assert.ok(reread);
  assert.equal(reread.currentStatus, "expired");
  assert.equal(
    evaluateBrokerPolicyFor(dispatcher, APEX(), { carrierOrganizationId: BAXTER }).effect,
    "none",
    "it lifted itself rather than quietly becoming permanent",
  );
  // The history is kept. The hold happened, and the record says who placed it.
  assert.ok(hold.history.some((e) => e.kind === "hold_placed"));
  assert.ok(hold.history.some((e) => e.kind === "expired"));
  assert.equal(
    brokerPolicyNeedsYouItems(baxterOwner).some((i) => i.entity.id === hold.policyId),
    false,
    "and the queue row goes with it, without anybody tidying up",
  );
});

test("12b · approval converts a hold into an explicit policy, on the same record", () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(dispatcher, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "temporary_safety_hold",
    reason: "suspected_fraud",
    explanation: "Somebody else's MC on their paperwork.",
  });

  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const decided = approveBrokerPolicySync(baxterOwner, policy.policyId, {
    action: "hard_block",
  });

  assert.equal(decided.status, "ok");
  assert.equal(policy.action, "hard_block", "it is now an explicit policy");
  assert.equal(policy.status, "active");
  assert.equal(policy.expiresAt, undefined, "the owner chose that it does not expire");
  assert.equal(policy.approvedBy?.membershipId, BAXTER_OWNER);
  // ONE record throughout. The hold's own history travelled with the decision
  // rather than being replaced by a tidier one.
  assert.equal(brokerPoliciesForTests(BAXTER).length, 1);
  assert.deepEqual(
    policy.history.map((e) => e.kind),
    ["hold_placed", "converted"],
  );
});

test("12c · a hold cannot be configured to outlast the product's own ceiling", () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(dispatcher, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "temporary_safety_hold",
    reason: "suspected_fraud",
    explanation: "Stop now.",
    holdHours: 24 * 365,
    // A caller trying to smuggle a permanent block in as a hold.
    expiresAt: new Date(Date.now() + 10 * 365 * 86_400_000).toISOString(),
  });

  const hours = (Date.parse(policy.expiresAt!) - Date.now()) / 3_600_000;
  assert.ok(hours <= 168, `a hold may not run for ${Math.round(hours)}h`);
});

/* ========================================================================== */
/* 16. Factoring rejection does not create a global broker blacklist          */
/* ========================================================================== */

test("16 · a factoring rejection is evidence, not a blacklist entry", async () => {
  resetPolicyWorld();
  const northlineOwner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const outcome = await recordFactoringRejection(northlineOwner, {
    brokerPartyId: apex.partyId,
    carrierOrganizationId: NORTHLINE,
    factoringResultId: "fct_88213",
    label: "Compass Funding declined — 2026-09-18",
    observedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    explanation: "Our factor will not buy their paper this month.",
  });

  // It is a WARNING, carrier-scoped, and it does not block anything.
  assert.equal(outcome.policy.scope, "carrier");
  assert.equal(outcome.policy.organizationId, NORTHLINE);
  assert.equal(outcome.policy.action, "warning");
  assert.equal(outcome.policy.reason, "factoring_rejected");
  assert.equal(
    evaluateBrokerPolicyFor(northlineOwner, APEX(), { carrierOrganizationId: NORTHLINE }).effect,
    "warning",
    "a factor's answer about money does not stop the freight on its own",
  );

  // It carries the DATE it was true. A factoring answer is time-sensitive and
  // a stale decline must be visibly stale rather than quietly permanent.
  assert.equal(outcome.policy.evidence.length, 1);
  assert.equal(outcome.policy.evidence[0].kind, "factoring_result");
  assert.ok(outcome.policy.evidence[0].observedAt);

  // ★ AND IT REACHES NOBODY ELSE ★
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  assert.equal(
    evaluateBrokerPolicyFor(baxterOwner, APEX(), { carrierOrganizationId: BAXTER }).effect,
    "none",
    "Northline's factor said nothing about Baxter",
  );
  assert.equal(brokerPoliciesForTests(BAXTER).length, 0);
  assert.equal(brokerPoliciesForTests(MERIDIAN).length, 0);

  // The canonical broker profile gained nothing at all — no flag, no standing,
  // no review reason. There is no global list for it to appear on.
  const party = brokerPartyByMc(APEX_MC);
  assert.equal(party.status, "active");
  assert.equal(JSON.stringify(party).includes("factoring"), false);
});

/* ========================================================================== */
/* 17. Private policy reasons never appear on the public broker profile       */
/* ========================================================================== */

test("17 · the private explanation never reaches the broker's profile or another organization", async () => {
  resetPolicyWorld();
  const northlineOwner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);
  const SECRET = "We believe their dispatch desk is running a double-brokering scam.";

  proposeBrokerPolicySync(northlineOwner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "suspected_fraud",
    explanation: SECRET,
  });

  /* ---- Not on the canonical profile any carrier can read ---- */
  const profile = await getPartyProfile(
    {
      organizationId: NORTHLINE,
      membershipId: northlineOwner.membershipId,
      actorName: "Test",
      userId: "usr_test",
      permissions: northlineOwner.permissions,
    },
    apex.partyId,
  );
  assert.equal(
    JSON.stringify(profile.party).includes(SECRET), false,
    "the shared record of who this company is carries no accusation",
  );
  assert.equal(JSON.stringify(profile.history).includes(SECRET), false);

  /* ---- Not in the directory listing ---- */
  const listings = await listDirectory({
    organizationId: NORTHLINE,
    membershipId: northlineOwner.membershipId,
    actorName: "Test",
    userId: "usr_test",
    permissions: northlineOwner.permissions,
  }, {});
  assert.equal(JSON.stringify(listings).includes(SECRET), false);

  /* ---- Not readable by another organization at all ---- */
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  assert.equal(brokerPoliciesFor(baxterOwner, {}).length, 0);
  const baxterEvaluation = evaluateBrokerPolicyFor(baxterOwner, APEX(), {
    carrierOrganizationId: BAXTER,
  });
  assert.equal(JSON.stringify(baxterEvaluation).includes(SECRET), false);

  /* ---- Not in the audit ledger of any other organization ---- */
  const baxterAudit = await services.audit.list(baxterOwner, { limit: 500 });
  assert.equal(JSON.stringify(baxterAudit.items).includes(SECRET), false);

  /* ---- Its owner CAN read it. Private is not the same as hidden. ---- */
  const own = brokerPoliciesFor(northlineOwner, {});
  assert.equal(own.length, 1);
  assert.equal(own[0].mayReadExplanation, true);
  assert.equal(own[0].policy.explanation, SECRET);
});

test("17b · a delegated dispatcher is told why, and an unrelated workspace is told nothing", () => {
  resetPolicyWorld();
  const baxterOwner = policyContextFor(BAXTER_OWNER);
  const apex = brokerPartyByMc(APEX_MC);
  const SECRET = "They disputed three invoices in a row.";

  proposeBrokerPolicySync(baxterOwner, {
    scope: "carrier",
    carrierOrganizationId: BAXTER,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: SECRET,
  });

  // Meridian dispatches Baxter's trucks, so it is the party being told not to
  // book. "Blocked, and you may not know why" is an instruction nobody can act
  // on, so its dispatcher is entitled to the sentence.
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const delegated = evaluateBrokerPolicyFor(dispatcher, APEX(), {
    carrierOrganizationId: BAXTER,
  });
  assert.equal(delegated.notices[0].explanation, SECRET);

  // Northline works for nobody here and is told nothing — not the sentence,
  // not the policy, not that one exists.
  const northlineOwner = policyContextFor(NORTHLINE_OWNER);
  const unrelated = evaluateBrokerPolicyFor(northlineOwner, APEX(), {
    carrierOrganizationId: NORTHLINE,
  });
  assert.equal(unrelated.effect, "none");
  assert.equal(brokerPoliciesFor(northlineOwner, {}).length, 0);
});

/* ========================================================================== */
/* 18. Concurrent approvals produce one final state and one audit event       */
/* ========================================================================== */

test("18 · two approvals of the same policy leave one state and one audit event", async () => {
  resetPolicyWorld();
  const paige = policyContextFor(NORTHLINE_DISPATCHER);
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(paige, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: "Two short-paid invoices.",
  });

  const first = approveBrokerPolicySync(owner, policy.policyId);
  const second = approveBrokerPolicySync(owner, policy.policyId);

  assert.equal(first.status, "ok");
  assert.equal(second.status, "already_decided", "the second press decided nothing");
  assert.equal(policy.status, "active");

  // ONE approval entry on the policy's own history.
  const approvals = policy.history.filter((e) => e.kind === "approved");
  assert.equal(approvals.length, 1);

  // ONE row in the ledger. Projection is keyed on the history entry's own id,
  // so re-reading the feed any number of times appends exactly once.
  const read = async () => {
    const page = await services.audit.list(owner, { limit: 500 });
    return page.items.filter((e) => e.sourceAction === "broker_policy.approved");
  };
  assert.equal((await read()).length, 1);
  assert.equal((await read()).length, 1, "reading the ledger twice does not duplicate it");

  // Approving is also refused for somebody who is not an approver at all, and
  // refusing writes nothing.
  assert.throws(
    () => approveBrokerPolicySync(paige, policy.policyId),
    (error: unknown) => error instanceof BrokerPolicyError,
  );
  assert.equal(policy.history.filter((e) => e.kind === "approved").length, 1);
});

/* ========================================================================== */
/* Routing with no eligible approver                                          */
/* ========================================================================== */

test("· with no eligible approver, the item is escalated and nothing is auto-approved", () => {
  resetPolicyWorld();
  const paige = policyContextFor(NORTHLINE_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  // Northline's Owner steps away entirely.
  setMembershipStatus(NORTHLINE_OWNER, "left");

  const outcome = proposeBrokerPolicySync(paige, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "other",
    explanation: "Nobody is left to ask.",
  });

  assert.equal(outcome.policy.status, "proposed", "it was not approved by default");
  assert.equal(outcome.escalated, true);
  assert.ok(outcome.policy.history.some((e) => e.kind === "escalated"));

  const items = brokerPolicyNeedsYouItems(paige);
  const item = items.find((i) => i.entity.id === outcome.policy.policyId);
  assert.ok(item, "it is still raised, visibly, rather than disappearing");
  assert.equal(item.status, "escalated");
});

/* ========================================================================== */
/* A policy is never written against a name                                   */
/* ========================================================================== */

test("· a posting with no MC number resolves to no broker, so no policy is applied", () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "suspected_fraud",
    explanation: "Stop.",
  });

  // The same NAME, with no MC number on the posting.
  const evaluation = evaluateBrokerPolicyFor(
    owner,
    { broker: { name: "Apex Logistics" } },
    { carrierOrganizationId: NORTHLINE },
  );
  assert.equal(evaluation.unresolvedBroker, true);
  assert.equal(
    evaluation.effect, "none",
    "a fraud suspicion is never applied on a matching string",
  );

  // And a genuinely different broker is untouched.
  const other = evaluateBrokerPolicyFor(
    owner,
    listingFor(TANDEM_MC, "Tandem Freight Partners"),
    { carrierOrganizationId: NORTHLINE },
  );
  assert.equal(other.effect, "none");
});

/* ========================================================================== */
/* Booking exceptions, scoped and audited (13)                                */
/* ========================================================================== */

test("13 · an owner's exception is scoped, expires, and writes exactly one audit event", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: "Two short-paid invoices.",
  });

  const expiresAt = new Date(Date.now() + 4 * 3_600_000).toISOString();
  const outcome = grantBrokerPolicyExceptionSync(owner, {
    policyId: policy.policyId,
    reason: "They paid the arrears this morning and this is a customer load.",
    expiresAt,
    negotiationId: "neg_test_1",
    listingId: "lst_test_1",
  });

  assert.equal(outcome.status, "ok");
  const exception = outcome.exception;

  /* ---- Scoped to ONE booking ---- */
  assert.equal(exception.negotiationId, "neg_test_1");
  assert.equal(exception.forOrganizationId, NORTHLINE);
  assert.equal(exception.expiresAt, expiresAt);

  const excused = verdictForBooking(owner, APEX(), {
    carrierOrganizationId: NORTHLINE,
    negotiationId: "neg_test_1",
    listingId: "lst_test_1",
  });
  assert.equal(excused.outcome, "allow", "the one booking it names goes through");

  const other = verdictForBooking(owner, APEX(), {
    carrierOrganizationId: NORTHLINE,
    negotiationId: "neg_test_2",
    listingId: "lst_test_2",
  });
  assert.equal(other.outcome, "blocked", "and no other booking does");

  /*
   * ★ NOT EVEN ANOTHER TRUCK ON THE SAME LISTING ★
   * Two trucks can be in conversation about one posting. An exception granted
   * for one of those conversations names that conversation, and a match on the
   * listing alone would quietly hand it to the other one — which is a standing
   * exception nobody granted.
   */
  const sameListing = verdictForBooking(owner, APEX(), {
    carrierOrganizationId: NORTHLINE,
    negotiationId: "neg_test_9",
    listingId: "lst_test_1",
  });
  assert.equal(
    sameListing.outcome, "blocked",
    "an exception naming one negotiation does not cover another on the same load",
  );

  // Search, which has no load to except, is unaffected either way.
  assert.equal(
    evaluateBrokerPolicyFor(owner, APEX(), { carrierOrganizationId: NORTHLINE }).effect,
    "blocked",
    "an exception lets one booking through; it does not put the load back on the board",
  );

  /* ---- There is no such thing as an exception with no end ---- */
  assert.throws(
    () => grantBrokerPolicyExceptionSync(owner, {
      policyId: policy.policyId,
      reason: "Forever, please.",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }),
    (error: unknown) => error instanceof BrokerPolicyError
      && error.code === "exception_needs_expiry",
  );
  assert.throws(
    () => grantBrokerPolicyExceptionSync(owner, {
      policyId: policy.policyId,
      reason: "   ",
      expiresAt,
    }),
    (error: unknown) => error instanceof BrokerPolicyError,
  );

  /* ---- Exactly one immutable audit event ---- */
  const page = await services.audit.list(owner, { limit: 500 });
  const rows = page.items.filter((e) => e.sourceAction === "broker_policy.exception_granted");
  assert.equal(rows.length, 1);
  assert.equal(Object.isFrozen(rows[0]), true);
  assert.equal(rows[0].entity.id, apex.partyId);

  const again = await services.audit.list(owner, { limit: 500 });
  assert.equal(
    again.items.filter((e) => e.sourceAction === "broker_policy.exception_granted").length, 1,
  );
});

/* ========================================================================== */
/* Settings configure the authority, and actually do something                */
/* ========================================================================== */

test("· Organization Settings holds the authority, and every setting changes behaviour", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const paige = policyContextFor(NORTHLINE_DISPATCHER);
  const apex = brokerPartyByMc(APEX_MC);

  /* ---- Who may approve: additive, and the Owner can never be removed ---- */
  const before = policyAuthorityFor(paige, {
    scope: "carrier", carrierOrganizationId: NORTHLINE,
  });
  assert.equal(before.mayApprove, false, "a dispatcher may only propose");

  await updateBrokerPolicyDefaults(owner, {
    additionalApproverMembershipIds: [NORTHLINE_DISPATCHER],
  });
  const after = policyAuthorityFor(paige, {
    scope: "carrier", carrierOrganizationId: NORTHLINE,
  });
  assert.equal(after.mayApprove, true, "the Owner named her");
  assert.equal(
    proposeBrokerPolicySync(paige, {
      scope: "carrier",
      carrierOrganizationId: NORTHLINE,
      brokerPartyId: apex.partyId,
      action: "warning",
      reason: "carrier_preference",
      explanation: "Take them last.",
    }).createdDirectly,
    true,
    "and she now writes directly",
  );

  // The Owner is an approver by definition and is never stored in the list, so
  // there is no way to configure them out of their own final authority.
  const withOwnerListed = await updateBrokerPolicyDefaults(owner, {
    additionalApproverMembershipIds: [NORTHLINE_OWNER, NORTHLINE_DISPATCHER],
  });
  assert.deepEqual(
    withOwnerListed.additionalApproverMembershipIds, [NORTHLINE_DISPATCHER],
    "listing the Owner is a no-op, not a way to manage them",
  );

  /* ---- A hold's ceiling is the product's, not the workspace's ---- */
  const stretched = await updateBrokerPolicyDefaults(owner, {
    temporaryHoldHours: 24 * 365,
  });
  assert.equal(stretched.temporaryHoldHours, MAX_TEMPORARY_HOLD_HOURS);

  /* ---- Exceptions can be turned off entirely ---- */
  await updateBrokerPolicyDefaults(owner, { allowOwnerBookingException: false });
  const { policy } = proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: "No.",
  });
  assert.throws(
    () => grantBrokerPolicyExceptionSync(owner, {
      policyId: policy.policyId,
      reason: "Just this once.",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    (error: unknown) => error instanceof BrokerPolicyError
      && error.code === "exception_not_allowed",
  );

  /* ---- Only the Owner may change any of it ---- */
  await assert.rejects(
    () => updateBrokerPolicyDefaults(paige, { temporaryHoldHours: 1 }),
    (error: unknown) => error instanceof BrokerPolicyError
      && error.code === "not_authorized",
  );
});

test("· the warning and unknown-broker settings change what booking is told, and never block", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "warning",
    reason: "payment_experience",
    explanation: "Ask for quick pay.",
  });

  const plain = verdictForBooking(owner, APEX(), { carrierOrganizationId: NORTHLINE });
  assert.equal(plain.outcome, "warn");
  assert.notEqual(plain.requiresAcknowledgement, true);

  await updateBrokerPolicyDefaults(owner, {
    warningBookingBehavior: "require_acknowledgement",
  });
  const strict = verdictForBooking(owner, APEX(), { carrierOrganizationId: NORTHLINE });
  assert.equal(strict.requiresAcknowledgement, true);
  assert.equal(
    strict.outcome, "warn",
    "asking somebody to read it is not the same as refusing them",
  );
  assert.deepEqual(strict.blockingPolicyIds, []);

  /* ---- An unresolved broker warns where asked, and never blocks ---- */
  //
  // The two settings are independent, and this is where that shows: asking for
  // an acknowledgement decorates a warning that already exists. It does not
  // manufacture one, so a broker nobody could resolve is still simply allowed
  // until somebody asks to be told about it.
  const nameless = { broker: { name: "Somebody Nobody Logged" } };
  assert.equal(
    verdictForBooking(owner, nameless, { carrierOrganizationId: NORTHLINE }).outcome,
    "allow",
  );

  await updateBrokerPolicyDefaults(owner, { warningBookingBehavior: "allow" });
  assert.equal(
    verdictForBooking(owner, nameless, { carrierOrganizationId: NORTHLINE }).outcome,
    "allow",
  );

  await updateBrokerPolicyDefaults(owner, { unknownBrokerBehavior: "warn" });
  const flagged = verdictForBooking(owner, nameless, {
    carrierOrganizationId: NORTHLINE,
  });
  assert.equal(flagged.outcome, "warn");
  assert.equal(flagged.evaluation.unresolvedBroker, true);
  assert.deepEqual(
    flagged.blockingPolicyIds, [],
    "a gap in what we know is never evidence about a company",
  );
});

/* ========================================================================== */
/* A factoring answer goes off                                                */
/* ========================================================================== */

test("· a stale factoring result is visibly stale rather than quietly permanent", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);
  const now = new Date().toISOString();

  const fresh = await recordFactoringRejection(owner, {
    brokerPartyId: apex.partyId,
    carrierOrganizationId: NORTHLINE,
    factoringResultId: "fct_fresh",
    label: "Compass Funding declined",
    observedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    explanation: "Declined this week.",
  });
  assert.equal(isStaleEvidence(fresh.policy.evidence[0], now), false);

  const old = await recordFactoringRejection(owner, {
    brokerPartyId: apex.partyId,
    carrierOrganizationId: NORTHLINE,
    factoringResultId: "fct_old",
    label: "Compass Funding declined",
    observedAt: new Date(
      Date.now() - (FACTORING_EVIDENCE_FRESH_DAYS + 30) * 86_400_000,
    ).toISOString(),
    explanation: "Declined last spring.",
  });
  assert.equal(
    isStaleEvidence(old.policy.evidence[0], now), true,
    "a factor's answer is about a receivable on a date, not about the broker",
  );

  // Nothing else about an invoice or a load goes off this way: only a factoring
  // result is time-sensitive in this sense, and treating a load as stale would
  // quietly discount evidence that is still perfectly good.
  assert.equal(
    isStaleEvidence(
      { kind: "load", observedAt: new Date(Date.now() - 400 * 86_400_000).toISOString() },
      now,
    ),
    false,
  );
});

/* ========================================================================== */
/* Evidence is a reference, and never a decision                              */
/* ========================================================================== */

test("· attaching evidence needs the permission and changes nothing about what a policy does", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const apex = brokerPartyByMc(APEX_MC);

  const { policy } = proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: apex.partyId,
    action: "warning",
    reason: "payment_experience",
    explanation: "Slow, but they pay.",
  });
  const before = evaluateBrokerPolicyFor(owner, APEX(), {
    carrierOrganizationId: NORTHLINE,
  }).effect;

  await attachBrokerPolicyEvidence(owner, policy.policyId, {
    kind: "invoice",
    id: "inv_4471",
    label: "Invoice 4471 · 52 days",
    observedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  });

  assert.equal(policy.evidence.length, 1);
  assert.equal(policy.evidence[0].attachedBy.membershipId, NORTHLINE_OWNER);
  assert.ok(policy.history.some((e) => e.kind === "evidence_added"));

  /*
   * ★ EVIDENCE ARRIVING IS NOT A DECISION ★
   * A worse invoice landing does not turn a warning into a block. Escalating is
   * a judgement, and a judgement belongs to the owner — a rule that promoted
   * the action on its own would be the system deciding who a company works
   * with, which is the one thing this module exists to stop.
   */
  assert.equal(policy.action, "warning");
  assert.equal(
    evaluateBrokerPolicyFor(owner, APEX(), { carrierOrganizationId: NORTHLINE }).effect,
    before,
  );

  // And somebody without the private-customer permission cannot attach one.
  const stripped = withoutKeys(owner, "customers:private:manage");
  await assert.rejects(
    () => attachBrokerPolicyEvidence(stripped, policy.policyId, {
      kind: "invoice",
      id: "inv_9999",
      label: "Another invoice",
      observedAt: new Date().toISOString(),
    }),
  );
});

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  addClaimNote, advanceClaimStatus, attachClaimEvidence, CLAIM_IDS,
  getClaimSync, InsuranceNotFoundError, listClaimsSync, POLICY_IDS,
  recordClaim, recordClaimCost, resetInsuranceRegistry, reverseClaimCost,
} from "@/lib/api/mock/insurance-registry";
import {
  canTransition, CLAIM_TRANSITIONS, claimFinancials, isOpenClaim,
} from "@/lib/insurance/claim-states";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { allExcept, BAXTER, insuranceCaller, NORTHLINE } from "./helpers";

const northline = () => insuranceCaller(NORTHLINE);
const isoDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeEach(() => resetInsuranceRegistry());

/* ---- The state machine --------------------------------------------------- */

test("every claim status has a defined set of next steps", () => {
  const statuses = Object.keys(CLAIM_TRANSITIONS) as Array<keyof typeof CLAIM_TRANSITIONS>;
  assert.equal(statuses.length, 8);
  for (const from of statuses) {
    for (const to of CLAIM_TRANSITIONS[from]) {
      assert.ok(statuses.includes(to), `${from} -> ${to} is a real status`);
    }
  }
});

test("closed is terminal", () => {
  assert.deepEqual(CLAIM_TRANSITIONS.closed, []);
  assert.equal(canTransition("closed", "under_review"), false);
});

test("a claim cannot jump straight from reported to paid", () => {
  assert.equal(canTransition("reported", "paid"), false);
  assert.equal(canTransition("approved", "paid"), true);
});

test("open statuses are the ones that still need somebody", () => {
  assert.equal(isOpenClaim("investigating"), true);
  assert.equal(isOpenClaim("paid"), false);
  assert.equal(isOpenClaim("closed"), false);
  assert.equal(isOpenClaim("denied"), false);
});

/* ---- Recording ----------------------------------------------------------- */

test("a new claim freezes what coverage said at the time of the event", async () => {
  const claim = await recordClaim(northline(), {
    claimType: "accident", severity: "moderate",
    title: "Mirror clipped in a yard",
    description: "Low-speed contact with a post.",
    eventAt: isoDays(-2),
    subjectKind: "truck", subjectId: TRUCK_IDS.nl104, subjectLabel: "Unit 104",
    coverageType: "auto_liability",
  });

  assert.equal(claim.status, "reported");
  assert.equal(claim.attribution.outcome, "covered");
  assert.equal(claim.attribution.policyId, POLICY_IDS.nlPrimaryV2);
  assert.equal(claim.attribution.eventAt, isoDays(-2).slice(0, 10) + claim.attribution.eventAt.slice(10));
  assert.ok(claim.attribution.deductible, "the deductible is snapshotted onto the claim");
});

test("an uncovered loss is recorded truthfully rather than refused", async () => {
  const claim = await recordClaim(northline(), {
    claimType: "property_damage", severity: "minor",
    title: "Fence panel clipped",
    description: "Reversing into a yard.",
    eventAt: isoDays(-1),
    subjectKind: "truck", subjectId: TRUCK_IDS.nl118, subjectLabel: "Unit 118",
    coverageType: "auto_liability",
  });

  assert.equal(claim.attribution.outcome, "not_scheduled");
  assert.equal(claim.attribution.policyId, undefined);
  assert.match(claim.attribution.reason, /Taken off policy/);
});

test("a new claim gets the evidence checklist its type calls for", async () => {
  const claim = await recordClaim(northline(), {
    claimType: "cargo_damage", severity: "minor",
    title: "Two cartons crushed", description: "Noted at delivery.",
    eventAt: isoDays(-1),
    subjectKind: "truck", subjectId: TRUCK_IDS.nl104, subjectLabel: "Unit 104",
    coverageType: "cargo",
  });
  assert.equal(claim.evidence.length, 3);
  assert.equal(claim.missingRequiredEvidence, 3);
});

test("a loss cannot be recorded for the future", async () => {
  await assert.rejects(
    () => recordClaim(northline(), {
      claimType: "accident", severity: "minor", title: "Later", description: "—",
      eventAt: isoDays(5),
      subjectKind: "truck", subjectId: TRUCK_IDS.nl104, subjectLabel: "Unit 104",
      coverageType: "auto_liability",
    }),
    /date in the future/,
  );
});

test("reporting a claim needs claims:create", async () => {
  await assert.rejects(
    () => recordClaim(insuranceCaller(NORTHLINE, allExcept("claims:create")), {
      claimType: "accident", severity: "minor", title: "X", description: "—",
      eventAt: isoDays(-1),
      subjectKind: "truck", subjectId: TRUCK_IDS.nl104, subjectLabel: "Unit 104",
      coverageType: "auto_liability",
    }),
    (e: Error) => e.name === "InsurancePermissionError",
  );
});

/* ---- Moving a claim along ------------------------------------------------ */

test("a refused transition says what is allowed instead", async () => {
  await assert.rejects(
    () => advanceClaimStatus(northline(), CLAIM_IDS.nlFreshCargo, "paid"),
    /can only move to/,
  );
});

test("an allowed transition is recorded in the append-only history", async () => {
  const ctx = northline();
  const before = getClaimSync(ctx, CLAIM_IDS.nlFreshCargo).history.length;
  const after = await advanceClaimStatus(ctx, CLAIM_IDS.nlFreshCargo, "under_review", "Looking at it.");

  assert.equal(after.status, "under_review");
  assert.equal(after.history.length, before + 1);
  const entry = after.history[0];
  assert.equal(entry.kind, "status_changed");
  assert.equal(entry.previousValue, "reported");
  assert.equal(entry.newValue, "under_review");
});

test("a closed claim cannot be moved again", async () => {
  await assert.rejects(
    () => advanceClaimStatus(northline(), CLAIM_IDS.nlHistoricCargo, "under_review"),
    /closed claim cannot be moved/,
  );
});

test("one carrier cannot move another carrier's claim", async () => {
  await assert.rejects(
    () => advanceClaimStatus(insuranceCaller(BAXTER), CLAIM_IDS.nlFreshCargo, "under_review"),
    InsuranceNotFoundError,
  );
});

/* ---- Evidence and notes -------------------------------------------------- */

test("attaching evidence clears it from the missing count", async () => {
  const ctx = northline();
  const before = getClaimSync(ctx, CLAIM_IDS.nlAccident);
  const missing = before.evidence.find((e) => e.status === "missing")!;

  const after = await attachClaimEvidence(ctx, missing.id, {
    fileName: "estimate.pdf", fileType: "application/pdf", sizeBytes: 90_000,
  });
  assert.equal(after.missingRequiredEvidence, before.missingRequiredEvidence - 1);
  // Honest about what actually happened to the file.
  const now = after.evidence.find((e) => e.id === missing.id)!;
  assert.equal(now.status, "selected_local");
  assert.equal(now.file?.fileName, "estimate.pdf");
});

test("notes are added, never replaced, and carry their visibility", async () => {
  const ctx = northline();
  const before = getClaimSync(ctx, CLAIM_IDS.nlAccident).notes.length;
  const after = await addClaimNote(ctx, CLAIM_IDS.nlAccident, {
    body: "Chased the adjuster.", visibility: "internal",
  });
  assert.equal(after.notes.length, before + 1);
  assert.equal(after.notes.at(-1)?.visibility, "internal");

  await assert.rejects(
    () => addClaimNote(ctx, CLAIM_IDS.nlAccident, { body: "   ", visibility: "internal" }),
    /empty note/,
  );
});

/* ---- Money --------------------------------------------------------------- */

test("cost lines add up, with the deductible capped at what the carrier bore", () => {
  const financials = claimFinancials(
    [
      {
        id: "a", claimId: "c", kind: "repair", amount: { amount: 500_000, currency: "USD" },
        incurredAt: "2026-01-01T00:00:00.000Z", bearer: "carrier", description: "Repair",
        recordedAt: "2026-01-01T00:00:00.000Z",
        recordedBy: { userId: "u", membershipId: "m", displayNameSnapshot: "U", source: "web" },
        paidAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "b", claimId: "c", kind: "reserve", amount: { amount: 2_000_000, currency: "USD" },
        incurredAt: "2026-01-01T00:00:00.000Z", bearer: "insurer", description: "Reserve",
        recordedAt: "2026-01-01T00:00:00.000Z",
        recordedBy: { userId: "u", membershipId: "m", displayNameSnapshot: "U", source: "web" },
      },
    ],
    { amount: 250_000, currency: "USD" },
  );

  assert.equal(financials.totalIncurred.amount, 500_000);
  assert.equal(financials.totalPaid.amount, 500_000);
  assert.equal(financials.outstandingReserve.amount, 1_500_000);
  assert.equal(financials.deductibleApplied.amount, 250_000, "capped at the deductible");
});

test("a wrong figure is reversed, not edited away", async () => {
  const ctx = northline();
  const withCost = await recordClaimCost(ctx, CLAIM_IDS.nlAccident, {
    kind: "repair", amountCents: 1_000_00, bearer: "carrier", description: "Typo",
  });
  const added = withCost.costs!.find((c) => c.description === "Typo")!;
  const incurred = withCost.financials!.totalIncurred.amount;

  const reversed = await reverseClaimCost(ctx, CLAIM_IDS.nlAccident, added.id, "Wrong figure.");
  assert.equal(reversed.financials!.totalIncurred.amount, incurred - 1_000_00);
  assert.ok(
    reversed.costs!.some((c) => c.id === added.id),
    "the original line is still on the record",
  );
  assert.ok(reversed.costs!.some((c) => c.reversesCostId === added.id));

  await assert.rejects(
    () => reverseClaimCost(ctx, CLAIM_IDS.nlAccident, added.id, "Again."),
    /already been reversed/,
  );
});

test("recording money needs the financial key as well as claims:manage", async () => {
  await assert.rejects(
    () => recordClaimCost(insuranceCaller(NORTHLINE, allExcept("claims:financials:view")),
      CLAIM_IDS.nlAccident,
      { kind: "repair", amountCents: 1000, bearer: "carrier", description: "X" }),
    (e: Error) => e.name === "InsurancePermissionError",
  );
});

/* ---- Isolation ----------------------------------------------------------- */

test("a carrier's claim list contains only its own claims and shared ones", () => {
  for (const row of listClaimsSync(northline())) {
    assert.equal(row.carrierName, "Northline Freight");
  }
  const baxter = listClaimsSync(insuranceCaller(BAXTER));
  assert.ok(baxter.every((r) => r.carrierName === "Baxter Transit LLC"));
});

test("a claim from another carrier cannot be opened by id", () => {
  assert.throws(
    () => getClaimSync(insuranceCaller(BAXTER), CLAIM_IDS.nlAccident),
    InsuranceNotFoundError,
  );
});

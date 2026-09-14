import assert from "node:assert/strict";
import test from "node:test";
import {
  INSURANCE_INTEGRATIONS, insuranceAdapters, IntegrationNotConnectedError,
} from "@/lib/insurance/extension-points";
import { COVERAGE_REQUIREMENTS, requiredCoverageTypes } from "@/lib/insurance/requirements";
import { COVERAGE_TYPE_DESCRIPTION, COVERAGE_TYPE_LABEL } from "@/lib/insurance/labels";
import { httpServices } from "@/lib/api/http";
import { POLICY_IDS } from "@/lib/api/mock/insurance-registry";

/**
 * Honesty, enforced.
 *
 * The point of these is that no future change can quietly make an unconnected
 * integration return a plausible-looking answer.
 */

test("every insurance adapter refuses rather than pretending", () => {
  // They throw synchronously and on purpose: a rejected promise is easy to
  // swallow, and a silent swallow is how a screen ends up claiming a policy
  // was verified.
  const calls: Array<() => unknown> = [
    () => insuranceAdapters.insurerDirectory.search("great plains"),
    () => insuranceAdapters.insurerDirectory.verifyPolicy({
      insurerName: "Great Plains Mutual", policyNumber: "X", asOf: new Date().toISOString(),
    }),
    () => insuranceAdapters.agentDirectory.search("pierce"),
    () => insuranceAdapters.payments.outstandingBalance(POLICY_IDS.nlPrimaryV2),
    () => insuranceAdapters.ocr.readDeclarations({ documentId: "doc_1" }),
    () => insuranceAdapters.telematics.incidentEvidence({
      truckId: "t", from: new Date().toISOString(), to: new Date().toISOString(),
    }),
    () => insuranceAdapters.externalReporting.isReportable({} as never),
    () => insuranceAdapters.claimsProcessing.submit({} as never),
  ];

  for (const call of calls) {
    assert.throws(call, IntegrationNotConnectedError);
  }
});

test("the error says which integration and which operation", () => {
  try {
    insuranceAdapters.claimsProcessing.poll({} as never);
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof IntegrationNotConnectedError);
    assert.equal(error.integration, "claims_processing");
    assert.equal(error.operation, "poll");
    assert.match(error.message, /never pretends otherwise/);
  }
});

test("every declared integration is listed as not connected, with what happens instead", () => {
  assert.ok(INSURANCE_INTEGRATIONS.length >= 7);
  for (const integration of INSURANCE_INTEGRATIONS) {
    assert.equal(integration.connected, false);
    assert.ok(integration.today.length > 0, `${integration.kind} says what Antcolos does today`);
    assert.ok(integration.description.length > 0);
  }
});

test("the adapter registry and the status list describe the same seams", () => {
  const listed = new Set(INSURANCE_INTEGRATIONS.map((i) => i.kind));
  assert.equal(listed.size, INSURANCE_INTEGRATIONS.length, "no duplicates");
  assert.equal(Object.keys(insuranceAdapters).length, listed.size);
});

test("the HTTP adapter is still deliberately unimplemented", () => {
  assert.throws(() => httpServices.loads.list({} as never), /not implemented/);
});

/* ---- Requirements --------------------------------------------------------- */

test("every coverage requirement explains itself in an operator's words", () => {
  for (const requirement of COVERAGE_REQUIREMENTS) {
    assert.ok(requirement.why.length > 0);
    assert.ok(COVERAGE_TYPE_LABEL[requirement.coverageType]);
  }
});

test("a power unit must carry liability and cargo", () => {
  const required = requiredCoverageTypes("truck");
  assert.ok(required.includes("auto_liability"));
  assert.ok(required.includes("cargo"));
  assert.ok(!required.includes("physical_damage"), "recommended, not required");
});

test("every coverage type has a label and a plain-language description", () => {
  for (const key of Object.keys(COVERAGE_TYPE_LABEL)) {
    assert.ok(COVERAGE_TYPE_DESCRIPTION[key as keyof typeof COVERAGE_TYPE_DESCRIPTION]);
  }
});

import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import {
  agreementContextFrom, confirmTerminationStepSync, contractsForOrganization,
  getSync, resetAgreementRegistry, signSync, waiveRequirementSync,
} from "./agreement-registry";
import { agreementNeedsYouItems, isAgreementNeedsYouId } from "./agreement-needs-you";
import { resetCarrierRegistry } from "./carrier-registry";
import { resetDriverRegistry } from "./driver-registry";

/**
 * Contract items in the Needs You queue.
 *
 * Every assertion here is about the same property: the item is DERIVED. It
 * appears because the contract is in a state, and it stops appearing when the
 * state changes — not when somebody ticks it off.
 */

const ctxFor = (organizationId: string, overrides?: Parameters<typeof contextFor>[1]) =>
  agreementContextFrom(contextFor(organizationId, overrides));

const owner = () => ctxFor("org_northline");

function contractByReference(organizationId: string, reference: string) {
  const found = contractsForOrganization(organizationId)
    .find((c) => c.reference === reference);
  if (!found) throw new Error(`No fixture contract ${reference} in ${organizationId}`);
  return found;
}

const categories = (ctx = owner()) =>
  agreementNeedsYouItems(ctx).map((i) => i.category);

beforeEach(() => {
  resetAgreementRegistry();
  resetCarrierRegistry();
  resetDriverRegistry();
});

describe("what the queue raises", () => {
  it("raises all four conditions the module promises", () => {
    const raised = new Set(categories());
    expect(raised).toContain("contract_signature_missing");
    expect(raised).toContain("contract_expiring");
    expect(raised).toContain("contract_requirement_unmet");
    expect(raised).toContain("contract_termination_unresolved");
  });

  it("marks every item derived, so nobody can snooze it away", () => {
    expect(agreementNeedsYouItems(owner()).every((i) => i.derived === true)).toBe(true);
  });

  it("gives every item a stable id that survives a recompute", () => {
    const first = agreementNeedsYouItems(owner()).map((i) => i.id);
    const second = agreementNeedsYouItems(owner()).map((i) => i.id);
    expect(second).toEqual(first);
    expect(first.every(isAgreementNeedsYouId)).toBe(true);
  });

  it("points every item at the contract, never at the relationship", () => {
    for (const item of agreementNeedsYouItems(owner())) {
      expect(item.entity.kind).toBe("contract");
      expect(item.entity.href).toMatch(/^\/contracts\//);
    }
  });
});

describe("missing signatures", () => {
  it("asks the party who can sign, and tells everybody else to chase", () => {
    const items = agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_signature_missing");
    // The carrier owner cannot sign the driver's line, so their item is a chase.
    expect(items.map((i) => i.recommendedAction.kind)).toContain("chase_signature");
    expect(items.some((i) => i.reason.includes("No party may sign for another")
      || i.reason.includes("no party may sign for another"))).toBe(true);
  });

  it("offers signing to the membership that actually holds the authority", () => {
    const driverCtx = { ...owner(), membershipId: "mem_nl_marisol" };
    const items = agreementNeedsYouItems(driverCtx)
      .filter((i) => i.category === "contract_signature_missing");
    const mine = items.filter((i) => i.recommendedAction.kind === "sign_contract");
    expect(mine).toHaveLength(1);
    expect(mine[0].recommendedAction.requires).toEqual(["contracts:sign"]);
    expect(mine[0].severity).toBe("high");
  });

  it("stops existing once the signature is given", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const before = getSync(owner(), contract.contractId);
    const driver = before.parties.find((p) => p.role === "driver")!;

    const beforeCount = agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_signature_missing").length;

    signSync({ ...owner(), membershipId: "mem_nl_marisol" }, {
      contractId: contract.contractId,
      contractVersionId: before.currentVersion.contractVersionId,
      partyId: driver.partyId,
      typedName: "Marisol Ortiz",
    });

    expect(agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_signature_missing").length)
      .toBe(beforeCount - 1);
  });

  it("says in the detail that a signature here is a mock", () => {
    const item = agreementNeedsYouItems(owner())
      .find((i) => i.category === "contract_signature_missing")!;
    expect(item.detail).toMatch(/nothing is verified, delivered or legally binding/i);
  });
});

describe("expiry", () => {
  it("raises the agreement inside its own reminder window, with its end date due", () => {
    const item = agreementNeedsYouItems(owner())
      .find((i) => i.category === "contract_expiring")!;
    expect(item.dueAt).toBeDefined();
    expect(item.recommendedAction.kind).toBe("renew_contract");
    expect(item.title).toMatch(/CDO-0003 ends in \d+ days?/);
  });

  it("raises the one that has run out, and says work is still happening under it", () => {
    const item = agreementNeedsYouItems(owner())
      .find((i) => i.category === "contract_expired")!;
    expect(item.severity).toBe("high");
    expect(item.reason).toMatch(/nothing has renewed or replaced it/);
  });

  it("never raises expiry for an open-ended agreement", () => {
    // CID-0001 in the solo workspace has an end date; the Baxter yard agreement
    // is open-ended and cancelled. Neither should produce a stray expiry item
    // from a missing date.
    const items = agreementNeedsYouItems(ctxFor("org_baxter"));
    expect(items.filter((i) => i.category === "contract_expiring")).toEqual([]);
    expect(items.filter((i) => i.category === "contract_expired")).toEqual([]);
  });
});

describe("unmet requirements", () => {
  it("raises a blocking one as high and a non-blocking one as low", () => {
    const items = agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_requirement_unmet");
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.severity === "high" || i.severity === "critical")).toBe(true);
  });

  it("says the agreement cannot go active while a blocking one is open", () => {
    const item = agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_requirement_unmet")
      .find((i) => i.severity === "high" || i.severity === "critical")!;
    expect(item.detail).toMatch(/cannot go active/);
  });

  it("points a document requirement at the Document Center, not at a second one", () => {
    const item = agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_requirement_unmet")
      .find((i) => i.recommendedAction.kind === "request_document")!;
    expect(item.recommendedAction.label).toMatch(/Document Center/);
    expect(item.relatedEntities?.[0].href).toBe("/documents");
  });

  it("stops existing once the requirement is waived", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const view = getSync(owner(), contract.contractId);
    const target = view.requirements.find(
      (r) => r.kind === "document" && r.status === "unmet",
    )!;

    const before = agreementNeedsYouItems(owner()).map((i) => i.id);
    waiveRequirementSync(
      owner(), contract.contractId, target.requirementId, "Coming next week.",
    );
    const after = agreementNeedsYouItems(owner()).map((i) => i.id);

    expect(before.length - after.length).toBe(1);
  });

  it("raises nothing for a cancelled agreement, which never took effect", () => {
    const items = agreementNeedsYouItems(ctxFor("org_baxter"));
    expect(items.filter((i) => i.category === "contract_requirement_unmet")).toEqual([]);
  });
});

describe("unresolved terminations", () => {
  it("raises the fixture termination whose closeout is unfinished", () => {
    const item = agreementNeedsYouItems(owner())
      .find((i) => i.category === "contract_termination_unresolved")!;
    expect(item.title).toMatch(/CD-0006 termination is not finished/);
    expect(item.recommendedAction.kind).toBe("complete_termination");
    expect(item.severity).toBe("high");
  });

  it("promises in the detail that nothing is deleted", () => {
    const item = agreementNeedsYouItems(owner())
      .find((i) => i.category === "contract_termination_unresolved")!;
    expect(item.detail).toMatch(/Nothing is deleted/);
    expect(item.detail).toMatch(/completed loads, invoices and settlements/);
  });

  it("stops existing once every closeout step is confirmed", () => {
    const contract = contractByReference("org_northline", "CD-0006");
    const view = getSync(owner(), contract.contractId);
    for (const step of view.termination!.steps.filter((s) => !s.confirmedAt)) {
      confirmTerminationStepSync(owner(), contract.contractId, step.key, "done");
    }
    expect(agreementNeedsYouItems(owner())
      .filter((i) => i.category === "contract_termination_unresolved")).toEqual([]);
  });
});

describe("permissions and isolation", () => {
  it("raises nothing at all without contracts:view", () => {
    expect(agreementNeedsYouItems(ctxFor("org_northline", { permissions: [] }))).toEqual([]);
  });

  it("raises the review item only for somebody who may review", () => {
    const withReview = categories(ctxFor("org_meridian", { with: ["contracts:review"] }));
    const withoutReview = categories(ctxFor("org_meridian", {
      permissions: ["contracts:view"],
    }));
    expect(withReview).toContain("contract_review_waiting");
    expect(withoutReview).not.toContain("contract_review_waiting");
  });

  it("only ever raises items for the caller's own organization", () => {
    for (const organizationId of ["org_northline", "org_meridian", "org_solo"]) {
      const items = agreementNeedsYouItems(ctxFor(organizationId));
      expect(items.every((i) => i.organizationId === organizationId)).toBe(true);
    }
  });
});

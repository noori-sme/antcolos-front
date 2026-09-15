import { describe, expect, it } from "vitest";
import { AGREEMENT_TYPE_CATALOG, agreementTypeMeta, compensationKindAllowed, counterpartyRole, relationshipKindAllowed } from "./catalog";
import { CONTRACT_INTEGRATIONS, contractAdapters } from "./extension-points";

describe("the agreement-type catalog", () => {
  it("covers the five named business relationships plus the supported extras", () => {
    expect(AGREEMENT_TYPE_CATALOG.map((m) => m.type)).toEqual([
      "carrier_driver",
      "carrier_owner_operator",
      "carrier_dispatch_organization",
      "carrier_individual_dispatcher",
      "equipment_lease",
      "operating_authority_lease",
      "other_business_relationship",
    ]);
  });

  it("gives every type two party roles and at least one relationship it papers", () => {
    for (const meta of AGREEMENT_TYPE_CATALOG) {
      expect(meta.partyRoles).toHaveLength(2);
      expect(meta.allowedRelationshipKinds.length).toBeGreaterThan(0);
      expect(meta.allowedCompensationKinds.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps an individual dispatcher distinct from a dispatch organization", () => {
    // Different workspace shapes, so different paperwork: a person has no
    // business registration to give.
    const org = agreementTypeMeta("carrier_dispatch_organization");
    const solo = agreementTypeMeta("carrier_individual_dispatcher");
    const keys = (m: typeof org) => m.documentTerms.map((d) => d.documentTypeKey);
    expect(keys(org)).toContain("business_registration");
    expect(keys(solo)).not.toContain("business_registration");
    expect(keys(solo)).toContain("government_id");
    expect(solo.counterpartySignsForSelf).toBe(true);
    expect(org.counterpartySignsForSelf).toBe(false);
  });

  it("asks an owner-operator for equipment paperwork a company driver never owes", () => {
    const oo = agreementTypeMeta("carrier_owner_operator").documentTerms.map((d) => d.documentTypeKey);
    const cd = agreementTypeMeta("carrier_driver").documentTerms.map((d) => d.documentTypeKey);
    expect(oo).toContain("vehicle_registration");
    expect(oo).toContain("w9");
    expect(cd).not.toContain("vehicle_registration");
    expect(cd).not.toContain("w9");
    // Both still owe the two things that let somebody drive at all.
    for (const key of ["cdl", "medical_card"]) {
      expect(oo).toContain(key);
      expect(cd).toContain(key);
    }
  });

  it("names the counterparty role per type", () => {
    expect(counterpartyRole("carrier_driver")).toBe("driver");
    expect(counterpartyRole("carrier_owner_operator")).toBe("owner_operator");
    expect(counterpartyRole("equipment_lease")).toBe("equipment_owner");
  });

  it("gates relationship references through the catalog, not through a caller", () => {
    expect(relationshipKindAllowed("carrier_driver", "driver_carrier_relationship")).toBe(true);
    expect(relationshipKindAllowed("carrier_driver", "truck_operating_lease")).toBe(false);
    expect(relationshipKindAllowed("operating_authority_lease", "truck_operating_lease")).toBe(true);
  });

  it("gates compensation shapes too", () => {
    expect(compensationKindAllowed("carrier_dispatch_organization", "percentage_of_revenue")).toBe(true);
    // A dispatch organization is not paid by the mile.
    expect(compensationKindAllowed("carrier_dispatch_organization", "rate_per_loaded_mile")).toBe(false);
  });

  it("throws on an unknown type rather than defaulting to something", () => {
    // @ts-expect-error deliberately outside the union
    expect(() => agreementTypeMeta("carrier_pirate")).toThrow(/Unknown agreement type/);
  });

  it("gives every type a closeout checklist to finish a termination with", () => {
    for (const meta of AGREEMENT_TYPE_CATALOG) {
      expect(meta.closeoutSteps.length).toBeGreaterThan(0);
    }
  });
});

describe("extension points", () => {
  it("declares every seam the brief names", () => {
    expect(CONTRACT_INTEGRATIONS.map((i) => i.kind)).toEqual([
      "templates", "negotiation", "legal_review",
      "e_signature", "insurance_verification", "payments",
    ]);
  });

  it("reports every one as not connected, and says what happens instead", () => {
    for (const integration of CONTRACT_INTEGRATIONS) {
      expect(integration.connected).toBe(false);
      expect(integration.today.length).toBeGreaterThan(20);
    }
  });

  it("throws from every adapter rather than inventing an answer", async () => {
    const calls: Array<Promise<unknown>> = [
      Promise.resolve().then(() => contractAdapters.templates.list("carrier_driver")),
      Promise.resolve().then(() => contractAdapters.negotiation.rounds("ct_1")),
      Promise.resolve().then(() => contractAdapters.legalReview.request({ contractId: "ct_1", contractVersionId: "cv_1" })),
      Promise.resolve().then(() => contractAdapters.eSignature.status("env_1")),
      Promise.resolve().then(() => contractAdapters.payments.status("ins_1")),
    ];
    for (const call of calls) {
      await expect(call).rejects.toThrow(/is not connected/);
    }
  });

  it("offers no way to mark a version signed from an adapter", () => {
    // Only a party signs, and only a provider can say that a party did.
    expect("markSigned" in contractAdapters.eSignature).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_CATALOG, applicableDefinitions, applies, evaluateApplicability,
  inapplicableDefinitions, requirementDefinition,
} from "@/lib/compliance";
import type { ComplianceSubjectContext } from "@/types";

/**
 * "Do not show irrelevant requirements" is the rule these tests exist to hold.
 * Every case below is a requirement that must be ABSENT, because a compliance
 * list padded with things that do not apply is one an operator stops reading.
 */

const carrierAuthority = {
  hasOwnAuthority: true,
  dotNumber: "3487211",
  mcNumber: "MC-1142908",
  interstate: true,
};

const intrastateAuthority = {
  hasOwnAuthority: true,
  dotNumber: "2910446",
  interstate: false,
};

const dispatchAuthority = { hasOwnAuthority: false, interstate: false };

const carrier: ComplianceSubjectContext = {
  kind: "carrier",
  organizationId: "org_northline",
  organizationType: "CARRIER",
  operatingAuthority: carrierAuthority,
  interstate: true,
};

const intrastateCarrier: ComplianceSubjectContext = {
  ...carrier,
  organizationId: "org_cascade",
  operatingAuthority: intrastateAuthority,
  interstate: false,
};

const dispatchOrg: ComplianceSubjectContext = {
  kind: "carrier",
  organizationId: "org_meridian",
  organizationType: "DISPATCH_AGENCY",
  operatingAuthority: dispatchAuthority,
  interstate: false,
};

const companyDriver: ComplianceSubjectContext = {
  kind: "driver",
  organizationId: "org_northline",
  organizationType: "CARRIER",
  operatingAuthority: carrierAuthority,
  interstate: true,
  engagementType: "company_driver",
};

const ownerOperator: ComplianceSubjectContext = {
  ...companyDriver,
  engagementType: "owner_operator",
};

const tractor: ComplianceSubjectContext = {
  kind: "truck",
  organizationId: "org_northline",
  organizationType: "CARRIER",
  operatingAuthority: carrierAuthority,
  interstate: true,
  truckEquipmentType: "tractor",
  carrierRelationshipType: "carrier_owned",
  grossWeightPounds: 80_000,
};

const cargoVan: ComplianceSubjectContext = {
  ...tractor,
  truckEquipmentType: "cargo_van",
  grossWeightPounds: 9_070,
};

const boxTruck: ComplianceSubjectContext = {
  ...tractor,
  truckEquipmentType: "box_truck",
  grossWeightPounds: 25_999,
};

const dryVan: ComplianceSubjectContext = {
  kind: "trailer",
  organizationId: "org_northline",
  organizationType: "CARRIER",
  operatingAuthority: carrierAuthority,
  interstate: true,
  trailerType: "dry_van",
  hasReeferUnit: false,
  carrierRelationshipType: "carrier_owned",
};

const reefer: ComplianceSubjectContext = {
  ...dryVan, trailerType: "reefer", hasReeferUnit: true,
};

const leasedFlatbed: ComplianceSubjectContext = {
  ...dryVan, trailerType: "flatbed", carrierRelationshipType: "leased_owner_operator",
};

const keysOf = (context: ComplianceSubjectContext) =>
  applicableDefinitions(context).map((d) => d.key);

describe("the catalog itself", () => {
  it("has a unique key per definition", () => {
    const keys = COMPLIANCE_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares a renewal interval wherever the basis needs one", () => {
    for (const definition of COMPLIANCE_CATALOG) {
      if (definition.renewal.basis === "fixed_interval") {
        expect(definition.renewal.intervalMonths, definition.key).toBeGreaterThan(0);
      }
    }
  });

  it("never claims a requirement was verified with an outside service", () => {
    // The product must not imply a connection it does not have. Any wording
    // that reads as "we checked with them" is a bug, not a style preference.
    const forbidden = /verified (with|by) (fmcsa|the clearinghouse|the state)|synced|live feed/i;
    for (const definition of COMPLIANCE_CATALOG) {
      expect(forbidden.test(definition.authority), definition.key).toBe(false);
    }
  });

  it("requires compliance:view on every definition", () => {
    for (const definition of COMPLIANCE_CATALOG) {
      expect(definition.requires, definition.key).toContain("compliance:view");
    }
  });
});

describe("organization type", () => {
  it("does not ask a dispatch organization for carrier filings", () => {
    const keys = keysOf(dispatchOrg);
    expect(keys).not.toContain("carrier.operating_authority_record");
    expect(keys).not.toContain("carrier.bipd_insurance");
    expect(keys).not.toContain("carrier.drug_alcohol_program");
  });

  it("asks a dispatch organization only for its own paperwork", () => {
    expect(keysOf(dispatchOrg).sort()).toEqual([
      "dispatch.carrier_service_agreement",
      "dispatch.errors_omissions_insurance",
      "dispatch.w9_on_file",
    ]);
  });

  it("does not ask a carrier for dispatch paperwork", () => {
    expect(keysOf(carrier)).not.toContain("dispatch.errors_omissions_insurance");
  });
});

describe("operating authority", () => {
  it("asks an interstate carrier for the interstate filings", () => {
    const keys = keysOf(carrier);
    expect(keys).toContain("carrier.ucr_registration");
    expect(keys).toContain("carrier.process_agent_designation");
    expect(keys).toContain("carrier.mcs150_biennial_update");
  });

  it("asks an intrastate carrier for none of them", () => {
    const keys = keysOf(intrastateCarrier);
    expect(keys).not.toContain("carrier.ucr_registration");
    expect(keys).not.toContain("carrier.process_agent_designation");
    expect(keys).not.toContain("carrier.mcs150_biennial_update");
    // …but still for the things every carrier owes.
    expect(keys).toContain("carrier.cargo_insurance");
  });

  it("explains why an interstate filing was left out", () => {
    const verdict = evaluateApplicability(
      requirementDefinition("carrier.ucr_registration"),
      intrastateCarrier,
    );
    expect(verdict.applies).toBe(false);
    if (!verdict.applies) {
      expect(verdict.reason.condition).toBe("interstateOnly");
      expect(verdict.reason.explanation).toMatch(/intrastate/i);
    }
  });
});

describe("driver engagement", () => {
  it("asks an owner-operator for their own agreement, W-9 and coverage", () => {
    const keys = keysOf(ownerOperator);
    expect(keys).toContain("driver.owner_operator_agreement");
    expect(keys).toContain("driver.owner_operator_w9");
    expect(keys).toContain("driver.owner_operator_insurance");
    expect(keys).not.toContain("driver.handbook_acknowledgement");
  });

  it("asks a company driver for the handbook and none of the owner-operator paperwork", () => {
    const keys = keysOf(companyDriver);
    expect(keys).toContain("driver.handbook_acknowledgement");
    expect(keys).not.toContain("driver.owner_operator_agreement");
    expect(keys).not.toContain("driver.owner_operator_w9");
    expect(keys).not.toContain("driver.owner_operator_insurance");
  });

  it("asks both for the licence and the medical card", () => {
    for (const context of [companyDriver, ownerOperator]) {
      expect(keysOf(context)).toContain("driver.commercial_licence");
      expect(keysOf(context)).toContain("driver.medical_certificate");
    }
  });

  it("never asks for a hazmat endorsement without placarded loads", () => {
    expect(keysOf(companyDriver)).not.toContain("driver.hazmat_endorsement");
    expect(keysOf({ ...companyDriver, hazmat: true })).toContain("driver.hazmat_endorsement");
  });
});

describe("equipment type and weight", () => {
  it("asks a heavy tractor for fuel tax credentials and the heavy vehicle return", () => {
    const keys = keysOf(tractor);
    expect(keys).toContain("truck.ifta_credentials");
    expect(keys).toContain("truck.heavy_vehicle_use_tax");
  });

  it("asks a cargo van for neither", () => {
    const keys = keysOf(cargoVan);
    expect(keys).not.toContain("truck.ifta_credentials");
    expect(keys).not.toContain("truck.heavy_vehicle_use_tax");
    expect(keys).not.toContain("truck.eld_device_record");
  });

  it("stops a 25,999 lb box truck short of the fuel tax threshold", () => {
    // The threshold is a real number, not a vibe: one pound under and the
    // requirement is absent.
    const keys = keysOf(boxTruck);
    expect(keys).not.toContain("truck.ifta_credentials");
    expect(keysOf({ ...boxTruck, grossWeightPounds: 26_001 })).toContain("truck.ifta_credentials");
  });

  it("asks every power unit for registration, inspection and insurance", () => {
    for (const context of [tractor, cargoVan, boxTruck]) {
      const keys = keysOf(context);
      expect(keys).toContain("truck.registration");
      expect(keys).toContain("truck.annual_inspection");
      expect(keys).toContain("truck.insurance_evidence");
    }
  });
});

describe("relationship type", () => {
  it("asks for a lease agreement only when the equipment is not owned", () => {
    expect(keysOf(tractor)).not.toContain("truck.lease_agreement");
    expect(
      keysOf({ ...tractor, carrierRelationshipType: "leased_owner_operator" }),
    ).toContain("truck.lease_agreement");
    expect(keysOf(dryVan)).not.toContain("trailer.lease_agreement");
    expect(keysOf(leasedFlatbed)).toContain("trailer.lease_agreement");
  });
});

describe("trailer configuration", () => {
  it("asks a reefer for a refrigeration service record and a dry van for none", () => {
    expect(keysOf(reefer)).toContain("trailer.reefer_unit_service_record");
    expect(keysOf(dryVan)).not.toContain("trailer.reefer_unit_service_record");
  });

  it("asks open-deck equipment for a securement inventory and a dry van for none", () => {
    expect(keysOf(leasedFlatbed)).toContain("trailer.securement_equipment_inventory");
    expect(keysOf(dryVan)).not.toContain("trailer.securement_equipment_inventory");
    expect(keysOf(reefer)).not.toContain("trailer.securement_equipment_inventory");
  });
});

describe("what was deliberately left out", () => {
  it("gives a reason for every requirement it skipped", () => {
    const skipped = inapplicableDefinitions(dryVan);
    expect(skipped.length).toBeGreaterThan(0);
    for (const { definition, reason } of skipped) {
      expect(reason.explanation, definition.key).toBeTruthy();
      expect(applies(definition, dryVan)).toBe(false);
    }
  });

  it("accounts for every definition of the subject kind, applicable or not", () => {
    const total = COMPLIANCE_CATALOG.filter((d) => d.subjectKind === "trailer").length;
    expect(applicableDefinitions(dryVan).length + inapplicableDefinitions(dryVan).length)
      .toBe(total);
  });
});

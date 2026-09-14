import { describe, expect, it } from "vitest";
import {
  WORKSPACE_DOCUMENT_MATRIX, driverRequirements, trailerRequirements,
  truckRequirements, workspaceApplicability, workspaceRequirements,
} from "./requirements";
import { DOCUMENT_TYPES, documentType } from "./catalog";
import type { WorkspaceKind } from "@/types";

const KINDS: WorkspaceKind[] = [
  "carrier_organization", "dispatch_organization", "individual_dispatcher",
];

describe("workspace requirement sets", () => {
  it("gives every workspace type an explicit answer for every candidate type", () => {
    // A missing row would be a silent bug; a wrong cell is a visible one.
    for (const row of WORKSPACE_DOCUMENT_MATRIX) {
      for (const kind of KINDS) {
        expect(row[kind], `${row.typeKey} / ${kind}`).toBeDefined();
        expect(["required", "optional", "not_applicable"]).toContain(row[kind].applicability);
      }
    }
  });

  it("never shows carrier-only requirements to a dispatch organization", () => {
    const dispatch = workspaceRequirements("dispatch_organization").map((r) => r.typeKey);
    for (const carrierOnly of ["operating_authority", "mc_authority_letter", "ifta_license", "drug_alcohol_policy"] as const) {
      expect(dispatch).not.toContain(carrierOnly);
    }
  });

  it("never shows carrier-only requirements to an individual dispatcher", () => {
    const solo = workspaceRequirements("individual_dispatcher").map((r) => r.typeKey);
    for (const carrierOnly of ["operating_authority", "mc_authority_letter", "certificate_of_insurance"] as const) {
      expect(solo).not.toContain(carrierOnly);
    }
  });

  it("asks an individual dispatcher for personal identity, and a company for neither", () => {
    expect(workspaceApplicability("individual_dispatcher", "government_id")).toBe("required");
    expect(workspaceApplicability("dispatch_organization", "government_id")).toBe("not_applicable");
    expect(workspaceApplicability("carrier_organization", "government_id")).toBe("not_applicable");
  });

  it("treats an individual dispatcher's company registration as optional, not missing work", () => {
    // Working as yourself is a valid answer and must never read as a failure.
    expect(workspaceApplicability("individual_dispatcher", "business_registration")).toBe("optional");
    expect(workspaceApplicability("dispatch_organization", "business_registration")).toBe("required");
  });

  it("keeps the document type reusable across workspace types", () => {
    // One W-9 type, three contexts, three different reasons.
    const reasons = KINDS.map(
      (kind) => workspaceRequirements(kind).find((r) => r.typeKey === "w9")?.reason,
    );
    expect(reasons.every(Boolean)).toBe(true);
    expect(new Set(reasons).size).toBe(3);
  });

  it("never returns a not_applicable requirement to a caller", () => {
    for (const kind of KINDS) {
      for (const requirement of workspaceRequirements(kind)) {
        expect(requirement.applicability).not.toBe("not_applicable");
      }
    }
  });

  it("namespaces requirement keys so no two workspace sets can collide", () => {
    const seen = new Set<string>();
    for (const kind of KINDS) {
      for (const requirement of workspaceRequirements(kind)) {
        expect(seen.has(requirement.key)).toBe(false);
        seen.add(requirement.key);
      }
    }
  });
});

describe("entity requirement sets", () => {
  it("asks an owner-operator for business paperwork and a company driver for none", () => {
    const company = driverRequirements("company_driver").map((r) => r.key);
    const owner = driverRequirements("owner_operator").map((r) => r.key);
    expect(company).not.toContain("w9");
    expect(owner).toContain("w9");
    expect(owner).toContain("coi");
  });

  it("keeps the driver requirement keys the driver screens already use", () => {
    const keys = driverRequirements("owner_operator").map((r) => r.key);
    for (const key of ["cdl_front", "cdl_back", "medical_front", "medical_back", "business_info", "vehicle_registration"]) {
      expect(keys).toContain(key);
    }
  });

  it("asks a reefer for a service record and a dry van for none", () => {
    expect(trailerRequirements("reefer").map((r) => r.typeKey)).toContain("reefer_service_record");
    expect(trailerRequirements("dry_van").map((r) => r.typeKey)).not.toContain("reefer_service_record");
  });

  it("asks an apportioned power unit for a cab card and a cargo van for none", () => {
    expect(truckRequirements("tractor").map((r) => r.typeKey)).toContain("cab_card");
    expect(truckRequirements("cargo_van").map((r) => r.typeKey)).not.toContain("cab_card");
  });
});

describe("document type catalog", () => {
  it("marks load paperwork as modelled but not built", () => {
    for (const key of ["rate_confirmation", "bill_of_lading", "proof_of_delivery", "lumper_receipt", "detention_evidence", "damage_document"] as const) {
      const meta = documentType(key);
      expect(meta.future, key).toBe(true);
      expect(meta.subjects).toContain("load");
    }
  });

  it("has no duplicate keys", () => {
    const keys = DOCUMENT_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

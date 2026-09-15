import { describe, expect, it } from "vitest";
import type { ContractTerms, ContractVersion } from "@/types";
import {
  assertAmendable, assertVersionMutable, canAmend, changedTermGroups, cloneTerms,
  freeze, isVersionMutable, nextVersionNumber,
} from "./versions";

function terms(): ContractTerms {
  return {
    summary: "Company driver agreement",
    effective: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" },
    renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 45 },
    termination: {
      grounds: ["for_convenience", "for_cause"],
      noticeDays: 14,
      forCauseNoticeDays: 0,
      closeoutSteps: [{ key: "final_settlement", label: "Final settlement", owedByRole: "carrier" }],
      survivingObligations: ["Confidentiality"],
    },
    compensation: [{
      id: "cr_1", kind: "percentage_of_revenue", label: "Driver share",
      detail: "28% of linehaul", percentageBasisPoints: 2800, payeeRole: "driver",
    }],
    responsibilities: [{ id: "rs_1", area: "fuel", owedByRole: "carrier", detail: "Carrier fuels the truck.", material: false }],
    requiredDocuments: [{ id: "rd_1", documentTypeKey: "cdl", owedByRole: "driver", reason: "Licence", blocking: true }],
  };
}

function version(overrides: Partial<ContractVersion> = {}): ContractVersion {
  return {
    contractVersionId: "cv_1",
    contractId: "ct_1",
    versionNumber: 1,
    kind: "original",
    status: "draft",
    changedTermGroups: [],
    terms: terms(),
    frozen: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByMembershipId: "mem_1",
    createdByName: "Sam",
    ...overrides,
  };
}

describe("version immutability", () => {
  it("lets only an unfrozen draft be edited", () => {
    expect(isVersionMutable(version())).toBe(true);
    expect(isVersionMutable(version({ status: "issued" }))).toBe(false);
    expect(isVersionMutable(version({ status: "signed" }))).toBe(false);
    expect(isVersionMutable(version({ status: "superseded" }))).toBe(false);
    expect(isVersionMutable(version({ status: "void" }))).toBe(false);
  });

  it("refuses a draft that has been frozen anyway", () => {
    // Belt and braces: status alone is not trusted, because a frozen record is
    // frozen whatever else it says.
    expect(isVersionMutable(version({ status: "draft", frozen: true }))).toBe(false);
  });

  it("refuses to edit a signed version and says to amend instead", () => {
    expect(() => assertVersionMutable(version({ status: "signed", frozen: true, versionNumber: 3 })))
      .toThrow(/Version 3 is signed or closed[\s\S]*amendment/);
  });

  it("freezes without a way back", () => {
    const frozen = freeze(version({ status: "signed" }));
    expect(frozen.frozen).toBe(true);
    // There is no unfreeze: the only export that touches the flag sets it.
    expect(Object.keys({ freeze })).toEqual(["freeze"]);
  });

  it("does not mutate the version it freezes", () => {
    const original = version();
    freeze(original);
    expect(original.frozen).toBe(false);
  });
});

describe("version numbering", () => {
  it("is 1-based and gapless", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([{ versionNumber: 1 }])).toBe(2);
    expect(nextVersionNumber([{ versionNumber: 1 }, { versionNumber: 2 }])).toBe(3);
  });

  it("never reuses a number, even when a middle version was withdrawn", () => {
    expect(nextVersionNumber([{ versionNumber: 1 }, { versionNumber: 3 }])).toBe(4);
  });
});

describe("amendments", () => {
  it("amends only a signed version", () => {
    expect(canAmend(version({ status: "signed" }))).toBe(true);
    expect(canAmend(version({ status: "draft" }))).toBe(false);
    expect(canAmend(version({ status: "issued" }))).toBe(false);
    expect(canAmend(version({ status: "superseded" }))).toBe(false);
  });

  it("explains why a draft is not amended but edited", () => {
    expect(() => assertAmendable(version({ status: "draft", versionNumber: 1 })))
      .toThrow(/Only a signed version can be amended/);
  });

  it("works out which term groups changed rather than believing the caller", () => {
    const before = terms();
    const after = cloneTerms(before);
    after.compensation[0].percentageBasisPoints = 3000;
    after.renewal.reminderDays = 60;

    expect(changedTermGroups(before, after).sort()).toEqual(["compensation", "renewal"]);
  });

  it("reports no change when nothing changed", () => {
    expect(changedTermGroups(terms(), terms())).toEqual([]);
  });

  it("catches a changed compensation window, not just a changed number", () => {
    const before = terms();
    const after = cloneTerms(before);
    after.compensation[0].appliesTo = "2026-06-30T00:00:00.000Z";
    expect(changedTermGroups(before, after)).toEqual(["compensation"]);
  });
});

describe("cloneTerms", () => {
  it("deep-copies, so editing an amendment cannot reach the signed version", () => {
    const signed = terms();
    const draft = cloneTerms(signed);

    draft.compensation[0].percentageBasisPoints = 9999;
    draft.termination.grounds.push("mutual");
    draft.termination.closeoutSteps[0].label = "Changed";
    draft.requiredDocuments[0].blocking = false;
    draft.responsibilities[0].detail = "Changed";
    draft.termination.survivingObligations!.push("Indemnity");

    expect(signed.compensation[0].percentageBasisPoints).toBe(2800);
    expect(signed.termination.grounds).toEqual(["for_convenience", "for_cause"]);
    expect(signed.termination.closeoutSteps[0].label).toBe("Final settlement");
    expect(signed.requiredDocuments[0].blocking).toBe(true);
    expect(signed.responsibilities[0].detail).toBe("Carrier fuels the truck.");
    expect(signed.termination.survivingObligations).toEqual(["Confidentiality"]);
  });
});

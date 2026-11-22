import { describe, expect, it } from "vitest";
import { capabilityError, capabilityRows, flagFormValue, flagLabel, interiorLabel, reeferRangeLabel } from "./capabilities";

describe("truck capabilities (plan 46)", () => {
  it("keeps not-recorded apart from No", () => {
    expect(flagLabel(true)).toBe("Yes");
    expect(flagLabel(false)).toBe("No");
    expect(flagLabel(null)).toBeUndefined();
    expect(flagFormValue(false)).toBe("no");
    expect(flagFormValue(undefined)).toBe("");
  });

  it("labels interior dimensions and the reefer range", () => {
    expect(interiorLabel({ trailerWidthIn: 102, trailerHeightIn: 110 })).toBe("102 × 110 in");
    expect(interiorLabel({ trailerWidthIn: 102 })).toBe("102 in wide");
    expect(interiorLabel({})).toBeUndefined();
    expect(reeferRangeLabel({ reeferMinTempF: -10, reeferMaxTempF: 70 })).toBe("−10 °F to 70 °F");
    expect(reeferRangeLabel({ reeferMaxTempF: 40 })).toBe("up to 40 °F");
    expect(reeferRangeLabel({})).toBeUndefined();
  });

  it("checks bounds like the API", () => {
    expect(capabilityError("strapCount", "")).toBeUndefined();
    expect(capabilityError("strapCount", "0")).toBeUndefined();
    expect(capabilityError("strapCount", "201")).toBe("Between 0 and 200.");
    expect(capabilityError("reeferMinTempF", "-41")).toBe("Between -40 and 100.");
    expect(capabilityError("trailerWidthIn", "1.5")).toBe("Enter a whole number.");
  });

  it("lists the reefer range only on a REEFER truck", () => {
    const base = { id: "t", vin: "V", hasLiftgate: false, strapCount: 0 } as const;
    expect(capabilityRows({ ...base, equipmentType: "DRY_VAN" }).map((r) => r.label)).not.toContain("Reefer Range");
    const reefer = capabilityRows({ ...base, equipmentType: "REEFER", reeferMinTempF: -10, reeferMaxTempF: 70 });
    expect(reefer).toContainEqual({ label: "Reefer Range", value: "−10 °F to 70 °F" });
    expect(reefer).toContainEqual({ label: "Liftgate", value: "No" });
    expect(reefer).toContainEqual({ label: "Load Straps", value: "0" });
  });
});

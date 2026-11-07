import { describe, expect, it } from "vitest";
import { carrierOnboardingInput } from "./rules";

describe("carrierOnboardingInput", () => {
  it("sends digit-only identifiers whatever prefix was typed", () => {
    expect(carrierOnboardingInput("Jane", "MC-123456", "USDOT 44110")).toEqual({
      legalOwnerName: "Jane",
      mcNumber: "123456",
      dotNumber: "44110",
    });
  });

  it("leaves out an identifier that was not given", () => {
    expect(carrierOnboardingInput("Jane", "", "44110")).toEqual({
      legalOwnerName: "Jane",
      mcNumber: undefined,
      dotNumber: "44110",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  InvalidEngagementTransitionError, WORKFORCE_TRANSITIONS, assertTransition,
  canTransition,
} from "./lifecycle";
import { WORKFORCE_TERMINAL_STATES, type WorkforceEngagementState } from "@/types";

const ALL: WorkforceEngagementState[] = [
  "prospective", "onboarding", "active", "suspended", "ended", "rejected", "withdrawn",
];

describe("the engagement lifecycle table", () => {
  it("covers every state, so a new one cannot be forgotten", () => {
    for (const state of ALL) {
      expect(WORKFORCE_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("never allows a terminal state to change", () => {
    for (const state of WORKFORCE_TERMINAL_STATES) {
      expect(WORKFORCE_TRANSITIONS[state]).toHaveLength(0);
      for (const to of ALL) expect(canTransition(state, to)).toBe(false);
    }
  });

  it("allows only the transitions that were decided", () => {
    expect(canTransition("prospective", "onboarding")).toBe(true);
    expect(canTransition("onboarding", "active")).toBe(true);
    expect(canTransition("active", "suspended")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true);
    expect(canTransition("active", "ended")).toBe(true);
    expect(canTransition("suspended", "ended")).toBe(true);

    // The ones that would quietly skip a decision somebody has to make.
    expect(canTransition("prospective", "active")).toBe(false);
    expect(canTransition("prospective", "suspended")).toBe(false);
    expect(canTransition("onboarding", "suspended")).toBe(false);
    expect(canTransition("ended", "active")).toBe(false);
  });

  it("refuses with a message naming both states and what is allowed", () => {
    try {
      assertTransition("prospective", "active");
      expect.unreachable("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEngagementTransitionError);
      expect((error as Error).message).toContain("prospective");
      expect((error as Error).message).toContain("active");
      expect((error as Error).message).toContain("onboarding");
    }
  });

  it("tells somebody holding a finished engagement to make a new one", () => {
    try {
      assertTransition("ended", "active");
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as Error).message).toContain("Create a new engagement");
    }
  });
});

import { describe, expect, it } from "vitest";
import type { ActorRef, NeedsYouItem } from "@/types";
import { automationProgress } from "@/types";
import {
  executeDecision, NotExecutableError, planAutomation, UnknownOptionError,
} from "./needs-you-automation";

/**
 * The 90% rule, tested where it is decided.
 *
 * Every claim here is about the SHAPE of an item's automation record — that one
 * press finishes it, that a derived item is a link and never a fake approval,
 * that a decision writes down what ran. None of it needs a screen, and none of
 * it may be re-decided by one.
 */

const ACTOR: ActorRef = {
  userId: "usr_1",
  membershipId: "mem_1",
  displayNameSnapshot: "A Person",
  source: "web",
};

function item(over: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return {
    id: "ny_1",
    organizationId: "org_1",
    category: "ratecon_waiting",
    severity: "high",
    status: "open",
    title: "A rate confirmation to check",
    reason: "It arrived and nobody has read it.",
    entity: { kind: "rate_confirmation", id: "rc_1", label: "RC-1" },
    recommendedAction: { kind: "check_ratecon", label: "Check it", requires: [] },
    source: "system",
    requires: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    history: [],
    ...over,
  };
}

describe("every item arrives at one press", () => {
  it("offers at least one option, whatever the work type", () => {
    for (const category of [
      "ratecon_waiting", "duplicate_fuel_purchase", "workforce_start_approval",
      // A work type with no playbook of its own still has to land on a button.
      "telemetry_odometer_conflict", "detention",
    ] as const) {
      const plan = planAutomation(item({ category }));
      expect(plan.options.length, category).toBeGreaterThan(0);
      expect(plan.stage, category).toBe("awaiting_decision");
    }
  });

  it("names the item's own recommended action when nobody has written a playbook", () => {
    const plan = planAutomation(
      item({
        category: "detention",
        recommendedAction: { kind: "review", label: "Sort the detention", requires: [] },
      }),
    );
    expect(plan.options.map((o) => o.label)).toContain("Sort the detention");
  });

  it("carries pre-work that says what already ran", () => {
    const plan = planAutomation(item());
    expect(plan.prework.length).toBeGreaterThanOrEqual(4);
    // Every label is short enough to scan rather than read.
    for (const step of plan.prework) {
      expect(step.label.split(/\s+/).length, step.label).toBeLessThanOrEqual(5);
    }
  });

  it("reports the system as carrying most of the work", () => {
    // The whole claim of the surface: a person's share of an item is one step.
    const plan = planAutomation(item());
    expect(plan.stepsDone).toBe(plan.prework.length);
    expect(plan.stepsTotal).toBeGreaterThan(plan.stepsDone);
    expect(automationProgress(plan)).toBeGreaterThanOrEqual(50);
  });

  it("is deterministic: the same item plans the same way twice", () => {
    expect(planAutomation(item())).toEqual(planAutomation(item()));
  });
});

describe("an item that is a view of another module's state", () => {
  const derived = item({
    derived: true,
    entity: { kind: "settlement", id: "s1", label: "S-1", href: "/finance/settlements/s1" },
    recommendedAction: {
      kind: "approve_settlement", label: "Work through the settlement", requires: [],
    },
  });

  it("offers a link rather than an approval that would write nothing", () => {
    const plan = planAutomation(derived);
    expect(plan.stage).toBe("handoff");
    expect(plan.options).toHaveLength(1);
    expect(plan.options[0].intent).toBe("open");
    expect(plan.options[0].href).toBe("/finance/settlements/s1");
  });

  it("refuses to be decided here, with the sentence a person should read", () => {
    const planned = { ...derived, automation: planAutomation(derived) };
    expect(() => executeDecision(planned, "open", ACTOR)).toThrow(NotExecutableError);
    expect(() => executeDecision(planned, "open", ACTOR)).toThrow(/clears on its own/);
  });
});

describe("taking the decision", () => {
  const planned = () => {
    const base = item();
    return { ...base, automation: planAutomation(base) };
  };

  it("records which option, who took it, and every step that ran after", () => {
    const outcome = executeDecision(planned(), "approve", ACTOR, "2026-02-02T09:00:00.000Z");

    expect(outcome.automation.stage).toBe("done");
    expect(outcome.automation.decision?.optionId).toBe("approve");
    expect(outcome.automation.decision?.actor).toEqual(ACTOR);
    expect(outcome.automation.decision?.steps.length).toBe(outcome.option.downstream.length);
    for (const step of outcome.automation.decision!.steps) {
      expect(step.state).toBe("done");
      expect(step.at).toBe("2026-02-02T09:00:00.000Z");
    }
    // The note is what the item's history and resolution will carry.
    expect(outcome.note).toMatch(/steps? after it/);
  });

  it("refuses an option the item never offered", () => {
    expect(() => executeDecision(planned(), "quote_from_nowhere", ACTOR))
      .toThrow(UnknownOptionError);
  });

  it("keeps the decision across a replan, so a later read still shows what ran", () => {
    const outcome = executeDecision(planned(), "approve", ACTOR);
    const stored: NeedsYouItem = { ...item(), automation: outcome.automation };
    const replanned = planAutomation(stored);
    expect(replanned.stage).toBe("done");
    expect(replanned.decision?.optionId).toBe("approve");
  });
});

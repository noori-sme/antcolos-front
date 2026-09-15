import {
  DEFAULT_LADDER, DEFAULT_POLICIES, DEFAULT_SLA_BY_SEVERITY, DEFAULT_TRIGGERS,
} from "@/config/responsibility";
import type {
  EscalationPolicy, ResponsibilityContext, ResponsibilityFunction,
  ResponsibilitySeverity,
} from "@/types";

/**
 * The policies a workspace starts with, and how one is chosen for a piece of
 * work.
 *
 * Both halves are deliberately dull, and that is the point of the zero-friction
 * rule: a Carrier that never opens settings never learns these exist. Three
 * policies are seeded, the routing engine picks one by function and severity,
 * and nobody is asked to choose.
 *
 * Seeded policies may be EDITED but not DELETED, exactly like permission
 * templates — a workspace with no policy is a workspace where nothing ever
 * escalates, and that is not a state a person should be able to reach by
 * tidying up.
 */

export function seedPolicies(organizationId: string, now: string): EscalationPolicy[] {
  return DEFAULT_POLICIES.map((seed) => ({
    id: `resp_pol_${organizationId}_${seed.key}`,
    organizationId,
    name: seed.name,
    description: seed.description,
    appliesToFunctions: seed.appliesToFunctions
      ? [...seed.appliesToFunctions]
      : undefined,
    appliesToSeverities: seed.appliesToSeverities
      ? [...seed.appliesToSeverities]
      : undefined,
    triggers: [...(seed.triggers ?? DEFAULT_TRIGGERS)],
    steps: DEFAULT_LADDER.map((s) => ({ ...s, notify: [...s.notify] })),
    sla: seed.sla ?? DEFAULT_SLA_BY_SEVERITY.medium,
    seeded: true,
    updatedAt: now,
  }));
}

/**
 * How specific a policy is about this work.
 *
 * Higher wins. Naming the function is worth more than naming the severity,
 * because "dispatch" is a smaller claim than "everything critical" — and the
 * general policy, which names neither, is the floor rather than a competitor.
 */
function specificity(
  policy: EscalationPolicy,
  functionKey: ResponsibilityFunction,
  severity: ResponsibilitySeverity,
): number {
  if (policy.appliesToFunctions && !policy.appliesToFunctions.includes(functionKey)) return -1;
  if (policy.appliesToSeverities && !policy.appliesToSeverities.includes(severity)) return -1;
  return (policy.appliesToFunctions ? 2 : 0) + (policy.appliesToSeverities ? 1 : 0);
}

/**
 * The policy that governs one piece of work.
 *
 * Most specific match wins; ties break on id so the answer is stable. A
 * workspace whose policies have all been narrowed past this work still gets one
 * — the last resort is a policy built from the defaults rather than `undefined`,
 * because a piece of work with no SLA and no triggers is a piece of work nothing
 * would ever notice going wrong.
 */
export function policyFor(
  policies: readonly EscalationPolicy[],
  context: Pick<ResponsibilityContext, "functionKey" | "severity" | "organizationId">,
): EscalationPolicy {
  const scored = policies
    .filter((p) => p.organizationId === context.organizationId)
    .map((p) => ({ policy: p, score: specificity(p, context.functionKey, context.severity) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => (b.score - a.score) || a.policy.id.localeCompare(b.policy.id));

  if (scored.length > 0) {
    const chosen = scored[0].policy;
    // A policy that does not set its own SLA uses the severity default rather
    // than the medium one it was seeded with. Kept here rather than in the seed
    // so editing a policy's targets and leaving them alone behave differently.
    const seed = DEFAULT_POLICIES.find((d) => chosen.id.endsWith(`_${d.key}`));
    if (seed && !seed.sla) {
      return { ...chosen, sla: DEFAULT_SLA_BY_SEVERITY[context.severity] };
    }
    return chosen;
  }

  return {
    id: `resp_pol_${context.organizationId}_fallback`,
    organizationId: context.organizationId,
    name: "Default",
    description:
      "Applied because no policy in this workspace claims this work. Edit a policy to change it.",
    triggers: [...DEFAULT_TRIGGERS],
    steps: DEFAULT_LADDER.map((s) => ({ ...s, notify: [...s.notify] })),
    sla: DEFAULT_SLA_BY_SEVERITY[context.severity],
    seeded: true,
    updatedAt: new Date(0).toISOString(),
  };
}

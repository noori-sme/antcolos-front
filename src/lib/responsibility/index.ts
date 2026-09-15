/**
 * ★ THE RESPONSIBILITY ENGINE ★
 *
 * Pure product rules: who holds a piece of work, who answers for it, what the
 * targets are, and what happens when nothing moves. Nothing in this folder
 * imports a mock, touches a store, renders anything or knows what an MT Loop is
 * — it is handed candidates and a typed context, and it returns a decision.
 *
 * That purity is what makes the engine testable against a workspace that does
 * not exist yet: a brand-new one-truck carrier with no members but its Owner is
 * three lines to construct here, and the same functions decide it as decide a
 * forty-truck fleet with a night desk.
 *
 * Read in this order:
 *
 *   candidate.ts     what a membership looks like to the engine — and, more
 *                    importantly, what it does not: there is no role field.
 *   fleet-profile.ts the one question onboarding asks, and everything it
 *                    decides. Thresholds live in config, never here.
 *   eligibility.ts   permissions, scope, asset and carrier assignment,
 *                    availability. The hard gate, and the score, kept apart.
 *   routing.ts       the four roles filled in. Accountable is never absent.
 *   policies.ts      which policy governs which work.
 *   sla.ts           two clocks, computed from the records. No timers.
 *   escalation.ts    triggers and rungs. Escalation is not reassignment.
 *   queues.ts        the seven views, and the Owner-oversight rule.
 *   timeline.ts      append-only history.
 */

export type { CandidateWorkload, ResponsibilityCandidate } from "./candidate";
export { bandFor, fleetProfileFor, type FleetProfileInput } from "./fleet-profile";
export { evaluateCandidate, rankCandidates, type EligibilityInput } from "./eligibility";
export {
  nextEligibleAfter, routeResponsibility,
  type RoutingInput, type RoutingResult,
} from "./routing";
export { policyFor, seedPolicies } from "./policies";
export { describeReading, isAtRisk, slaFor, targetFor } from "./sla";
export {
  describeEscalation, escalationsFor, hasEscalated, isEscalated, ladderFor,
  movesWork, pendingMoves, topLevel, type EscalationInput,
} from "./escalation";
export {
  buildQueues, queueApplies, queueCounts, type QueueInput,
} from "./queues";
export {
  appendTimeline, recentFirst, resetTimelineSequence, type AppendInput,
} from "./timeline";

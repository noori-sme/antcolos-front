import type {
  ResponsibilityTimelineAction, ResponsibilityTimelineEntry,
} from "@/types";

/**
 * The immutable timeline.
 *
 * One function, and the constraint is in what it does NOT offer: there is no
 * `edit`, no `remove`, no `replace`. Every assignment, override, escalation,
 * acknowledgement, approval, takeover and resolution appends a line, and the
 * lines are never touched again — including when the membership they name is
 * suspended or leaves, which is why the names are snapshotted rather than
 * looked up at read time.
 *
 * ███ FRONTEND ONLY ███
 * "Immutable" here means this module never mutates it and hands out frozen
 * copies. It is not a tamper-evident log: it lives in memory for the life of
 * the tab, and a real append-only ledger with real guarantees is the backend's
 * job. The one Antcolos already has for cross-module history is
 * `src/lib/audit/` — the responsibility service projects into it, and this
 * timeline is the detailed per-assignment record beside it.
 */

let seq = 0;

/** Test hook, so ids are stable within a run. Never called by the UI. */
export function resetTimelineSequence() {
  seq = 0;
}

export interface AppendInput {
  action: ResponsibilityTimelineAction;
  /** Absent when the system did it rather than a person. */
  actorMembershipId?: string;
  actorName: string;
  subjectMembershipId?: string;
  subjectName?: string;
  note: string;
  trigger?: ResponsibilityTimelineEntry["trigger"];
  level?: number;
  at?: string;
}

/**
 * Appends one line and returns a NEW frozen array.
 *
 * Returning a new array rather than pushing is what makes the "never rewritten"
 * claim structural instead of a convention somebody has to remember: a caller
 * holding the old timeline still holds exactly what it held.
 */
export function appendTimeline(
  timeline: readonly ResponsibilityTimelineEntry[],
  input: AppendInput,
): readonly ResponsibilityTimelineEntry[] {
  const entry: ResponsibilityTimelineEntry = Object.freeze({
    id: `rt_${(++seq).toString(36)}${Date.now().toString(36)}`,
    at: input.at ?? new Date().toISOString(),
    action: input.action,
    actorMembershipId: input.actorMembershipId,
    actorName: input.actorName,
    subjectMembershipId: input.subjectMembershipId,
    subjectName: input.subjectName,
    note: input.note,
    trigger: input.trigger,
    level: input.level,
  });
  return Object.freeze([...timeline, entry]);
}

/** Newest first, for a panel that shows the last few. */
export function recentFirst(
  timeline: readonly ResponsibilityTimelineEntry[],
): ResponsibilityTimelineEntry[] {
  return [...timeline].sort((a, b) => b.at.localeCompare(a.at));
}

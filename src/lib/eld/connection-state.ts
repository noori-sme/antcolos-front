import type { EldConnection, EldConnectionState } from "@/types";

/**
 * ★ SEVEN STATES, AND WHY NONE OF THEM COLLAPSES INTO ANOTHER ★
 *
 * The temptation with connection health is one boolean — connected or not —
 * and it is wrong for the same reason a single equipment status field is wrong:
 * the operator's next action differs in every one of these cases.
 *
 *   connected     nothing to do
 *   syncing       wait; gaps right now are expected and not a fault
 *   stale         somebody should look. The link is up and the data is not.
 *   offline       usually the key is off. Normal overnight, a problem at noon.
 *   disconnected  a person did this deliberately. Do not raise an alarm.
 *   error         the provider or adapter refused. There is a reason to read.
 *   unsupported   stop asking. This provider will never give you that signal.
 *
 * Two of these are DECLARED and five are DERIVED. `disconnected`, `error` and
 * `unsupported` are facts somebody or something recorded and are never
 * overridden by freshness — a disconnected link is not "stale", it is off, and
 * calling it stale would put a row in the Needs You queue that nobody should
 * act on. Everything else is worked out from when data last actually arrived.
 */

const MINUTE_MS = 60_000;

/**
 * How long after the freshness expectation a link stops being "stale" and
 * starts being "offline".
 *
 * A multiple rather than a second absolute number, so a nightly import and a
 * thirty-second webhook each get a proportionate answer instead of one global
 * threshold that libels the slower of the two.
 */
export const OFFLINE_MULTIPLE = 4;

/** How long a first sync or backfill is allowed to run before it is an error. */
export const SYNC_GRACE_MINUTES = 30;

export interface DerivedConnectionState {
  state: EldConnectionState;
  /** Always populated. A state with no reason is a state nobody can act on. */
  reason: string;
  /** Minutes since the last normalized event. Absent when none has arrived. */
  minutesSinceEvent?: number;
}

/**
 * The live state of a link.
 *
 * Takes `nowMs` rather than reading the clock, so the same connection can be
 * asked "what were you an hour ago" and so every test in this module is
 * deterministic.
 */
export function deriveConnectionState(
  connection: Pick<
    EldConnection,
    | "state" | "transport" | "freshnessExpectationMinutes" | "connectedAt"
    | "lastEventAt" | "lastSyncAt" | "stateReason" | "disconnectedReason"
  >,
  nowMs: number,
): DerivedConnectionState {
  // Declared states win. Somebody recorded these; freshness does not get a vote.
  if (connection.state === "disconnected") {
    return {
      state: "disconnected",
      reason: connection.disconnectedReason
        ?? "This link was taken down deliberately. Nothing is expected from it.",
    };
  }
  if (connection.state === "error") {
    return {
      state: "error",
      reason: connection.stateReason ?? "The provider or the adapter refused, and gave no reason.",
    };
  }
  if (connection.state === "unsupported") {
    return {
      state: "unsupported",
      reason: connection.stateReason
        ?? "This provider cannot serve what this connection was asked for.",
    };
  }

  const lastEventMs = connection.lastEventAt ? Date.parse(connection.lastEventAt) : undefined;
  const minutesSinceEvent = lastEventMs != null
    ? Math.max(0, Math.floor((nowMs - lastEventMs) / MINUTE_MS))
    : undefined;

  if (connection.state === "syncing") {
    const startedMs = Date.parse(connection.lastSyncAt ?? connection.connectedAt);
    const runningMinutes = (nowMs - startedMs) / MINUTE_MS;
    if (runningMinutes <= SYNC_GRACE_MINUTES) {
      return {
        state: "syncing",
        reason: "A first sync or backfill is in flight. Gaps in the data are expected right now.",
        minutesSinceEvent,
      };
    }
    return {
      state: "error",
      reason:
        `The sync has been running for ${Math.round(runningMinutes)} minutes, past the `
        + `${SYNC_GRACE_MINUTES}-minute grace period. Something is stuck.`,
      minutesSinceEvent,
    };
  }

  // From here the link claims to be connected, and the data decides.
  const expectation = Math.max(1, connection.freshnessExpectationMinutes);

  if (minutesSinceEvent == null) {
    const connectedMinutes = (nowMs - Date.parse(connection.connectedAt)) / MINUTE_MS;
    if (connectedMinutes <= expectation) {
      return {
        state: "syncing",
        reason: "Linked, and nothing has arrived yet. It is still inside the first expectation.",
      };
    }
    return {
      state: "offline",
      reason:
        `Linked ${Math.round(connectedMinutes)} minutes ago and nothing has ever arrived. `
        + "Check that the device is powered and reporting.",
    };
  }

  if (minutesSinceEvent <= expectation) {
    return {
      state: "connected",
      reason: `Last signal ${minutesSinceEvent} minutes ago, inside the ${expectation}-minute expectation.`,
      minutesSinceEvent,
    };
  }

  if (minutesSinceEvent <= expectation * OFFLINE_MULTIPLE) {
    return {
      state: "stale",
      reason:
        `Last signal ${minutesSinceEvent} minutes ago, past the ${expectation}-minute `
        + "expectation. The link is up; the data is not.",
      minutesSinceEvent,
    };
  }

  return {
    state: "offline",
    reason:
      `Nothing for ${minutesSinceEvent} minutes, more than ${OFFLINE_MULTIPLE}× the `
      + `${expectation}-minute expectation. Treated as not reporting.`,
    minutesSinceEvent,
  };
}

/** True while a link is one somebody should be chased about. */
export function connectionNeedsAttention(state: EldConnectionState): boolean {
  return state === "stale" || state === "offline" || state === "error";
}

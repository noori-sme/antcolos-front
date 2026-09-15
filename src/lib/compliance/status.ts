import type {
  ComplianceEvidenceRef, ComplianceRenewalCycle, ComplianceRequirement,
  ComplianceSeverity, ComplianceStatus,
} from "@/types";
import { COMPLIANCE_SEVERITY_ORDER, COMPLIANCE_STATUS_ORDER } from "@/types";

/**
 * Status is DERIVED, never typed in.
 *
 * A requirement's state is a function of three things and nothing else: whether
 * a piece of evidence satisfies it, what the owning system says about that
 * evidence, and where today sits relative to the due date. That is why a
 * document being rejected in the Document Center turns the requirement red
 * without anybody touching the requirement — and why the requirement survives
 * the document being deleted, reading "action required" again.
 */

const DAY_MS = 86_400_000;

export function daysUntil(iso: string, from = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - from) / DAY_MS);
}

export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months);
  // Rolling 31 Jan forward a month must not land in March.
  if (date.getUTCDate() < day) date.setUTCDate(0);
  return date.toISOString();
}

/**
 * When this requirement next falls due.
 *
 * `document_expiry` defers to the evidence: a licence expires when the licence
 * says it does, not on a cycle Antcolos invented. `event_driven` returns
 * nothing at all — inspections, violations and accidents are later milestones,
 * and guessing a date from a basis we cannot compute would be a lie.
 */
export function nextDueAt(
  renewal: ComplianceRenewalCycle,
  options: { satisfiedAt?: string; evidence?: ComplianceEvidenceRef },
): string | undefined {
  switch (renewal.basis) {
    case "none":
      return undefined;
    case "document_expiry":
      return options.evidence?.expiresAt;
    case "fixed_interval":
      if (!options.satisfiedAt || !renewal.intervalMonths) return undefined;
      return addMonths(options.satisfiedAt, renewal.intervalMonths);
    case "event_driven":
      return undefined;
  }
}

/** Evidence states that cannot satisfy anything. */
const UNSATISFYING = new Set<ComplianceEvidenceRef["state"]>([
  "missing", "rejected", "superseded",
]);

export interface StatusInput {
  renewal: ComplianceRenewalCycle;
  evidence?: ComplianceEvidenceRef;
  satisfiedAt?: string;
  dueAt?: string;
  /** Set when the subject is deliberately paused — suspended driver, unit out of service. */
  suspended?: boolean;
  suspendedReason?: string;
  /** Set when the requirement does not reach this subject at all. */
  notApplicableReason?: string;
}

export interface StatusResult {
  status: ComplianceStatus;
  reason?: string;
  dueAt?: string;
}

/**
 * The whole state machine, in one place.
 *
 * Order matters: "not applicable" beats everything (the rule never reached this
 * subject), then "suspended" (deliberately paused), then evidence problems,
 * then the clock.
 */
export function evaluateStatus(input: StatusInput, now = Date.now()): StatusResult {
  if (input.notApplicableReason) {
    return { status: "not_applicable", reason: input.notApplicableReason };
  }
  if (input.suspended) {
    return {
      status: "suspended",
      reason: input.suspendedReason ?? "Paused while the subject is not operating.",
      dueAt: input.dueAt,
    };
  }

  const evidence = input.evidence;
  const dueAt =
    input.dueAt ?? nextDueAt(input.renewal, { satisfiedAt: input.satisfiedAt, evidence });

  if (!evidence || UNSATISFYING.has(evidence.state)) {
    return {
      status: "action_required",
      reason:
        evidence?.state === "rejected"
          ? evidence.rejectionReason ?? "The evidence on file was rejected."
          : evidence?.state === "superseded"
            ? "The evidence on file was replaced and nothing has been accepted since."
            : "Nothing on file satisfies this requirement yet.",
      dueAt,
    };
  }

  if (evidence.state === "pending_review") {
    // Submitted is not satisfied. Somebody still has to accept it.
    return {
      status: "action_required",
      reason: "Evidence is submitted and waiting for review.",
      dueAt,
    };
  }

  if (!dueAt) {
    // A one-time requirement with accepted evidence never comes back round.
    return { status: "compliant" };
  }

  const remaining = daysUntil(dueAt, now);
  if (remaining < 0) {
    return { status: "expired", reason: `Lapsed ${Math.abs(remaining)} days ago.`, dueAt };
  }
  if (remaining <= input.renewal.warnWithinDays) {
    return {
      status: "expiring",
      reason: remaining === 0 ? "Due today." : `Due in ${remaining} days.`,
      dueAt,
    };
  }
  return { status: "compliant", dueAt };
}

/** Sort: worst status first, then severity, then the nearest deadline. */
export function complianceOrder(a: ComplianceRequirement, b: ComplianceRequirement): number {
  const byStatus = COMPLIANCE_STATUS_ORDER[a.status] - COMPLIANCE_STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  const bySeverity = COMPLIANCE_SEVERITY_ORDER[a.severity] - COMPLIANCE_SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const at = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  return a.label.localeCompare(b.label);
}

export function isOpen(status: ComplianceStatus): boolean {
  return status === "action_required" || status === "expiring" || status === "expired";
}

export function worstStatus(statuses: readonly ComplianceStatus[]): ComplianceStatus {
  if (statuses.length === 0) return "not_applicable";
  return [...statuses].sort(
    (a, b) => COMPLIANCE_STATUS_ORDER[a] - COMPLIANCE_STATUS_ORDER[b],
  )[0];
}

export function worstSeverity(
  severities: readonly ComplianceSeverity[],
): ComplianceSeverity | undefined {
  if (severities.length === 0) return undefined;
  return [...severities].sort(
    (a, b) => COMPLIANCE_SEVERITY_ORDER[a] - COMPLIANCE_SEVERITY_ORDER[b],
  )[0];
}

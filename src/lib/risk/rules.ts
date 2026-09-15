import type { RiskRule, RiskSignalKind } from "@/types";

/**
 * ★ MOCK RISK RULES ★
 *
 * Every rule below is a hand-written condition over the audit ledger. There is
 * no model, no score, no training data, no outside feed and no detection
 * engine. `mock: true` is on the type so a rule cannot exist without admitting
 * it, and every screen that shows a signal shows the rule's `limitations`
 * beside it.
 *
 * What these rules are FOR is proving the shape: that a signal points at audit
 * events rather than restating them, that severity is set by policy rather than
 * by whoever wrote the rule, and that a case can be worked without the rule
 * being any good. Replacing them later changes this file and nothing else.
 */
export const RISK_RULES: readonly RiskRule[] = [
  {
    id: "rule.permission_denied_burst",
    kind: "unauthorized_action",
    label: "Refused permission-sensitive actions",
    description:
      "A membership was refused a permission-sensitive action, or was refused several actions in a short run.",
    severity: "high",
    reads: ["access"],
    mock: true,
    limitations:
      "Counts refusals in the ledger. It cannot tell a person clicking the wrong thing from a person testing what they can reach.",
  },
  {
    id: "rule.cross_organization_attempt",
    kind: "cross_organization_access",
    label: "Cross-organization access attempt",
    description:
      "A record belonging to another organization was requested through this one.",
    severity: "critical",
    reads: ["access"],
    mock: true,
    limitations:
      "Only sees attempts that reached the service seam. A stale link or a bookmarked URL produces the same event as anything else.",
  },
  {
    id: "rule.control_record_changed",
    kind: "sensitive_record_change",
    label: "Ownership, Authority or signer changed",
    description:
      "Ownership, Operating Authority or the authorized signer moved. Always worth a second pair of eyes, whoever did it.",
    severity: "high",
    reads: ["organization"],
    mock: true,
    limitations:
      "Flags every such change, including entirely legitimate ones. It is a review prompt, not an accusation.",
  },
  {
    id: "rule.banking_details_changed",
    kind: "sensitive_record_change",
    label: "Banking or payout details changed",
    description:
      "Bank or payout details were changed. The values themselves are never in the ledger — only that they moved, and who moved them.",
    severity: "critical",
    reads: ["banking", "settlements"],
    mock: true,
    limitations:
      "Cannot verify the new details against anything. It knows a change happened and nothing about whether it was right.",
  },
  {
    id: "rule.duplicate_record",
    kind: "duplicate_or_conflict",
    label: "Duplicate or conflicting records",
    description:
      "Two documents, invoices, settlements, fuel transactions or claims that look like the same thing, or that disagree with each other.",
    severity: "medium",
    reads: ["documents", "invoices", "settlements", "fuel", "insurance"],
    mock: true,
    limitations:
      "Matches on the module's own duplicate marking and on repeated references in the ledger. It does no fuzzy matching and no content comparison.",
  },
  {
    id: "rule.suspicious_relationship_change",
    kind: "suspicious_change",
    label: "Relationship, contract, equipment or assignment change",
    description:
      "A relationship, contract, equipment record or assignment changed in a way worth reading back — an assignment reversed quickly, or a relationship ended and restarted.",
    severity: "medium",
    reads: ["organization", "fleet", "dispatch", "drivers"],
    mock: true,
    limitations:
      "Looks at timing and repetition in the ledger only. Ordinary operational churn will trip it.",
  },
  {
    id: "rule.repeated_rejection",
    kind: "repeated_rejection",
    label: "Repeated rejected uploads or corrections",
    description:
      "The same subject had several uploads rejected, or a run of corrections that is unusual for the record.",
    severity: "medium",
    reads: ["documents", "compliance", "fuel"],
    mock: true,
    limitations:
      "Counts rejections and corrections. A person struggling with a scanner and a person retrying until something passes look identical to it.",
  },
  {
    id: "rule.critical_inconsistency",
    kind: "critical_inconsistency",
    label: "Critical ELD, Maintenance, Insurance or Compliance inconsistency",
    description:
      "Two records that cannot both be true — equipment out of service and dispatched, or a policy lapsed while a load is running under it.",
    severity: "critical",
    reads: ["compliance", "maintenance", "insurance", "fleet"],
    mock: true,
    limitations:
      "Antcolos is connected to no ELD and to no insurer. This reads what is recorded in Antcolos, and nothing else.",
  },
] as const;

const BY_ID = new Map<string, RiskRule>(RISK_RULES.map((r) => [r.id, r]));

export function riskRule(id: string): RiskRule {
  const rule = BY_ID.get(id);
  if (!rule) throw new Error(`Unknown risk rule: ${id}`);
  return rule;
}

export function rulesForKind(kind: RiskSignalKind): RiskRule[] {
  return RISK_RULES.filter((r) => r.kind === kind);
}

/** Shown wherever signals are listed. Deliberately blunt. */
export const RISK_RULES_NOTICE =
  "These rules are mock rules, written by hand and evaluated over the audit ledger inside Antcolos. " +
  "There is no fraud model, no risk scoring, no identity verification and no connection to any outside monitoring service.";

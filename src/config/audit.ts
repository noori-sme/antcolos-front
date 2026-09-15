import type { badgeVariants } from "@/components/ui/badge";
import type {
  AuditEventSource, AuditOutcome, RiskCaseState, RiskCaseTimelineAction,
  RiskSeverity, RiskSignalKind, RiskSignalStatus,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

/**
 * How Audit & Risk reads on screen.
 *
 * Tones are chosen so nothing overstates itself: an inferred event and a
 * dismissed signal are NEUTRAL, because neither is a finding, and a critical
 * severity is the only thing that gets the loudest colour in the system.
 */

export const AUDIT_SOURCE_TONE: Record<AuditEventSource, Tone> = {
  human: "info",
  system: "neutral",
  integration: "progress",
  imported: "progress",
  // An inference is not an observation. It never gets a colour that reads as
  // confirmation.
  inferred: "outline",
};

export const AUDIT_OUTCOME_TONE: Record<AuditOutcome, Tone> = {
  succeeded: "neutral",
  denied: "warning",
  failed: "danger",
};

export const RISK_SEVERITY_TONE: Record<RiskSeverity, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "progress",
  low: "info",
  informational: "neutral",
};

export const RISK_SEVERITY_DESCRIPTION: Record<RiskSeverity, string> = {
  critical: "Somebody has to look at this now.",
  high: "Somebody has to look at this, and be given it by name.",
  medium: "Worth reading back when there is time.",
  low: "Recorded so a pattern would be visible later.",
  informational: "Noted. No concern is being claimed.",
};

export const RISK_CASE_STATE_TONE: Record<RiskCaseState, Tone> = {
  open: "info",
  investigating: "progress",
  action_required: "warning",
  escalated: "danger",
  resolved: "success",
  // Accepting a risk is a decision, not a clean bill of health, so it is not
  // shown in the same green as "resolved".
  accepted_risk: "outline",
  dismissed: "neutral",
};

export const RISK_CASE_STATE_DESCRIPTION: Record<RiskCaseState, string> = {
  open: "Raised. Nobody has started on it.",
  investigating: "Somebody is looking into it.",
  action_required: "Something has to change before this can close.",
  escalated: "Handed up. Somebody more senior is deciding.",
  resolved: "It was a problem, and it was dealt with.",
  accepted_risk: "It was a problem, and somebody decided to live with it.",
  dismissed: "It turned out not to be a problem.",
};

export const RISK_SIGNAL_STATUS_LABEL: Record<RiskSignalStatus, string> = {
  new: "Not yet looked at",
  linked: "In a case",
  dismissed: "Dismissed",
};

export const RISK_SIGNAL_STATUS_TONE: Record<RiskSignalStatus, Tone> = {
  new: "warning",
  linked: "progress",
  dismissed: "neutral",
};

export const RISK_SIGNAL_KIND_DESCRIPTION: Record<RiskSignalKind, string> = {
  unauthorized_action: "Somebody was refused something the permission system protects.",
  sensitive_record_change: "Ownership, Operating Authority, a signer, banking or payout details moved.",
  duplicate_or_conflict: "Two records that should not both exist, or that disagree.",
  suspicious_change: "A relationship, contract, equipment record or assignment that changed oddly.",
  repeated_rejection: "Several rejected uploads, or an unusual run of corrections.",
  cross_organization_access: "A record belonging to another organization was requested through this one.",
  critical_inconsistency: "Two records in Antcolos that cannot both be true.",
};

export const RISK_TIMELINE_ACTION_LABEL: Record<RiskCaseTimelineAction, string> = {
  opened: "Case opened",
  signal_linked: "Signal linked",
  signal_unlinked: "Signal unlinked",
  assigned: "Assigned",
  unassigned: "Responsibility cleared",
  due_date_set: "Due date set",
  due_date_cleared: "Due date cleared",
  note_added: "Note added",
  evidence_added: "Evidence attached",
  decision_recorded: "Decision recorded",
  state_changed: "State changed",
  reopened: "Reopened",
};

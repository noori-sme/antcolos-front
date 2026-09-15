import type { RiskExtensionPoint } from "@/types";

/**
 * The seams later milestones land in.
 *
 * Security monitoring, fraud detection, identity verification, legal holds,
 * retention policies and outside compliance tools are NOT built and NOT
 * connected. They are declared here so that when they land they extend this
 * module — reading the one ledger, raising signals through the one signal type,
 * working through the one case model — instead of growing a second audit system
 * beside it.
 *
 * `available` is `false` on every entry, and the screens render them as "not
 * built yet" rather than as an empty count. A panel reading "0 fraud alerts"
 * means Antcolos looked and found none. Antcolos has not looked.
 */
export const RISK_EXTENSION_POINTS: readonly RiskExtensionPoint[] = [
  {
    kind: "security_monitoring",
    label: "Security monitoring",
    description:
      "Continuous watching of sign-ins, sessions, devices and unusual access patterns, with alerting.",
    available: false,
    consumes: ["access", "organization"],
    wouldAdd:
      "A monitor that raises signals without a person reading the ledger, plus session and device records the ledger does not hold today.",
  },
  {
    kind: "fraud_detection",
    label: "Fraud detection",
    description:
      "Scoring and pattern detection over payments, settlements, fuel and documents.",
    available: false,
    consumes: ["banking", "settlements", "invoices", "fuel", "documents"],
    wouldAdd:
      "A scored assessment beside each signal. Nothing in Antcolos scores anything today, and no screen shows a score.",
  },
  {
    kind: "identity_verification",
    label: "Identity verification",
    description:
      "Checking that a person or a business is who they say they are, against a source that can actually answer.",
    available: false,
    consumes: ["access", "directory", "compliance"],
    wouldAdd:
      "A verification result on a membership or a party. Today Antcolos records what was typed in and verifies nothing.",
  },
  {
    kind: "legal_hold",
    label: "Legal holds",
    description:
      "Marking records as preserved for a dispute or an investigation, and blocking the things that would otherwise close them.",
    available: false,
    consumes: ["documents", "settlements", "invoices", "loads", "insurance"],
    wouldAdd:
      "A hold record with its own scope and lifecycle. The ledger is already append-only; a hold is about the CANONICAL records, which this module does not own.",
  },
  {
    kind: "retention_policy",
    label: "Retention policies",
    description:
      "How long each kind of record is kept, and what happens at the end of it.",
    available: false,
    consumes: ["documents", "loads", "settlements", "invoices", "compliance"],
    wouldAdd:
      "Policy records and a scheduled sweep. Nothing in Antcolos expires or deletes anything today.",
  },
  {
    kind: "external_compliance",
    label: "External compliance tools",
    description:
      "Sending evidence to, or reading findings from, an outside compliance or audit service.",
    available: false,
    consumes: ["compliance", "documents", "insurance", "maintenance"],
    wouldAdd:
      "An integration port with its own provenance, like every other outside system. Antcolos is connected to none of them, and this module claims no certification of any kind.",
  },
] as const;

/**
 * Shown at the top of the Audit & Risk area. Says what this module is not, in
 * the words somebody would otherwise assume.
 */
export const RISK_SCOPE_NOTICE =
  "Antcolos records what happened inside Antcolos. This is not a SIEM, not a legal case-management system, " +
  "not an automated enforcement engine and not tamper-proof legal evidence. Nothing here is certified by anybody, " +
  "and Antcolos is not connected to any outside security, fraud, identity or compliance service.";

import type {
  CertificateOfInsurance, InsuranceAgent, InsuranceClaim, InsuranceCoverage,
  InsurancePolicy, InsurerVerification, IsoDateTime, Money,
} from "@/types";

/**
 * ███ NOTHING HERE IS CONNECTED ███
 *
 * The typed seams the later insurance milestones attach to. Every adapter is
 * declared, none is implemented, and the only implementation shipped throws.
 *
 * Declaring them now is not speculation — it is the opposite. Each one marks a
 * place where the foundation would otherwise be tempted to fake an answer: a
 * screen that says "verified" because a field defaulted to true, a claim that
 * looks submitted because a status was set by hand, a premium that looks paid
 * because a date was filled in. With the seam present and visibly throwing,
 * the honest state is the only state the product can reach.
 *
 * The rule for anyone implementing one: the adapter returns what the outside
 * system actually said, and the service layer records it as an event. No
 * adapter may write directly into the registry.
 */

export type IntegrationKind =
  | "insurer_directory"
  | "agent_directory"
  | "claims_processing"
  | "payments"
  | "document_ocr"
  | "telematics"
  | "external_reporting";

export class IntegrationNotConnectedError extends Error {
  constructor(readonly integration: IntegrationKind, readonly operation: string) {
    super(
      `${integration}.${operation} is not connected. Antcolos has no live link to this system, and this build never pretends otherwise.`,
    );
    this.name = "IntegrationNotConnectedError";
  }
}

const unavailable = (integration: IntegrationKind, operation: string) => (): never => {
  throw new IntegrationNotConnectedError(integration, operation);
};

/* -------------------------------------------------------------------------- */
/* Insurers and agents                                                         */
/* -------------------------------------------------------------------------- */

export interface InsurerSearchResult {
  name: string;
  naicCode?: string;
  /** What the directory says about the insurer's standing. Never inferred. */
  admitted?: boolean;
  states?: string[];
}

/**
 * Looking up an insurer and confirming a policy really exists with them.
 *
 * `verifyPolicy` is the one that matters: until it is connected, every policy
 * in Antcolos is what somebody typed, and the interface says so by returning
 * an `InsurerVerification` rather than a boolean.
 */
export interface InsurerDirectoryAdapter {
  search(query: string): Promise<InsurerSearchResult[]>;
  verifyPolicy(input: {
    insurerName: string;
    policyNumber: string;
    asOf: IsoDateTime;
  }): Promise<InsurerVerification>;
}

export interface AgentDirectoryAdapter {
  search(query: string): Promise<InsuranceAgent[]>;
  /** Ask the agent of record for the current declarations page. */
  requestDeclarations(policy: InsurancePolicy): Promise<{ requestedAt: IsoDateTime }>;
}

/* -------------------------------------------------------------------------- */
/* Claims processing                                                           */
/* -------------------------------------------------------------------------- */

export type ExternalClaimState =
  | "not_submitted" | "queued" | "received" | "acknowledged" | "rejected";

export interface ExternalClaimReceipt {
  state: ExternalClaimState;
  insurerClaimNumber?: string;
  receivedAt?: IsoDateTime;
  message?: string;
}

/**
 * Filing a claim with the insurer, and hearing back.
 *
 * Note what is missing: there is no `approve` and no `deny`. Those are the
 * insurer's decisions, and Antcolos can only ever record that it was told
 * about them.
 */
export interface ClaimsProcessingAdapter {
  submit(claim: InsuranceClaim): Promise<ExternalClaimReceipt>;
  poll(claim: InsuranceClaim): Promise<ExternalClaimReceipt>;
  /** Push a piece of evidence to an open external claim. */
  attachEvidence(
    claim: InsuranceClaim,
    input: { evidenceId: string; documentId?: string },
  ): Promise<{ acceptedAt: IsoDateTime }>;
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Premium and deductible movement.
 *
 * Out of scope for this milestone and for the next one: premium accounting and
 * insurance payments are their own project. The seam exists so that when a cost
 * line says "paid", there is somewhere for that fact to have come from other
 * than a checkbox.
 */
export interface InsurancePaymentsAdapter {
  recordPremiumPayment(input: {
    policyId: string;
    amount: Money;
    paidAt: IsoDateTime;
    reference?: string;
  }): Promise<{ confirmationId: string }>;
  recordDeductiblePayment(input: {
    claimId: string;
    amount: Money;
    paidAt: IsoDateTime;
  }): Promise<{ confirmationId: string }>;
  /** What the insurer says is outstanding. Never computed locally. */
  outstandingBalance(policyId: string): Promise<Money>;
}

/* -------------------------------------------------------------------------- */
/* Reading documents                                                           */
/* -------------------------------------------------------------------------- */

export interface ExtractedPolicyFields {
  policyNumber?: string;
  insurerName?: string;
  effectiveFrom?: IsoDateTime;
  expiresAt?: IsoDateTime;
  coverages?: Array<Pick<InsuranceCoverage, "coverageType" | "limitPerOccurrence" | "deductible">>;
  /** 0-1 per field. A low score must reach a human, never a database. */
  confidence: Record<string, number>;
}

/**
 * Reading a declarations page or a certificate.
 *
 * Extraction proposes; a person accepts. The adapter deliberately returns
 * fields plus confidence rather than a finished record, so nothing can be
 * written into a policy without somebody having looked at it.
 */
export interface InsuranceOcrAdapter {
  readDeclarations(input: { documentId: string }): Promise<ExtractedPolicyFields>;
  readCertificate(input: { documentId: string }): Promise<Partial<CertificateOfInsurance> & {
    confidence: Record<string, number>;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Telematics                                                                  */
/* -------------------------------------------------------------------------- */

export interface TelematicsIncidentWindow {
  truckId: string;
  from: IsoDateTime;
  to: IsoDateTime;
}

export interface TelematicsIncidentEvidence {
  recordedAt: IsoDateTime;
  /** Harsh braking, collision detection, speed and position around the event. */
  signals: Array<{ at: IsoDateTime; kind: string; value: number; unit: string }>;
  videoAvailable: boolean;
}

/** Pulling the vehicle's own account of an event, to attach to a claim. */
export interface TelematicsAdapter {
  incidentEvidence(window: TelematicsIncidentWindow): Promise<TelematicsIncidentEvidence>;
}

/* -------------------------------------------------------------------------- */
/* External reporting                                                          */
/* -------------------------------------------------------------------------- */

export type ReportingAuthority = "fmcsa" | "state_dot" | "police" | "other";

export interface ExternalReportReceipt {
  authority: ReportingAuthority;
  submittedAt: IsoDateTime;
  reference: string;
}

/**
 * Accident reporting to a government body.
 *
 * The highest-consequence seam in the file: an unconnected adapter that
 * silently "succeeded" would let a carrier believe a reportable accident had
 * been reported. It throws, loudly, and the UI never claims otherwise.
 */
export interface ExternalReportingAdapter {
  isReportable(claim: InsuranceClaim): Promise<{ reportable: boolean; reason: string }>;
  submitReport(
    claim: InsuranceClaim,
    authority: ReportingAuthority,
  ): Promise<ExternalReportReceipt>;
}

/* -------------------------------------------------------------------------- */
/* The registry the UI reads                                                   */
/* -------------------------------------------------------------------------- */

export const notConnectedInsurerDirectory: InsurerDirectoryAdapter = {
  search: unavailable("insurer_directory", "search"),
  verifyPolicy: unavailable("insurer_directory", "verifyPolicy"),
};

export const notConnectedAgentDirectory: AgentDirectoryAdapter = {
  search: unavailable("agent_directory", "search"),
  requestDeclarations: unavailable("agent_directory", "requestDeclarations"),
};

export const notConnectedClaimsProcessing: ClaimsProcessingAdapter = {
  submit: unavailable("claims_processing", "submit"),
  poll: unavailable("claims_processing", "poll"),
  attachEvidence: unavailable("claims_processing", "attachEvidence"),
};

export const notConnectedPayments: InsurancePaymentsAdapter = {
  recordPremiumPayment: unavailable("payments", "recordPremiumPayment"),
  recordDeductiblePayment: unavailable("payments", "recordDeductiblePayment"),
  outstandingBalance: unavailable("payments", "outstandingBalance"),
};

export const notConnectedOcr: InsuranceOcrAdapter = {
  readDeclarations: unavailable("document_ocr", "readDeclarations"),
  readCertificate: unavailable("document_ocr", "readCertificate"),
};

export const notConnectedTelematics: TelematicsAdapter = {
  incidentEvidence: unavailable("telematics", "incidentEvidence"),
};

export const notConnectedExternalReporting: ExternalReportingAdapter = {
  isReportable: unavailable("external_reporting", "isReportable"),
  submitReport: unavailable("external_reporting", "submitReport"),
};

export interface InsuranceAdapters {
  insurerDirectory: InsurerDirectoryAdapter;
  agentDirectory: AgentDirectoryAdapter;
  claimsProcessing: ClaimsProcessingAdapter;
  payments: InsurancePaymentsAdapter;
  ocr: InsuranceOcrAdapter;
  telematics: TelematicsAdapter;
  externalReporting: ExternalReportingAdapter;
}

/** The only wiring that exists. Replacing an entry is how one gets connected. */
export const insuranceAdapters: InsuranceAdapters = {
  insurerDirectory: notConnectedInsurerDirectory,
  agentDirectory: notConnectedAgentDirectory,
  claimsProcessing: notConnectedClaimsProcessing,
  payments: notConnectedPayments,
  ocr: notConnectedOcr,
  telematics: notConnectedTelematics,
  externalReporting: notConnectedExternalReporting,
};

/**
 * What the Insurance screens tell the operator about each seam.
 *
 * Read by the dashboard so the honest "not connected" message is data, not a
 * sentence typed into a component that somebody later forgets to change.
 */
export interface IntegrationStatus {
  kind: IntegrationKind;
  label: string;
  /** What it will do, once something is behind it. */
  description: string;
  connected: false;
  /** What Antcolos does instead, today. */
  today: string;
}

export const INSURANCE_INTEGRATIONS: readonly IntegrationStatus[] = [
  {
    kind: "insurer_directory", label: "Insurer verification", connected: false,
    description: "Confirm a policy exists and is in force with the insurer of record.",
    today: "Policies show exactly what your team typed in. Nothing has been confirmed with an insurer.",
  },
  {
    kind: "agent_directory", label: "Agent of record", connected: false,
    description: "Look up your agent and request a current declarations page.",
    today: "Agent details are recorded by hand and nothing is sent to them.",
  },
  {
    kind: "claims_processing", label: "Claim submission", connected: false,
    description: "File a claim with the insurer and track what they send back.",
    today: "Marking a claim submitted records that your team submitted it. Antcolos sent nothing.",
  },
  {
    kind: "payments", label: "Premium and deductible payments", connected: false,
    description: "Record premium payments and deductible settlements against the policy.",
    today: "Cost lines record what your team says was paid. No money moves through Antcolos.",
  },
  {
    kind: "document_ocr", label: "Document reading", connected: false,
    description: "Read declarations pages and certificates instead of keying them in.",
    today: "Files are named and sized by the browser. Nothing is uploaded, stored or read.",
  },
  {
    kind: "telematics", label: "Telematics evidence", connected: false,
    description: "Pull the vehicle's own record of an incident onto the claim.",
    today: "Telematics evidence is attached by hand, if at all.",
  },
  {
    kind: "external_reporting", label: "Government reporting", connected: false,
    description: "Work out whether an accident is reportable and file it.",
    today: "Antcolos does not decide reportability and has reported nothing to any authority.",
  },
] as const;

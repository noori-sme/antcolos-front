import type {
  ActorRef, ExtractedField, Provenance, RateConfirmationFact,
  RateConfirmationRecord, RateConWorkflow,
} from "@/types";
import { ambientCorrelationId } from "@/lib/audit/correlation";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The canonical Rate Confirmation records: committed once, never edited.
 *
 * `RateConWorkflow` is the canonical source DURING review. It is mutable by
 * design — that is what a review is — and downstream modules must never read it,
 * because "the rate on this load" cannot be a field somebody is still editing.
 *
 * At the single moment all four gates are true (every required field reviewed,
 * Dispatch approved, the authorized carrier signature applied, the signed copy
 * confirmed as returned to the broker) the workflow is FROZEN into one of these
 * and that is what the rest of Antcolos reads.
 *
 * Immutability is the whole contract:
 *  - Nothing in this file mutates a committed record. There is no setter.
 *  - A broker amendment commits a NEW record at `version + 1` pointing back at
 *    the one it supersedes, and both survive. So "finalize the load exactly
 *    once" and "a broker can amend" are not in tension: the amendment is a
 *    second fact, not an overwrite of the first.
 *  - Every field keeps what the document said BESIDE what a person confirmed,
 *    so a dispute a year later is argued from the record instead of memory.
 *
 * ███ NOT PERSISTED, NOT SIGNED ███
 * The signature is a name on a line, not a credential. The document was drawn by
 * `ratecon-document.ts`, not received. Nothing left this machine.
 */

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface RecordState {
  /** rateConfirmationId → the record. Frozen on the way in. */
  byId: Map<string, RateConfirmationRecord>;
  /** loadId → every version, oldest first. */
  byLoad: Map<string, RateConfirmationRecord[]>;
  /** idempotency key → rateConfirmationId, so a retried commit writes once. */
  byKey: Map<string, string>;
}

let state: RecordState | null = null;

function db(): RecordState {
  if (!state) state = { byId: new Map(), byLoad: new Map(), byKey: new Map() };
  return state;
}

/** Test hook. Never called by the UI. */
export function resetRateConfirmationRecords() {
  state = null;
}

/**
 * RFC-4122-shaped v4 identifier.
 *
 * A committed rate confirmation is referenced by the invoice, the settlement and
 * the audit ledger for the life of the load, so it gets a real UUID rather than
 * a sequence number that leaks how many the system has ever seen.
 */
function uuid(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* -------------------------------------------------------------------------- */
/* Committing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One reviewed field, frozen.
 *
 * `verification` is derived from the review status rather than passed in, so a
 * field nobody looked at cannot arrive here calling itself confirmed.
 */
function factOf(field: ExtractedField): RateConfirmationFact {
  return {
    key: field.key,
    label: field.label,
    // The raw OCR text, exactly as read. Never edited, at any point.
    extractedValue: field.rawText,
    confirmedValue: field.correctedValue ?? field.value,
    correctedValue: field.correctedValue,
    correctionNote: field.correctionNote,
    confidence: field.confidence,
    verification: field.status === "corrected"
      ? "corrected"
      : field.status === "verified"
        ? "confirmed"
        : "extracted",
    expected: field.expected,
    disagreed: field.disagrees,
    blockId: field.blockId,
    reviewedByName: field.reviewedByName,
    reviewedAt: field.reviewedAt,
  };
}

const RATECON_PROVENANCE = (at: string): Provenance => ({
  module: "rate_confirmation",
  adapter: "mock:rate-confirmation",
  mock: true,
  observedAt: at,
  receivedAt: nowIso(),
});

export interface CommitOutcome {
  record: RateConfirmationRecord;
  /** True when this workflow had already been committed. Nothing was written. */
  duplicate: boolean;
}

/**
 * Freeze a signed, returned workflow into the canonical record.
 *
 * Refuses rather than committing a half-finished one. The four checks below are
 * the same gates `progressOf` and `confirmAndSign` enforce; duplicating them
 * here is deliberate, because this function is what every downstream module
 * ultimately trusts and it must not be trustworthy only when called correctly.
 */
export function commitRateConfirmation(input: {
  workflow: RateConWorkflow;
  actor: ActorRef;
  membershipId: string;
  /** Set when this supersedes an earlier committed version. */
  supersedes?: RateConfirmationRecord;
  channel?: "email" | "portal" | "fax";
  correlationId?: string;
}): CommitOutcome {
  const { workflow } = input;

  if (!workflow.signed?.signature) {
    throw new Error("A rate confirmation cannot be committed before it is signed.");
  }
  if (workflow.status !== "returned") {
    throw new Error("A rate confirmation cannot be committed before it goes back to the broker.");
  }
  const unreviewed = workflow.fields.filter((f) => f.required && f.status === "unreviewed");
  if (unreviewed.length > 0) {
    throw new Error(
      `${unreviewed.length} required field${unreviewed.length === 1 ? "" : "s"} were never looked at.`,
    );
  }

  const ledger = db();
  const key = `ratecon-commit:${workflow.rateConId}:${workflow.signed.documentId}`;
  const seen = ledger.byKey.get(key);
  if (seen) {
    const existing = ledger.byId.get(seen);
    if (existing) return { record: existing, duplicate: true };
  }

  const at = workflow.confirmedAt ?? nowIso();
  const versions = ledger.byLoad.get(workflow.loadId) ?? [];
  const version = (input.supersedes?.version ?? versions.at(-1)?.version ?? 0) + 1;

  const record: RateConfirmationRecord = Object.freeze({
    rateConfirmationId: uuid(),
    version,
    supersedesRateConfirmationId: input.supersedes?.rateConfirmationId
      ?? versions.at(-1)?.rateConfirmationId,
    organizationId: workflow.organizationId,
    carrierOrganizationId: workflow.carrierOrganizationId,
    carrierName: workflow.carrierName,
    loadId: workflow.loadId,
    loadReference: workflow.loadReference,
    customerReference: workflow.fields.find((f) => f.key === "load_reference")
      ? (workflow.fields.find((f) => f.key === "load_reference")!.correctedValue
        ?? workflow.fields.find((f) => f.key === "load_reference")!.value)
      : undefined,
    brokerName: workflow.brokerName,
    workflowId: workflow.rateConId,
    originalDocumentId: workflow.original.documentId,
    signedDocumentId: workflow.signed.documentId,
    signature: workflow.signed.signature,
    returnedToBroker: {
      at,
      channel: input.channel ?? "email",
      messageId: workflow.returnMessageId,
    },
    facts: Object.freeze(workflow.fields.map(factOf)) as RateConfirmationFact[],
    committedAt: at,
    committedByName: input.actor.displayNameSnapshot,
    committedByMembershipId: input.membershipId,
    correlationId: input.correlationId ?? ambientCorrelationId(),
    idempotencyKey: key,
    provenance: RATECON_PROVENANCE(at),
  }) as RateConfirmationRecord;

  ledger.byId.set(record.rateConfirmationId, record);
  ledger.byLoad.set(workflow.loadId, [...versions, record]);
  ledger.byKey.set(key, record.rateConfirmationId);

  return { record, duplicate: false };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The rate confirmation in force for a load: the newest committed version.
 *
 * This is what every downstream module reads. It is `undefined` for a load whose
 * confirmation has not been signed and returned, and that absence is a
 * first-class answer — an unfinalized load has no agreed rate, which is exactly
 * what the invoice readiness check needs to be able to say.
 */
export function rateConfirmationForLoad(
  organizationId: string,
  loadId: string,
): RateConfirmationRecord | undefined {
  const versions = db().byLoad.get(loadId);
  const current = versions?.at(-1);
  if (!current) return undefined;
  // Scoped like every other read in this layer. A record from another
  // organization is absent, never forbidden.
  return current.organizationId === organizationId ? current : undefined;
}

/** Every committed version for a load, oldest first. Nothing is ever removed. */
export function rateConfirmationVersions(
  organizationId: string,
  loadId: string,
): RateConfirmationRecord[] {
  return (db().byLoad.get(loadId) ?? []).filter(
    (r) => r.organizationId === organizationId,
  );
}

export function rateConfirmationRecordById(
  organizationId: string,
  rateConfirmationId: string,
): RateConfirmationRecord | undefined {
  const record = db().byId.get(rateConfirmationId);
  if (!record) return undefined;
  return record.organizationId === organizationId ? record : undefined;
}

/** Whether a load has a committed, signed, returned rate confirmation. */
export function isLoadFinalized(organizationId: string, loadId: string): boolean {
  return rateConfirmationForLoad(organizationId, loadId) !== undefined;
}

/** Test seam only. */
export function committedRecordsForTests(): RateConfirmationRecord[] {
  return [...db().byId.values()];
}

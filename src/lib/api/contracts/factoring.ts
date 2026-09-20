import type {
  BrokerFactorabilityCheck, FactoringBookingGate, FactoringCheckPolicy,
  FactoringConnection, FactoringConnectionMode, FactoringFallbackPrefill,
  FactoringImportBatch, FactoringImportPreview, FactoringImportResult,
  FactoringImportRow, FactoringImportRowInput, FactoringOverride,
  FactoringProviderKind, FactoringStatusView, RecordFactoringResultInput,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE FACTORING SEAM ★
 *
 * Will this carrier's factor buy the invoice on this broker?
 *
 * ███ NOTHING BEHIND THIS INTERFACE CONTACTS A FACTORING COMPANY ███
 *
 * Antcolos has no confirmed production API access from OTR, RTS or anybody
 * else. Every method below is implemented today by a mock adapter over an
 * in-memory store, and every result it returns carries a `source` saying which
 * of the five honest origins it came from. `live_api` is reserved and nothing
 * in this build produces one.
 *
 * ★ WHAT A BACKEND IMPLEMENTING THIS OWES ★
 *
 *  - Provider authorization lives on the SERVER. No method here takes a
 *    credential, and none may be added: a browser must never hold a carrier's
 *    factoring token, portal password or session.
 *  - Encryption at rest for credit limits, rejection reasons and account
 *    references. They are a carrier's banking relationship, not metadata.
 *  - Durable storage with the same append-only rule this mock keeps: a newer
 *    answer supersedes an older one and neither is edited.
 *  - Server-side enforcement of every permission and of the carrier boundary.
 *    The checks in the mock are user experience; they are not security.
 *  - Audit retention for override events, which is the one record of a person
 *    deciding to take a risk the organization's own policy refused.
 *  - Provider-specific rate limiting. A credit check costs the carrier
 *    something with most factors, and a search screen that checked every load
 *    on every keystroke would spend it.
 *
 * ★ WHAT IS EXCLUDED, PERMANENTLY ★
 * Portal scraping, headless-browser automation, CAPTCHA handling and storing a
 * carrier's factoring login. Those are not unimplemented; they are not going to
 * be implemented.
 *
 * ★ THE ONE RULE THE WHOLE INTERFACE IS SHAPED AROUND ★
 * Every method takes a `carrierOrganizationId`. A factoring answer belongs to
 * one carrier's arrangement with one factor, and there is deliberately no read
 * here that returns results for more than one carrier at a time — so Carrier
 * A's approval cannot reach Carrier B through any call on this seam.
 */

export interface FactoringSubjectInput {
  carrierOrganizationId: string;
  brokerNameObserved: string;
  /** As printed. Normalized on the way in. The only deciding identifier. */
  brokerMcNumber?: string;
  brokerPartyId?: string;
  /** Only where the caller has an amount. Never a placeholder. */
  proposedAmountCents?: number;
  dispatchCycleId?: string;
  listingId?: string;
  loadId?: string;
}

export interface ConnectFactoringInput {
  carrierOrganizationId: string;
  providerKind: FactoringProviderKind;
  providerName?: string;
  accountLabel: string;
  /** The factor's client number. There is no field for a password. */
  accountReference?: string;
  mode: FactoringConnectionMode;
  fallback?: FactoringConnection["fallback"];
}

export interface FactoringOverrideInput {
  carrierOrganizationId: string;
  /** Required, non-empty. An override with no reason is not recorded at all. */
  reason: string;
  dispatchCycleId?: string;
  listingId?: string;
  brokerNameObserved: string;
  brokerMcNumber?: string;
  brokerPartyId?: string;
  proposedAmountCents?: number;
}

export interface StageFactoringImportInput {
  carrierOrganizationId: string;
  label: string;
  /** Already parsed. This seam takes rows, not a file. */
  rows: FactoringImportRowInput[];
}

export interface FactoringService {
  /* -- Connection and policy --------------------------------------------- */

  /**
   * The carrier's factoring account, or nothing.
   *
   * Requires `factoring:view` and authority over the carrier. A dispatch
   * organization reaches only the carriers that granted it dispatch authority;
   * anything else is `NotFoundError`, not a refusal, so a URL cannot be used to
   * find out who a competitor factors with.
   */
  connection(
    ctx: ServiceContext, carrierOrganizationId: string,
  ): Promise<FactoringConnection | undefined>;

  /**
   * Connect or re-point the carrier's factoring account.
   *
   * Requires `factoring:manage`, IN THE CARRIER'S OWN ORGANIZATION. A carrier
   * that has handed its trucks to a dispatch agency has delegated dispatch, not
   * its banking, so a delegate is refused however much it holds.
   */
  connect(ctx: ServiceContext, input: ConnectFactoringInput): Promise<FactoringConnection>;

  /** Ends the arrangement. Keeps every answer it ever produced. */
  disconnect(ctx: ServiceContext, carrierOrganizationId: string): Promise<void>;

  policy(ctx: ServiceContext, carrierOrganizationId: string): Promise<FactoringCheckPolicy>;

  /** Requires `factoring:manage` in the carrier's own organization. */
  setPolicy(
    ctx: ServiceContext,
    carrierOrganizationId: string,
    patch: Partial<Omit<FactoringCheckPolicy, "carrierOrganizationId" | "updatedAt" | "updatedBy">>,
  ): Promise<FactoringCheckPolicy>;

  /* -- Reading a status --------------------------------------------------- */

  /**
   * The answer as of NOW, with expiry applied at read time.
   *
   * Requires `factoring:view`. Never throws for "no answer": `unknown`,
   * `stale`, `not_connected` and `provider_unavailable` are results, and none
   * of them is ever returned as `rejected`.
   */
  status(ctx: ServiceContext, input: FactoringSubjectInput): Promise<FactoringStatusView>;

  /** The same, for a page of search results. One carrier, many brokers. */
  statuses(
    ctx: ServiceContext, inputs: FactoringSubjectInput[],
  ): Promise<FactoringStatusView[]>;

  /** Every answer this carrier holds about one broker, newest first. */
  history(
    ctx: ServiceContext, input: FactoringSubjectInput,
  ): Promise<BrokerFactorabilityCheck[]>;

  /* -- Getting an answer -------------------------------------------------- */

  /**
   * Run a check through the carrier's adapter.
   *
   * Requires `factoring:check`. In a mode with no adapter — import, email,
   * manual — this does NOT invent an attempt: it returns the current status
   * unchanged, and the caller offers the fallback workflow instead.
   */
  check(ctx: ServiceContext, input: FactoringSubjectInput): Promise<FactoringStatusView>;

  /**
   * Everything Antcolos already knows, for the fallback panel.
   *
   * Read-only. Building a prefill records nothing and decides nothing.
   */
  fallbackPrefill(
    ctx: ServiceContext, input: FactoringSubjectInput,
  ): Promise<FactoringFallbackPrefill>;

  /**
   * Write down what the factor actually said.
   *
   * Requires `factoring:check`. Idempotent on `idempotencyKey`. The result is
   * labelled with its source — recorded email, portal check, phone — and is
   * never presented as a live API response.
   */
  recordResult(
    ctx: ServiceContext, input: RecordFactoringResultInput,
  ): Promise<BrokerFactorabilityCheck>;

  /* -- Booking ------------------------------------------------------------ */

  /**
   * Evaluate the carrier's policy against the current answer.
   *
   * Rechecks through the adapter first where one exists, and says honestly in
   * `recheckNote` when no live recheck happened.
   */
  evaluateBooking(
    ctx: ServiceContext, input: FactoringSubjectInput,
  ): Promise<FactoringBookingGate>;

  /**
   * Book past a block, on the record.
   *
   * Requires `factoring:override` AND the carrier's policy permitting one AND a
   * non-empty reason. Writes exactly one audit event, which nothing can edit or
   * remove.
   */
  override(ctx: ServiceContext, input: FactoringOverrideInput): Promise<FactoringOverride>;

  /* -- Import ------------------------------------------------------------- */

  /** What the file would do. Writes no decision. Requires `factoring:manage`. */
  previewImport(
    ctx: ServiceContext, input: StageFactoringImportInput,
  ): Promise<FactoringImportPreview>;

  /**
   * Write the rows that are ready.
   *
   * Idempotent and resumable: a row already committed produces nothing, so a
   * commit interrupted halfway is finished by calling this again.
   */
  commitImport(ctx: ServiceContext, batchId: string): Promise<FactoringImportResult>;

  importBatches(
    ctx: ServiceContext, carrierOrganizationId: string,
  ): Promise<FactoringImportBatch[]>;

  importRows(ctx: ServiceContext, batchId: string): Promise<FactoringImportRow[]>;
}

/**
 * Refused because the organization's own policy does not permit an override.
 *
 * Thrown rather than returned so a caller cannot mistake a refused override for
 * a recorded one — the whole value of the gate is that nothing proceeds quietly.
 */
export class FactoringOverrideNotPermittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactoringOverrideNotPermittedError";
  }
}

/** An override with no reason. Never stored, never partially applied. */
export class FactoringReasonRequiredError extends Error {
  constructor() {
    super("An override needs a reason.");
    this.name = "FactoringReasonRequiredError";
  }
}

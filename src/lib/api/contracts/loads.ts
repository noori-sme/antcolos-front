import type {
  Assignment, ConsentRequirement, Document, EquipmentType, Load,
  LoadDocumentRequirement, LoadEvent, LoadStatus, Page, PageRequest,
  RateConfirmationRecord, Stop,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE ONE PLACE A CANONICAL LOAD IS WRITTEN ★
 *
 * Reads plus a NARROW, named set of commands. It used to be reads only, on the
 * grounds that the backend had not defined the mutation rules — and the
 * consequence was that two modules reached around it and mutated the record in
 * place: the booking flow pushed a `Load` straight onto the store, and the rate
 * confirmation flow wrote the confirmed rate, the facilities, the appointments
 * and the status directly onto the object.
 *
 * So the commands exist now, and they are the only way in. Each one:
 *
 *  1. checks the caller's permissions at this seam, not in the UI;
 *  2. is IDEMPOTENT on a caller-supplied key, so a double-tapped Save or a
 *     retried call produces one load and one timeline entry;
 *  3. appends to the append-only `LoadEvent` timeline rather than only setting
 *     `status` — the timeline is the record and `status` is derived from it;
 *  4. keeps provenance: which module asked, under whose authority, and the
 *     correlation id joining it to everything else that one intent produced;
 *  5. publishes to the central propagation layer where a fact changed that other
 *     modules must follow, instead of writing into their records itself.
 *
 * What is still deliberately absent: anything that edits history, anything that
 * moves a load backwards through its lifecycle, and any command whose rules
 * belong to another module (assigning a driver, verifying a document, issuing an
 * invoice). Those stay where they are.
 *
 * ███ FRONTEND ONLY ███ Authorization here is a frontend check over a mock
 * store. Real authorization, persistence, transactional integrity and
 * idempotency are the backend's to enforce.
 */

export interface LoadFilters {
  /** Matches reference, customer reference, customer name, city or driver. */
  search?: string;
  status?: LoadStatus[];
  /** Named groupings the UI offers as tabs. */
  view?: "active" | "upcoming" | "completed" | "cancelled" | "exceptions" | "all";
  customerId?: string;
  truckId?: string;
  driverId?: string;
  /** Pickup window, inclusive. */
  pickupFrom?: string;
  pickupTo?: string;
  /** Only loads missing at least one required document. */
  missingDocuments?: boolean;
}

export type LoadSortField =
  | "reference" | "status" | "pickupAt" | "deliveryAt" | "customer" | "rate";

export interface LoadSort {
  field: LoadSortField;
  direction: "asc" | "desc";
}

/** What a booking hands over when an agreed price becomes a load. */
export interface CreateBookedLoadInput {
  /** Same key, same load. A retried booking does not create a second one. */
  idempotencyKey: string;
  /** The human reference the workspace will know it by. */
  reference: string;
  /**
   * The customer exactly as the market gave it. NOT a profile reference: the
   * Directory owns matching, and minting a profile here is how duplicates are
   * made.
   */
  customer: Load["customer"];
  stops: Stop[];
  assignment: Assignment;
  equipment: EquipmentType;
  weightLbs?: number;
  commodity?: string;
  documentRequirements: LoadDocumentRequirement[];
  financials?: Load["financials"];
  /** Whether the driver still has to accept. Decides the initial status. */
  consent: ConsentRequirement;
  /** Plain language, for the timeline entry. */
  note?: string;
  /** The operational cycle this load was booked into. */
  dispatchCycleId?: string;
  bookingId?: string;
  at?: string;
}

/** A driver's answer to an offered load. */
export interface RecordConsentInput {
  idempotencyKey: string;
  loadId: string;
  answer: "accepted" | "declined";
  note?: string;
  at?: string;
}

/**
 * Applying a committed rate confirmation to the load it is about.
 *
 * Takes the IMMUTABLE canonical record rather than loose values, so there is no
 * way to call this with something a person has not signed. It writes only fields
 * the load owns, and it never creates a party profile.
 */
export interface ApplyRateConfirmationInput {
  idempotencyKey: string;
  loadId: string;
  record: RateConfirmationRecord;
  at?: string;
}

/** What finalizing produced, including every downstream projection's outcome. */
export interface FinalizeLoadResult {
  load: Load;
  /** True when this rate confirmation had already been applied. */
  duplicate: boolean;
  /** The published event id, for joining to the projection records. */
  eventId: string;
}

export interface LoadsService {
  /**
   * Results are always narrowed by the caller's organization AND record scope:
   * a membership scoped to "assigned" receives only its own driver's loads.
   * `financials` is omitted from every load unless the caller holds rates:view.
   */
  list(
    ctx: ServiceContext,
    filters?: LoadFilters,
    sort?: LoadSort,
    page?: PageRequest,
  ): Promise<Page<Load>>;

  get(ctx: ServiceContext, loadId: string): Promise<Load>;

  /** The append-only execution timeline, newest first. */
  events(ctx: ServiceContext, loadId: string): Promise<LoadEvent[]>;

  /** Documents linked to the load, newest version of each first. */
  documents(ctx: ServiceContext, loadId: string): Promise<Document[]>;

  /* -- Commands ---------------------------------------------------------- */

  /**
   * Create the load a booking agreed to, with its assignment and its timeline.
   *
   * Requires `loads:create`. Idempotent: the same key returns the load it
   * already made. Appends `load.created` and `assignment.created`.
   */
  createBooked(ctx: ServiceContext, input: CreateBookedLoadInput): Promise<Load>;

  /**
   * Record the driver's answer to an offered load.
   *
   * Requires `loads:assign` — answering for a driver is a dispatch act, and
   * somebody who may correct a reference number is not thereby entitled to
   * accept work on a driver's behalf. Appends `load.accepted` or
   * `load.declined` and moves the derived status; it never edits the
   * assignment's history.
   */
  recordConsent(ctx: ServiceContext, input: RecordConsentInput): Promise<Load>;

  /**
   * Apply a committed rate confirmation and finalize the load — ONCE.
   *
   * Requires `loads:edit` and `rates:view`: this command writes the agreed
   * money, so somebody who may not see rates may not set them. It writes the
   * confirmed values onto the load, satisfies the rate confirmation requirement
   * with the SIGNED document, appends the timeline entries, and publishes one
   * versioned `load.finalized` event for the authorized projections to consume.
   *
   * Idempotent on the key AND on the rate confirmation: calling it twice
   * produces one finalized load, one event and one run of every projection.
   */
  applyRateConfirmation(
    ctx: ServiceContext,
    input: ApplyRateConfirmationInput,
  ): Promise<FinalizeLoadResult>;
}

import type {
  Address, Cents, Contact, CurrencyCode, IsoDateTime, TimeZone,
} from "./common";
import type { LoadDocumentRequirement } from "./document";
import type { ActorRef } from "./user";

/**
 * The canonical load. One record links organization, customer, stops, rate,
 * equipment needs, assignment, events, documents and financial references.
 * Telegram, the driver portal, the office UI and accounting all read THIS.
 */

/**
 * Derived from the event timeline — see event.ts. Stored denormalized so lists
 * and badges do not have to replay events, but the timeline is authoritative.
 */
export type LoadStatus =
  | "draft"
  | "verifying"
  | "planned"
  | "offered"
  | "accepted"
  | "assigned"
  | "dispatched"
  | "at_pickup"
  | "loaded"
  | "in_transit"
  | "at_delivery"
  | "delivered"
  | "ready_to_invoice"
  | "invoiced"
  | "paid"
  | "cancelled";

export type EquipmentType =
  | "cargo_van" | "sprinter" | "box_truck" | "dry_van" | "reefer" | "flatbed";

/** How the receiving or shipping facility handles timing. */
export type AppointmentType =
  /** A firm time the facility booked. */
  | "appointment"
  /** First come, first served inside a window. */
  | "fcfs"
  /** Any time inside the window. */
  | "window";

export type StopKind = "pickup" | "delivery";

export interface Stop {
  id: string;
  loadId: string;
  kind: StopKind;
  /** 1-based order of travel. Unique within a load. */
  sequence: number;
  facilityName?: string;
  address: Address;
  /** The facility's own zone — a stop is timed locally, not in the org's zone. */
  timeZone: TimeZone;
  appointmentType: AppointmentType;
  /** Start of the window, or the firm appointment time. */
  appointmentAt: IsoDateTime;
  /** End of the window. Absent for a firm appointment. */
  appointmentEndAt?: IsoDateTime;
  /** Actuals, written by events. Null until the event arrives. */
  arrivedAt?: IsoDateTime;
  departedAt?: IsoDateTime;
  contact?: Contact;
  instructions?: string;
  /** PU numbers, delivery numbers, seal numbers, appointment confirmations. */
  referenceNumbers?: { label: string; value: string }[];
}

export type ConsentStatus = "not_required" | "pending" | "accepted" | "declined";

/**
 * Assignment of equipment and a person to a load. Superseding an assignment
 * writes an assignment.changed event; history is never overwritten.
 */
export interface Assignment {
  id: string;
  loadId: string;
  truckId?: string;
  trailerId?: string;
  /** The organization's Driver record, not a User. */
  driverId?: string;
  /**
   * For a dispatch agency: the carrier organization whose authority runs this
   * load. Absent when the load runs under the owning organization's own authority.
   */
  carrierOrganizationId?: string;
  assignedAt: IsoDateTime;
  assignedBy: ActorRef;
  /** Organization policy may require the driver to accept before dispatch. */
  consent: {
    status: ConsentStatus;
    respondedAt?: IsoDateTime;
    declineReason?: string;
  };
  /** Set when this assignment was replaced or removed. */
  endedAt?: IsoDateTime;
}

export interface Accessorial {
  /** detention, lumper, layover, tonu, fuel_surcharge, other. */
  code: string;
  label: string;
  amountCents: Cents;
  /** Charged to the customer, or paid out. */
  direction: "receivable" | "payable";
}

/**
 * Everything money. Rendering ANY field here requires `rates:view`; the service
 * omits the whole object rather than returning it for the UI to hide.
 */
export interface LoadFinancials {
  currency: CurrencyCode;
  linehaulCents: Cents;
  accessorials: Accessorial[];
  /** linehaul + receivable accessorials. The number that gets invoiced. */
  totalRateCents: Cents;
  loadedMiles: number;
  deadheadMiles: number;
  /** Derived: totalRateCents / loadedMiles. Sent so clients agree on rounding. */
  ratePerMileCents: Cents;
  driverShareCents?: Cents;
  dispatcherCommissionCents?: Cents;
  /** Set once accounting has a reference. Never invented by the frontend. */
  invoiceId?: string;
  settlementId?: string;
}

/** Denormalized customer identity carried on the load for display. */
export interface CustomerRef {
  id: string;
  name: string;
  kind: "broker" | "shipper";
  /** MC number for brokers, where known. */
  mcNumber?: string;
  contact?: Contact;
}

export interface Load {
  id: string;
  /**
   * The organization that owns this load — always the CARRIER whose operating
   * authority it runs under, never the dispatch organization that booked it.
   *
   * A booking made under a carrier's MC is that carrier's transaction. A
   * dispatch provider acting for the carrier appears in
   * `dispatchedByOrganizationId` and on each event's actor, and acquires
   * nothing by having pressed the button.
   */
  organizationId: string;
  /**
   * ★ PINNED AT BOOKING, NEVER RE-DERIVED ★
   *
   * The operating carrier proved by A6's `operatingContextAt` at the instant
   * the load was booked, together with the operating lease that proved it.
   *
   * Equal to `organizationId` and carried separately on purpose: the first is
   * where the record lives, this is the PROOF of why it lives there. A truck
   * moving to another carrier next month must not move, rewrite or re-authorize
   * this load, and a command that re-derived the owner from today's operator
   * would do exactly that. Every later command authorizes against this field
   * plus the actor's current, action-specific authority — two separate
   * questions, and neither substitutes for the other.
   */
  pinnedCarrierOrganizationId: string;
  /**
   * The `TruckOperatingLease.id` that proved it, when a lease did.
   *
   * Absent when the operating carrier was proved another way — a carrier-owned
   * truck, or a sole approved relationship. Pinned permanently, exactly as
   * `FactScope.truckOperatingLeaseId` is: correcting a lease later does not
   * move the loads that happened under it.
   */
  operatingLeaseId?: string;
  /**
   * The dispatch organization that booked or worked this load for the carrier.
   *
   * ★ ATTRIBUTION, NEVER A GRANT ★
   * The same rule A6 states for `FactScope`. This field says who did the work;
   * it does not say who may read it. Reach is decided by a live
   * `TruckDispatchAccess` and the membership's own permissions, checked at the
   * service boundary. A filter of the form
   * `dispatchedByOrganizationId === myOrganizationId` would be a silent
   * cross-organization grant and must never be written.
   */
  dispatchedByOrganizationId?: string;
  /** Human-facing identifier, unique within the organization. */
  reference: string;
  /** The customer's own load or order number, as printed on the rate con. */
  customerReference?: string;
  status: LoadStatus;
  customer: CustomerRef;
  /** Ordered by `sequence`. At least one pickup and one delivery. */
  stops: Stop[];
  /** The live assignment. Superseded ones live in the event timeline. */
  assignment?: Assignment;
  equipment: EquipmentType;
  weightLbs?: number;
  commodity?: string;
  temperatureF?: { min: number; max: number };
  /** Per-load, from the customer agreement — not a global rule. */
  documentRequirements: LoadDocumentRequirement[];
  /** Omitted entirely unless the caller holds `rates:view`. */
  financials?: LoadFinancials;
  createdAt: IsoDateTime;
  createdBy: ActorRef;
  updatedAt: IsoDateTime;
  cancelledAt?: IsoDateTime;
  cancellationReason?: string;
}

// --- Derived helpers. Pure functions over the entity, no service calls. ------

export function originStop(load: Load): Stop {
  return load.stops.find((s) => s.kind === "pickup") ?? load.stops[0];
}

export function destinationStop(load: Load): Stop {
  return (
    [...load.stops].reverse().find((s) => s.kind === "delivery") ??
    load.stops[load.stops.length - 1]
  );
}

export function laneLabel(load: Load): string {
  const a = originStop(load);
  const b = destinationStop(load);
  return `${a.address.city}, ${a.address.state} → ${b.address.city}, ${b.address.state}`;
}

export function missingRequiredDocuments(load: Load): LoadDocumentRequirement[] {
  return load.documentRequirements.filter(
    (r) => r.required && !r.satisfiedByDocumentId,
  );
}

const TERMINAL: LoadStatus[] = ["delivered", "invoiced", "paid", "cancelled"];
export function isTerminal(load: Load): boolean {
  return TERMINAL.includes(load.status);
}

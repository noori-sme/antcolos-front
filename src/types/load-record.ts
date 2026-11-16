/**
 * A booked load as the real API returns it (F1.2, plan 14):
 * ../antcolos/docs/requirements/loads-api-contract.md. Separate from the mock
 * `Load` in ./index, which models areas the backend has not built.
 */

export type LoadRecordStatus =
  | "booked"
  | "rc_received"
  | "driver_assigned"
  | "driver_accepted"
  | "en_route_pickup"
  | "arrived_pickup"
  | "loaded"
  | "awaiting_broker_release"
  | "in_transit"
  | "arrived_delivery"
  | "delivered"
  | "pod_received"
  | "invoice_ready"
  | "cancelled";

export type CancellationParty = "broker" | "shipper" | "carrier" | "other";

export type LoadRecordSource = "manual" | "browser_extension" | "rate_confirmation";

export interface LoadRecordStop {
  sequence: number;
  type: "pickup" | "delivery";
  facilityName: string | null;
  addressLine1: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  /** IANA zone the stop's times are shown in. */
  timezone: string;
  /** YYYY-MM-DD, the stop's local date. */
  scheduledDate: string | null;
  /** ISO instants. */
  windowStart: string | null;
  windowEnd: string | null;
  appointmentConfirmed: boolean;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
}

export interface LoadRecord {
  id: string;
  status: LoadRecordStatus;
  statusChangedAt: string;
  /** The states this caller may move the load to now, from the API. */
  allowedTransitions: LoadRecordStatus[];
  requiresBrokerRelease: boolean;
  /** The truck booked for this load (plan 31). */
  truckId: string | null;
  /** The driver on this load (plan 32). */
  driverUserId: string | null;
  driverAssignedAt: string | null;
  /** When the driver accepted; informational (D1.2). */
  driverAcceptedAt: string | null;
  source: LoadRecordSource;
  brokerName: string;
  brokerMcNumber: string;
  brokerContactName: string | null;
  brokerPhone: string | null;
  brokerEmail: string | null;
  brokerLoadNumber: string;
  /** YYYY-MM-DD */
  firstPickupDate: string;
  /** The API's equipment code, e.g. DRY_VAN. */
  equipmentType: string;
  weightLbs: number | null;
  commodity: string | null;
  totalMiles: number | null;
  /** Decimal string, e.g. "2750.00". */
  rateTotal: string | null;
  referenceNumbers: string[];
  specialInstructions: string | null;
  notes: string | null;
  stops: LoadRecordStop[];
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledByParty: CancellationParty | null;
  tonuAmount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoadRecordPage {
  items: LoadRecord[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface LoadRecordQuery {
  page: number;
  pageSize: number;
  status?: LoadRecordStatus;
  /** Broker name, MC or load number. */
  search?: string;
  sortBy: "createdAt" | "firstPickupDate";
  sortDir: "asc" | "desc";
}

export interface LoadTimelineEntry {
  id: string;
  /** Event type, e.g. load.status_changed. Unknown types are shown by name. */
  type: string;
  occurredAt: string;
  source: string;
  actor: { id: string; name: string | null } | null;
  from: LoadRecordStatus | null;
  to: LoadRecordStatus | null;
  reason: string | null;
  party: CancellationParty | null;
  tonuAmount: string | null;
  changedFields: string[];
  truckId: string | null;
  driverUserId: string | null;
}

export interface LoadTimelinePage {
  items: LoadTimelineEntry[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export interface CancelLoadInput {
  reason: string;
  party?: CancellationParty;
  /** "150.00" */
  tonuAmount?: string;
}

/** What a driver's accept / reject returns: no rate (contract §10). */
export interface DriverAnswer {
  id: string;
  status: LoadRecordStatus;
  driverUserId: string | null;
  driverAcceptedAt: string | null;
}

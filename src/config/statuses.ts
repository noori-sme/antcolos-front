import type { badgeVariants } from "@/components/ui/badge";
import type {
  DriverStatus, LoadStatus, PayeeKind, SettlementStatus, TruckStatus,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

export const LOAD_STATUS: Record<LoadStatus, { label: string; tone: Tone }> = {
  draft:            { label: "Draft",            tone: "neutral" },
  verifying:        { label: "Verifying",        tone: "warning" },
  planned:          { label: "Planned",          tone: "neutral" },
  offered:          { label: "Offered",          tone: "info" },
  accepted:         { label: "Accepted",         tone: "info" },
  assigned:         { label: "Assigned",         tone: "info" },
  dispatched:       { label: "Dispatched",       tone: "info" },
  at_pickup:        { label: "At pickup",        tone: "progress" },
  loaded:           { label: "Loaded",           tone: "progress" },
  in_transit:       { label: "In transit",       tone: "progress" },
  at_delivery:      { label: "At delivery",      tone: "progress" },
  delivered:        { label: "Delivered",        tone: "success" },
  ready_to_invoice: { label: "Ready to invoice", tone: "warning" },
  invoiced:         { label: "Invoiced",         tone: "info" },
  paid:             { label: "Paid",             tone: "success" },
  cancelled:        { label: "Cancelled",        tone: "danger" },
};

export const TRUCK_STATUS: Record<TruckStatus, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "success" },
  loaded: { label: "Loaded", tone: "progress" },
  expected_available: { label: "Expected available", tone: "info" },
  unavailable: { label: "Unavailable", tone: "neutral" },
  maintenance: { label: "Maintenance", tone: "warning" },
};

export const DRIVER_STATUS: Record<DriverStatus, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "success" },
  driving:   { label: "Driving",   tone: "info" },
  off_duty:  { label: "Off duty",  tone: "neutral" },
  inactive:  { label: "Inactive",  tone: "neutral" },
};

/**
 * Settlement tone is chosen by what the number MEANS to the person reading it,
 * not by how far along the workflow it is: "approved" is not success, because
 * nobody has been paid yet. Only paid is green.
 */
export const SETTLEMENT_STATUS: Record<SettlementStatus, { label: string; tone: Tone }> = {
  draft:             { label: "Draft",             tone: "neutral" },
  needs_review:      { label: "Needs review",      tone: "warning" },
  approved:          { label: "Approved",          tone: "info" },
  disputed:          { label: "Disputed",          tone: "danger" },
  ready_for_payment: { label: "Ready for payment", tone: "info" },
  partially_paid:    { label: "Partially paid",    tone: "progress" },
  paid:              { label: "Paid",              tone: "success" },
  voided:            { label: "Voided",            tone: "neutral" },
};

export const PAYEE_KIND_LABEL: Record<PayeeKind, string> = {
  company_driver: "Company driver",
  owner_operator: "Owner-operator",
  dispatcher: "Dispatcher",
  dispatch_organization: "Dispatch organization",
  other_payee: "Other payee",
};

export const EQUIPMENT_LABEL: Record<string, string> = {
  cargo_van: "Cargo van",
  sprinter: "Sprinter",
  box_truck: "Box truck",
  dry_van: "Dry van",
  reefer: "Reefer",
  flatbed: "Flatbed",
};

export const DOCUMENT_LABEL: Record<string, string> = {
  rate_con: "Rate con",
  bol: "BOL",
  pod: "POD",
  scale_ticket: "Scale ticket",
};

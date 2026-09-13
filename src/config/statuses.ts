import type { badgeVariants } from "@/components/ui/badge";
import type { LoadStatus, TruckStatus, DriverStatus } from "@/types";

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
  available:      { label: "Available",      tone: "success" },
  on_load:        { label: "On a load",      tone: "info" },
  out_of_service: { label: "Out of service", tone: "danger" },
  maintenance:    { label: "Maintenance",    tone: "warning" },
};

export const DRIVER_STATUS: Record<DriverStatus, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "success" },
  driving:   { label: "Driving",   tone: "info" },
  off_duty:  { label: "Off duty",  tone: "neutral" },
  inactive:  { label: "Inactive",  tone: "neutral" },
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

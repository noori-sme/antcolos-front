import { METER_SOURCE_LABEL, type MeterSource } from "@/types";
import type {
  DefectArea,
  DefectSeverity,
  DefectState,
  EquipmentAvailabilityImpact,
  MaintenanceCategory,
  MaintenanceCriticality,
  MaintenanceShareScope,
  MaintenanceState,
  MaintenanceTriggerKind,
  MaintenanceVendorKind,
  Money,
  RepairOrderStatus,
} from "@/types";

/**
 * Every word maintenance shows a person, in one place.
 *
 * Descriptions are written for a fleet owner or a driver, not an engineer. Where
 * a term could be read as a claim about a system we are not connected to, the
 * wording says plainly who supplied the information.
 */

export const MAINTENANCE_STATE_LABEL: Record<MaintenanceState, string> = {
  upcoming: "Upcoming",
  due_soon: "Due soon",
  overdue: "Overdue",
  in_service: "In service",
  completed: "Completed",
  deferred: "Deferred",
};

export const MAINTENANCE_STATE_DESCRIPTION: Record<MaintenanceState, string> = {
  upcoming: "Scheduled, with time or miles still to run.",
  due_soon: "Close enough that it needs booking in.",
  overdue: "Past its due point and still not done.",
  in_service: "A repair order is open against it and the work is under way.",
  completed: "Done. The permanent service record is written and cannot be changed.",
  deferred: "Somebody decided to run past due, and recorded why.",
};

export const TRIGGER_KIND_LABEL: Record<MaintenanceTriggerKind, string> = {
  date: "Date",
  mileage: "Mileage",
  engine_hours: "Engine hours",
  defect: "Reported defect",
};

export const TRIGGER_KIND_DESCRIPTION: Record<MaintenanceTriggerKind, string> = {
  date: "Falls due on a calendar date, whatever the equipment has done.",
  mileage: "Falls due at an odometer reading. Somebody has to record the odometer.",
  engine_hours: "Falls due at an hour-meter reading. Somebody has to record the meter.",
  defect: "Raised because a fault was reported. It closes when the fault does.",
};

export const MAINTENANCE_CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  inspection: "Inspection",
  preventive: "Preventive service",
  brakes: "Brakes",
  tires: "Tires",
  engine: "Engine",
  transmission: "Transmission and driveline",
  electrical: "Electrical",
  reefer: "Reefer unit",
  body: "Body and structure",
  other: "Other",
};

export const CRITICALITY_LABEL: Record<MaintenanceCriticality, string> = {
  routine: "Routine",
  important: "Important",
  safety_critical: "Safety critical",
};

export const CRITICALITY_DESCRIPTION: Record<MaintenanceCriticality, string> = {
  routine: "Running late costs money eventually. It stops nothing today.",
  important: "Running late risks a breakdown or a failed inspection.",
  safety_critical: "Running late puts the driver and the public at risk.",
};

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

export const DEFECT_SEVERITY_LABEL: Record<DefectSeverity, string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  out_of_service: "Should not be driven",
};

export const DEFECT_SEVERITY_DESCRIPTION: Record<DefectSeverity, string> = {
  minor: "Worth fixing, but it changes nothing about running the equipment today.",
  major: "Needs attention soon. The equipment still works.",
  critical: "Needs attention now. Something important is failing.",
  out_of_service:
    "In your judgement this equipment should not move until it is fixed. "
    + "Reporting this parks the equipment and cannot be deferred.",
};

export const AVAILABILITY_IMPACT_LABEL: Record<EquipmentAvailabilityImpact, string> = {
  none: "Still fully usable",
  reduced: "Usable with limits",
  out_of_service: "Cannot be used",
};

export const AVAILABILITY_IMPACT_DESCRIPTION: Record<EquipmentAvailabilityImpact, string> = {
  none: "Dispatch can plan this equipment normally.",
  reduced: "It can still work, but not for every load. Say what it cannot do.",
  out_of_service: "It cannot take a load at all until this is sorted.",
};

export const DEFECT_AREA_LABEL: Record<DefectArea, string> = {
  brakes: "Brakes",
  tires_wheels: "Tires and wheels",
  lights_electrical: "Lights and electrical",
  steering_suspension: "Steering and suspension",
  engine: "Engine",
  transmission_driveline: "Transmission and driveline",
  coupling: "Coupling and fifth wheel",
  reefer_unit: "Reefer unit",
  body_doors: "Body and doors",
  safety_equipment: "Safety equipment",
  other: "Something else",
};

export const DEFECT_STATE_LABEL: Record<DefectState, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  in_repair: "In repair",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const DEFECT_STATE_DESCRIPTION: Record<DefectState, string> = {
  reported: "Somebody reported it. Nobody has picked it up yet.",
  acknowledged: "Maintenance has seen it and taken it on.",
  in_repair: "A repair order is open and the work is under way.",
  resolved: "Fixed. What was done is in the service history.",
  dismissed: "Looked at and closed without work, with a reason recorded.",
};

/* -------------------------------------------------------------------------- */
/* Repair orders                                                               */
/* -------------------------------------------------------------------------- */

export const REPAIR_ORDER_STATUS_LABEL: Record<RepairOrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In progress",
  awaiting_parts: "Awaiting parts",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const REPAIR_ORDER_STATUS_DESCRIPTION: Record<RepairOrderStatus, string> = {
  draft: "Being put together. Nothing is committed.",
  open: "Raised and waiting to be booked in.",
  scheduled: "Booked with a vendor for a date.",
  in_progress: "The work is happening.",
  awaiting_parts: "Held up waiting for parts. Antcolos is not ordering them.",
  completed: "Finished. A permanent service record was written.",
  cancelled: "Called off, with a reason recorded. Nothing was written to history.",
};

export const VENDOR_KIND_LABEL: Record<MaintenanceVendorKind, string> = {
  in_house: "Own shop",
  dealer: "Dealer",
  independent_shop: "Independent shop",
  mobile_service: "Mobile service",
  tire_service: "Tire service",
  roadside: "Roadside",
};

export const SHARE_SCOPE_LABEL: Record<MaintenanceShareScope, string> = {
  availability_only: "Availability only",
  availability_and_schedule: "Availability and schedule",
};

export const SHARE_SCOPE_DESCRIPTION: Record<MaintenanceShareScope, string> = {
  availability_only:
    "They see only whether the equipment can take a load and when it is expected back. "
    + "No schedule, no faults, no cost.",
  availability_and_schedule:
    "As above, plus what the equipment is due for and when. "
    + "Still no cost, no vendor, no notes and no defect detail.",
};

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatMaintenanceDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatMaintenanceDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Integer minor units to a readable amount. No floats in the money path. */
export function formatMoney(money?: Money): string {
  if (!money) return "—";
  return (money.amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatMiles(miles?: number): string {
  return miles === undefined ? "—" : `${miles.toLocaleString()} mi`;
}

export function formatEngineHours(hours?: number): string {
  return hours === undefined ? "—" : `${hours.toLocaleString()} h`;
}

export function formatDowntime(hours?: number): string {
  if (hours === undefined) return "—";
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/**
 * Where a meter reading came from, in the words a shop would use.
 *
 * Built on the canonical ledger's own vocabulary plus maintenance's older word
 * for a reading typed into one of its screens. The maintenance panel used to say
 * "(entered by hand)" for anything that was not a driver report, which became a
 * lie the moment a fuel receipt could move the odometer — because it can, and
 * that is the point of there being one ledger.
 */
export const MAINTENANCE_METER_SOURCE_LABEL: Record<MeterSource, string> = {
  ...METER_SOURCE_LABEL,
  manual: "Entered by hand",
};

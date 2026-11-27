import { LOAD_RECORD_STATUS } from "@/config/statuses";
import type {
  CancellationParty, LoadRecordStatus, LoadRecordStop, LoadTimelineEntry,
} from "@/types/load-record";

/** DRY_VAN → "Dry van". */
export function equipmentLabel(code: string): string {
  const words = code.toLowerCase().split("_").filter(Boolean);
  if (!words.length) return code;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "2750.00" → "$2,750.00"; null stays null. */
export function money(amount: string | null): string | null {
  if (amount === null || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) ? USD.format(value) : amount;
}

function time(iso: string, timezone: string, withZone: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
    ...(withZone ? { timeZoneName: "short" } : {}),
  }).format(new Date(iso));
}

/** The appointment window in the stop's own timezone: "08:00–10:00 CST". */
export function stopWindow(stop: LoadRecordStop): string | null {
  if (!stop.windowStart || !stop.timezone) return null;
  if (!stop.windowEnd) return time(stop.windowStart, stop.timezone, true);
  return `${time(stop.windowStart, stop.timezone, false)}–${time(stop.windowEnd, stop.timezone, true)}`;
}

const place = (stop: LoadRecordStop) => `${stop.city}, ${stop.state}`;

/** "Joliet, IL → Newark, NJ": first pickup to last delivery. */
export function routeSummary(stops: readonly LoadRecordStop[]): string {
  if (!stops.length) return "No stops";
  const first = stops.find((s) => s.type === "pickup") ?? stops[0];
  const last = [...stops].reverse().find((s) => s.type === "delivery") ?? stops[stops.length - 1];
  return first === last ? place(first) : `${place(first)} → ${place(last)}`;
}

const statusLabel = (status: LoadRecordStatus | null) =>
  status ? LOAD_RECORD_STATUS[status].label : "?";

const PARTY: Record<CancellationParty, string> = {
  broker: "the broker",
  shipper: "the shipper",
  carrier: "the carrier",
  other: "someone else",
};

/**
 * Where an event came from, when it is worth saying (loads-api-contract §8 `source`).
 * Telegram is named so the office can tell a driver's button press from its own changes.
 */
export function timelineVia(source: string): string | null {
  return source === "telegram" ? "via Telegram" : null;
}

/** One readable line per timeline event; an unknown type is shown by name. */
export function timelineSentence(entry: LoadTimelineEntry): string {
  switch (entry.type) {
    case "load.created":
      return "Load created";
    case "load.updated":
      return entry.changedFields.length
        ? `Details edited: ${entry.changedFields.join(", ")}`
        : "Details edited";
    case "load.rc_received":
      return "Rate Con received";
    case "load.approved":
      return "Rate Con approved into this load";
    case "document.accepted":
      return "Rate Con attached";
    case "load.status_changed":
      return `${statusLabel(entry.from)} → ${statusLabel(entry.to)}`;
    case "load.status_corrected":
      return `Status corrected: ${statusLabel(entry.from)} → ${statusLabel(entry.to)}`;
    case "load.truck_assigned":
      return "Truck booked for this load";
    case "load.truck_unassigned":
      return "Truck taken off this load";
    case "load.driver_assigned":
      return "Driver assigned";
    case "load.driver_unassigned":
      return "Driver taken off this load";
    case "load.driver_accepted":
      return "Driver accepted the load";
    case "load.driver_rejected":
      return "Driver turned the load down";
    case "load.cancelled": {
      const by = entry.party ? `Cancelled by ${PARTY[entry.party]}` : "Cancelled";
      const tonu = money(entry.tonuAmount);
      return tonu ? `${by} · TONU ${tonu}` : by;
    }
    // Driver milestones (plan 33).
    case "load.stop_arrived":
      return `Arrived at ${stopName(entry)}`;
    case "load.stop_loaded":
      return `Loaded at ${stopName(entry)}`;
    case "load.stop_departed":
      return `Departed ${stopName(entry)}`;
    case "load.stop_delivered":
      return `Delivered at ${stopName(entry)}`;
    // Documents (plans 34, 37).
    case "load.document_received":
      return `${docName(entry.documentType)} received`;
    case "load.broker_email_requested":
      return `${docName(entry.documentType)} queued for the broker`;
    case "load.broker_email_sent":
      return `${docName(entry.documentType)} emailed to ${entry.recipient ?? "the broker"}`;
    case "load.broker_email_failed":
      return `${docName(entry.documentType)} could not be emailed to the broker`;
    // Exceptions (plan 36).
    case "load.exception_opened":
      return `Problem reported: ${exceptionName(entry.exceptionType)}${entry.severity ? ` (${entry.severity.toLowerCase()})` : ""}`;
    case "load.exception_acknowledged":
      return "Problem taken by dispatch";
    case "load.exception_resolved": {
      const cost = money(entry.financialImpact);
      return cost ? `Problem resolved · cost ${cost}` : "Problem resolved";
    }
    // Accounting (plan 39).
    case "load.accounting_exported":
      return "Sent to accounting";
    default:
      return entry.type;
  }
}

function stopName(entry: LoadTimelineEntry): string {
  const kind = entry.stopType === "delivery" ? "delivery" : entry.stopType === "pickup" ? "pickup" : "stop";
  return entry.stopSequence != null ? `${kind} (stop ${entry.stopSequence})` : kind;
}

const DOC_NAME: Record<string, string> = { BOL: "BOL", POD: "POD", RATE_CONFIRMATION: "Rate Con" };
const docName = (type: string | null) => (type && DOC_NAME[type]) || "Document";

function exceptionName(type: string | null): string {
  if (!type) return "other";
  return type.toLowerCase().replace(/_/g, " ");
}

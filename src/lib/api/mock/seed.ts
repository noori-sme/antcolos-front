import type {
  Customer, Document, Driver, Load, LoadEvent, NeedsYouItem,
} from "@/types";
import { buildLoad, nextId, type LoadSeed } from "./build-load";
import { daysFromNow, hoursFromNow, minutesFromNow } from "./time";
import { TRUCK_IDS } from "./truck-registry";

/**
 * Seed data, PARTITIONED BY ORGANIZATION. Every collection is keyed by
 * organizationId and every mock service method requires one, so cross-org
 * access fails in development exactly as it will in production.
 */
export interface OrgData {
  loads: Load[];
  events: LoadEvent[];
  documents: Document[];
  drivers: Driver[];
  customers: Customer[];
  needsYou: NeedsYouItem[];
}

const SYSTEM = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system" as const,
};

const id = (prefix: string) => nextId(prefix);

/** Expands compact load seeds into canonical loads plus timelines and documents. */
function expand(organizationId: string, seeds: LoadSeed[]) {
  const built = seeds.map((s) => buildLoad(organizationId, s));
  return {
    loads: built.map((b) => b.load),
    events: built.flatMap((b) => b.events),
    documents: built.flatMap((b) => b.documents),
  };
}

function needsYou(
  organizationId: string,
  n: Omit<NeedsYouItem, "id" | "organizationId" | "createdAt" | "history" | "status"> &
    Partial<Pick<NeedsYouItem, "status" | "createdAt">>,
): NeedsYouItem {
  const createdAt = n.createdAt ?? hoursFromNow(-6);
  return {
    id: id("ny"),
    organizationId,
    status: n.status ?? "open",
    createdAt,
    history: [
      {
        id: id("nyh"),
        at: createdAt,
        actor: SYSTEM,
        action: "created",
        note: n.reason,
      },
    ],
    ...n,
  } as NeedsYouItem;
}

// ---------------------------------------------------------------------------
// Northline Freight — CARRIER. Sam is Owner here.
// ---------------------------------------------------------------------------

function northline(): OrgData {
  const org = "org_northline";

  const customers: Customer[] = [
    { id: "cus_nl_apex", organizationId: org, name: "Apex Logistics", kind: "broker", contactName: "Dana Wells", phone: "+1 (312) 555-0110", email: "dana@apexlog.example" },
    { id: "cus_nl_rivet", organizationId: org, name: "Rivet Supply Co.", kind: "shipper", contactName: "Marco Bell", phone: "+1 (614) 555-0166" },
    { id: "cus_nl_tandem", organizationId: org, name: "Tandem Freight Partners", kind: "broker", contactName: "Priya Raman", phone: "+1 (773) 555-0143" },
    { id: "cus_nl_glenmark", organizationId: org, name: "Glenmark Distribution", kind: "shipper", contactName: "Eli Ross" },
  ];

  const drivers: Driver[] = [
    { id: "drv_nl_01", organizationId: org, userId: "usr_dmitri", displayName: "Dmitri Kovalenko", status: "driving", phone: "+1 (312) 555-0181", currentTruckId: TRUCK_IDS.nl104, telegramConnected: true, documentWarnings: 0 },
    { id: "drv_nl_02", organizationId: org, displayName: "Marisol Ortiz", status: "driving", phone: "+1 (312) 555-0182", currentTruckId: TRUCK_IDS.nl107, telegramConnected: true, documentWarnings: 0 },
    { id: "drv_nl_03", organizationId: org, displayName: "Ray Bell", status: "available", phone: "+1 (312) 555-0183", currentTruckId: TRUCK_IDS.nl111, telegramConnected: true, documentWarnings: 0 },
    { id: "drv_nl_04", organizationId: org, displayName: "Amir Haddad", status: "driving", phone: "+1 (312) 555-0184", currentTruckId: TRUCK_IDS.nl115, telegramConnected: true, documentWarnings: 1 },
    { id: "drv_nl_05", organizationId: org, displayName: "Tomas Reyes", status: "available", phone: "+1 (312) 555-0185", currentTruckId: TRUCK_IDS.nl118, telegramConnected: false, documentWarnings: 0 },
    { id: "drv_nl_06", organizationId: org, displayName: "Kelsey Nguyen", status: "off_duty", phone: "+1 (312) 555-0186", currentTruckId: TRUCK_IDS.nl121, telegramConnected: true, documentWarnings: 0 },
  ];


  const TZ = "America/Chicago";
  const { loads, events, documents } = expand(org, [
    {
      ref: "NL-24817", customerRef: "APX-77120", status: "in_transit",
      customer: { id: "cus_nl_apex", name: "Apex Logistics", kind: "broker", mc: "MC-612884", contact: "Dana Wells", phone: "+1 (312) 555-0110" },
      pickup: { city: "Chicago", state: "IL", timeZone: TZ, at: hoursFromNow(-9), facility: "Apex Cross-Dock 4", contactName: "Yard office", phone: "+1 (312) 555-0188", arrived: hoursFromNow(-9.4), departed: hoursFromNow(-8.2), instructions: "Dock 12. Driver must check in at the guard shack with the PU number.", refs: [["PU", "77120-A"], ["Seal", "0093412"]] },
      delivery: { city: "Columbus", state: "OH", timeZone: "America/New_York", at: hoursFromNow(5), facility: "Rivet DC Columbus", appointmentType: "appointment", contactName: "Receiving", phone: "+1 (614) 555-0140", instructions: "Appointment is firm. Late arrivals are rescheduled to the next morning.", refs: [["Delivery", "CMH-4471"]] },
      linehaul: 44400, loaded: 355, deadhead: 12, equipment: "cargo_van", weight: 3100, commodity: "Automotive parts",
      driverId: "drv_nl_01", driverName: "Dmitri Kovalenko", truckId: TRUCK_IDS.nl104,
      has: ["rate_confirmation", "bill_of_lading"],
      extraEvents: [
        { kind: "load.eta_updated", at: hoursFromNow(-1.2), by: "system", source: "eld", etaAt: hoursFromNow(6.2), note: "ETA slipped 70 minutes: congestion on I-70 near Springfield" },
        { kind: "load.location_reported", at: hoursFromNow(-0.5), by: "driver", source: "eld", note: "Near Lafayette, IN" },
      ],
    },
    {
      ref: "NL-24816", customerRef: "RS-5514", status: "at_delivery",
      customer: { id: "cus_nl_rivet", name: "Rivet Supply Co.", kind: "shipper", contact: "Marco Bell", phone: "+1 (614) 555-0166" },
      pickup: { city: "Joliet", state: "IL", timeZone: TZ, at: hoursFromNow(-14), arrived: hoursFromNow(-14.3), departed: hoursFromNow(-13.1) },
      delivery: { city: "Indianapolis", state: "IN", timeZone: "America/Indiana/Indianapolis", at: hoursFromNow(1), appointmentType: "fcfs", windowHours: 4, arrived: hoursFromNow(-2.7), instructions: "FCFS 07:00–11:00. Two hours free, then detention at $65/hr." },
      linehaul: 25100, loaded: 186, deadhead: 8, equipment: "sprinter", weight: 1850,
      driverId: "drv_nl_02", driverName: "Marisol Ortiz", truckId: TRUCK_IDS.nl107,
      has: ["rate_confirmation", "bill_of_lading"],
      extraEvents: [
        { kind: "exception.detention_started", at: hoursFromNow(-0.7), by: "system", source: "eld", durationMinutes: 160, note: "On site 2h40m against 2h free time" },
      ],
    },
    {
      ref: "NL-24812", customerRef: "TFP-31902", status: "delivered",
      customer: { id: "cus_nl_tandem", name: "Tandem Freight Partners", kind: "broker", mc: "MC-908114", contact: "Priya Raman", phone: "+1 (773) 555-0143" },
      pickup: { city: "Milwaukee", state: "WI", timeZone: TZ, at: hoursFromNow(-52), arrived: hoursFromNow(-52.5), departed: hoursFromNow(-51) },
      delivery: { city: "Kansas City", state: "MO", timeZone: TZ, at: hoursFromNow(-28), arrived: hoursFromNow(-28.4), departed: hoursFromNow(-27.2) },
      linehaul: 99800, loaded: 512, deadhead: 21, equipment: "box_truck", weight: 6400, commodity: "Packaged food",
      driverId: "drv_nl_04", driverName: "Amir Haddad", truckId: TRUCK_IDS.nl115,
      has: ["rate_confirmation", "bill_of_lading"],
    },
    {
      ref: "NL-24809", status: "planned",
      customer: { id: "cus_nl_apex", name: "Apex Logistics", kind: "broker", mc: "MC-612884", contact: "Dana Wells", phone: "+1 (312) 555-0110" },
      pickup: { city: "Gary", state: "IN", timeZone: TZ, at: hoursFromNow(16), appointmentType: "window", windowHours: 3 },
      delivery: { city: "Nashville", state: "TN", timeZone: TZ, at: hoursFromNow(38) },
      linehaul: 47400, loaded: 412, deadhead: 34, equipment: "cargo_van", weight: 2900,
    },
    {
      ref: "NL-24805", customerRef: "GD-8801", status: "ready_to_invoice",
      customer: { id: "cus_nl_glenmark", name: "Glenmark Distribution", kind: "shipper", contact: "Eli Ross" },
      pickup: { city: "Rockford", state: "IL", timeZone: TZ, at: hoursFromNow(-74), arrived: hoursFromNow(-74.2), departed: hoursFromNow(-73) },
      delivery: { city: "Memphis", state: "TN", timeZone: TZ, at: hoursFromNow(-50), arrived: hoursFromNow(-50.3), departed: hoursFromNow(-49.1) },
      linehaul: 104100, accessorials: [{ code: "detention", label: "Detention, 1.5 hrs", cents: 8000 }],
      loaded: 548, deadhead: 18, equipment: "box_truck", weight: 7200,
      driverId: "drv_nl_04", driverName: "Amir Haddad", truckId: TRUCK_IDS.nl115,
      has: ["rate_confirmation", "bill_of_lading", "proof_of_delivery"],
    },
    {
      ref: "NL-24821", status: "verifying",
      customer: { id: "cus_nl_tandem", name: "Tandem Freight Partners", kind: "broker", mc: "MC-908114", contact: "Priya Raman" },
      pickup: { city: "Chicago", state: "IL", timeZone: TZ, at: hoursFromNow(20) },
      delivery: { city: "Cleveland", state: "OH", timeZone: "America/New_York", at: hoursFromNow(34) },
      linehaul: 41300, loaded: 344, deadhead: 15, equipment: "cargo_van",
    },
    {
      ref: "NL-24822", status: "planned",
      customer: { id: "cus_nl_rivet", name: "Rivet Supply Co.", kind: "shipper", contact: "Marco Bell" },
      pickup: { city: "Chicago", state: "IL", timeZone: TZ, at: hoursFromNow(26) },
      delivery: { city: "St. Louis", state: "MO", timeZone: TZ, at: hoursFromNow(40) },
      linehaul: 38600, loaded: 297, deadhead: 9, equipment: "sprinter",
    },
    {
      ref: "NL-24799", customerRef: "APX-76980", status: "invoiced",
      customer: { id: "cus_nl_apex", name: "Apex Logistics", kind: "broker", mc: "MC-612884" },
      pickup: { city: "Chicago", state: "IL", timeZone: TZ, at: daysFromNow(-6), arrived: daysFromNow(-6), departed: daysFromNow(-6) },
      delivery: { city: "Detroit", state: "MI", timeZone: "America/Detroit", at: daysFromNow(-6), arrived: daysFromNow(-6), departed: daysFromNow(-6) },
      linehaul: 34500, loaded: 283, deadhead: 11, equipment: "cargo_van",
      driverId: "drv_nl_03", driverName: "Ray Bell", truckId: TRUCK_IDS.nl111,
      has: ["rate_confirmation", "bill_of_lading", "proof_of_delivery"],
    },
    {
      ref: "NL-24790", status: "cancelled",
      customer: { id: "cus_nl_glenmark", name: "Glenmark Distribution", kind: "shipper" },
      pickup: { city: "Aurora", state: "IL", timeZone: TZ, at: daysFromNow(-8) },
      delivery: { city: "Louisville", state: "KY", timeZone: "America/New_York", at: daysFromNow(-8) },
      linehaul: 36100, loaded: 301, deadhead: 16, equipment: "cargo_van",
    },
  ]);

  const ld = (ref: string) => loads.find((l) => l.reference === ref)!;

  const items: NeedsYouItem[] = [
    needsYou(org, {
      category: "rate_con_verification", severity: "high",
      title: "Rate confirmation awaiting verification",
      reason: "OCR extracted 15 fields. The rate and the delivery appointment are below the confidence threshold.",
      detail: "Extracted rate $413.00 and delivery 08:00 — both flagged. Verify against the source document before this becomes a committed load.",
      entity: { kind: "load", id: ld("NL-24821").id, label: "NL-24821 · Chicago, IL → Cleveland, OH", href: "/loads" },
      recommendedAction: { kind: "verify", label: "Open verification workspace", requires: ["loads:edit"], deferred: true },
      dueAt: hoursFromNow(3), source: "ocr", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "missing_document", severity: "critical",
      title: "POD missing on a delivered load",
      reason: "NL-24812 delivered 28 hours ago. Apex requires the POD within 48 hours of delivery or payment terms reset.",
      detail: "Driver Amir Haddad has uploaded the BOL but not the POD. Telegram reminder sent twice with no response.",
      entity: { kind: "load", id: ld("NL-24812").id, label: "NL-24812 · Milwaukee, WI → Kansas City, MO", href: "/loads" },
      relatedEntities: [{ kind: "driver", id: "drv_nl_04", label: "Amir Haddad", href: "/people/drivers" }],
      recommendedAction: { kind: "request_document", label: "Request POD from driver", requires: ["documents:view"] },
      dueAt: hoursFromNow(-2), source: "system", requires: ["loads:view", "documents:view"],
    }),
    needsYou(org, {
      category: "truck_going_empty", severity: "high",
      title: "Unit 107 goes empty in about 2 hours",
      reason: "Marisol Ortiz delivers in Indianapolis, IN at 14:15 with no next load committed.",
      detail: "Minimum rate $1.05/mi, deadhead limit 30 mi. Sprinter, available for same-day pickup.",
      entity: { kind: "truck", id: TRUCK_IDS.nl107, label: "Unit 107 · Sprinter · Indianapolis, IN", href: "/fleet/trucks" },
      recommendedAction: { kind: "start_search", label: "Start assisted load search", requires: ["loads:view"], deferred: true },
      dueAt: hoursFromNow(2), source: "system", requires: ["trucks:view"],
    }),
    needsYou(org, {
      category: "truck_going_empty", severity: "medium",
      title: "Unit 118 has been empty for 20 hours",
      reason: "Tomas Reyes is sitting in Joliet, IL with no assignment and no outreach recorded since yesterday.",
      entity: { kind: "truck", id: TRUCK_IDS.nl118, label: "Unit 118 · Cargo van · Joliet, IL", href: "/fleet/trucks" },
      recommendedAction: { kind: "start_search", label: "Start assisted load search", requires: ["loads:view"], deferred: true },
      dueAt: hoursFromNow(6), source: "system", requires: ["trucks:view"],
    }),
    needsYou(org, {
      category: "unassigned_load", severity: "high",
      title: "NL-24809 picks up tomorrow with no driver",
      reason: "Pickup in Gary, IN in 16 hours. No truck, driver or trailer assigned.",
      detail: "Cargo van, 412 loaded miles, 34 deadhead — above the 30-mile policy for two of the three candidate trucks.",
      entity: { kind: "load", id: ld("NL-24809").id, label: "NL-24809 · Gary, IN → Nashville, TN", href: "/loads" },
      recommendedAction: { kind: "assign_load", label: "Assign a truck and driver", requires: ["loads:assign"], deferred: true },
      dueAt: hoursFromNow(16), source: "system", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "eta_risk", severity: "critical",
      title: "NL-24817 is tracking 70 minutes late",
      reason: "Current position near Lafayette, IN puts arrival at 19:50 against a 18:40 delivery appointment.",
      detail: "Apex requires notification before the appointment window closes. No delay has been reported to the customer yet.",
      entity: { kind: "load", id: ld("NL-24817").id, label: "NL-24817 · Chicago, IL → Columbus, OH", href: "/loads" },
      relatedEntities: [{ kind: "driver", id: "drv_nl_01", label: "Dmitri Kovalenko", href: "/people/drivers" }],
      recommendedAction: { kind: "contact_customer", label: "Notify Apex Logistics", requires: ["customers:view"] },
      dueAt: hoursFromNow(1), source: "system", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "status_confirmation", severity: "medium",
      title: "No arrival confirmation from unit 115",
      reason: "Amir Haddad was due at the Memphis receiver 45 minutes ago. No Telegram status update received.",
      entity: { kind: "driver", id: "drv_nl_04", label: "Amir Haddad · Unit 115", href: "/people/drivers" },
      recommendedAction: { kind: "contact_driver", label: "Message the driver", requires: ["drivers:view"] },
      dueAt: minutesFromNow(-45), source: "telegram", requires: ["drivers:view"],
    }),
    needsYou(org, {
      category: "expiring_document", severity: "high",
      title: "Medical card expires in 6 days",
      reason: "Amir Haddad's DOT medical certificate expires on the 19th. He is scheduled on loads through the 23rd.",
      entity: { kind: "driver", id: "drv_nl_04", label: "Amir Haddad", href: "/people/drivers" },
      recommendedAction: { kind: "request_document", label: "Request updated medical card", requires: ["compliance:view"] },
      dueAt: daysFromNow(6), source: "system", requires: ["compliance:view"],
    }),
    needsYou(org, {
      category: "invoice_review", severity: "medium",
      title: "NL-24805 is ready to invoice",
      reason: "Delivered with all required documents present. $1,121.00 unbilled for 3 days.",
      entity: { kind: "load", id: ld("NL-24805").id, label: "NL-24805 · Rockford, IL → Memphis, TN", href: "/loads" },
      recommendedAction: { kind: "review", label: "Review and invoice", requires: ["invoices:create"], deferred: true },
      dueAt: hoursFromNow(20), source: "system", requires: ["invoices:view"],
    }),
    needsYou(org, {
      category: "detention", severity: "medium",
      title: "Possible detention at the Indianapolis receiver",
      reason: "Unit 107 has been on site 2 hours 40 minutes. Rivet's agreement allows 2 hours free.",
      entity: { kind: "load", id: ld("NL-24816").id, label: "NL-24816 · Joliet, IL → Indianapolis, IN", href: "/loads" },
      recommendedAction: { kind: "contact_customer", label: "Open a detention claim", requires: ["customers:view"], deferred: true },
      dueAt: hoursFromNow(1), source: "eld", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "customer_response", severity: "low",
      title: "Tandem Freight is waiting on a rate response",
      reason: "Priya Raman replied to the NL-24822 offer 5 hours ago asking for $410. Nothing sent back yet.",
      entity: { kind: "customer", id: "cus_nl_tandem", label: "Tandem Freight Partners", href: "/customers" },
      recommendedAction: { kind: "contact_customer", label: "Reply to Tandem", requires: ["customers:view"] },
      dueAt: hoursFromNow(12), source: "manual", requires: ["customers:view"],
    }),
    needsYou(org, {
      category: "settlement_review", severity: "low",
      title: "Weekly settlements ready for review",
      reason: "6 drivers, 19 loads, period closes tonight. Nothing approved yet.",
      entity: { kind: "settlement", id: "stl_nl_w37", label: "Week 37 settlement period", href: "/finance/settlements" },
      recommendedAction: { kind: "review", label: "Review settlement period", requires: ["settlements:view"], deferred: true },
      dueAt: hoursFromNow(9), source: "system", requires: ["settlements:view"],
    }),
  ];

  return { loads, events, documents, drivers, customers, needsYou: items };
}

// ---------------------------------------------------------------------------
// Meridian Dispatch — DISPATCH_AGENCY. Sam is a rate-blind Senior dispatcher.
// Trucks here run under other carriers' authority.
// ---------------------------------------------------------------------------

function meridian(): OrgData {
  const org = "org_meridian";

  const customers: Customer[] = [
    { id: "cus_md_keystone", organizationId: org, name: "Keystone Brokerage", kind: "broker", contactName: "Alan Pike", phone: "+1 (646) 555-0121" },
    { id: "cus_md_harbor", organizationId: org, name: "Harbor Point Freight", kind: "broker", contactName: "Nia Coles" },
    { id: "cus_md_vantage", organizationId: org, name: "Vantage Shippers", kind: "shipper", contactName: "Owen Pratt" },
  ];

  const drivers: Driver[] = [
    { id: "drv_md_01", organizationId: org, displayName: "Serge Petrov", status: "driving", currentTruckId: TRUCK_IDS.mdA12, telegramConnected: true, documentWarnings: 0 },
    { id: "drv_md_02", organizationId: org, displayName: "Hannah Boyd", status: "available", currentTruckId: TRUCK_IDS.mdB04, telegramConnected: true, documentWarnings: 0 },
    { id: "drv_md_03", organizationId: org, displayName: "Luis Carrera", status: "driving", currentTruckId: TRUCK_IDS.crosswind, telegramConnected: false, documentWarnings: 1 },
    { id: "drv_md_04", organizationId: org, displayName: "Grace Lindqvist", status: "available", currentTruckId: TRUCK_IDS.mdA18, telegramConnected: true, documentWarnings: 0 },
  ];


  const TZ = "America/New_York";
  const { loads, events, documents } = expand(org, [
    {
      ref: "MD-9042", customerRef: "KB-22841", status: "in_transit",
      customer: { id: "cus_md_keystone", name: "Keystone Brokerage", kind: "broker", mc: "MC-771220", contact: "Alan Pike", phone: "+1 (646) 555-0121" },
      pickup: { city: "Allentown", state: "PA", timeZone: TZ, at: hoursFromNow(-7), arrived: hoursFromNow(-7.3), departed: hoursFromNow(-6.1) },
      delivery: { city: "Pittsburgh", state: "PA", timeZone: TZ, at: hoursFromNow(3), appointmentType: "window", windowHours: 2 },
      linehaul: 38700, loaded: 298, deadhead: 14, equipment: "sprinter", weight: 2200,
      driverId: "drv_md_01", driverName: "Serge Petrov", truckId: TRUCK_IDS.mdA12,
      carrierOrganizationId: "carrier_baxter",
      has: ["rate_confirmation", "bill_of_lading"],
    },
    {
      ref: "MD-9038", status: "in_transit",
      customer: { id: "cus_md_harbor", name: "Harbor Point Freight", kind: "broker", contact: "Nia Coles" },
      pickup: { city: "Richmond", state: "VA", timeZone: TZ, at: hoursFromNow(-4), arrived: hoursFromNow(-4.2), departed: hoursFromNow(-3.6) },
      delivery: { city: "Charlotte", state: "NC", timeZone: TZ, at: hoursFromNow(7) },
      linehaul: 53800, loaded: 291, deadhead: 22, equipment: "box_truck", weight: 5800,
      driverId: "drv_md_03", driverName: "Luis Carrera", truckId: TRUCK_IDS.crosswind,
      carrierOrganizationId: "carrier_crosswind",
      has: ["rate_confirmation"],
    },
    {
      ref: "MD-9051", status: "planned",
      customer: { id: "cus_md_vantage", name: "Vantage Shippers", kind: "shipper", contact: "Owen Pratt" },
      pickup: { city: "Newark", state: "NJ", timeZone: TZ, at: hoursFromNow(11) },
      delivery: { city: "Boston", state: "MA", timeZone: TZ, at: hoursFromNow(22) },
      linehaul: 28200, loaded: 226, deadhead: 6, equipment: "cargo_van",
    },
    {
      ref: "MD-9050", status: "verifying",
      customer: { id: "cus_md_keystone", name: "Keystone Brokerage", kind: "broker", mc: "MC-771220", contact: "Alan Pike" },
      pickup: { city: "Baltimore", state: "MD", timeZone: TZ, at: hoursFromNow(14) },
      delivery: { city: "Raleigh", state: "NC", timeZone: TZ, at: hoursFromNow(28) },
      linehaul: 37400, loaded: 312, deadhead: 19, equipment: "cargo_van",
    },
    {
      ref: "MD-9031", status: "delivered",
      customer: { id: "cus_md_harbor", name: "Harbor Point Freight", kind: "broker" },
      pickup: { city: "Trenton", state: "NJ", timeZone: TZ, at: daysFromNow(-2), arrived: daysFromNow(-2), departed: daysFromNow(-2) },
      delivery: { city: "Philadelphia", state: "PA", timeZone: TZ, at: daysFromNow(-2), arrived: daysFromNow(-2), departed: daysFromNow(-2) },
      linehaul: 17900, loaded: 112, deadhead: 8, equipment: "cargo_van",
      driverId: "drv_md_02", driverName: "Hannah Boyd", truckId: TRUCK_IDS.mdB04,
      carrierOrganizationId: "carrier_ridgeway",
      has: ["rate_confirmation", "bill_of_lading", "proof_of_delivery"],
    },
  ]);

  const ld = (ref: string) => loads.find((l) => l.reference === ref)!;

  const items: NeedsYouItem[] = [
    needsYou(org, {
      category: "truck_going_empty", severity: "critical",
      title: "B-04 has been empty for 6 hours in Newark",
      reason: "Hannah Boyd went empty at 06:10 with nothing booked. Ridgeway's minimum is $1.00/mi within 25 miles deadhead.",
      detail: "Newark is a strong outbound market this morning; 4 candidate loads matched on the last sweep.",
      entity: { kind: "truck", id: TRUCK_IDS.mdB04, label: "B-04 · Ridgeway Carriers · Newark, NJ", href: "/fleet/trucks" },
      recommendedAction: { kind: "start_search", label: "Start assisted load search", requires: ["loads:view"], deferred: true },
      dueAt: hoursFromNow(-1), source: "system", requires: ["trucks:view"],
    }),
    needsYou(org, {
      category: "truck_going_empty", severity: "high",
      title: "A-18 is empty in Baltimore",
      reason: "Grace Lindqvist delivered an hour ago. No next assignment and no outreach logged.",
      entity: { kind: "truck", id: TRUCK_IDS.mdA18, label: "A-18 · Baxter Transit LLC · Baltimore, MD", href: "/fleet/trucks" },
      recommendedAction: { kind: "start_search", label: "Start assisted load search", requires: ["loads:view"], deferred: true },
      dueAt: hoursFromNow(2), source: "system", requires: ["trucks:view"],
    }),
    needsYou(org, {
      category: "rate_con_verification", severity: "high",
      title: "Keystone rate con needs verification",
      reason: "Pickup address extracted with low confidence and the appointment time is ambiguous (14:00 vs 04:00).",
      entity: { kind: "load", id: ld("MD-9050").id, label: "MD-9050 · Baltimore, MD → Raleigh, NC", href: "/loads" },
      recommendedAction: { kind: "verify", label: "Open verification workspace", requires: ["loads:edit"], deferred: true },
      dueAt: hoursFromNow(4), source: "ocr", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "status_confirmation", severity: "high",
      title: "C-31 has not confirmed pickup",
      reason: "Luis Carrera is not connected to Telegram and the Richmond pickup was 4 hours ago.",
      detail: "No ELD on this unit. Confirmation has to come by phone.",
      entity: { kind: "driver", id: "drv_md_03", label: "Luis Carrera · C-31", href: "/people/drivers" },
      recommendedAction: { kind: "contact_driver", label: "Call the driver", requires: ["drivers:view"] },
      dueAt: hoursFromNow(-1), source: "system", requires: ["drivers:view"],
    }),
    needsYou(org, {
      category: "unassigned_load", severity: "medium",
      title: "MD-9051 picks up in 11 hours with no truck",
      reason: "Newark pickup. B-04 is sitting empty 4 miles away and matches the equipment.",
      entity: { kind: "load", id: ld("MD-9051").id, label: "MD-9051 · Newark, NJ → Boston, MA", href: "/loads" },
      recommendedAction: { kind: "assign_load", label: "Assign B-04", requires: ["loads:assign"], deferred: true },
      dueAt: hoursFromNow(11), source: "system", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "missing_document", severity: "medium",
      title: "BOL not uploaded for MD-9038",
      reason: "Loaded 4 hours ago in Richmond. Harbor Point requires the BOL at pickup.",
      entity: { kind: "load", id: ld("MD-9038").id, label: "MD-9038 · Richmond, VA → Charlotte, NC", href: "/loads" },
      recommendedAction: { kind: "request_document", label: "Request BOL", requires: ["documents:view"] },
      dueAt: hoursFromNow(2), source: "system", requires: ["documents:view"],
    }),
    needsYou(org, {
      category: "customer_response", severity: "low",
      title: "Keystone asked for a Pittsburgh update",
      reason: "Alan Pike emailed 2 hours ago asking for an ETA on MD-9042.",
      entity: { kind: "customer", id: "cus_md_keystone", label: "Keystone Brokerage", href: "/customers" },
      recommendedAction: { kind: "contact_customer", label: "Send an ETA update", requires: ["customers:view"] },
      dueAt: hoursFromNow(3), source: "manual", requires: ["customers:view"],
    }),
  ];

  return { loads, events, documents, drivers, customers, needsYou: items };
}

// ---------------------------------------------------------------------------
// Cascade Haul — CARRIER. Sam is a Company driver with assigned/own scope.
// ---------------------------------------------------------------------------

function cascade(): OrgData {
  const org = "org_cascade";
  const me = "drv_cascade_0192";

  const customers: Customer[] = [
    { id: "cus_cs_pacline", organizationId: org, name: "Pacline Logistics", kind: "broker", contactName: "Rhea Doss" },
    { id: "cus_cs_summit", organizationId: org, name: "Summit Goods", kind: "shipper" },
  ];

  const drivers: Driver[] = [
    { id: me, organizationId: org, userId: "usr_sam", displayName: "Sam Murtaza", status: "driving", currentTruckId: TRUCK_IDS.cs47, currentLoadId: undefined, telegramConnected: true, documentWarnings: 1 },
    { id: "drv_cs_02", organizationId: org, displayName: "Owen Fitz", status: "available", currentTruckId: TRUCK_IDS.cs47, telegramConnected: true, documentWarnings: 0 },
  ];


  const TZ = "America/Los_Angeles";
  const { loads, events, documents } = expand(org, [
    {
      ref: "CS-3318", status: "in_transit",
      customer: { id: "cus_cs_pacline", name: "Pacline Logistics", kind: "broker", contact: "Rhea Doss" },
      pickup: { city: "Portland", state: "OR", timeZone: TZ, at: hoursFromNow(-5), arrived: hoursFromNow(-5.2), departed: hoursFromNow(-4.4) },
      delivery: { city: "Eugene", state: "OR", timeZone: TZ, at: hoursFromNow(2), instructions: "Ring the bell at the side door; the dock closes at 18:00." },
      linehaul: 17000, loaded: 110, deadhead: 7, equipment: "cargo_van", weight: 1400,
      driverId: me, driverName: "Sam Murtaza", truckId: TRUCK_IDS.cs47,
      has: ["rate_confirmation", "bill_of_lading"],
    },
    {
      ref: "CS-3321", status: "offered",
      customer: { id: "cus_cs_summit", name: "Summit Goods", kind: "shipper" },
      pickup: { city: "Eugene", state: "OR", timeZone: TZ, at: hoursFromNow(8) },
      delivery: { city: "Boise", state: "ID", timeZone: "America/Boise", at: hoursFromNow(22) },
      linehaul: 47100, loaded: 428, deadhead: 4, equipment: "cargo_van",
      driverId: me, driverName: "Sam Murtaza", truckId: TRUCK_IDS.cs47, consent: "pending",
    },
    {
      ref: "CS-3309", status: "delivered",
      customer: { id: "cus_cs_pacline", name: "Pacline Logistics", kind: "broker", contact: "Rhea Doss" },
      pickup: { city: "Seattle", state: "WA", timeZone: TZ, at: daysFromNow(-3), arrived: daysFromNow(-3), departed: daysFromNow(-3) },
      delivery: { city: "Portland", state: "OR", timeZone: TZ, at: daysFromNow(-3), arrived: daysFromNow(-3), departed: daysFromNow(-3) },
      linehaul: 24400, loaded: 174, deadhead: 5, equipment: "cargo_van",
      driverId: me, driverName: "Sam Murtaza", truckId: TRUCK_IDS.cs47,
      has: ["rate_confirmation", "bill_of_lading"],
    },
    {
      ref: "CS-3324", status: "planned",
      customer: { id: "cus_cs_summit", name: "Summit Goods", kind: "shipper" },
      pickup: { city: "Portland", state: "OR", timeZone: TZ, at: hoursFromNow(18) },
      delivery: { city: "Spokane", state: "WA", timeZone: TZ, at: hoursFromNow(30) },
      linehaul: 44000, loaded: 352, deadhead: 12, equipment: "sprinter",
    },
  ]);

  const ld = (ref: string) => loads.find((l) => l.reference === ref)!;

  const items: NeedsYouItem[] = [
    needsYou(org, {
      category: "status_confirmation", severity: "high",
      title: "Confirm your arrival in Eugene",
      reason: "You are due at the Eugene receiver in about 2 hours. Mark arrived when you are on site.",
      entity: { kind: "load", id: ld("CS-3318").id, label: "CS-3318 · Portland, OR → Eugene, OR", href: "/driver/loads" },
      recommendedAction: { kind: "confirm_status", label: "Open the load", requires: ["loads:status:update"], deferred: true },
      dueAt: hoursFromNow(2), source: "system", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "unassigned_load", severity: "high",
      title: "CS-3321 is waiting for your acceptance",
      reason: "Dispatch offered the Eugene → Boise run. Cascade requires driver consent before dispatch.",
      entity: { kind: "load", id: ld("CS-3321").id, label: "CS-3321 · Eugene, OR → Boise, ID", href: "/driver/loads" },
      recommendedAction: { kind: "confirm_status", label: "Accept or decline", requires: ["loads:status:update"], deferred: true },
      dueAt: hoursFromNow(4), source: "telegram", requires: ["loads:view"],
    }),
    needsYou(org, {
      category: "missing_document", severity: "medium",
      title: "POD needed for CS-3309",
      reason: "Delivered three days ago in Portland. The POD photo has not come through.",
      entity: { kind: "load", id: ld("CS-3309").id, label: "CS-3309 · Seattle, WA → Portland, OR", href: "/driver/loads" },
      recommendedAction: { kind: "request_document", label: "Upload the POD", requires: ["documents:upload"], deferred: true },
      dueAt: hoursFromNow(10), source: "system", requires: ["documents:view"],
    }),
    needsYou(org, {
      category: "truck_going_empty", severity: "medium",
      title: "Unit 47 empty in Portland",
      reason: "Owen Fitz has been available for 9 hours with nothing booked.",
      entity: { kind: "truck", id: TRUCK_IDS.cs47, label: "Unit 47 · Sprinter · Portland, OR", href: "/fleet/trucks" },
      recommendedAction: { kind: "start_search", label: "Start assisted load search", requires: ["loads:view"], deferred: true },
      dueAt: hoursFromNow(3), source: "system", requires: ["trucks:view"],
    }),
  ];

  return { loads, events, documents, drivers, customers, needsYou: items };
}

/** A newly created organization that has not booked anything yet. */
function empty(): OrgData {
  return {
    loads: [], events: [], documents: [],
    drivers: [], customers: [], needsYou: [],
  };
}

// ---------------------------------------------------------------------------
// Summit Dispatch — DISPATCH_AGENCY with a team. Sam owns it.
// Small on purpose: enough work for a team queue to mean something, and no more.
// ---------------------------------------------------------------------------

function summit(): OrgData {
  const org = "org_summit";
  const TZ = "America/Denver";

  const customers: Customer[] = [
    { id: "cus_sm_ridge", organizationId: org, name: "Ridgeline Logistics", kind: "broker", contactName: "Dana Whitlock", phone: "+1 (303) 555-0155" },
    { id: "cus_sm_basin", organizationId: org, name: "Basin Produce Co.", kind: "shipper", contactName: "Tomás Ibarra" },
  ];

  const drivers: Driver[] = [];

  const { loads, events, documents } = expand(org, [
    {
      ref: "SM-4410", status: "in_transit",
      customer: { id: "cus_sm_ridge", name: "Ridgeline Logistics", kind: "broker", mc: "MC-884012", contact: "Dana Whitlock" },
      pickup: { city: "Denver", state: "CO", timeZone: TZ, at: hoursFromNow(-6), arrived: hoursFromNow(-6.4), departed: hoursFromNow(-5.2) },
      delivery: { city: "Salt Lake City", state: "UT", timeZone: TZ, at: hoursFromNow(5) },
      linehaul: 92500, loaded: 521, deadhead: 18, equipment: "dry_van", weight: 31000,
      carrierOrganizationId: "carrier_northline",
      has: ["rate_confirmation", "bill_of_lading"],
    },
    {
      ref: "SM-4412", status: "assigned",
      customer: { id: "cus_sm_basin", name: "Basin Produce Co.", kind: "shipper", contact: "Tomás Ibarra" },
      pickup: { city: "Greeley", state: "CO", timeZone: TZ, at: hoursFromNow(9) },
      delivery: { city: "Phoenix", state: "AZ", timeZone: TZ, at: hoursFromNow(31) },
      linehaul: 118000, loaded: 812, deadhead: 40, equipment: "reefer", weight: 38000,
      carrierOrganizationId: "carrier_northline",
      has: ["rate_confirmation"],
    },
    {
      ref: "SM-4415", status: "planned",
      customer: { id: "cus_sm_ridge", name: "Ridgeline Logistics", kind: "broker", contact: "Dana Whitlock" },
      pickup: { city: "Colorado Springs", state: "CO", timeZone: TZ, at: hoursFromNow(20) },
      delivery: { city: "Albuquerque", state: "NM", timeZone: TZ, at: hoursFromNow(33) },
      linehaul: 64000, loaded: 386, deadhead: 12, equipment: "flatbed",
    },
    {
      ref: "SM-4417", status: "verifying",
      customer: { id: "cus_sm_basin", name: "Basin Produce Co.", kind: "shipper", contact: "Tomás Ibarra" },
      pickup: { city: "Pueblo", state: "CO", timeZone: TZ, at: hoursFromNow(26) },
      delivery: { city: "Las Vegas", state: "NV", timeZone: TZ, at: hoursFromNow(48) },
      linehaul: 87500, loaded: 634, deadhead: 25, equipment: "dry_van",
    },
    {
      ref: "SM-4408", status: "delivered",
      customer: { id: "cus_sm_ridge", name: "Ridgeline Logistics", kind: "broker", contact: "Dana Whitlock" },
      pickup: { city: "Cheyenne", state: "WY", timeZone: TZ, at: hoursFromNow(-40), arrived: hoursFromNow(-40.5), departed: hoursFromNow(-39.2) },
      delivery: { city: "Denver", state: "CO", timeZone: TZ, at: hoursFromNow(-30), arrived: hoursFromNow(-30.3), departed: hoursFromNow(-29.4) },
      linehaul: 41000, loaded: 101, deadhead: 8, equipment: "dry_van",
      has: ["rate_confirmation", "bill_of_lading", "proof_of_delivery"],
    },
  ]);

  return { loads, events, documents, drivers, customers, needsYou: [] };
}

// ---------------------------------------------------------------------------
// The individual dispatcher — a dispatch workspace with one person in it.
// Everything here is Sam's own work; there is nobody to hand it to.
// ---------------------------------------------------------------------------

function solo(): OrgData {
  const org = "org_solo";
  const TZ = "America/Los_Angeles";

  const customers: Customer[] = [
    { id: "cus_so_coastal", organizationId: org, name: "Coastal Freight Group", kind: "broker", contactName: "Priya Raman", phone: "+1 (503) 555-0190" },
    { id: "cus_so_cedar", organizationId: org, name: "Cedar Mill Supply", kind: "shipper", contactName: "Gene Halloran" },
  ];

  const { loads, events, documents } = expand(org, [
    {
      ref: "SD-118", status: "in_transit",
      customer: { id: "cus_so_coastal", name: "Coastal Freight Group", kind: "broker", mc: "MC-902344", contact: "Priya Raman" },
      pickup: { city: "Portland", state: "OR", timeZone: TZ, at: hoursFromNow(-5), arrived: hoursFromNow(-5.4), departed: hoursFromNow(-4.6) },
      delivery: { city: "Seattle", state: "WA", timeZone: TZ, at: hoursFromNow(2) },
      linehaul: 42000, loaded: 174, deadhead: 11, equipment: "sprinter", weight: 2600,
      carrierOrganizationId: "carrier_cascade",
      has: ["rate_confirmation", "bill_of_lading"],
    },
    {
      ref: "SD-121", status: "assigned",
      customer: { id: "cus_so_cedar", name: "Cedar Mill Supply", kind: "shipper", contact: "Gene Halloran" },
      pickup: { city: "Eugene", state: "OR", timeZone: TZ, at: hoursFromNow(12) },
      delivery: { city: "Boise", state: "ID", timeZone: TZ, at: hoursFromNow(27) },
      linehaul: 58000, loaded: 428, deadhead: 19, equipment: "box_truck", weight: 7400,
      carrierOrganizationId: "carrier_cascade",
      has: ["rate_confirmation"],
    },
    {
      ref: "SD-124", status: "planned",
      customer: { id: "cus_so_coastal", name: "Coastal Freight Group", kind: "broker", contact: "Priya Raman" },
      pickup: { city: "Tacoma", state: "WA", timeZone: TZ, at: hoursFromNow(23) },
      delivery: { city: "Spokane", state: "WA", timeZone: TZ, at: hoursFromNow(36) },
      linehaul: 37500, loaded: 299, deadhead: 9, equipment: "cargo_van",
    },
  ]);

  return { loads, events, documents, drivers: [], customers, needsYou: [] };
}

export function buildSeed(): Record<string, OrgData> {
  return {
    org_northline: northline(),
    org_meridian: meridian(),
    org_summit: summit(),
    org_solo: solo(),
    org_cascade: cascade(),
    org_baxter: empty(),
  };
}

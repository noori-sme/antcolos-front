import type {
  Customer, Document, Driver, Load, LoadEvent, NeedsYouItem,
} from "@/types";
import { buildLoad, type LoadSeed } from "./build-load";
import { daysFromNow, hoursFromNow } from "./time";
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
  /**
   * Starts EMPTY for every organization, and stays that way in this file.
   *
   * Needs You items are not fixtures any more. They are generated from live
   * state by `needs-you-derive.ts` on every read and removed again the moment
   * the condition behind them is gone, so a card written here would be a
   * problem that could never be fixed. This array is the place those generated
   * items live, and the place a person's snooze, assignee and history survive
   * between regenerations.
   */
  needsYou: NeedsYouItem[];
}

/** Expands compact load seeds into canonical loads plus timelines and documents. */
function expand(organizationId: string, seeds: LoadSeed[]) {
  const built = seeds.map((s) => buildLoad(organizationId, s));
  return {
    loads: built.map((b) => b.load),
    events: built.flatMap((b) => b.events),
    documents: built.flatMap((b) => b.documents),
  };
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

  return { loads, events, documents, drivers, customers, needsYou: [] };
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

  return { loads, events, documents, drivers, customers, needsYou: [] };
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

  return { loads, events, documents, drivers, customers, needsYou: [] };
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
    // Every organization a membership can switch into needs a partition, even
    // an empty one: a missing partition is not "no data", it is a crash.
    org_baxter: empty(),
  };
}

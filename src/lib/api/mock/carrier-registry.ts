import type {
  CarrierAccessReason, CarrierContact, CarrierDocument, CarrierDocumentKind,
  CarrierProfile, CarrierRule, CarrierView, OperatingAuthority,
} from "@/types";
import type { PermissionKey } from "@/types";
import { fleetSync, truckDispatchGrants, type TruckContext } from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The carrier registry.
 *
 * A permanent record per carrier, global like the truck and trailer registries
 * and for the same reason: the carrier is one business, so its MC number, its
 * authority and its rules are one set of facts, not one set per workspace
 * looking at it. Two dispatch agencies working for the same carrier read the
 * same record and must never be able to disagree about whether it can legally
 * haul.
 *
 * Visibility is derived from relationships and nothing else. A workspace sees a
 * carrier because it IS that carrier, or because that carrier granted it
 * dispatch access to at least one truck. There is no partially-public carrier
 * record and no way to look one up by id without a reason to have it — the same
 * rule the truck registry holds, for the same reason.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 220;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function contact(
  name: string,
  role: CarrierContact["role"],
  opts: { phone?: string; email?: string; primary?: boolean; hours?: string } = {},
): CarrierContact {
  return {
    id: rowId("cc"), name, role,
    phone: opts.phone, email: opts.email,
    isPrimary: opts.primary === true, hours: opts.hours,
  };
}

function rule(
  kind: CarrierRule["kind"],
  label: string,
  detail: string,
  opts: { number?: number; list?: string[]; blocking?: boolean } = {},
): CarrierRule {
  return {
    id: rowId("cr"), kind, label, detail,
    numberValue: opts.number, listValue: opts.list,
    blocking: opts.blocking ?? true,
  };
}

function doc(
  organizationId: string,
  kind: CarrierDocumentKind,
  status: CarrierDocument["status"],
  fileName?: string,
  expiresAt?: string,
  rejectionReason?: string,
): CarrierDocument {
  return {
    id: rowId("cd"), organizationId, kind, status, fileName, expiresAt,
    rejectionReason, updatedAt: daysAgo(30),
  };
}

const authority = (
  status: OperatingAuthority["status"],
  kind?: OperatingAuthority["kind"],
  opts: { grantedDaysAgo?: number; verifiedDaysAgo?: number; note?: string } = {},
): OperatingAuthority => ({
  status, kind,
  grantedAt: opts.grantedDaysAgo === undefined ? undefined : daysAgo(opts.grantedDaysAgo),
  verifiedAt: opts.verifiedDaysAgo === undefined ? undefined : daysAgo(opts.verifiedDaysAgo),
  note: opts.note,
});

function buildFixtures(): CarrierProfile[] {
  return [
    {
      organizationId: "org_northline",
      legalName: "Northline Freight LLC",
      displayName: "Northline Freight",
      mcNumber: "MC-1142908",
      dotNumber: "3487211",
      authority: authority("active", "common", { grantedDaysAgo: 1180, verifiedDaysAgo: 9 }),
      contacts: [
        contact("Dana Whitfield", "dispatch", { phone: "+1 (312) 555-0101", email: "dispatch@northlinefreight.example", primary: true, hours: "Mon–Fri 06:00–20:00 CT" }),
        contact("Sam Murtaza", "owner", { phone: "+1 (312) 555-0148", email: "sam@antcolos.com" }),
        contact("Ruth Okonkwo", "safety", { phone: "+1 (312) 555-0119", email: "safety@northlinefreight.example" }),
        contact("Night desk", "after_hours", { phone: "+1 (312) 555-0100", hours: "20:00–06:00 CT, weekends" }),
      ],
      rules: [
        rule("minimum_rate_per_mile", "At least $2.10/mi", "Northline will not run below $2.10 per loaded mile on any lane.", { number: 210 }),
        rule("max_deadhead_miles", "Deadhead 150 mi or less", "Nothing further than 150 empty miles to a pickup without the owner agreeing first.", { number: 150 }),
        rule("driver_consent_required", "Driver must accept", "Every load is offered to the driver and dispatched only once they accept.", {}),
        rule("no_hazmat", "No hazmat", "No hazardous materials on any unit, regardless of endorsement.", {}),
        rule("refused_states", "Not into NY or NYC", "Northline does not run into New York City or anywhere in New York state.", { list: ["NY"] }),
        rule("broker_credit_minimum", "Broker credit 90 or better", "Brokers below a 90 credit score need the owner's approval before booking.", { number: 90, blocking: false }),
      ],
      documents: [
        doc("org_northline", "operating_authority", "approved", "northline-authority.pdf"),
        doc("org_northline", "certificate_of_insurance", "approved", "northline-coi.pdf", daysFromNow(140)),
        doc("org_northline", "w9", "approved", "northline-w9.pdf"),
        doc("org_northline", "carrier_packet", "approved", "northline-packet.pdf"),
      ],
      dispatchNotes:
        "Call the driver before you book anything with a same-day pickup. Reefer loads go to Marisol only.",
      createdAt: daysAgo(1180),
    },
    {
      organizationId: "org_baxter",
      legalName: "Baxter Transit LLC",
      displayName: "Baxter Transit",
      mcNumber: "MC-1098447",
      dotNumber: "3155902",
      authority: authority("active", "common", { grantedDaysAgo: 900, verifiedDaysAgo: 40 }),
      contacts: [
        contact("Corina Baxter", "owner", { phone: "+1 (610) 555-0177", email: "corina@baxtertransit.example", primary: true, hours: "Mon–Sat 07:00–19:00 ET" }),
        contact("Book keeping", "accounting", { email: "ap@baxtertransit.example" }),
      ],
      rules: [
        rule("minimum_rate_per_mile", "At least $1.95/mi", "Baxter takes nothing under $1.95 per loaded mile.", { number: 195 }),
        rule("max_deadhead_miles", "Deadhead 100 mi or less", "No more than 100 empty miles to a pickup.", { number: 100 }),
        rule("max_weight_lbs", "Up to 44,000 lb", "Baxter's trailers are not plated above 44,000 lb of freight.", { number: 44_000 }),
      ],
      documents: [
        doc("org_baxter", "operating_authority", "approved", "baxter-authority.pdf"),
        // Lapses inside the month. A dispatcher needs to see this coming.
        doc("org_baxter", "certificate_of_insurance", "expiring_soon", "baxter-coi.pdf", daysFromNow(19)),
        doc("org_baxter", "w9", "approved", "baxter-w9.pdf"),
      ],
      createdAt: daysAgo(900),
    },
    {
      organizationId: "org_ridgeway",
      legalName: "Ridgeway Carriers Inc.",
      displayName: "Ridgeway Carriers",
      mcNumber: "MC-877240",
      dotNumber: "2884103",
      authority: authority("active", "contract", { grantedDaysAgo: 1500, verifiedDaysAgo: 62 }),
      contacts: [
        contact("Pete Ridgeway", "owner", { phone: "+1 (973) 555-0144", primary: true }),
        contact("Ana Duarte", "dispatch", { phone: "+1 (973) 555-0145", email: "ana@ridgewaycarriers.example", hours: "Mon–Fri 05:00–17:00 ET" }),
      ],
      rules: [
        rule("minimum_rate_per_mile", "At least $2.00/mi", "Nothing under $2.00 per loaded mile.", { number: 200 }),
        rule("driver_consent_required", "Driver must accept", "Ridgeway drivers accept their own loads.", {}),
        rule("refused_brokers", "Not with Harbor Point", "Ridgeway will not work with Harbor Point Freight after a payment dispute.", { list: ["Harbor Point Freight"] }),
      ],
      documents: [
        doc("org_ridgeway", "operating_authority", "approved", "ridgeway-authority.pdf"),
        doc("org_ridgeway", "certificate_of_insurance", "approved", "ridgeway-coi.pdf", daysFromNow(210)),
      ],
      createdAt: daysAgo(1500),
    },
    {
      organizationId: "org_crosswind",
      legalName: "Crosswind Freight LLC",
      displayName: "Crosswind Freight",
      dotNumber: "3901122",
      // The record says the authority lapsed. Nothing should be booked on this
      // carrier's trucks until it is sorted out, and the MT Loop says so.
      authority: authority("inactive", "common", {
        grantedDaysAgo: 420, verifiedDaysAgo: 3,
        note: "Authority went inactive when the insurance filing lapsed. Reinstatement is with the carrier.",
      }),
      contacts: [
        contact("Luis Carrera", "dispatch", { phone: "+1 (804) 555-0192", primary: true }),
      ],
      rules: [
        rule("minimum_rate_per_mile", "At least $2.25/mi", "Crosswind runs short lanes and prices them accordingly.", { number: 225 }),
      ],
      documents: [
        doc("org_crosswind", "operating_authority", "expired", "crosswind-authority.pdf", daysFromNow(-14)),
        doc("org_crosswind", "certificate_of_insurance", "expired", "crosswind-coi.pdf", daysFromNow(-11)),
      ],
      createdAt: daysAgo(420),
    },
    {
      organizationId: "org_cascade",
      legalName: "Cascade Haul Co.",
      displayName: "Cascade Haul",
      mcNumber: "MC-1044921",
      dotNumber: "2910446",
      authority: authority("active", "common", { grantedDaysAgo: 690, verifiedDaysAgo: 17 }),
      contacts: [
        contact("Rhea Doss", "dispatch", { phone: "+1 (503) 555-0133", email: "dispatch@cascadehaul.example", primary: true, hours: "Mon–Fri 06:00–18:00 PT" }),
        contact("Owen Fitz", "after_hours", { phone: "+1 (503) 555-0134" }),
      ],
      rules: [
        rule("minimum_rate_per_mile", "At least $1.85/mi", "Cascade runs the I-5 corridor and needs $1.85 per loaded mile to make it work.", { number: 185 }),
        rule("max_deadhead_miles", "Deadhead 75 mi or less", "Short deadheads only; the fleet stays close to Portland.", { number: 75 }),
        rule("driver_consent_required", "Driver must accept", "Cascade requires the driver to accept before dispatch.", {}),
      ],
      documents: [
        doc("org_cascade", "certificate_of_insurance", "approved", "cascade-coi.pdf", daysFromNow(95)),
        // The authority is active on the record, but nobody has ever put the
        // letter on file. Worth chasing, and NOT the same thing as the carrier
        // being unable to haul — which is why it is a document problem here and
        // Crosswind's lapsed authority is a different problem entirely.
        doc("org_cascade", "operating_authority", "missing"),
        doc("org_cascade", "w9", "approved", "cascade-w9.pdf"),
      ],
      dispatchNotes: "Owen prefers to be home Friday nights. Do not book him anything that keeps him out over a weekend.",
      createdAt: daysAgo(700),
    },
  ];
}

let registry: CarrierProfile[] | null = null;

function db(): CarrierProfile[] {
  if (!registry) registry = buildFixtures();
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetCarrierRegistry() {
  registry = null;
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Why — if at all — this workspace may see this carrier.
 *
 * Two reasons, and no third. Being able to name a carrier, having worked for it
 * once, or sharing a broker with it are all not reasons.
 */
export function carrierAccessReason(
  organizationId: string,
  ctx: TruckContext,
): CarrierAccessReason | null {
  if (organizationId === ctx.organizationId) return "own_organization";
  // A live dispatch grant on any of the carrier's trucks. Working that out from
  // the truck registry rather than storing a second copy of the relationship is
  // what stops the two drifting apart.
  const granted = fleetSync(ctx).some((t) => t.carrierOrganizationId === organizationId);
  return granted ? "dispatch_access" : null;
}

const CARRIER_PERMS: PermissionKey[] = ["trucks:view"];

function mayRead(ctx: TruckContext): boolean {
  return CARRIER_PERMS.every((p) => ctx.permissions.has(p));
}

function project(
  profile: CarrierProfile,
  reason: CarrierAccessReason,
  ctx: TruckContext,
): CarrierView {
  return {
    organizationId: profile.organizationId,
    legalName: profile.legalName,
    displayName: profile.displayName,
    mcNumber: profile.mcNumber,
    dotNumber: profile.dotNumber,
    authority: profile.authority,
    contacts: profile.contacts,
    rules: profile.rules,
    documents: profile.documents,
    dispatchNotes: profile.dispatchNotes,
    reason,
    truckCount: fleetSync(ctx).filter(
      (t) => (t.carrierOrganizationId ?? ctx.organizationId) === profile.organizationId,
    ).length,
    canHaul: profile.authority.status === "active",
  };
}

/**
 * One carrier, as this workspace may see it.
 *
 * Returns nothing both for a carrier that does not exist and for one this
 * workspace has no relationship with — anything else turns an id field into a
 * directory of other people's carriers.
 */
export function carrierViewSync(
  organizationId: string,
  ctx: TruckContext,
): CarrierView | undefined {
  if (!mayRead(ctx)) return undefined;
  const profile = db().find((c) => c.organizationId === organizationId);
  if (!profile) return undefined;
  const reason = carrierAccessReason(organizationId, ctx);
  if (!reason) return undefined;
  return project(profile, reason, ctx);
}

export async function carrierView(
  organizationId: string,
  ctx: TruckContext,
): Promise<CarrierView | undefined> {
  await sleep(LATENCY_MS);
  return carrierViewSync(organizationId, ctx);
}

/**
 * Every carrier this workspace works for, alphabetically.
 *
 * Assembled from the grants the workspace actually holds rather than by
 * filtering the whole registry, so a carrier with no live relationship is never
 * even considered.
 */
export function carriersForWorkspaceSync(ctx: TruckContext): CarrierView[] {
  if (!mayRead(ctx)) return [];
  const ids = new Set<string>();
  for (const truck of fleetSync(ctx)) {
    ids.add(truck.carrierOrganizationId ?? ctx.organizationId);
  }
  return [...ids]
    .map((id) => carrierViewSync(id, ctx))
    .filter((c): c is CarrierView => c !== undefined)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * The carrier record behind a truck, for callers that already know the truck is
 * theirs to see.
 *
 * Still goes through the access check: knowing about the truck is not the same
 * as being entitled to the carrier's contacts, rules and paperwork.
 */
export function carrierForTruckSync(
  truckId: string,
  ctx: TruckContext,
): CarrierView | undefined {
  const grants = truckDispatchGrants(truckId);
  const mine = grants.find((g) => g.dispatchOrganizationId === ctx.organizationId);
  const carrierId = mine?.grantedByCarrierOrganizationId ?? ctx.organizationId;
  return carrierViewSync(carrierId, ctx);
}

/** The raw record, for services that need it. Never reached by a screen. */
export function carrierProfile(organizationId: string): CarrierProfile | undefined {
  return db().find((c) => c.organizationId === organizationId);
}

import type {
  Address, CarrierPartyRelationship, ConfirmedResolution, CommitResult,
  ContactProfileView, DirectoryEvent, DirectoryEventKind, DirectoryListing,
  ExtractedContact, ExtractedFacility, ExtractedParty, ExtractedPartyBlock,
  Facility, FacilityProfileView, PartyContact, PartyContactKind, PartyLoadLink,
  PartyClaim, PartyNote, PartyProfileView, PartyProvenance, PartyRole, PartySnapshot,
  PartyStanding, PaymentExperience, PermissionKey, Party, ResolutionOutcome,
  ResolutionPlan, PartyResolutionProposal, RateConfirmationExtraction,
} from "@/types";
import type { ActorRef } from "@/types";
import {
  rankContactCandidates, rankFacilityCandidates, rankPartyCandidates,
  recommendFor, thinExtraction,
} from "@/lib/directory/matching";
import { decideAutoIndexForBlocks } from "@/lib/directory/auto-broker";
import {
  normalizeCompanyName, normalizeDotNumber, normalizeEmail, normalizeMcNumber,
  normalizePhone, normalizeScac,
} from "@/lib/directory/normalize";
import { mockStore } from "./store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE permanent Broker, Shipper, Receiver, Facility and Contact directory.
 *
 * Two things about its shape are deliberate and worth reading before changing
 * anything here.
 *
 * 1. The canonical records are NOT partitioned by organization.
 *
 *    A broker exists once in the world, so it exists once here — the same
 *    reason the truck and trailer registries are global. If every carrier kept
 *    its own copy of "TQL", an MC number would stop being a unique key and the
 *    entity resolution this whole module exists for would have nothing to
 *    resolve against. What a carrier *sees in its directory* is still narrowed:
 *    the list shows the companies it has a relationship with, and nothing else.
 *
 * 2. Everything a carrier thinks is partitioned, at the store.
 *
 *    Notes, ratings, blocked and preferred standing, payment experience and
 *    private history live in rows keyed by carrier organization, and every
 *    accessor for them takes that organization from the context — never from a
 *    parameter a screen could supply. Northline cannot read Baxter's opinion of
 *    a broker because there is no code path that would return it, not because
 *    a component declines to render it.
 *
 * The resolution service at the bottom is the part the future rate confirmation
 * workflow calls. It plans, it explains, and it waits: `planResolution` never
 * writes anything, and `commitResolution` applies only what a dispatcher
 * confirmed.
 */

const LATENCY_MS = 260;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const iso = (d: Date) => d.toISOString();
const now = () => iso(new Date());
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;

/** A party's, facility's and contact's permanent id is a UUID and nothing else. */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Context and errors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The caller. Mirrors ServiceContext: an organization and the permissions of
 * the membership acting inside it. Never a user, and never an organization
 * supplied by a form.
 */
export interface PartyContext {
  organizationId: string;
  membershipId: string;
  actorName: string;
  userId: string;
  permissions: ReadonlySet<PermissionKey>;
}

export class PartyPermissionError extends Error {
  missing: PermissionKey[];
  constructor(missing: PermissionKey[]) {
    super(`Missing permission: ${missing.join(", ")}`);
    this.name = "PartyPermissionError";
    this.missing = missing;
  }
}

/**
 * Thrown for an unknown record AND for one this organization may not see. The
 * two are indistinguishable on purpose, so a URL cannot be used to probe which
 * companies another carrier hauls for.
 */
export class PartyNotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found`);
    this.name = "PartyNotFoundError";
  }
}

function requirePermissions(ctx: PartyContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new PartyPermissionError(missing);
}

function actorOf(ctx: PartyContext): ActorRef {
  return {
    userId: ctx.userId,
    membershipId: ctx.membershipId,
    displayNameSnapshot: ctx.actorName,
    source: "web",
  };
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

interface RegistryState {
  /** Global: a company exists once. */
  parties: Party[];
  facilities: Facility[];
  contacts: PartyContact[];
  /** Private, keyed by carrier organization. */
  relationships: CarrierPartyRelationship[];
  notes: PartyNote[];
  /** Private: a carrier's loads are its own. */
  loadLinks: PartyLoadLink[];
  events: DirectoryEvent[];
}

let state: RegistryState | null = null;

function db(): RegistryState {
  if (!state) state = buildFixtures();
  return state;
}

/** Test hook. Never called by the UI. */
export function resetPartyRegistry() {
  state = null;
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                            */
/* -------------------------------------------------------------------------- */

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

function provenance(
  organizationId: string,
  kind: PartyProvenance["kind"] = "rate_confirmation",
  documentId?: string,
): PartyProvenance {
  return {
    kind,
    documentId,
    recordedAt: daysAgo(40),
    recordedBy: SYSTEM_ACTOR,
    recordedByOrganizationId: organizationId,
  };
}

interface PartySeed {
  key: string;
  organizationId: string;
  roles: PartyRole[];
  legalName: string;
  dbaName?: string;
  mcNumber?: string;
  dotNumber?: string;
  address?: Address;
  phone?: string;
  email?: string;
  website?: string;
  provisional?: string;
  /** Seeds an already-claimed brokerage, for the screens that show one. */
  claim?: PartyClaim;
  /** Seeds a record nobody confirmed, for the auto-indexed badge. */
  provenanceKind?: PartyProvenance["kind"];
}

function makeParty(seed: PartySeed): Party {
  const created = daysAgo(40);
  return {
    partyId: uuid(),
    roles: [...seed.roles],
    legalName: seed.legalName,
    dbaName: seed.dbaName,
    identifiers: {
      mcNumber: normalizeMcNumber(seed.mcNumber),
      dotNumber: normalizeDotNumber(seed.dotNumber),
      scac: normalizeScac(undefined),
      asPrinted: seed.mcNumber ? { mcNumber: seed.mcNumber } : undefined,
    },
    primaryAddress: seed.address,
    phone: seed.phone,
    email: seed.email,
    website: seed.website,
    status: seed.provisional ? "provisional" : "active",
    reviewReason: seed.provisional,
    // Fixtures are seeded as dispatcher-confirmed where a person would have
    // confirmed them. Nothing here is ever "externally_verified": no fixture,
    // and no rate confirmation, may claim a check that never happened.
    verification: seed.provisional
      ? { state: "unverified" }
      : { state: "dispatcher_confirmed", confirmedBy: SYSTEM_ACTOR, checkedAt: created },
    // No fixture is claimed. Claiming means a real brokerage proved a record is
    // theirs, and seeding one would put words in a company's mouth.
    claim: seed.claim ?? { state: "unclaimed" },
    provenance: provenance(seed.organizationId, seed.provenanceKind),
    createdAt: created,
    updatedAt: created,
    createdByOrganizationId: seed.organizationId,
  };
}

function makeFacility(
  partyId: string,
  organizationId: string,
  name: string,
  address: Address,
  functions: Facility["functions"],
  extra: Partial<Facility> = {},
): Facility {
  return {
    facilityId: uuid(),
    partyId,
    name,
    address,
    functions,
    status: "active",
    provenance: provenance(organizationId),
    createdAt: daysAgo(40),
    updatedAt: daysAgo(40),
    createdByOrganizationId: organizationId,
    ...extra,
  };
}

function makeContact(
  partyId: string,
  organizationId: string,
  kind: PartyContactKind,
  fullName: string,
  extra: Partial<PartyContact> = {},
): PartyContact {
  return {
    contactId: uuid(),
    partyId,
    kind,
    fullName,
    status: "active",
    provenance: provenance(organizationId),
    createdAt: daysAgo(40),
    updatedAt: daysAgo(40),
    createdByOrganizationId: organizationId,
    ...extra,
  };
}

function makeRelationship(
  carrierOrganizationId: string,
  partyId: string,
  extra: Partial<CarrierPartyRelationship> = {},
): CarrierPartyRelationship {
  return {
    id: rowId("rel"),
    carrierOrganizationId,
    partyId,
    standing: "standard",
    loadCount: 0,
    createdAt: daysAgo(40),
    updatedAt: daysAgo(3),
    ...extra,
  };
}

function event(
  carrierOrganizationId: string,
  kind: DirectoryEventKind,
  summary: string,
  target: { partyId?: string; facilityId?: string; contactId?: string; loadId?: string },
  options: { private?: boolean; occurredAt?: string; actor?: ActorRef; changes?: DirectoryEvent["changes"] } = {},
): DirectoryEvent {
  return {
    id: rowId("dev"),
    carrierOrganizationId,
    private: options.private ?? false,
    kind,
    ...target,
    occurredAt: options.occurredAt ?? daysAgo(40),
    actor: options.actor ?? SYSTEM_ACTOR,
    summary,
    changes: options.changes,
  };
}

function snapshotFrom(
  party: Party,
  facility?: Facility,
  contact?: PartyContact,
): PartySnapshot {
  return {
    legalName: party.legalName,
    dbaName: party.dbaName,
    mcNumber: party.identifiers.mcNumber,
    dotNumber: party.identifiers.dotNumber,
    address: party.primaryAddress,
    phone: party.phone,
    email: party.email,
    facilityName: facility?.name,
    facilityAddress: facility?.address,
    facilityHoursText: facility?.hoursText,
    contactName: contact?.fullName,
    contactPhone: contact?.phone,
    contactEmail: contact?.email,
  };
}

/**
 * Fixtures.
 *
 * Every load link points at a load that actually exists in the load seed,
 * resolved by its reference at build time — so a party profile's load history
 * opens real loads, and the "profile shows loads without owning them" claim is
 * something a reviewer can click on rather than take on trust.
 */
function buildFixtures(): RegistryState {
  const parties: Party[] = [];
  const facilities: Facility[] = [];
  const contacts: PartyContact[] = [];
  const relationships: CarrierPartyRelationship[] = [];
  const notes: PartyNote[] = [];
  const loadLinks: PartyLoadLink[] = [];
  const events: DirectoryEvent[] = [];

  const NL = "org_northline";
  const MD = "org_meridian";
  const CS = "org_cascade";
  const BX = "org_baxter";

  /** A load's real UUID, looked up by the reference the seed gave it. */
  const loadId = (organizationId: string, reference: string): string | undefined => {
    try {
      return mockStore.org(organizationId).loads.find((l) => l.reference === reference)?.id;
    } catch {
      return undefined;
    }
  };

  const push = <T>(list: T[], item: T): T => {
    list.push(item);
    return item;
  };

  // ---- Northline Freight -------------------------------------------------

  const apex = push(parties, makeParty({
    key: "apex", organizationId: NL, roles: ["broker"],
    legalName: "Apex Logistics LLC", dbaName: "Apex Logistics",
    mcNumber: "MC-612884", dotNumber: "2884110",
    address: { line1: "400 W Monroe St", line2: "Suite 1800", city: "Chicago", state: "IL", postalCode: "60606" },
    phone: "+1 (312) 555-0110", email: "dispatch@apexlog.example", website: "apexlog.example",
  }));

  const tandem = push(parties, makeParty({
    key: "tandem", organizationId: NL, roles: ["broker"],
    legalName: "Tandem Freight Partners Inc.",
    mcNumber: "MC-908114", dotNumber: "3114882",
    address: { line1: "2250 N Elston Ave", city: "Chicago", state: "IL", postalCode: "60614" },
    phone: "+1 (773) 555-0143", email: "ops@tandemfreight.example",
  }));

  /**
   * A second company whose name normalizes close to Tandem's and which carries
   * no MC number. It is here so the "two plausible candidates, pick one"
   * path is reachable in the demo rather than only in a test.
   */
  const tandemLogistics = push(parties, makeParty({
    key: "tandem_logistics", organizationId: NL, roles: ["broker"],
    legalName: "Tandem Freight Services LLC",
    address: { line1: "18 Commerce Dr", city: "Naperville", state: "IL", postalCode: "60563" },
    phone: "+1 (630) 555-0197",
    provisional: "Created from a rate confirmation that carried no MC number",
  }));

  /**
   * A broker Antcolos indexed on its own, with nobody in the loop.
   *
   * Seeded because the demo cannot otherwise reach this state: every broker the
   * fixture rate confirmations name is already in this directory, so the
   * indexer correctly abstains on all of them and the badge would never appear
   * on screen. Signing a confirmation for a genuinely unknown broker produces
   * exactly this record — see `auto-broker-indexing.test.ts`, which drives that
   * path for real.
   *
   * ★ WHY IT HAS A RELATIONSHIP AND THE INDEXER CREATES NONE ★
   * `visibleParties` lists the companies a carrier has a relationship with, and
   * auto-indexing deliberately creates no relationship — it writes the shared
   * company record and nothing carrier-private. So a freshly indexed broker is
   * a canonical record that stops the next confirmation duplicating it, and it
   * enters a carrier's directory at the moment that carrier links a load to it
   * in Directory → Review. This fixture is seeded one step past that, with the
   * zero-load relationship such a link produces, so the badge is visible.
   */
  const ridgeline = push(parties, makeParty({
    key: "ridgeline_auto", organizationId: NL, roles: ["broker"],
    legalName: "Ridgeline Freight Brokers LLC",
    mcNumber: "MC-1042778",
    address: { line1: "870 N Arrowhead Ave", city: "San Bernardino", state: "CA", postalCode: "92401" },
    phone: "+1 (909) 555-0117",
    provisional:
      "Indexed automatically from a rate confirmation. Nobody has confirmed it and the "
      + "brokerage has not claimed it.",
    provenanceKind: "rate_confirmation_auto",
  }));

  const rivet = push(parties, makeParty({
    key: "rivet", organizationId: NL, roles: ["shipper", "receiver"],
    legalName: "Rivet Supply Co.",
    address: { line1: "1400 Kinnear Rd", city: "Columbus", state: "OH", postalCode: "43212" },
    phone: "+1 (614) 555-0166", email: "logistics@rivetsupply.example",
  }));

  const glenmark = push(parties, makeParty({
    key: "glenmark", organizationId: NL, roles: ["shipper"],
    legalName: "Glenmark Distribution LLC",
    address: { line1: "3300 N Main St", city: "Rockford", state: "IL", postalCode: "61103" },
    phone: "+1 (815) 555-0122",
  }));

  const apexDock = push(facilities, makeFacility(
    apex.partyId, NL, "Apex Cross-Dock 4",
    { line1: "5600 W 73rd St", city: "Chicago", state: "IL", postalCode: "60638" },
    ["pickup"],
    {
      timeZone: "America/Chicago",
      hoursText: "Mon–Fri 06:00–18:00",
      appointmentRequired: false,
      instructions: "Dock 12. Driver must check in at the guard shack with the PU number.",
    },
  ));

  const rivetColumbus = push(facilities, makeFacility(
    rivet.partyId, NL, "Rivet DC Columbus",
    { line1: "2900 Charter St", city: "Columbus", state: "OH", postalCode: "43228" },
    ["delivery"],
    {
      timeZone: "America/New_York",
      hoursText: "Mon–Sat 07:00–15:00",
      appointmentRequired: true,
      instructions: "Appointment is firm. Late arrivals are rescheduled to the next morning.",
    },
  ));

  const rivetJoliet = push(facilities, makeFacility(
    rivet.partyId, NL, "Rivet Plant — Joliet",
    { line1: "1750 Channahon Rd", city: "Joliet", state: "IL", postalCode: "60436" },
    ["pickup"],
    { timeZone: "America/Chicago", hoursText: "24/7", appointmentRequired: false },
  ));

  const glenmarkRockford = push(facilities, makeFacility(
    glenmark.partyId, NL, "Glenmark Rockford Warehouse",
    { line1: "3300 N Main St", city: "Rockford", state: "IL", postalCode: "61103" },
    ["pickup"],
    { timeZone: "America/Chicago", hoursText: "Mon–Fri 07:00–16:00" },
  ));

  const danaWells = push(contacts, makeContact(apex.partyId, NL, "broker_agent", "Dana Wells", {
    title: "Senior broker",
    phone: "+1 (312) 555-0110",
    phoneExtension: "204",
    email: "dana@apexlog.example",
  }));

  const apexYard = push(contacts, makeContact(apex.partyId, NL, "facility_contact", "Yard office", {
    facilityId: apexDock.facilityId,
    phone: "+1 (312) 555-0188",
  }));

  const priyaRaman = push(contacts, makeContact(tandem.partyId, NL, "broker_agent", "Priya Raman", {
    title: "Account manager",
    phone: "+1 (773) 555-0143",
    email: "priya@tandemfreight.example",
  }));

  const marcoBell = push(contacts, makeContact(rivet.partyId, NL, "facility_contact", "Marco Bell", {
    facilityId: rivetColumbus.facilityId,
    title: "Receiving supervisor",
    phone: "+1 (614) 555-0140",
    email: "mbell@rivetsupply.example",
  }));

  const eliRoss = push(contacts, makeContact(glenmark.partyId, NL, "facility_contact", "Eli Ross", {
    facilityId: glenmarkRockford.facilityId,
    title: "Shipping clerk",
    phone: "+1 (815) 555-0122",
  }));

  relationships.push(
    makeRelationship(NL, apex.partyId, {
      standing: "preferred",
      standingReason: "Pays in 21 days without chasing, and the Chicago dock never holds us up.",
      rating: 5,
      loadCount: 3,
      firstLoadAt: daysAgo(38),
      lastLoadAt: daysAgo(6),
      internalReference: "APX",
      paymentExperience: {
        termsDays: 30, averageDaysToPay: 21, lastPaidAt: daysAgo(9),
        openInvoiceCount: 1, disputeCount: 0, factored: false,
        notes: "Quick-pay offered at 2% — not worth it at 21 days.",
      },
    }),
    makeRelationship(NL, tandem.partyId, {
      standing: "watch",
      standingReason: "Two detention claims still unpaid from August.",
      rating: 3,
      loadCount: 2,
      firstLoadAt: daysAgo(30),
      lastLoadAt: daysAgo(2),
      paymentExperience: {
        termsDays: 30, averageDaysToPay: 44, openInvoiceCount: 2, disputeCount: 2,
        notes: "Detention is always disputed. Get it in writing before the driver leaves.",
      },
    }),
    makeRelationship(NL, tandemLogistics.partyId, { standing: "standard", loadCount: 0 }),
    // Zero loads on purpose: Northline has met this broker on paperwork and
    // has not hauled for them yet. See the seed below for why it exists.
    makeRelationship(NL, ridgeline.partyId, { standing: "standard", loadCount: 0 }),
    makeRelationship(NL, rivet.partyId, {
      standing: "standard", rating: 4, loadCount: 2,
      firstLoadAt: daysAgo(20), lastLoadAt: daysAgo(1),
    }),
    makeRelationship(NL, glenmark.partyId, {
      standing: "standard", rating: 4, loadCount: 2,
      firstLoadAt: daysAgo(14), lastLoadAt: daysAgo(3),
    }),
  );

  notes.push(
    {
      id: rowId("note"), carrierOrganizationId: NL, partyId: apex.partyId,
      body: "Dana will take a truck off the board on a Friday afternoon if we call her directly rather than emailing.",
      pinned: true, author: SYSTEM_ACTOR, createdAt: daysAgo(12),
    },
    {
      id: rowId("note"), carrierOrganizationId: NL, partyId: tandem.partyId,
      body: "Do not run for them without a signed rate confirmation naming the detention rate. Two claims outstanding.",
      pinned: true, author: SYSTEM_ACTOR, createdAt: daysAgo(5),
    },
    {
      id: rowId("note"), carrierOrganizationId: NL, facilityId: rivetColumbus.facilityId,
      body: "Appointment is genuinely firm here. Arrive 30 minutes early or it rolls to the next morning.",
      pinned: false, author: SYSTEM_ACTOR, createdAt: daysAgo(8),
    },
  );

  /**
   * Baxter's private view of the SAME broker. Northline must never see this
   * row, and the fact that it exists at all is what makes the isolation
   * demonstrable rather than asserted.
   */
  relationships.push(makeRelationship(BX, apex.partyId, {
    standing: "blocked",
    standingReason: "Held our driver 9 hours in Chicago and refused the detention claim.",
    rating: 1,
    loadCount: 1,
    paymentExperience: { termsDays: 30, averageDaysToPay: 71, disputeCount: 1, openInvoiceCount: 1 },
  }));
  notes.push({
    id: rowId("note"), carrierOrganizationId: BX, partyId: apex.partyId,
    body: "Blocked. Do not accept loads from this broker without prepayment.",
    pinned: true, author: SYSTEM_ACTOR, createdAt: daysAgo(15),
  });

  // Load links — the join, carrying the frozen snapshot.
  const link = (
    carrierOrganizationId: string,
    reference: string,
    role: PartyRole,
    party: Party,
    facility?: Facility,
    contact?: PartyContact,
    daysBack = 10,
  ) => {
    const id = loadId(carrierOrganizationId, reference);
    if (!id) return;
    loadLinks.push({
      id: rowId("pll"),
      carrierOrganizationId,
      loadId: id,
      role,
      partyId: party.partyId,
      facilityId: facility?.facilityId,
      contactId: contact?.contactId,
      rateConfirmationDocumentId: mockStore
        .org(carrierOrganizationId)
        .documents.find(
          (d) => d.kind === "rate_confirmation" &&
            d.links.some((l) => l.entityKind === "load" && l.entityId === id),
        )?.id,
      snapshot: snapshotFrom(party, facility, contact),
      linkedAt: daysAgo(daysBack),
      linkedBy: SYSTEM_ACTOR,
    });
  };

  link(NL, "NL-24817", "broker", apex, apexDock, danaWells, 1);
  link(NL, "NL-24817", "shipper", apex, apexDock, apexYard, 1);
  link(NL, "NL-24817", "receiver", rivet, rivetColumbus, marcoBell, 1);
  link(NL, "NL-24816", "shipper", rivet, rivetJoliet, undefined, 1);
  link(NL, "NL-24812", "broker", tandem, undefined, priyaRaman, 3);
  link(NL, "NL-24809", "broker", apex, undefined, danaWells, 1);
  link(NL, "NL-24805", "shipper", glenmark, glenmarkRockford, eliRoss, 4);
  link(NL, "NL-24799", "broker", apex, apexDock, danaWells, 7);
  link(NL, "NL-24821", "broker", tandem, undefined, priyaRaman, 1);
  link(NL, "NL-24790", "shipper", glenmark, glenmarkRockford, undefined, 9);

  // ---- Meridian Dispatch -------------------------------------------------

  const keystone = push(parties, makeParty({
    key: "keystone", organizationId: MD, roles: ["broker"],
    legalName: "Keystone Brokerage Inc.",
    mcNumber: "MC-771220", dotNumber: "2712204",
    address: { line1: "120 Broadway", city: "New York", state: "NY", postalCode: "10271" },
    phone: "+1 (646) 555-0121", email: "loads@keystonebrokerage.example",
  }));

  const harbor = push(parties, makeParty({
    key: "harbor", organizationId: MD, roles: ["broker"],
    legalName: "Harbor Point Freight",
    address: { line1: "88 Dock St", city: "Baltimore", state: "MD", postalCode: "21231" },
    phone: "+1 (410) 555-0178",
    provisional: "No MC number on the rate confirmation it came from",
  }));

  const vantage = push(parties, makeParty({
    key: "vantage", organizationId: MD, roles: ["shipper", "receiver"],
    legalName: "Vantage Shippers LLC",
    address: { line1: "700 Tradepoint Ave", city: "Sparrows Point", state: "MD", postalCode: "21219" },
    phone: "+1 (410) 555-0133",
  }));

  const vantageDock = push(facilities, makeFacility(
    vantage.partyId, MD, "Vantage Tradepoint Terminal",
    { line1: "700 Tradepoint Ave", city: "Sparrows Point", state: "MD", postalCode: "21219" },
    ["pickup", "delivery"],
    { timeZone: "America/New_York", hoursText: "Mon–Fri 05:00–21:00", appointmentRequired: true },
  ));

  const alanPike = push(contacts, makeContact(keystone.partyId, MD, "broker_agent", "Alan Pike", {
    title: "Broker", phone: "+1 (646) 555-0121", email: "apike@keystonebrokerage.example",
  }));
  const niaColes = push(contacts, makeContact(harbor.partyId, MD, "broker_agent", "Nia Coles", {
    phone: "+1 (410) 555-0178",
  }));
  const owenPratt = push(contacts, makeContact(vantage.partyId, MD, "facility_contact", "Owen Pratt", {
    facilityId: vantageDock.facilityId, title: "Dock lead", phone: "+1 (410) 555-0133",
  }));

  relationships.push(
    makeRelationship(MD, keystone.partyId, {
      standing: "preferred", rating: 4, loadCount: 2,
      firstLoadAt: daysAgo(26), lastLoadAt: daysAgo(2),
      paymentExperience: { termsDays: 30, averageDaysToPay: 26, openInvoiceCount: 1 },
    }),
    makeRelationship(MD, harbor.partyId, { standing: "standard", loadCount: 2, lastLoadAt: daysAgo(4) }),
    makeRelationship(MD, vantage.partyId, { standing: "standard", rating: 4, loadCount: 1, lastLoadAt: daysAgo(5) }),
  );

  notes.push({
    id: rowId("note"), carrierOrganizationId: MD, partyId: harbor.partyId,
    body: "Ask Nia for their MC number before the next load — this profile is provisional until we have it.",
    pinned: true, author: SYSTEM_ACTOR, createdAt: daysAgo(4),
  });

  link(MD, "MD-9047", "broker", keystone, undefined, alanPike, 2);
  link(MD, "MD-9051", "broker", harbor, undefined, niaColes, 1);
  link(MD, "MD-9038", "shipper", vantage, vantageDock, owenPratt, 5);
  link(MD, "MD-9050", "broker", keystone, undefined, alanPike, 3);

  // ---- Cascade Haul ------------------------------------------------------

  const pacline = push(parties, makeParty({
    key: "pacline", organizationId: CS, roles: ["broker"],
    legalName: "Pacline Logistics LLC",
    mcNumber: "MC-455901",
    address: { line1: "1201 SW Alder St", city: "Portland", state: "OR", postalCode: "97205" },
    phone: "+1 (503) 555-0161",
  }));

  const summitGoods = push(parties, makeParty({
    key: "summit_goods", organizationId: CS, roles: ["shipper"],
    legalName: "Summit Goods Co.",
    address: { line1: "4400 E Marginal Way S", city: "Seattle", state: "WA", postalCode: "98134" },
  }));


  const rheaDoss = push(contacts, makeContact(pacline.partyId, CS, "broker_agent", "Rhea Doss", {
    phone: "+1 (503) 555-0161",
  }));

  relationships.push(
    makeRelationship(CS, pacline.partyId, { standing: "standard", rating: 4, loadCount: 2, lastLoadAt: daysAgo(2) }),
    makeRelationship(CS, summitGoods.partyId, { standing: "standard", loadCount: 2, lastLoadAt: daysAgo(3) }),
  );

  link(CS, "CS-5512", "broker", pacline, undefined, rheaDoss, 2);
  link(CS, "CS-5509", "shipper", summitGoods, undefined, undefined, 3);

  // ---- History -----------------------------------------------------------

  for (const party of parties) {
    events.push(event(
      party.createdByOrganizationId, "party.created",
      `${party.legalName} added from a rate confirmation`,
      { partyId: party.partyId },
      { occurredAt: party.createdAt },
    ));
    if (party.status === "provisional") {
      events.push(event(
        party.createdByOrganizationId, "party.flagged_for_review",
        party.reviewReason ?? "Flagged for review",
        { partyId: party.partyId },
        { occurredAt: party.createdAt },
      ));
    }
  }
  for (const facility of facilities) {
    events.push(event(
      facility.createdByOrganizationId, "facility.created",
      `${facility.name} added as a location`,
      { partyId: facility.partyId, facilityId: facility.facilityId },
      { occurredAt: facility.createdAt },
    ));
  }
  for (const contact of contacts) {
    events.push(event(
      contact.createdByOrganizationId, "contact.created",
      `${contact.fullName} added as a contact`,
      { partyId: contact.partyId, contactId: contact.contactId, facilityId: contact.facilityId },
      { occurredAt: contact.createdAt },
    ));
  }
  for (const l of loadLinks) {
    events.push(event(
      l.carrierOrganizationId, "load.linked",
      `Linked to a load as ${l.role}`,
      { partyId: l.partyId, facilityId: l.facilityId, contactId: l.contactId, loadId: l.loadId },
      { private: true, occurredAt: l.linkedAt },
    ));
  }
  events.push(
    event(NL, "private.standing_changed", "Marked preferred — pays in 21 days without chasing",
      { partyId: apex.partyId }, { private: true, occurredAt: daysAgo(12) }),
    event(NL, "private.standing_changed", "Moved to watch — two detention claims unpaid",
      { partyId: tandem.partyId }, { private: true, occurredAt: daysAgo(5) }),
    event(BX, "private.standing_changed", "Blocked after an unpaid detention claim",
      { partyId: apex.partyId }, { private: true, occurredAt: daysAgo(15) }),
  );

  return { parties, facilities, contacts, relationships, notes, loadLinks, events };
}

/* -------------------------------------------------------------------------- */
/* Visibility                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A carrier's private view of a company, created on demand.
 *
 * Absence of a row is not absence of an opinion — it is the *default* opinion,
 * and returning a default rather than undefined is what lets every read path
 * treat "we have never dealt with them" and "we have no notes" identically.
 */
function relationshipFor(
  carrierOrganizationId: string,
  partyId: string,
): CarrierPartyRelationship {
  const found = db().relationships.find(
    (r) => r.carrierOrganizationId === carrierOrganizationId && r.partyId === partyId,
  );
  if (found) return found;
  return {
    id: rowId("rel"),
    carrierOrganizationId,
    partyId,
    standing: "standard",
    loadCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
}

/** Whether this carrier has a directory relationship with the company at all. */
function hasRelationship(carrierOrganizationId: string, partyId: string): boolean {
  return db().relationships.some(
    (r) => r.carrierOrganizationId === carrierOrganizationId && r.partyId === partyId,
  );
}

/**
 * The parties this carrier's directory lists.
 *
 * Deliberately narrower than the parties it can *match against*: resolution
 * searches every canonical record, because that is what stops a second "TQL"
 * being created, while browsing shows only companies this carrier has actually
 * worked with. A dispatcher cannot page through another carrier's customer
 * list, and an MC number is still unique across all of them.
 */
function visibleParties(ctx: PartyContext): Party[] {
  return db().parties.filter((p) => hasRelationship(ctx.organizationId, p.partyId));
}

function requireVisibleParty(ctx: PartyContext, partyId: string): Party {
  const party = db().parties.find((p) => p.partyId === partyId);
  if (!party || !hasRelationship(ctx.organizationId, partyId)) {
    throw new PartyNotFoundError("Company");
  }
  return party;
}

function partyLoadLinks(ctx: PartyContext, predicate: (l: PartyLoadLink) => boolean) {
  return db()
    .loadLinks.filter((l) => l.carrierOrganizationId === ctx.organizationId && predicate(l))
    .sort((a, b) => new Date(b.linkedAt).getTime() - new Date(a.linkedAt).getTime());
}

function historyFor(
  ctx: PartyContext,
  predicate: (e: DirectoryEvent) => boolean,
): DirectoryEvent[] {
  return db()
    .events.filter((e) => {
      if (!predicate(e)) return false;
      // A private event belongs to the carrier that wrote it, full stop.
      if (e.private) return e.carrierOrganizationId === ctx.organizationId;
      return true;
    })
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function notesFor(ctx: PartyContext, predicate: (n: PartyNote) => boolean): PartyNote[] {
  return db()
    .notes.filter((n) => n.carrierOrganizationId === ctx.organizationId && predicate(n))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface DirectoryFilters {
  /** Matches name, DBA, MC, USDOT, city and state. */
  search?: string;
  role?: PartyRole | "all";
  status?: "all" | "active" | "provisional" | "archived";
  standing?: PartyStanding | "all";
  /** Only companies this carrier has run at least one load with. */
  withLoadsOnly?: boolean;
}

export async function listDirectory(
  ctx: PartyContext,
  filters: DirectoryFilters = {},
): Promise<DirectoryListing[]> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const { facilities, contacts } = db();
  const query = filters.search?.trim().toLowerCase() ?? "";

  return visibleParties(ctx)
    .filter((party) => {
      if (filters.role && filters.role !== "all" && !party.roles.includes(filters.role)) return false;
      if (filters.status && filters.status !== "all" && party.status !== filters.status) return false;
      if (party.status === "merged") return false;
      const relationship = relationshipFor(ctx.organizationId, party.partyId);
      if (filters.standing && filters.standing !== "all" && relationship.standing !== filters.standing) {
        return false;
      }
      if (filters.withLoadsOnly && relationship.loadCount === 0) return false;
      if (!query) return true;
      const hay = [
        party.legalName,
        party.dbaName ?? "",
        party.identifiers.mcNumber ?? "",
        party.identifiers.dotNumber ?? "",
        party.primaryAddress?.city ?? "",
        party.primaryAddress?.state ?? "",
        party.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    })
    .map((party): DirectoryListing => {
      const relationship = relationshipFor(ctx.organizationId, party.partyId);
      return {
        partyId: party.partyId,
        legalName: party.legalName,
        dbaName: party.dbaName,
        roles: party.roles,
        mcNumber: party.identifiers.mcNumber,
        dotNumber: party.identifiers.dotNumber,
        status: party.status,
        verificationState: party.verification.state,
        claimState: party.claim.state,
        autoIndexed: party.provenance.kind === "rate_confirmation_auto",
        city: party.primaryAddress?.city,
        state: party.primaryAddress?.state,
        facilityCount: facilities.filter(
          (f) => f.partyId === party.partyId && f.status !== "merged",
        ).length,
        contactCount: contacts.filter(
          (c) => c.partyId === party.partyId && c.status !== "merged",
        ).length,
        loadCount: relationship.loadCount,
        lastLoadAt: relationship.lastLoadAt,
        standing: relationship.standing,
        rating: relationship.rating,
      };
    })
    .sort((a, b) => a.legalName.localeCompare(b.legalName));
}

export async function getPartyProfile(
  ctx: PartyContext,
  partyId: string,
): Promise<PartyProfileView> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const party = requireVisibleParty(ctx, partyId);
  const { facilities, contacts } = db();

  return {
    party,
    facilities: facilities
      .filter((f) => f.partyId === partyId && f.status !== "merged")
      .sort((a, b) => a.name.localeCompare(b.name)),
    contacts: contacts
      .filter((c) => c.partyId === partyId && c.status !== "merged")
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    relationship: relationshipFor(ctx.organizationId, partyId),
    notes: notesFor(ctx, (n) => n.partyId === partyId),
    loadLinks: partyLoadLinks(ctx, (l) => l.partyId === partyId),
    history: historyFor(ctx, (e) => e.partyId === partyId),
  };
}

export async function getFacilityProfile(
  ctx: PartyContext,
  facilityId: string,
): Promise<FacilityProfileView> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const facility = db().facilities.find((f) => f.facilityId === facilityId);
  if (!facility) throw new PartyNotFoundError("Location");
  const party = requireVisibleParty(ctx, facility.partyId);

  return {
    facility,
    party,
    contacts: db()
      .contacts.filter((c) => c.facilityId === facilityId && c.status !== "merged")
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    notes: notesFor(ctx, (n) => n.facilityId === facilityId),
    loadLinks: partyLoadLinks(ctx, (l) => l.facilityId === facilityId),
    history: historyFor(ctx, (e) => e.facilityId === facilityId),
  };
}

export async function getContactProfile(
  ctx: PartyContext,
  contactId: string,
): Promise<ContactProfileView> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const contact = db().contacts.find((c) => c.contactId === contactId);
  if (!contact) throw new PartyNotFoundError("Contact");
  const party = requireVisibleParty(ctx, contact.partyId);

  return {
    contact,
    party,
    facility: contact.facilityId
      ? db().facilities.find((f) => f.facilityId === contact.facilityId)
      : undefined,
    notes: notesFor(ctx, (n) => n.contactId === contactId),
    loadLinks: partyLoadLinks(ctx, (l) => l.contactId === contactId),
    history: historyFor(ctx, (e) => e.contactId === contactId),
  };
}

/** Every facility this carrier can see, for the directory's Locations tab. */
export async function listFacilities(ctx: PartyContext): Promise<
  { facility: Facility; party: Party; loadCount: number }[]
> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const visible = new Map(visibleParties(ctx).map((p) => [p.partyId, p]));
  return db()
    .facilities.filter((f) => visible.has(f.partyId) && f.status !== "merged")
    .map((facility) => ({
      facility,
      party: visible.get(facility.partyId)!,
      loadCount: db().loadLinks.filter(
        (l) => l.carrierOrganizationId === ctx.organizationId && l.facilityId === facility.facilityId,
      ).length,
    }))
    .sort((a, b) => a.facility.name.localeCompare(b.facility.name));
}

/** Every contact this carrier can see, for the directory's People tab. */
export async function listContacts(ctx: PartyContext): Promise<
  { contact: PartyContact; party: Party; facility?: Facility }[]
> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const visible = new Map(visibleParties(ctx).map((p) => [p.partyId, p]));
  return db()
    .contacts.filter((c) => visible.has(c.partyId) && c.status !== "merged")
    .map((contact) => ({
      contact,
      party: visible.get(contact.partyId)!,
      facility: contact.facilityId
        ? db().facilities.find((f) => f.facilityId === contact.facilityId)
        : undefined,
    }))
    .sort((a, b) => a.contact.fullName.localeCompare(b.contact.fullName));
}

/* -------------------------------------------------------------------------- */
/* The carrier-private layer                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every mutation below writes a row stamped with the caller's organization and
 * reads back through the same filter. There is no parameter on any of them that
 * names an organization, which is what makes cross-carrier leakage a thing you
 * would have to add code to achieve.
 */

function persistRelationship(relationship: CarrierPartyRelationship) {
  const existing = db().relationships.findIndex((r) => r.id === relationship.id);
  if (existing >= 0) db().relationships[existing] = relationship;
  else db().relationships.push(relationship);
}

export async function setStanding(
  ctx: PartyContext,
  partyId: string,
  standing: PartyStanding,
  reason?: string,
): Promise<CarrierPartyRelationship> {
  requirePermissions(ctx, "customers:view", "customers:private:manage");
  await sleep(LATENCY_MS);

  const party = requireVisibleParty(ctx, partyId);
  const current = relationshipFor(ctx.organizationId, partyId);
  const next: CarrierPartyRelationship = {
    ...current,
    standing,
    standingReason: reason,
    updatedAt: now(),
  };
  persistRelationship(next);
  db().events.push(event(
    ctx.organizationId, "private.standing_changed",
    `${party.legalName} marked ${standing}${reason ? ` — ${reason}` : ""}`,
    { partyId },
    { private: true, occurredAt: now(), actor: actorOf(ctx), changes: [{ field: "standing", from: current.standing, to: standing }] },
  ));
  return next;
}

export async function setRating(
  ctx: PartyContext,
  partyId: string,
  rating: number | undefined,
): Promise<CarrierPartyRelationship> {
  requirePermissions(ctx, "customers:view", "customers:private:manage");
  await sleep(LATENCY_MS);

  requireVisibleParty(ctx, partyId);
  if (rating !== undefined && (rating < 1 || rating > 5)) {
    throw new Error("A rating is 1 to 5, or nothing at all");
  }
  const current = relationshipFor(ctx.organizationId, partyId);
  const next = { ...current, rating, updatedAt: now() };
  persistRelationship(next);
  db().events.push(event(
    ctx.organizationId, "private.rating_changed",
    rating === undefined ? "Rating cleared" : `Rated ${rating} out of 5`,
    { partyId },
    { private: true, occurredAt: now(), actor: actorOf(ctx) },
  ));
  return next;
}

export async function updatePaymentExperience(
  ctx: PartyContext,
  partyId: string,
  patch: PaymentExperience,
): Promise<CarrierPartyRelationship> {
  requirePermissions(ctx, "customers:view", "customers:private:manage");
  await sleep(LATENCY_MS);

  requireVisibleParty(ctx, partyId);
  const current = relationshipFor(ctx.organizationId, partyId);
  const next = {
    ...current,
    paymentExperience: { ...current.paymentExperience, ...patch },
    updatedAt: now(),
  };
  persistRelationship(next);
  db().events.push(event(
    ctx.organizationId, "private.payment_experience_updated", "Payment experience updated",
    { partyId },
    { private: true, occurredAt: now(), actor: actorOf(ctx) },
  ));
  return next;
}

export async function addNote(
  ctx: PartyContext,
  target: { partyId?: string; facilityId?: string; contactId?: string },
  body: string,
  pinned = false,
): Promise<PartyNote> {
  requirePermissions(ctx, "customers:view", "customers:private:manage");
  await sleep(LATENCY_MS);

  const text = body.trim();
  if (!text) throw new Error("A note needs something in it");

  // Whatever the note hangs off, the company behind it must be visible here.
  const partyId =
    target.partyId ??
    (target.facilityId
      ? db().facilities.find((f) => f.facilityId === target.facilityId)?.partyId
      : undefined) ??
    (target.contactId
      ? db().contacts.find((c) => c.contactId === target.contactId)?.partyId
      : undefined);
  if (!partyId) throw new PartyNotFoundError();
  requireVisibleParty(ctx, partyId);

  const note: PartyNote = {
    id: rowId("note"),
    carrierOrganizationId: ctx.organizationId,
    partyId: target.partyId,
    facilityId: target.facilityId,
    contactId: target.contactId,
    body: text,
    pinned,
    author: actorOf(ctx),
    createdAt: now(),
  };
  db().notes.push(note);
  db().events.push(event(
    ctx.organizationId, "private.note_added", "Note added",
    { partyId: target.partyId ?? partyId, facilityId: target.facilityId, contactId: target.contactId },
    { private: true, occurredAt: note.createdAt, actor: actorOf(ctx) },
  ));
  return note;
}

/* -------------------------------------------------------------------------- */
/* Entity resolution — planning                                                */
/* -------------------------------------------------------------------------- */

/**
 * Work out which permanent records a reviewed rate confirmation refers to.
 *
 * This function writes NOTHING. It is safe to call repeatedly, safe to call
 * speculatively, and safe to throw away — which matters, because the dispatcher
 * confirmation step it feeds can be abandoned halfway through, and abandoning
 * it must not leave half a broker in the directory.
 *
 * Matching runs against every canonical record rather than only this carrier's,
 * so an MC number stays unique across the whole registry and a broker three
 * other carriers already know does not get a fourth profile.
 */
/* -------------------------------------------------------------------------- */
/* Test-visible reads                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every party, unfiltered. For tests and for the auto-indexer's duplicate check.
 *
 * Deliberately NOT a service method and deliberately not exported through the
 * contracts seam: it takes no context and applies no carrier scoping, so
 * serving it to a screen would hand one carrier the whole directory. The
 * scoped read a screen uses is `listDirectory`.
 */
export function allParties(): readonly Party[] {
  return db().parties;
}

/** The load links for one party, across carriers. Tests only, same reason. */
export function loadLinksFor(partyId: string): readonly PartyLoadLink[] {
  return db().loadLinks.filter((l) => l.partyId === partyId);
}

/* -------------------------------------------------------------------------- */
/* Automatic broker indexing                                                   */
/* -------------------------------------------------------------------------- */

export interface AutoIndexReport {
  /** Parties created. Empty on almost every confirmation, which is correct. */
  created: Party[];
  /** One line per block that was not indexed, and why. For the projection. */
  skipped: { role: PartyRole; name: string; detail: string }[];
}

/**
 * Index the brokers on one rate confirmation, with nobody in the loop.
 *
 * ★ WHY THIS DOES NOT TAKE A PartyContext ★
 * Every other write in this file takes one and checks a permission, because
 * every other write is somebody doing something. This is the platform indexing
 * a company from paperwork, and there is no "somebody": the dispatcher who
 * signed the rate confirmation did not ask for a broker profile and may not
 * hold `customers:resolve` at all. Gating it on their permissions would mean a
 * carrier's directory grew or did not grow depending on which dispatcher
 * happened to sign — which is not a permission, it is a coin toss.
 *
 * So it takes an organization for attribution only, exactly as
 * `createdByOrganizationId` is documented to be: audit provenance that confers
 * no access. A party record is shared and public in the real world — an MC
 * number is a matter of public record — so creating one discloses nothing.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT DO ★
 * It does not link the load. It does not create a facility or a contact. It
 * does not touch `CarrierPartyRelationship`, standing, rating or notes. Every
 * one of those is either carrier-private or a judgement, and both still belong
 * to the person working the review queue. All this does is make sure that when
 * they get there, the broker is already a profile instead of a name.
 */
export function autoIndexBrokers(
  organizationId: string,
  extraction: RateConfirmationExtraction,
): AutoIndexReport {
  const at = now();
  const created: Party[] = [];
  const skipped: AutoIndexReport["skipped"] = [];

  const decisions = decideAutoIndexForBlocks(extraction.blocks, db().parties);

  decisions.forEach((decision, index) => {
    const block = extraction.blocks[index];
    if (decision.outcome === "skip") {
      skipped.push({ role: block.role, name: block.party.name, detail: decision.detail });
      return;
    }

    const party: Party = {
      partyId: uuid(),
      roles: ["broker"],
      legalName: decision.legalName,
      dbaName: block.party.dbaName?.trim() || undefined,
      identifiers: {
        mcNumber: decision.mcNumber,
        dotNumber: normalizeDotNumber(block.party.dotNumber),
        asPrinted: {
          mcNumber: block.party.mcNumber,
          dotNumber: block.party.dotNumber,
        },
      },
      primaryAddress: block.party.address,
      phone: block.party.phone,
      email: normalizeEmail(block.party.email) ?? block.party.email,
      // Provisional, and the review reason says why rather than implying an
      // uncertain match. The MC number was decisive; what is missing is a
      // person, and confirming the proposal in Directory → Review promotes it
      // through the lifecycle that already exists.
      status: "provisional",
      reviewReason:
        "Indexed automatically from a rate confirmation. Nobody has confirmed it and the "
        + "brokerage has not claimed it.",
      // NOT dispatcher_confirmed: no dispatcher saw it. A record that called
      // itself confirmed because a machine wrote it would make the word
      // meaningless everywhere else it appears.
      verification: { state: "unverified" },
      claim: { state: "unclaimed" },
      provenance: {
        kind: "rate_confirmation_auto",
        documentId: extraction.documentId,
        loadId: extraction.loadId,
        recordedAt: at,
        recordedBy: SYSTEM_ACTOR,
        recordedByOrganizationId: organizationId,
      },
      createdAt: at,
      updatedAt: at,
      createdByOrganizationId: organizationId,
    };

    db().parties.push(party);
    created.push(party);

    db().events.push(event(
      organizationId,
      "party.auto_indexed",
      `Indexed ${party.legalName} (MC ${decision.mcNumber}) from a rate confirmation. `
      + "Unverified and unclaimed — no person confirmed it.",
      { partyId: party.partyId, loadId: extraction.loadId },
      { occurredAt: at, actor: SYSTEM_ACTOR },
    ));
  });

  return { created, skipped };
}

export async function planResolution(
  ctx: PartyContext,
  extraction: RateConfirmationExtraction,
): Promise<ResolutionPlan> {
  requirePermissions(ctx, "customers:view");
  await sleep(LATENCY_MS);

  const { parties, facilities, contacts } = db();

  const statsFor = (partyId: string) => {
    const relationship = db().relationships.find(
      (r) => r.carrierOrganizationId === ctx.organizationId && r.partyId === partyId,
    );
    return { loadCount: relationship?.loadCount ?? 0, lastLoadAt: relationship?.lastLoadAt };
  };

  const proposals = extraction.blocks.map((block): PartyResolutionProposal => {
    const candidates = rankPartyCandidates(block.party, parties, block.role, statsFor);
    const partyRec = recommendFor(
      candidates,
      candidates.map((c) => c.partyId),
      { thing: block.role === "broker" ? "broker" : block.role },
    );

    // A document too thin to match reliably next time produces a flagged
    // record even when nothing resembled it — a clean create with no MC number
    // is still a broker nobody can recognise on the next rate confirmation.
    const thin = thinExtraction(block.party, block.role);
    let recommendation = partyRec.recommendation;
    let reviewReason = partyRec.reviewReason;
    if (recommendation === "create_new" && thin) {
      recommendation = "create_provisional";
      reviewReason = thin;
    } else if (recommendation === "create_provisional" && thin) {
      reviewReason = `${reviewReason ?? "Uncertain match"}. ${thin}`;
    }

    // Facility and contact matching is scoped to the party being proposed:
    // "1200 Industrial Blvd" is ambiguous in the world and unambiguous within
    // one company's locations.
    const scopedPartyId = partyRec.targetId;
    const facility = block.facility
      ? buildFacilityProposal(block.facility, scopedPartyId, facilities)
      : undefined;

    const contactProposals = block.contacts.map((extractedContact) => {
      const pool = contacts.filter(
        (c) => scopedPartyId !== undefined && c.partyId === scopedPartyId,
      );
      const ranked = rankContactCandidates(extractedContact, pool);
      const rec = recommendFor(ranked, ranked.map((c) => c.contactId), { thing: "contact" });
      return {
        extracted: extractedContact,
        candidates: ranked,
        recommendation: rec.recommendation,
        recommendedContactId: rec.targetId,
        rationale: rec.rationale,
      };
    });

    return {
      role: block.role,
      extracted: block,
      candidates,
      recommendation,
      recommendedPartyId: partyRec.targetId,
      rationale: partyRec.rationale,
      reviewReason,
      requiresDispatcherConfirmation: true,
      facility,
      contacts: contactProposals,
    };
  });

  return {
    planId: rowId("plan"),
    documentId: extraction.documentId,
    loadId: extraction.loadId,
    customerReference: extraction.customerReference,
    proposals,
    plannedAt: now(),
  };
}

function buildFacilityProposal(
  extracted: ExtractedFacility,
  partyId: string | undefined,
  facilities: Facility[],
): PartyResolutionProposal["facility"] {
  const pool = partyId ? facilities.filter((f) => f.partyId === partyId) : [];
  const ranked = rankFacilityCandidates(extracted, pool);
  const rec = recommendFor(ranked, ranked.map((c) => c.facilityId), { thing: "location" });
  return {
    extracted,
    candidates: ranked,
    recommendation: rec.recommendation,
    recommendedFacilityId: rec.targetId,
    rationale: partyId
      ? rec.rationale
      : "The company has to be settled first — locations are matched inside one company, never across the directory.",
  };
}

/* -------------------------------------------------------------------------- */
/* Entity resolution — committing                                              */
/* -------------------------------------------------------------------------- */

/**
 * Apply what a dispatcher confirmed.
 *
 * The rules this enforces, all of which are the point of the module:
 *
 *   - A decision is required per block. A plan alone commits nothing, and there
 *     is no code path from `planResolution` to a write.
 *   - "link" updates the existing profile; it never creates a second one.
 *   - "create" makes one profile for the company, not one per load.
 *   - Anything created from an uncertain match is born `provisional` and says
 *     why, rather than quietly joining the directory as settled fact.
 *   - Nothing here can write `externally_verified`. A rate confirmation is the
 *     broker's word, and the strongest state it can produce is a dispatcher's
 *     confirmation that they read it.
 *   - The rate confirmation id is preserved on every record and every link, and
 *     a frozen snapshot of the fields used is written with the load link, so a
 *     later profile edit cannot rewrite what that load ran under.
 */
export async function commitResolution(
  ctx: PartyContext,
  plan: ResolutionPlan,
  confirmation: ConfirmedResolution,
): Promise<CommitResult> {
  requirePermissions(ctx, "customers:view", "customers:resolve");
  await sleep(LATENCY_MS);

  if (confirmation.planId !== plan.planId) {
    throw new Error("This confirmation belongs to a different plan");
  }

  const outcomes: ResolutionOutcome[] = [];
  const needsReview: CommitResult["needsReview"] = [];
  const actor = actorOf(ctx);
  const at = now();

  for (const proposal of plan.proposals) {
    const decision = confirmation.decisions.find((d) => d.role === proposal.role);
    if (!decision) {
      // A block nobody decided is left alone. Silently inventing a profile for
      // it is exactly the duplicate-per-load behaviour this module exists to
      // prevent, so the block is reported instead.
      needsReview.push({
        reason: `The ${proposal.role} on this rate confirmation was not confirmed, so nothing was linked or created.`,
      });
      continue;
    }

    const recordProvenance: PartyProvenance = {
      kind: "rate_confirmation",
      documentId: plan.documentId,
      loadId: plan.loadId,
      recordedAt: at,
      recordedBy: actor,
      recordedByOrganizationId: ctx.organizationId,
    };

    /* -- The company ----------------------------------------------------- */

    let party: Party;
    let createdParty = false;

    if (decision.choice === "link") {
      if (!decision.partyId) throw new Error("Confirming an existing profile needs the profile");
      const existing = db().parties.find((p) => p.partyId === decision.partyId);
      if (!existing) throw new PartyNotFoundError("Company");
      party = existing;

      // Confirmed matches may take corrections off the document, but only ever
      // by filling gaps: an MC number already on file is never overwritten by
      // a rate confirmation, because the document is the weaker source.
      if (decision.applyExtractedUpdates) {
        party = applyExtractedToParty(party, proposal.extracted.party, actor, at);
      }
      if (!party.roles.includes(proposal.role)) {
        party = { ...party, roles: [...party.roles, proposal.role], updatedAt: at };
        db().events.push(event(
          ctx.organizationId, "party.role_added",
          `Also seen as a ${proposal.role}`, { partyId: party.partyId },
          { occurredAt: at, actor },
        ));
      }
      if (decision.markProvisional && party.status === "active") {
        party = {
          ...party,
          status: "provisional",
          reviewReason: "A dispatcher linked this match but asked for it to be checked",
          updatedAt: at,
        };
      }
      replaceParty(party);

      db().events.push(event(
        ctx.organizationId, "resolution.confirmed_existing",
        `Confirmed as ${party.legalName} from rate confirmation ${plan.customerReference ?? plan.documentId}`,
        { partyId: party.partyId, loadId: plan.loadId },
        { occurredAt: at, actor },
      ));
    } else {
      // A brand new profile. Provisional when the match was uncertain or the
      // document was too thin to recognise again.
      const uncertain =
        proposal.recommendation === "create_provisional" ||
        proposal.recommendation === "choose_between" ||
        decision.markProvisional === true;
      const reviewReason =
        proposal.reviewReason ??
        thinExtraction(proposal.extracted.party, proposal.role) ??
        (uncertain ? "Created from an uncertain match on a rate confirmation" : undefined);

      party = createPartyFrom(
        proposal.extracted.party,
        proposal.role,
        ctx.organizationId,
        recordProvenance,
        uncertain || reviewReason !== undefined ? reviewReason ?? "Needs review" : undefined,
        actor,
        at,
      );
      createdParty = true;
      db().parties.push(party);

      db().events.push(
        event(ctx.organizationId, "party.created",
          `${party.legalName} created from rate confirmation ${plan.customerReference ?? plan.documentId}`,
          { partyId: party.partyId, loadId: plan.loadId }, { occurredAt: at, actor }),
        event(ctx.organizationId, "resolution.created_new",
          "A dispatcher confirmed there was no existing profile for this company",
          { partyId: party.partyId, loadId: plan.loadId }, { occurredAt: at, actor }),
      );
      if (party.status === "provisional") {
        db().events.push(event(
          ctx.organizationId, "party.flagged_for_review",
          party.reviewReason ?? "Flagged for review",
          { partyId: party.partyId }, { occurredAt: at, actor },
        ));
        needsReview.push({ partyId: party.partyId, reason: party.reviewReason ?? "Needs review" });
      }
    }

    // The carrier's private relationship row: created on first contact, never
    // shared, and the only place this carrier's load count with them lives.
    touchRelationship(ctx, party.partyId, at);

    /* -- The location ---------------------------------------------------- */

    let facility: Facility | undefined;
    let createdFacility = false;

    if (proposal.extracted.facility) {
      const chosenId = decision.facilityId;
      if (chosenId) {
        const existing = db().facilities.find(
          (f) => f.facilityId === chosenId && f.partyId === party.partyId,
        );
        if (!existing) throw new PartyNotFoundError("Location");
        facility = mergeFacilityDetails(existing, proposal.extracted.facility, proposal.role, at);
        replaceFacility(facility);
      } else {
        facility = createFacilityFrom(
          proposal.extracted.facility,
          party.partyId,
          proposal.role,
          ctx.organizationId,
          recordProvenance,
          at,
        );
        createdFacility = true;
        db().facilities.push(facility);
        db().events.push(event(
          ctx.organizationId, "facility.created",
          `${facility.name} added as a location for ${party.legalName}`,
          { partyId: party.partyId, facilityId: facility.facilityId, loadId: plan.loadId },
          { occurredAt: at, actor },
        ));
        if (facility.status === "provisional") {
          needsReview.push({
            facilityId: facility.facilityId,
            reason: facility.reviewReason ?? "Needs review",
          });
        }
      }
    }

    /* -- The people ------------------------------------------------------ */

    const contactIds: string[] = [];
    const createdContactIds: string[] = [];
    const chosen = new Set(decision.contactIds ?? []);

    for (const contactProposal of proposal.contacts) {
      const linkedExisting = contactProposal.candidates.find((c) => chosen.has(c.contactId));
      if (linkedExisting) {
        const existing = db().contacts.find((c) => c.contactId === linkedExisting.contactId);
        if (existing) {
          const updated = mergeContactDetails(existing, contactProposal.extracted, at);
          replaceContact(updated);
          contactIds.push(updated.contactId);
        }
        continue;
      }
      // Not matched to anybody, so this is a new person at a known company.
      const created = createContactFrom(
        contactProposal.extracted,
        party.partyId,
        facility?.facilityId,
        proposal.role,
        ctx.organizationId,
        recordProvenance,
        at,
      );
      db().contacts.push(created);
      contactIds.push(created.contactId);
      createdContactIds.push(created.contactId);
      db().events.push(event(
        ctx.organizationId, "contact.created",
        `${created.fullName} added as a contact for ${party.legalName}`,
        { partyId: party.partyId, contactId: created.contactId, facilityId: facility?.facilityId, loadId: plan.loadId },
        { occurredAt: at, actor },
      ));
    }

    /* -- The load link and its frozen snapshot --------------------------- */

    const snapshot = snapshotFromExtraction(proposal.extracted, party, facility, contactIds);
    let loadLinkId: string | undefined;

    if (plan.loadId) {
      const link: PartyLoadLink = {
        id: rowId("pll"),
        carrierOrganizationId: ctx.organizationId,
        loadId: plan.loadId,
        role: proposal.role,
        partyId: party.partyId,
        facilityId: facility?.facilityId,
        contactId: contactIds[0],
        rateConfirmationDocumentId: plan.documentId,
        snapshot,
        linkedAt: at,
        linkedBy: actor,
      };
      db().loadLinks.push(link);
      loadLinkId = link.id;
      db().events.push(event(
        ctx.organizationId, "load.linked",
        `Linked to a load as ${proposal.role}`,
        { partyId: party.partyId, facilityId: facility?.facilityId, contactId: contactIds[0], loadId: plan.loadId },
        { private: true, occurredAt: at, actor },
      ));
    }

    outcomes.push({
      role: proposal.role,
      partyId: party.partyId,
      createdParty,
      partyStatus: party.status,
      facilityId: facility?.facilityId,
      createdFacility,
      contactIds,
      createdContactIds,
      loadLinkId,
      snapshot,
      summary: createdParty
        ? `Created ${party.legalName}${party.status === "provisional" ? " — flagged for review" : ""}`
        : `Linked to the existing profile for ${party.legalName}`,
    });
  }

  return { documentId: plan.documentId, loadId: plan.loadId, outcomes, needsReview };
}

/* -------------------------------------------------------------------------- */
/* Write helpers                                                               */
/* -------------------------------------------------------------------------- */

function replaceParty(party: Party) {
  const i = db().parties.findIndex((p) => p.partyId === party.partyId);
  if (i >= 0) db().parties[i] = party;
}

function replaceFacility(facility: Facility) {
  const i = db().facilities.findIndex((f) => f.facilityId === facility.facilityId);
  if (i >= 0) db().facilities[i] = facility;
}

function replaceContact(contact: PartyContact) {
  const i = db().contacts.findIndex((c) => c.contactId === contact.contactId);
  if (i >= 0) db().contacts[i] = contact;
}

function touchRelationship(ctx: PartyContext, partyId: string, at: string) {
  const current = relationshipFor(ctx.organizationId, partyId);
  persistRelationship({
    ...current,
    loadCount: current.loadCount + 1,
    firstLoadAt: current.firstLoadAt ?? at,
    lastLoadAt: at,
    updatedAt: at,
  });
}

function createPartyFrom(
  extracted: ExtractedParty,
  role: PartyRole,
  organizationId: string,
  recordProvenance: PartyProvenance,
  reviewReason: string | undefined,
  actor: ActorRef,
  at: string,
): Party {
  const mc = normalizeMcNumber(extracted.mcNumber);
  const dot = normalizeDotNumber(extracted.dotNumber);
  return {
    partyId: uuid(),
    roles: [role],
    legalName: extracted.name.trim(),
    dbaName: extracted.dbaName?.trim() || undefined,
    identifiers: {
      mcNumber: mc,
      dotNumber: dot,
      asPrinted: {
        mcNumber: extracted.mcNumber,
        dotNumber: extracted.dotNumber,
      },
    },
    primaryAddress: extracted.address,
    phone: extracted.phone,
    email: normalizeEmail(extracted.email) ?? extracted.email,
    status: reviewReason ? "provisional" : "active",
    reviewReason,
    // The strongest state a rate confirmation can produce. An MC number
    // printed on a broker's own paperwork has not been checked against FMCSA,
    // and calling it verified here would make a document self-certifying.
    verification: { state: "dispatcher_confirmed", confirmedBy: actor, checkedAt: at },
    // A dispatcher standing behind the DATA is not the brokerage standing
    // behind the RECORD. Confirming a proposal never claims a company.
    claim: { state: "unclaimed" },
    provenance: recordProvenance,
    createdAt: at,
    updatedAt: at,
    createdByOrganizationId: organizationId,
  };
}

/**
 * Fill gaps on a confirmed profile from the document.
 *
 * Gaps only. An identifier already on file outranks one printed on a broker's
 * rate confirmation, so nothing here overwrites an existing MC or DOT number —
 * the day those disagree is the day somebody needs to look, not the day the
 * weaker source wins.
 */
function applyExtractedToParty(
  party: Party,
  extracted: ExtractedParty,
  actor: ActorRef,
  at: string,
): Party {
  const changes: { field: string; from?: string; to?: string }[] = [];
  const next: Party = { ...party, identifiers: { ...party.identifiers } };

  const mc = normalizeMcNumber(extracted.mcNumber);
  if (mc && !next.identifiers.mcNumber) {
    next.identifiers.mcNumber = mc;
    next.identifiers.asPrinted = { ...next.identifiers.asPrinted, mcNumber: extracted.mcNumber };
    changes.push({ field: "MC number", to: mc });
  }
  const dot = normalizeDotNumber(extracted.dotNumber);
  if (dot && !next.identifiers.dotNumber) {
    next.identifiers.dotNumber = dot;
    changes.push({ field: "USDOT number", to: dot });
  }
  if (!next.primaryAddress && extracted.address) {
    next.primaryAddress = extracted.address;
    changes.push({ field: "Address", to: `${extracted.address.city}, ${extracted.address.state}` });
  }
  if (!next.phone && normalizePhone(extracted.phone)) {
    next.phone = extracted.phone;
    changes.push({ field: "Phone", to: extracted.phone });
  }
  if (!next.email && normalizeEmail(extracted.email)) {
    next.email = extracted.email;
    changes.push({ field: "Email", to: extracted.email });
  }
  if (!next.dbaName && extracted.dbaName && normalizeCompanyName(extracted.dbaName)) {
    next.dbaName = extracted.dbaName;
    changes.push({ field: "Trading name", to: extracted.dbaName });
  }

  if (changes.length === 0) return party;
  next.updatedAt = at;
  db().events.push(event(
    party.createdByOrganizationId, "party.updated",
    `Filled in ${changes.map((c) => c.field.toLowerCase()).join(", ")} from a rate confirmation`,
    { partyId: party.partyId },
    { occurredAt: at, actor, changes },
  ));
  return next;
}

function createFacilityFrom(
  extracted: ExtractedFacility,
  partyId: string,
  role: PartyRole,
  organizationId: string,
  recordProvenance: PartyProvenance,
  at: string,
): Facility {
  const functions: Facility["functions"] =
    role === "receiver" ? ["delivery"] : role === "shipper" ? ["pickup"] : [];
  return {
    facilityId: uuid(),
    partyId,
    name: extracted.name?.trim() || `${extracted.address.city}, ${extracted.address.state}`,
    address: extracted.address,
    functions,
    hoursText: extracted.hoursText,
    appointmentRequired: extracted.appointmentRequired,
    instructions: extracted.instructions,
    status: "active",
    provenance: recordProvenance,
    createdAt: at,
    updatedAt: at,
    createdByOrganizationId: organizationId,
  };
}

/**
 * A confirmed location picks up whatever the document adds and loses nothing.
 * A rate confirmation that omits the dock hours is silent about them, not a
 * statement that there are none.
 */
function mergeFacilityDetails(
  facility: Facility,
  extracted: ExtractedFacility,
  role: PartyRole,
  at: string,
): Facility {
  const functions = new Set(facility.functions);
  if (role === "receiver") functions.add("delivery");
  if (role === "shipper") functions.add("pickup");
  return {
    ...facility,
    functions: [...functions],
    hoursText: facility.hoursText ?? extracted.hoursText,
    appointmentRequired: facility.appointmentRequired ?? extracted.appointmentRequired,
    instructions: facility.instructions ?? extracted.instructions,
    updatedAt: at,
  };
}

function createContactFrom(
  extracted: ExtractedContact,
  partyId: string,
  facilityId: string | undefined,
  role: PartyRole,
  organizationId: string,
  recordProvenance: PartyProvenance,
  at: string,
): PartyContact {
  return {
    contactId: uuid(),
    partyId,
    facilityId,
    kind: role === "broker" ? "broker_agent" : "facility_contact",
    fullName: extracted.fullName.trim(),
    title: extracted.title,
    phone: extracted.phone,
    phoneExtension: extracted.phoneExtension,
    email: normalizeEmail(extracted.email) ?? extracted.email,
    status: "active",
    provenance: recordProvenance,
    createdAt: at,
    updatedAt: at,
    createdByOrganizationId: organizationId,
  };
}

function mergeContactDetails(
  contact: PartyContact,
  extracted: ExtractedContact,
  at: string,
): PartyContact {
  return {
    ...contact,
    title: contact.title ?? extracted.title,
    phone: contact.phone ?? extracted.phone,
    phoneExtension: contact.phoneExtension ?? extracted.phoneExtension,
    email: contact.email ?? normalizeEmail(extracted.email) ?? extracted.email,
    updatedAt: at,
  };
}

/**
 * The snapshot written with a load link.
 *
 * Built from what the DOCUMENT said, not from the profile it resolved to. That
 * is the whole point: the load has to keep showing the address the driver was
 * sent to, even after somebody corrects the profile six months later.
 */
function snapshotFromExtraction(
  block: ExtractedPartyBlock,
  party: Party,
  facility: Facility | undefined,
  contactIds: string[],
): PartySnapshot {
  const firstContact = block.contacts[0];
  const resolvedContact = contactIds[0]
    ? db().contacts.find((c) => c.contactId === contactIds[0])
    : undefined;
  return {
    legalName: block.party.name,
    dbaName: block.party.dbaName,
    mcNumber: normalizeMcNumber(block.party.mcNumber) ?? party.identifiers.mcNumber,
    dotNumber: normalizeDotNumber(block.party.dotNumber) ?? party.identifiers.dotNumber,
    address: block.party.address,
    phone: block.party.phone,
    email: block.party.email,
    facilityName: block.facility?.name ?? facility?.name,
    facilityAddress: block.facility?.address ?? facility?.address,
    facilityHoursText: block.facility?.hoursText ?? facility?.hoursText,
    contactName: firstContact?.fullName ?? resolvedContact?.fullName,
    contactPhone: firstContact?.phone ?? resolvedContact?.phone,
    contactEmail: firstContact?.email ?? resolvedContact?.email,
  };
}

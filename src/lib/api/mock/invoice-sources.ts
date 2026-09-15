import type {
  ApprovedAccessorialInput, BillingPartyInput, ConfirmedLoadInput,
  ConfirmedRateConfirmationInput, DocumentRequirementInput, InvoiceSourcePacket,
} from "../contracts/invoices";
import type {
  BillingPartySnapshot, CarrierSnapshot, Document, InvoiceLineItemKind, Load,
} from "@/types";
import { destinationStop, originStop, rateConfirmationValue } from "@/types";
import { mockStore } from "./store";
import { rateConfirmationForLoad } from "./rate-confirmation-record";
import { hoursFromNow } from "./time";

/**
 * ███ MOCK ONLY — STANDS IN FOR FOUR OTHER MODULES ███
 *
 * Rate Confirmations, Documents, Broker/Shipper profiles and the accessorial
 * modules (Detention, Layover, Lumper, TONU) are being built separately. Until
 * they exist, THIS file is the only thing that pretends to be them, and it
 * pretends in exactly one direction: it produces the typed inbound contracts
 * from `contracts/invoices.ts` and nothing else.
 *
 * The point of confining the pretending here is that when those modules land,
 * this file is deleted and the real ones produce the same packets. Nothing in
 * the invoice service, the domain logic or the screens changes.
 *
 * The data is honest: it is derived from the loads and documents that already
 * exist in the mock store, and where a field genuinely has no upstream source
 * yet (a broker's net terms, a lumper receipt number) it is stated as fixture
 * data rather than computed from something that does not mean it.
 */

/* -------------------------------------------------------------------------- */
/* Broker / shipper billing profiles — the Broker/Shipper module's job         */
/* -------------------------------------------------------------------------- */

/**
 * Billing profiles keyed by the customer id the Loads module already uses.
 * Terms, billing email and document policy belong to the payer's profile, not
 * to the load and not to the invoice.
 */
const BILLING_PROFILES: Record<string, Omit<BillingPartyInput, "partyId" | "name" | "kind">> = {
  cus_nl_apex: {
    mcNumber: "MC-612884",
    billingContactName: "Accounts payable",
    billingEmail: "ap@apexlog.example",
    billingPhone: "+1 (312) 555-0112",
    billingAddressLine1: "4400 W Roosevelt Rd",
    billingCity: "Chicago", billingState: "IL", billingPostalCode: "60624",
    paymentTermsDays: 30,
    submissionPortal: "Apex Carrier Portal",
  },
  cus_nl_rivet: {
    billingContactName: "Marco Bell",
    billingEmail: "ap@rivetsupply.example",
    billingCity: "Columbus", billingState: "OH",
    paymentTermsDays: 45,
    requiresOriginalDocuments: true,
  },
  cus_nl_tandem: {
    mcNumber: "MC-908114",
    billingContactName: "Priya Raman",
    billingEmail: "billing@tandemfp.example",
    billingCity: "Chicago", billingState: "IL",
    paymentTermsDays: 21,
  },
  cus_nl_glenmark: {
    billingContactName: "Eli Ross",
    billingEmail: "ap@glenmark.example",
    billingCity: "Memphis", billingState: "TN",
    paymentTermsDays: 30,
  },
  cus_md_keystone: {
    mcNumber: "MC-771220",
    billingContactName: "Alan Pike",
    billingEmail: "ap@keystonebrokerage.example",
    billingCity: "New York", billingState: "NY",
    paymentTermsDays: 30,
  },
  cus_md_harbor: {
    billingContactName: "Nia Coles",
    billingEmail: "ap@harborpoint.example",
    paymentTermsDays: 30,
  },
  cus_md_vantage: {
    billingContactName: "Owen Pratt",
    paymentTermsDays: 15,
  },
};

/**
 * An approved payer that is NOT the load's customer: Northline factors Apex
 * freight through Ridgeline. Proves the billing party is its own reference
 * rather than a copy of the customer on the load.
 */
export const OTHER_PAYERS: Record<string, BillingPartyInput> = {
  pay_ridgeline_factoring: {
    partyId: "pay_ridgeline_factoring",
    kind: "factoring_company",
    name: "Ridgeline Capital Funding",
    billingContactName: "Funding desk",
    billingEmail: "schedules@ridgelinecap.example",
    billingAddressLine1: "1100 Commerce St, Suite 700",
    billingCity: "Dallas", billingState: "TX", billingPostalCode: "75202",
    paymentTermsDays: 2,
    submissionPortal: "Ridgeline Client Portal",
  },
};

const DEFAULT_TERMS_DAYS = 30;

export function billingPartyInput(
  organizationId: string,
  partyId: string,
): BillingPartyInput | null {
  if (OTHER_PAYERS[partyId]) return OTHER_PAYERS[partyId];

  const customer = mockStore
    .org(organizationId)
    .customers.find((c) => c.id === partyId);
  if (!customer) return null;

  const profile = BILLING_PROFILES[customer.id] ?? {
    paymentTermsDays: DEFAULT_TERMS_DAYS,
  };
  // The profile is the payer's own record; the customer row on the load only
  // fills gaps the Broker/Shipper module has not been given yet.
  return {
    ...profile,
    partyId: customer.id,
    kind: customer.kind,
    name: customer.name,
    billingContactName: profile.billingContactName ?? customer.contactName,
    billingPhone: profile.billingPhone ?? customer.phone,
    billingEmail: profile.billingEmail ?? customer.email,
    paymentTermsDays: profile.paymentTermsDays ?? DEFAULT_TERMS_DAYS,
  };
}

/** Payers this organization may bill: its customers plus approved third parties. */
export function approvedPayers(organizationId: string): BillingPartyInput[] {
  const customers = mockStore
    .org(organizationId)
    .customers.map((c) => billingPartyInput(organizationId, c.id))
    .filter((p): p is BillingPartyInput => p !== null);

  // The factoring company is only an approved payer for the carrier that
  // actually factors. Nothing here is offered to every organization.
  const extra = organizationId === "org_northline"
    ? [OTHER_PAYERS.pay_ridgeline_factoring]
    : [];

  return [...customers, ...extra];
}

export function toBillingPartySnapshot(input: BillingPartyInput): BillingPartySnapshot {
  return {
    partyId: input.partyId,
    kind: input.kind,
    name: input.name,
    mcNumber: input.mcNumber,
    billingContact:
      input.billingContactName || input.billingEmail || input.billingPhone
        ? {
            name: input.billingContactName,
            email: input.billingEmail,
            phone: input.billingPhone,
          }
        : undefined,
    billingAddress: input.billingCity && input.billingState
      ? {
          line1: input.billingAddressLine1,
          city: input.billingCity,
          state: input.billingState,
          postalCode: input.billingPostalCode,
          country: "US",
        }
      : undefined,
    paymentTermsDays: input.paymentTermsDays,
    requiresOriginalDocuments: input.requiresOriginalDocuments,
    submissionPortal: input.submissionPortal,
  };
}

/* -------------------------------------------------------------------------- */
/* Loads — the Loads module's job                                              */
/* -------------------------------------------------------------------------- */

export function confirmedLoadInput(load: Load): ConfirmedLoadInput {
  const pickup = originStop(load);
  const delivery = destinationStop(load);
  return {
    loadId: load.id,
    organizationId: load.organizationId,
    reference: load.reference,
    customerReference: load.customerReference,
    billingPartyId: load.customer.id,
    originCity: pickup.address.city,
    originState: pickup.address.state,
    destinationCity: delivery.address.city,
    destinationState: delivery.address.state,
    pickedUpAt: pickup.departedAt,
    deliveredAt: delivery.departedAt,
    equipment: load.equipment,
    loadedMiles: load.financials?.loadedMiles ?? 0,
    driverNameSnapshot: load.assignment?.driverId
      ? DRIVER_DISPLAY_NAMES[load.assignment.driverId]
      : undefined,
  };
}

/** Driver names the Drivers module owns. Attribution only, never a lookup key. */
const DRIVER_DISPLAY_NAMES: Record<string, string> = {
  drv_nl_01: "Dmitri Kovalenko",
  drv_nl_02: "Marisol Ortiz",
  drv_nl_03: "Ray Bell",
  drv_nl_04: "Amir Haddad",
  drv_nl_05: "Tomas Reyes",
  drv_nl_06: "Kelsey Nguyen",
  drv_md_01: "Serge Petrov",
  drv_md_02: "Hannah Boyd",
  drv_md_03: "Luis Carrera",
  drv_md_04: "Grace Lindqvist",
};

/* -------------------------------------------------------------------------- */
/* Rate confirmations — the Rate Confirmation module's job                     */
/* -------------------------------------------------------------------------- */

/**
 * The rate confirmation behind the money on an invoice.
 *
 * Reads the CANONICAL committed record where one exists. That matters for a
 * reason that is easy to miss: `evaluateReadiness` compares the invoice's
 * linehaul against `agreedLinehaulCents`, and this function used to read
 * `load.financials.linehaulCents` — the same field the rate confirmation flow
 * had already written. So the check compared a number against itself and could
 * never fail. It now compares against the amount frozen on the signed
 * confirmation, which is the number the broker actually agreed to.
 *
 * It also used to mint `rcon_${load.id}`, an id belonging to no record anywhere.
 * A committed confirmation carries its own permanent UUID and its own version,
 * and both travel onto the invoice.
 *
 * The document fallback below is for seeded loads whose confirmation was never
 * put through the review workflow in this session. It is honest about what it
 * knows: the document is on file, and nobody signed anything in front of us.
 */
export function rateConfirmationInput(
  load: Load,
  documents: Document[],
): ConfirmedRateConfirmationInput | undefined {
  const committed = rateConfirmationForLoad(load.organizationId, load.id);
  if (committed) {
    const agreed = rateConfirmationValue(committed, "rate_total");
    const cents = agreed
      ? Math.round(Number.parseFloat(agreed.replace(/[^0-9.]/g, "")) * 100)
      : undefined;
    return {
      rateConfirmationId: committed.rateConfirmationId,
      loadId: load.id,
      documentId: committed.signedDocumentId,
      // The amount on the SIGNED confirmation, not the amount currently on the
      // load. If somebody later edits the load, this check starts failing —
      // which is the whole point of it existing.
      agreedLinehaulCents: Number.isFinite(cents) && cents !== undefined
        ? cents
        : load.financials?.linehaulCents ?? 0,
      preApprovedAccessorialCodes: ["detention"],
      receivedAt: committed.committedAt,
      // A person reviewed every required field and applied the carrier
      // signature. That IS the verification, and it has a name and a time.
      verifiedAt: committed.committedAt,
    };
  }

  const rateCon = documents.find((d) => d.kind === "rate_confirmation");
  if (!rateCon) return undefined;
  return {
    rateConfirmationId: `rcon_${load.id}`,
    loadId: load.id,
    documentId: rateCon.id,
    agreedLinehaulCents: load.financials?.linehaulCents ?? 0,
    // Detention is pre-authorized in these agreements; everything else needs a
    // separate approval before it may be billed.
    preApprovedAccessorialCodes: ["detention"],
    receivedAt: rateCon.uploadedAt,
    verifiedAt: rateCon.verification.state === "verified"
      ? rateCon.verification.verifiedAt
      : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Accessorials — Detention, Layover, Lumper and TONU modules' job             */
/* -------------------------------------------------------------------------- */

const ACCESSORIAL_KIND: Record<string, InvoiceLineItemKind> = {
  detention: "detention",
  layover: "layover",
  lumper: "lumper",
  tonu: "tonu",
  fuel_surcharge: "fuel_surcharge",
};

/**
 * The accessorials each module has APPROVED for a load. The load's own
 * `financials.accessorials` is where they surface in the mock today; the
 * approval, the approver and the evidence are added here because that is what
 * the real modules will send and what the invoice has to be able to defend.
 */
export function approvedAccessorialInputs(load: Load): ApprovedAccessorialInput[] {
  const accessorials = load.financials?.accessorials ?? [];
  return accessorials
    .filter((a) => a.direction === "receivable")
    .map((a, i) => {
      const kind = ACCESSORIAL_KIND[a.code] ?? "other";
      const metered = kind === "detention"
        ? { quantity: 1.5, unit: "hours" as const, unitAmountCents: Math.round(a.amountCents / 1.5) }
        : kind === "layover"
          ? { quantity: 1, unit: "days" as const, unitAmountCents: a.amountCents }
          : {};
      return {
        accessorialId: `acc_${load.id}_${i}`,
        loadId: load.id,
        kind,
        label: a.label,
        amountCents: a.amountCents,
        ...metered,
        approvedByMembershipId: `mem_${load.organizationId}`,
        approvedByDisplayName: "Sam Murtaza",
        approvedAt: hoursFromNow(-20),
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Documents — the Documents module's job                                      */
/* -------------------------------------------------------------------------- */

export function documentRequirementInputs(
  load: Load,
  documents: Document[],
): DocumentRequirementInput[] {
  return load.documentRequirements.map((req) => {
    const doc = documents.find((d) => d.id === req.satisfiedByDocumentId);
    return {
      kind: req.kind,
      required: req.required,
      documentId: doc?.id,
      fileName: doc?.fileName,
      version: doc?.version,
      verificationState: doc?.verification.state,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* The whole packet                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything the invoice service is allowed to know about a load, assembled
 * from the modules that own it. Returns null when the load does not exist in
 * this organization — the caller turns that into NOT FOUND.
 */
export function sourcePacketFor(
  organizationId: string,
  loadId: string,
  billingPartyId?: string,
): InvoiceSourcePacket | null {
  const org = mockStore.org(organizationId);
  const load = org.loads.find((l) => l.id === loadId);
  if (!load) return null;

  const documents = org.documents.filter((d) =>
    d.links.some((link) => link.entityKind === "load" && link.entityId === load.id),
  );

  const party = billingPartyInput(organizationId, billingPartyId ?? load.customer.id);
  if (!party) return null;

  return {
    load: confirmedLoadInput(load),
    billingParty: party,
    rateConfirmation: rateConfirmationInput(load, documents),
    approvedAccessorials: approvedAccessorialInputs(load),
    documents: documentRequirementInputs(load, documents),
  };
}

/* -------------------------------------------------------------------------- */
/* Carrier profiles — the Organization module's job                            */
/* -------------------------------------------------------------------------- */

/**
 * Remit-to details belong to the organization's own profile. They are copied
 * onto an invoice at issue time so moving office next year does not rewrite
 * where last year's invoices said to send the cheque.
 */
const CARRIER_PROFILES: Record<string, CarrierSnapshot> = {
  org_northline: {
    organizationId: "org_northline",
    legalName: "Northline Freight LLC",
    displayName: "Northline Freight",
    dotNumber: "3487211",
    mcNumber: "MC-1142908",
    remitToAddress: {
      line1: "2210 S Canal St",
      city: "Chicago", state: "IL", postalCode: "60616", country: "US",
    },
    billingEmail: "billing@northlinefreight.example",
  },
  org_meridian: {
    organizationId: "org_meridian",
    legalName: "Meridian Dispatch Group Inc.",
    displayName: "Meridian Dispatch",
    remitToAddress: {
      line1: "47 Hudson St, Floor 3",
      city: "New York", state: "NY", postalCode: "10013", country: "US",
    },
    billingEmail: "ar@meridiandispatch.example",
  },
  org_cascade: {
    organizationId: "org_cascade",
    legalName: "Cascade Haul Co.",
    displayName: "Cascade Haul",
    dotNumber: "2910446",
    remitToAddress: { city: "Portland", state: "OR", country: "US" },
    billingEmail: "office@cascadehaul.example",
  },
};

export function carrierSnapshotFor(organizationId: string): CarrierSnapshot {
  return (
    CARRIER_PROFILES[organizationId] ?? {
      organizationId,
      legalName: organizationId,
      displayName: organizationId,
    }
  );
}

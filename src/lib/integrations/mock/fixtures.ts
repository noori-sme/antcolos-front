import type {
  EngagementType, DriverExtractedField, IsoDateTime, ProposalStop,
} from "@/types";
import type { InboundLoadProposal, RateConfirmationState } from "../ports";
import {
  daysFromNow, externalRef, hoursFromNow, mockProvenance,
} from "./support";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Every piece of made-up input this branch consumes, in ONE file.
 *
 * Nothing here is a canonical record. These are the inputs the Dispatch
 * workspace, the Opportunity inbox, the Rate Confirmation module and the OCR
 * service will supply once they exist; until then this file supplies them in
 * exactly the shape those modules promised, so deleting it and pointing the
 * adapter at the real thing is the whole migration.
 */

const OFFICE = {
  userId: "usr_dispatch_mock",
  membershipId: "mem_dispatch_mock",
  displayNameSnapshot: "Dispatch (mock)",
  source: "web" as const,
};

/* -------------------------------------------------------------------------- */
/* Which engagement a driver has with a carrier                               */
/* -------------------------------------------------------------------------- */

/**
 * Owned by the Carrier / Driver relationship module. Read here, never written.
 * It is what every policy decision in this feature is resolved from.
 */
export const ENGAGEMENTS: Record<string, EngagementType> = {
  "org_cascade:drv_cascade_0192": "company_driver",
  "org_stonebridge:drv_sb_0044": "owner_operator",
};

/* -------------------------------------------------------------------------- */
/* Rate confirmation state, by load reference                                 */
/* -------------------------------------------------------------------------- */

/**
 * The finalization gate reads this and nothing else. A load whose reference is
 * absent here has no rate confirmation at all, which is the correct answer for
 * a load Dispatch has not worked yet.
 */
function rateCon(input: {
  externalId: string;
  reviewed: boolean;
  signed: boolean;
  sent: boolean;
  reviewedAt?: IsoDateTime;
  signerName?: string;
}): RateConfirmationState {
  return {
    documentRef: externalRef("rate_confirmation", input.externalId, {
      entityKind: "rate_confirmation",
    }),
    reviewedByDispatch: input.reviewed,
    reviewedAt: input.reviewed ? (input.reviewedAt ?? hoursFromNow(-6)) : undefined,
    reviewedByName: input.reviewed ? "Priya Raman" : undefined,
    carrierSignature: {
      signed: input.signed,
      signedAt: input.signed ? hoursFromNow(-5.5) : undefined,
      signerName: input.signed ? (input.signerName ?? "Sam Murtaza") : undefined,
      authorityRef: input.signed
        ? externalRef("rate_confirmation", "auth_mc_1203774", { entityKind: "operating_authority" })
        : undefined,
    },
    sentToBroker: {
      sent: input.sent,
      sentAt: input.sent ? hoursFromNow(-5.2) : undefined,
      channel: input.sent ? "email" : undefined,
    },
    provenance: mockProvenance("rate_confirmation", { externalId: input.externalId }),
  };
}

/** Keyed by the load's human reference, which is what Dispatch quotes. */
export const RATE_CONFIRMATIONS: Record<string, RateConfirmationState> = {
  // Finished end to end — these are the loads that may become driver posts.
  "CS-3318": rateCon({ externalId: "rc_cs_3318", reviewed: true, signed: true, sent: true, signerName: "Dana Whitlock" }),
  "CS-3309": rateCon({ externalId: "rc_cs_3309", reviewed: true, signed: true, sent: true, signerName: "Dana Whitlock" }),
  "SB-1042": rateCon({ externalId: "rc_sb_1042", reviewed: true, signed: true, sent: true, signerName: "Sam Murtaza" }),
  "SB-1036": rateCon({ externalId: "rc_sb_1036", reviewed: true, signed: true, sent: true, signerName: "Sam Murtaza" }),
  // Complete, but no post has been created from it yet. Finalizing it is what
  // settles the two Richmond proposals that sit over the same hours.
  "SB-1048": rateCon({ externalId: "rc_sb_1048", reviewed: true, signed: true, sent: true, signerName: "Sam Murtaza" }),
  // Reviewed and signed, NOT yet sent back to the broker. This one exists to
  // prove the gate: it is not final, so no driver post may be created from it.
  "CS-3324": rateCon({ externalId: "rc_cs_3324", reviewed: true, signed: true, sent: false }),
  // Signed by nobody. Dispatch is still arguing about it.
  "CS-3321": rateCon({ externalId: "rc_cs_3321", reviewed: false, signed: false, sent: false }),
};

/* -------------------------------------------------------------------------- */
/* Dispatch-originated proposals                                              */
/* -------------------------------------------------------------------------- */

function stop(
  kind: "pickup" | "delivery",
  sequence: number,
  city: string,
  state: string,
  timeZone: string,
  at: IsoDateTime,
  extra: Partial<ProposalStop> = {},
): ProposalStop {
  return {
    kind,
    sequence,
    address: { city, state, country: "US" },
    timeZone,
    appointmentAt: at,
    appointmentType: "appointment",
    ...extra,
  };
}

/**
 * What Dispatch has sent to drivers, as the Opportunity inbox would hand it
 * over. The money here is the FULL rate; policy is what decides how much of it
 * a given driver ever sees.
 */
export function inboundProposals(): InboundLoadProposal[] {
  return [
    /* --- Cascade: a company driver, operational feedback only ------------- */
    {
      opportunityRef: externalRef("opportunity", "opp_cs_88421", { entityKind: "load_opportunity" }),
      organizationId: "org_cascade",
      driverId: "drv_cascade_0192",
      engagementType: "company_driver",
      customerName: "Pacline Logistics",
      customerKind: "broker",
      commodity: "Retail freight, palletized",
      weightLbs: 2600,
      equipment: { type: "cargo_van" },
      stops: [
        stop("pickup", 1, "Eugene", "OR", "America/Los_Angeles", hoursFromNow(14), {
          facilityName: "Pacline Cross-dock",
          notes: "Live load. Two hours free.",
        }),
        stop("delivery", 2, "Boise", "ID", "America/Boise", hoursFromNow(28), {
          appointmentType: "window",
          appointmentEndAt: hoursFromNow(31),
        }),
      ],
      serviceWindow: { startAt: hoursFromNow(14), endAt: hoursFromNow(31) },
      dispatchNote:
        "Broker is holding this for us until 16:00. Before I push on the rate, can you run it — and does the Boise window work against your hours?",
      rate: {
        currency: "USD",
        linehaulCents: 49_800,
        totalRateCents: 49_800,
        ratePerMileCents: 116,
        driverShareCents: 14_940,
        loadedMiles: 428,
        deadheadMiles: 6,
        accessorials: [],
      },
      sentAt: hoursFromNow(-1.5),
      sentBy: OFFICE,
      respondByAt: hoursFromNow(6),
      idempotencyKey: "opp_cs_88421:sent",
      provenance: mockProvenance("opportunity", { externalId: "opp_cs_88421" }),
    },
    {
      opportunityRef: externalRef("opportunity", "opp_cs_88455", { entityKind: "load_opportunity" }),
      organizationId: "org_cascade",
      driverId: "drv_cascade_0192",
      engagementType: "company_driver",
      customerName: "Summit Goods",
      customerKind: "shipper",
      commodity: "Store fixtures",
      weightLbs: 3100,
      equipment: { type: "sprinter" },
      stops: [
        stop("pickup", 1, "Portland", "OR", "America/Los_Angeles", hoursFromNow(20)),
        stop("delivery", 2, "Spokane", "WA", "America/Los_Angeles", hoursFromNow(33)),
      ],
      serviceWindow: { startAt: hoursFromNow(20), endAt: hoursFromNow(33) },
      dispatchNote:
        "Overnight run. Says it needs a sprinter but a van would do it. Tell me if the reset lands wrong for you.",
      rate: {
        currency: "USD",
        linehaulCents: 44_000,
        totalRateCents: 44_000,
        ratePerMileCents: 125,
        driverShareCents: 13_200,
        loadedMiles: 352,
        deadheadMiles: 12,
        accessorials: [],
      },
      sentAt: hoursFromNow(-4),
      sentBy: OFFICE,
      respondByAt: hoursFromNow(9),
      idempotencyKey: "opp_cs_88455:sent",
      provenance: mockProvenance("opportunity", { externalId: "opp_cs_88455" }),
    },

    /* --- Stonebridge: an owner-operator, the rate is theirs to argue ------ */
    {
      opportunityRef: externalRef("opportunity", "opp_sb_20114", { entityKind: "load_opportunity" }),
      organizationId: "org_stonebridge",
      driverId: "drv_sb_0044",
      engagementType: "owner_operator",
      customerName: "Keystone Brokerage",
      customerKind: "broker",
      commodity: "Machined parts, crated",
      weightLbs: 7400,
      equipment: { type: "box_truck" },
      stops: [
        stop("pickup", 1, "Richmond", "VA", "America/New_York", hoursFromNow(16), {
          facilityName: "Keystone DC Richmond",
          notes: "Same building you deliver 1042 into. Ask for Marcus at the dock office.",
        }),
        stop("delivery", 2, "Greensboro", "NC", "America/New_York", hoursFromNow(27), {
          appointmentType: "fcfs",
          appointmentEndAt: hoursFromNow(31),
        }),
      ],
      serviceWindow: { startAt: hoursFromNow(16), endAt: hoursFromNow(31) },
      dispatchNote:
        "Reload out of Richmond so you are not going home empty. They opened at $1,180. I think there is room — tell me your number before I answer them.",
      rate: {
        currency: "USD",
        linehaulCents: 118_000,
        totalRateCents: 118_000,
        ratePerMileCents: 494,
        loadedMiles: 239,
        deadheadMiles: 4,
        accessorials: [],
      },
      sentAt: hoursFromNow(-0.7),
      sentBy: OFFICE,
      respondByAt: hoursFromNow(5),
      idempotencyKey: "opp_sb_20114:sent",
      provenance: mockProvenance("opportunity", { externalId: "opp_sb_20114" }),
    },
    {
      // Overlaps 20114 in time and uses the same truck. Finalizing one of them
      // is what turns the other Unavailable — which is the point of having it.
      opportunityRef: externalRef("opportunity", "opp_sb_20119", { entityKind: "load_opportunity" }),
      organizationId: "org_stonebridge",
      driverId: "drv_sb_0044",
      engagementType: "owner_operator",
      customerName: "Hartline Manufacturing",
      customerKind: "shipper",
      commodity: "Steel coil, banded",
      weightLbs: 9600,
      equipment: { type: "box_truck" },
      stops: [
        stop("pickup", 1, "Richmond", "VA", "America/New_York", hoursFromNow(18)),
        stop("delivery", 2, "Columbia", "SC", "America/New_York", hoursFromNow(34)),
      ],
      serviceWindow: { startAt: hoursFromNow(18), endAt: hoursFromNow(34) },
      dispatchNote:
        "Second option out of Richmond, pays better per mile but it is a long day. You can only take one of these two.",
      rate: {
        currency: "USD",
        linehaulCents: 164_000,
        totalRateCents: 172_500,
        ratePerMileCents: 421,
        loadedMiles: 390,
        deadheadMiles: 4,
        accessorials: [{ code: "tarp", label: "Tarp", amountCents: 8_500 }],
      },
      sentAt: hoursFromNow(-0.4),
      sentBy: OFFICE,
      respondByAt: hoursFromNow(5),
      idempotencyKey: "opp_sb_20119:sent",
      provenance: mockProvenance("opportunity", { externalId: "opp_sb_20119" }),
    },
    {
      // Already dead: finalized freight took this window. Kept so the inbox
      // shows what an Unavailable proposal looks like with its history intact.
      opportunityRef: externalRef("opportunity", "opp_sb_20088", { entityKind: "load_opportunity" }),
      organizationId: "org_stonebridge",
      driverId: "drv_sb_0044",
      engagementType: "owner_operator",
      customerName: "Keystone Brokerage",
      customerKind: "broker",
      commodity: "Mixed hardware",
      weightLbs: 5200,
      equipment: { type: "box_truck" },
      stops: [
        stop("pickup", 1, "Pittsburgh", "PA", "America/New_York", hoursFromNow(-1)),
        stop("delivery", 2, "Baltimore", "MD", "America/New_York", hoursFromNow(9)),
      ],
      serviceWindow: { startAt: hoursFromNow(-1), endAt: hoursFromNow(9) },
      dispatchNote: "Backup option while 1042 was still being papered.",
      rate: {
        currency: "USD",
        linehaulCents: 71_000,
        totalRateCents: 71_000,
        ratePerMileCents: 292,
        loadedMiles: 243,
        deadheadMiles: 8,
        accessorials: [],
      },
      sentAt: daysFromNow(-1),
      sentBy: OFFICE,
      idempotencyKey: "opp_sb_20088:sent",
      provenance: mockProvenance("opportunity", { externalId: "opp_sb_20088" }),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Extraction fixtures                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a document extractor would return. There is no extractor: these are
 * fixtures, the adapter says so, and the UI repeats it.
 *
 * They exist so the correction path is real code rather than a promise — a
 * driver can disagree with an extracted value today and both values are kept
 * with who changed it and when.
 */
export function extractionFixture(kind: string, at: IsoDateTime): DriverExtractedField[] {
  const base = (key: string, label: string, value: string, confidence: number): DriverExtractedField => ({
    key,
    label,
    extractedValue: value,
    extractionConfidence: confidence,
  });

  switch (kind) {
    case "bill_of_lading":
      return [
        base("bol_number", "BOL number", "BOL-449120", 0.94),
        base("pieces", "Pieces", "14", 0.88),
        base("weight_lbs", "Weight (lbs)", "8,140", 0.61),
        base("shipper_signature", "Shipper signature", "Present", 0.79),
        base("pickup_date", "Pickup date", at.slice(0, 10), 0.9),
      ];
    case "proof_of_delivery":
      return [
        base("pod_number", "POD number", "POD-449120", 0.92),
        base("received_by", "Received by", "M. ORTEGA", 0.54),
        base("delivery_date", "Delivery date", at.slice(0, 10), 0.91),
        base("exceptions_noted", "Exceptions noted", "None", 0.83),
      ];
    case "scale_ticket":
      return [
        base("gross_weight_lbs", "Gross weight (lbs)", "31,220", 0.87),
        base("ticket_number", "Ticket number", "SC-77310", 0.9),
      ];
    default:
      return [
        base("total_amount", "Total", "$186.44", 0.72),
        base("vendor", "Vendor", "PILOT #412", 0.85),
        base("date", "Date", at.slice(0, 10), 0.93),
      ];
  }
}

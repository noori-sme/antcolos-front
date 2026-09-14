import type { ActorRef, RateConfirmationExtraction } from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Reviewed rate confirmation extractions.
 *
 * These stand in for the output of the rate confirmation workflow, which is not
 * built yet: a document has been read, a dispatcher has corrected the fields,
 * and this is what they signed off. Everything downstream of this point — the
 * matching, the proposal, the confirmation, the permanent profiles — is real
 * code operating on real records.
 *
 * The four below are chosen to reach every branch of the resolver, because a
 * fixture set where everything matches cleanly proves only the easy half:
 *
 *   1. `rcon_apex_reorder`     The MC number matches a broker on file exactly,
 *                              and so do the location and the agent. The happy
 *                              path — and still a confirmation, not an
 *                              automatic merge.
 *   2. `rcon_tandem_ambiguous` A broker with NO MC number whose name resembles
 *                              two profiles on file. The resolver refuses to
 *                              pick and hands the dispatcher the choice.
 *   3. `rcon_midwest_new`      Nobody in the directory resembles any of these
 *                              three companies. Clean creations.
 *   4. `rcon_apex_thin`        The right broker, but the document omits the MC
 *                              number and the shipper's street address. Enough
 *                              to book the load, not enough to recognise the
 *                              shipper next time — so the profile it creates is
 *                              born flagged rather than silently trusted.
 */

const REVIEWER: ActorRef = {
  userId: "usr_sam",
  membershipId: "mem_northline_owner",
  displayNameSnapshot: "Sam Murtaza",
  source: "web",
};

const reviewedAt = new Date(Date.now() - 20 * 60_000).toISOString();

/** 1 — Everything matches. The dispatcher is confirming, not deciding. */
const apexReorder: RateConfirmationExtraction = {
  documentId: "doc_rcon_demo_apex",
  customerReference: "APX-78402",
  blocks: [
    {
      role: "broker",
      party: {
        // Printed differently from the profile on file, which is the point:
        // the MC number is what matches, not the spelling of the name.
        name: "APEX LOGISTICS, LLC",
        mcNumber: "MC 612884",
        dotNumber: "2884110",
        address: { line1: "400 W Monroe Street, Ste 1800", city: "Chicago", state: "IL", postalCode: "60606" },
        phone: "(312) 555-0110",
        email: "dispatch@apexlog.example",
      },
      contacts: [
        {
          fullName: "Dana Wells",
          title: "Senior broker",
          phone: "312-555-0110",
          phoneExtension: "204",
          email: "dana@apexlog.example",
        },
      ],
    },
    {
      role: "shipper",
      party: {
        name: "Apex Logistics LLC",
        mcNumber: "MC 612884",
        address: { line1: "5600 W 73rd St", city: "Chicago", state: "IL", postalCode: "60638" },
      },
      facility: {
        name: "Apex Cross-Dock 4",
        address: { line1: "5600 W 73rd Street", city: "Chicago", state: "IL", postalCode: "60638" },
        hoursText: "Mon–Fri 06:00–18:00",
        appointmentRequired: false,
        instructions: "Dock 12. Check in at the guard shack with the PU number.",
      },
      contacts: [{ fullName: "Yard office", phone: "(312) 555-0188" }],
    },
    {
      role: "receiver",
      party: {
        name: "Rivet Supply Co",
        address: { line1: "1400 Kinnear Rd", city: "Columbus", state: "OH", postalCode: "43212" },
        phone: "614-555-0166",
      },
      facility: {
        name: "Rivet DC Columbus",
        address: { line1: "2900 Charter Street", city: "Columbus", state: "OH", postalCode: "43228" },
        hoursText: "Mon–Sat 07:00–15:00",
        appointmentRequired: true,
      },
      contacts: [
        { fullName: "Marco Bell", title: "Receiving supervisor", phone: "(614) 555-0140", email: "mbell@rivetsupply.example" },
      ],
    },
  ],
  reviewedBy: REVIEWER,
  reviewedAt,
};

/** 2 — Two plausible brokers, nothing to separate them. */
const tandemAmbiguous: RateConfirmationExtraction = {
  documentId: "doc_rcon_demo_tandem",
  customerReference: "TF-44120",
  blocks: [
    {
      role: "broker",
      party: {
        // No MC number at all, and "Tandem Freight" matches two profiles.
        name: "Tandem Freight",
        address: { city: "Chicago", state: "IL" },
        phone: "(312) 555-0900",
      },
      contacts: [{ fullName: "Dave", phone: "(312) 555-0900", phoneExtension: "11" }],
    },
    {
      role: "shipper",
      party: {
        name: "Glenmark Distribution LLC",
        address: { line1: "3300 N Main St", city: "Rockford", state: "IL", postalCode: "61103" },
      },
      facility: {
        name: "Glenmark Rockford Warehouse",
        address: { line1: "3300 North Main Street", city: "Rockford", state: "IL", postalCode: "61103" },
        hoursText: "Mon–Fri 07:00–16:00",
      },
      contacts: [{ fullName: "Eli Ross", title: "Shipping clerk", phone: "815-555-0122" }],
    },
    {
      role: "receiver",
      party: {
        name: "Cardinal Cold Storage Inc",
        address: { line1: "9100 Maritime Dr", city: "Memphis", state: "TN", postalCode: "38118" },
        phone: "(901) 555-0144",
      },
      facility: {
        name: "Cardinal Cold — Memphis",
        address: { line1: "9100 Maritime Drive", city: "Memphis", state: "TN", postalCode: "38118" },
        hoursText: "24/7",
        appointmentRequired: true,
        instructions: "Reefer set to 34°F continuous. Pulp temp taken at the door.",
      },
      contacts: [{ fullName: "Tasha Greene", title: "Dock supervisor", phone: "(901) 555-0144", email: "tgreene@cardinalcold.example" }],
    },
  ],
  reviewedBy: REVIEWER,
  reviewedAt,
};

/** 3 — A broker and two companies nobody has dealt with before. */
const midwestNew: RateConfirmationExtraction = {
  documentId: "doc_rcon_demo_midwest",
  customerReference: "MWL-20714",
  blocks: [
    {
      role: "broker",
      party: {
        name: "Midwest Lane Logistics LLC",
        mcNumber: "MC-1044219",
        dotNumber: "3442190",
        address: { line1: "820 E Washington St", city: "Indianapolis", state: "IN", postalCode: "46204" },
        phone: "(317) 555-0181",
        email: "ops@midwestlane.example",
      },
      contacts: [
        { fullName: "Colby Nance", title: "Carrier sales", phone: "317-555-0181", phoneExtension: "312", email: "cnance@midwestlane.example" },
        { fullName: "After hours desk", phone: "(317) 555-0199" },
      ],
    },
    {
      role: "shipper",
      party: {
        name: "Lakeshore Paper Products",
        address: { line1: "6200 Industrial Pkwy", city: "Green Bay", state: "WI", postalCode: "54311" },
        phone: "(920) 555-0117",
      },
      facility: {
        name: "Lakeshore Mill 2",
        address: { line1: "6200 Industrial Parkway", city: "Green Bay", state: "WI", postalCode: "54311" },
        hoursText: "Mon–Fri 05:00–22:00",
        appointmentRequired: false,
        instructions: "Trailer must be swept clean. Load bars supplied on site.",
      },
      contacts: [{ fullName: "Hank Moser", title: "Shipping office", phone: "920-555-0117", email: "hmoser@lakeshorepaper.example" }],
    },
    {
      role: "receiver",
      party: {
        name: "Heartland Print Supply Co.",
        address: { line1: "1425 S 27th St", city: "Omaha", state: "NE", postalCode: "68105" },
        phone: "(402) 555-0164",
      },
      facility: {
        name: "Heartland Omaha DC",
        address: { line1: "1425 South 27th Street", city: "Omaha", state: "NE", postalCode: "68105" },
        hoursText: "Mon–Fri 08:00–16:00",
        appointmentRequired: true,
      },
      contacts: [{ fullName: "Renata Vogel", title: "Receiving", phone: "(402) 555-0164", email: "rvogel@heartlandprint.example" }],
    },
  ],
  reviewedBy: REVIEWER,
  reviewedAt,
};

/** 4 — The right broker, a document too thin to recognise the shipper again. */
const apexThin: RateConfirmationExtraction = {
  documentId: "doc_rcon_demo_thin",
  customerReference: "APX-78500",
  blocks: [
    {
      role: "broker",
      party: {
        // No MC number printed, but the address, phone and name all agree with
        // the Apex profile — several soft signals rather than one decisive one.
        name: "Apex Logistics",
        address: { line1: "400 W Monroe St", city: "Chicago", state: "IL", postalCode: "60606" },
        phone: "(312) 555-0110",
        email: "dispatch@apexlog.example",
      },
      contacts: [{ fullName: "Dana Wells", phone: "(312) 555-0110", phoneExtension: "204" }],
    },
    {
      role: "shipper",
      party: {
        // A city and a state, and nothing else. Bookable, not matchable.
        name: "Northgate Plastics",
        address: { city: "Elkhart", state: "IN" },
      },
      facility: {
        address: { city: "Elkhart", state: "IN" },
        hoursText: "Call for appointment",
      },
      contacts: [],
    },
  ],
  reviewedBy: REVIEWER,
  reviewedAt,
};

export const MOCK_EXTRACTIONS: RateConfirmationExtraction[] = [
  apexReorder,
  tandemAmbiguous,
  midwestNew,
  apexThin,
];

/** What the demo screen calls each one. Not part of the extraction itself. */
export const MOCK_EXTRACTION_LABELS: Record<string, { title: string; blurb: string }> = {
  doc_rcon_demo_apex: {
    title: "Apex Logistics — MC number matches",
    blurb: "Everything on this one is already in the directory. Confirm and it links.",
  },
  doc_rcon_demo_tandem: {
    title: "Tandem Freight — two profiles fit",
    blurb: "No MC number, and the name matches two brokers. You pick, or create a new one.",
  },
  doc_rcon_demo_midwest: {
    title: "Midwest Lane Logistics — all new",
    blurb: "Nothing here resembles anything on file. Three new profiles, once you agree.",
  },
  doc_rcon_demo_thin: {
    title: "Apex Logistics — a thin document",
    blurb: "The broker is recognisable; the shipper has no street address, so it is flagged.",
  },
};

export function mockExtraction(documentId: string): RateConfirmationExtraction | undefined {
  return MOCK_EXTRACTIONS.find((e) => e.documentId === documentId);
}

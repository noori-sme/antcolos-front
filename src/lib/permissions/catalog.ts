import type {
  OrganizationType,
  PermissionGroup,
  PermissionKey,
  PermissionMeta,
} from "@/types";

/**
 * THE permission catalog. Adding a key here makes it appear in the permission
 * editor, the invitation summary, the audit log and the docs — there is nowhere
 * else to register it.
 *
 * Descriptions are written for a carrier owner, not an engineer: they say what
 * the person will be able to do, in the words that owner would use.
 *
 * For Taqi: UI permission checks are user experience, not security. Hiding a
 * button prevents confusion, not attack. Every key below must be enforced
 * server-side on the matching endpoint. This catalog is the shared vocabulary.
 */
export const PERMISSION_CATALOG: readonly PermissionMeta[] = [
  // ---- Loads -------------------------------------------------------------
  { key: "loads:view", label: "View loads", description: "See loads, their stops and where they are.", group: "loads", scopeNote: "Narrowed by record scope: a seat set to assigned loads sees only the loads it is on." },
  { key: "loads:create", label: "Create loads", description: "Add new loads by hand or by import.", group: "loads", prerequisites: ["loads:view"] },
  { key: "loads:edit", label: "Edit loads", description: "Change load details, stops and reference numbers.", group: "loads", prerequisites: ["loads:view"] },
  { key: "loads:status:update", label: "Update load status", description: "Move a load along — picked up, in transit, delivered.", group: "loads", prerequisites: ["loads:view"], scopeNote: "Narrowed by record scope, so a driver updates only their own loads." },
  { key: "loads:export", label: "Download loads", description: "Export load lists out of Antcolos as a file.", group: "loads", prerequisites: ["loads:view"] },
  { key: "loads:delete", label: "Delete loads", description: "Permanently remove a load and its history.", group: "loads", sensitive: true, prerequisites: ["loads:view"] },

  // ---- Dispatch ----------------------------------------------------------
  { key: "dispatch:view", label: "Open the dispatch board", description: "See the planning board of trucks and available freight.", group: "dispatch" },
  { key: "loads:assign", label: "Assign loads", description: "Put a driver, truck and trailer on a load.", group: "dispatch", prerequisites: ["loads:view"] },

  // ---- Tracking ----------------------------------------------------------
  // Three keys, because they are three different exposures. Watching your own
  // fleet run is an everyday thing; handing a stranger a link that shows where
  // one of your trucks is, is not, and sending words to a broker in the
  // carrier's name is different again.
  { key: "tracking:view", label: "Open load tracking", description: "See where loads are, how fresh the tracking is, and what has gone wrong with them.", group: "tracking", scopeNote: "In a dispatch organization this reaches only the trucks a carrier has explicitly shared, and only while that sharing lasts." },
  { key: "tracking:share", label: "Share tracking with customers", description: "Create and withdraw tracking links for a broker, shipper or receiver, and decide what each of them may see.", group: "tracking", sensitive: true, prerequisites: ["tracking:view"], scopeNote: "Creates a link for somebody outside Antcolos. Bounded by what the carrier shared in the first place." },
  { key: "tracking:update:send", label: "Approve tracking updates", description: "Approve the progress updates that go out to a customer, or decide they should not go.", group: "tracking", prerequisites: ["tracking:view"] },

  // ---- Driver decision and trip workflow ---------------------------------
  { key: "proposals:view", label: "See load proposals", description: "See load opportunities dispatch sends you before they are booked.", group: "driver_workflow", scopeNote: "Only the proposals sent to this person. It never opens anybody else's." },
  { key: "proposals:respond", label: "Answer load proposals", description: "Approve, reject, pause, comment on or counter a load proposal.", group: "driver_workflow", prerequisites: ["proposals:view"], scopeNote: "Their own proposals only. Answering for somebody else is not a thing this key can do." },
  { key: "trips:execute", label: "Run the trip workflow", description: "Record trip milestones, fuel, rest and other operational updates, and attach the paperwork they produce.", group: "driver_workflow", scopeNote: "The trips this person is assigned to, and no others." },

  // ---- Drivers -----------------------------------------------------------
  { key: "drivers:view", label: "View drivers", description: "See driver records, contact details and availability.", group: "drivers" },
  { key: "drivers:create", label: "Add drivers", description: "Create a new driver record.", group: "drivers", prerequisites: ["drivers:view"] },
  { key: "drivers:edit", label: "Edit drivers", description: "Change driver details and mark them active or inactive.", group: "drivers", prerequisites: ["drivers:view"] },
  { key: "drivers:delete", label: "Delete drivers", description: "Permanently remove a driver record.", group: "drivers", sensitive: true, prerequisites: ["drivers:view"] },

  // ---- Trucks ------------------------------------------------------------
  { key: "trucks:view", label: "View trucks", description: "See trucks, where they are and when they come empty.", group: "trucks" },
  { key: "trucks:create", label: "Add trucks", description: "Add a truck to the fleet.", group: "trucks", orgTypes: ["CARRIER"], prerequisites: ["trucks:view"] },
  { key: "trucks:edit", label: "Edit trucks", description: "Change truck details and status.", group: "trucks", orgTypes: ["CARRIER"], prerequisites: ["trucks:view"] },
  { key: "trucks:delete", label: "Delete trucks", description: "Permanently remove a truck.", group: "trucks", sensitive: true, orgTypes: ["CARRIER"], prerequisites: ["trucks:view"] },
  { key: "trucks:documents:manage", label: "Manage truck documents", description: "Add, replace and review registration, title, insurance and inspection paperwork.", group: "trucks", prerequisites: ["trucks:view"] },
  { key: "trucks:assignments:manage", label: "Assign drivers to trucks", description: "Put a driver on a truck, swap them, or end the assignment.", group: "trucks", prerequisites: ["trucks:view"] },
  { key: "trucks:relationships:manage", label: "Manage truck carrier relationships", description: "Connect a truck to this organization, or end that connection.", group: "trucks", sensitive: true, prerequisites: ["trucks:view"], scopeNote: "This is what grants an outside dispatch organization reach into a truck. It is a delegation, not a permission somebody else's role can contain." },
  { key: "trucks:ownership:review", label: "Review truck ownership claims", description: "Decide who legally owns a truck when somebody claims it. The strongest truck permission there is.", group: "trucks", sensitive: true, prerequisites: ["trucks:view"] },

  // ---- Trailers ----------------------------------------------------------
  { key: "trailers:view", label: "View trailers", description: "See trailers and what they are attached to.", group: "trailers" },
  { key: "trailers:create", label: "Add trailers", description: "Add a trailer to the fleet.", group: "trailers", orgTypes: ["CARRIER"], prerequisites: ["trailers:view"] },
  { key: "trailers:edit", label: "Edit trailers", description: "Change trailer details and status.", group: "trailers", orgTypes: ["CARRIER"], prerequisites: ["trailers:view"] },
  { key: "trailers:delete", label: "Delete trailers", description: "Permanently remove a trailer.", group: "trailers", sensitive: true, orgTypes: ["CARRIER"], prerequisites: ["trailers:view"] },
  { key: "trailers:documents:manage", label: "Manage trailer documents", description: "Add, replace and review registration, title, insurance and inspection paperwork for trailers.", group: "trailers", prerequisites: ["trailers:view"] },
  { key: "trailers:attachments:manage", label: "Attach and detach trailers", description: "Put a trailer on a power unit, reserve one, move it to another, or unhook it.", group: "trailers", prerequisites: ["trailers:view"] },
  { key: "trailers:relationships:manage", label: "Manage trailer carrier relationships", description: "Connect a trailer to this organization, take operating authority over it, or end that connection.", group: "trailers", sensitive: true, prerequisites: ["trailers:view"] },
  { key: "trailers:status:manage", label: "Change trailer status and availability", description: "Mark a trailer available, loaded, in maintenance or out of service, and set where it will be free.", group: "trailers", prerequisites: ["trailers:view"] },
  { key: "trailers:ownership:review", label: "Review trailer ownership claims", description: "Decide who legally owns a trailer when somebody claims it. The strongest trailer permission there is.", group: "trailers", sensitive: true, prerequisites: ["trailers:view"] },

  // ---- Fleet operations --------------------------------------------------
  { key: "fleet:view", label: "Open the fleet dashboard", description: "See the operational picture across trucks, trailers and drivers — what is available, what is out, and what is stopping it.", group: "fleet" },
  { key: "fleet:telemetry:record", label: "Record location and mileage", description: "Write down where a truck or trailer is, its odometer and its engine hours. Nothing is read from a device — somebody types it in.", group: "fleet", prerequisites: ["fleet:view"] },

  // ---- ELD & Telematics --------------------------------------------------
  // Eight keys, because there are eight genuinely different powers here. The
  // last four are the ones that would otherwise ride in on "can see the fleet":
  // a person's exact position, a person's driving clock, an engine's faults and
  // the raw payloads a provider posted are each somebody's business and not
  // everybody's.
  { key: "eld:view", label: "Open ELD & Telematics", description: "See connected devices, their state, and the equipment picture built from what they report.", group: "eld" },
  { key: "eld:devices:manage", label: "Manage devices and connections", description: "Register a device, link or unlink a provider connection, and retire a unit.", group: "eld", orgTypes: ["CARRIER"], prerequisites: ["eld:view"] },
  { key: "eld:bindings:manage", label: "Bind devices to trucks and drivers", description: "Say which truck a device reports for, and which driver is operating it, from when until when.", group: "eld", orgTypes: ["CARRIER"], prerequisites: ["eld:view"] },
  { key: "eld:ingest", label: "Submit provider data", description: "Push a mock provider payload through the webhook or import boundary. A development affordance, clearly labelled as one.", group: "eld", orgTypes: ["CARRIER"], prerequisites: ["eld:view"] },
  { key: "eld:location:precise:view", label: "See precise locations", description: "See exact coordinates rather than the city a truck is near. This is a person's whereabouts, minute by minute.", group: "eld", sensitive: true, prerequisites: ["eld:view"], scopeNote: "Necessary and not sufficient in a dispatch organization: the carrier's per-truck Dispatch delegation decides which trucks it reaches." },
  { key: "eld:diagnostics:view", label: "See engine diagnostics", description: "See the fault codes equipment reports. Antcolos carries the codes and does not interpret them.", group: "eld", prerequisites: ["eld:view"] },
  { key: "eld:hos:view", label: "See hours-of-service availability", description: "See how much driving, shift and cycle time a driver has left, as their provider summarises it. Not their logs.", group: "eld", sensitive: true, prerequisites: ["eld:view"], scopeNote: "A driver holding this sees their own clock only. It does not open a colleague's." },
  { key: "eld:raw:view", label: "See raw provider payloads", description: "Read exactly what a provider sent, before Antcolos normalized it. For settling disputes about what actually arrived.", group: "eld", sensitive: true, prerequisites: ["eld:view"] },

  // ---- Customers ---------------------------------------------------------
  { key: "customers:view", label: "View customers", description: "See the brokers and shippers you haul for.", group: "customers" },
  { key: "customers:create", label: "Add customers", description: "Add a new broker or shipper.", group: "customers", prerequisites: ["customers:view"] },
  { key: "customers:edit", label: "Edit customers", description: "Change customer details and contacts.", group: "customers", prerequisites: ["customers:view"] },
  { key: "customers:delete", label: "Delete customers", description: "Permanently remove a customer record.", group: "customers", sensitive: true, prerequisites: ["customers:view"] },
  { key: "customers:private:manage", label: "Manage private notes and ratings", description: "Write your own notes, ratings, payment experience and blocked or preferred status. Only your organization ever sees them.", group: "customers", prerequisites: ["customers:view"] },
  { key: "customers:resolve", label: "Confirm customer matches", description: "Decide whether a broker, shipper or receiver on a rate confirmation is one you already have, or a new profile.", group: "customers", sensitive: true, prerequisites: ["customers:view"] },

  // ---- Documents ---------------------------------------------------------
  { key: "documents:view", label: "View documents", description: "Open uploaded paperwork such as BOLs and PODs.", group: "documents", scopeNote: "A driver's own documents reach a carrier only through the driver's own sharing consent, never through this key alone." },
  { key: "documents:upload", label: "Upload documents", description: "Attach paperwork to a load or a driver.", group: "documents", prerequisites: ["documents:view"] },
  { key: "documents:download", label: "Download documents", description: "Save copies of paperwork onto their own device.", group: "documents", prerequisites: ["documents:view"] },
  { key: "documents:approve", label: "Approve documents", description: "Accept or reject paperwork someone submitted.", group: "documents", prerequisites: ["documents:view"] },
  { key: "documents:delete", label: "Delete documents", description: "Permanently remove uploaded paperwork.", group: "documents", sensitive: true, prerequisites: ["documents:view"] },

  // ---- Settlements -------------------------------------------------------
  { key: "settlements:view", label: "View settlements", description: "See driver pay statements.", group: "settlements", scopeNote: "Narrowed by financial scope: a seat set to own financials sees only its own statements." },
  { key: "settlements:create", label: "Create settlements", description: "Build pay periods and add pay lines.", group: "settlements", prerequisites: ["settlements:view"] },
  { key: "settlements:approve", label: "Approve settlements", description: "Sign off a settlement so it can be paid.", group: "settlements", sensitive: true, financial: true, prerequisites: ["settlements:view"] },
  { key: "settlements:export", label: "Download settlements", description: "Export pay statements out of Antcolos.", group: "settlements", sensitive: true, financial: true, prerequisites: ["settlements:view"] },
  { key: "settlements:dispute", label: "Raise a settlement dispute", description: "Tell the carrier a pay statement looks wrong, and say why.", group: "settlements", prerequisites: ["settlements:view"], scopeNote: "Raising one only. It never approves, corrects or pays a settlement \u2014 including the holder's own." },
  { key: "settlements:dispute:resolve", label: "Resolve settlement disputes", description: "Answer a disputed pay statement and decide whether it stands or gets corrected.", group: "settlements", sensitive: true, financial: true, prerequisites: ["settlements:view"] },
  { key: "settlements:adjust", label: "Correct settlements", description: "Raise a correction against a settlement that is already approved or paid. The original is never edited.", group: "settlements", sensitive: true, financial: true, prerequisites: ["settlements:view"] },
  { key: "settlements:pay", label: "Record settlement payments", description: "Queue a settlement for payment and record what was paid. Antcolos does not move the money.", group: "settlements", sensitive: true, financial: true, prerequisites: ["settlements:view"] },
  { key: "settlements:void", label: "Void settlements", description: "Cancel a settlement. It stays on the record with its reason.", group: "settlements", sensitive: true, financial: true, prerequisites: ["settlements:view"] },

  // ---- Invoices ----------------------------------------------------------
  { key: "invoices:view", label: "View invoices", description: "See customer invoices and what is unpaid.", group: "invoices" },
  { key: "invoices:create", label: "Create invoices", description: "Invoice a customer for delivered freight.", group: "invoices", prerequisites: ["invoices:view"] },
  { key: "invoices:edit", label: "Edit invoices", description: "Change an invoice before it is sent.", group: "invoices", prerequisites: ["invoices:view"] },
  { key: "invoices:send", label: "Send invoices", description: "Send an invoice to the customer.", group: "invoices", financial: true, prerequisites: ["invoices:view"] },
  { key: "invoices:export", label: "Download invoices", description: "Export invoices out of Antcolos.", group: "invoices", sensitive: true, financial: true, prerequisites: ["invoices:view"] },

  // ---- Reports -----------------------------------------------------------
  { key: "reports:view", label: "View reports", description: "Open performance and operations reports.", group: "reports", scopeNote: "What it shows depends on the organization type and on whether revenue:view is held alongside it." },
  { key: "reports:export", label: "Download reports", description: "Export reports out of Antcolos as a file.", group: "reports", sensitive: true, prerequisites: ["reports:view"] },

  // ---- Accounting and financial information ------------------------------
  { key: "rates:view", label: "See rates", description: "See what each load pays. Without this, loads show no money at all.", group: "accounting", sensitive: true, financial: true },
  { key: "rates:edit", label: "Change rates", description: "Change what a load pays, including accessorials.", group: "accounting", sensitive: true, financial: true, prerequisites: ["rates:view"] },
  { key: "revenue:view", label: "See revenue", description: "See total revenue across the business.", group: "accounting", sensitive: true, financial: true, scopeNote: "Organization-wide figures. Without it, Reports shows a dispatcher their own income and nothing more." },
  { key: "expenses:view", label: "See expenses", description: "See what the business is spending.", group: "accounting", sensitive: true, financial: true },
  { key: "profitability:view", label: "See profit and margin", description: "See what the business actually makes after costs.", group: "accounting", sensitive: true, financial: true },

  // ---- Fuel and IFTA -----------------------------------------------------
  // Seeing that a truck bought fuel, seeing what it cost, and being allowed
  // near the tax return are three different powers and three different keys.
  { key: "fuel:view", label: "View fuel purchases", description: "See fuel purchases, gallons, where they happened and how the fleet is running.", group: "fuel", scopeNote: "Operational fuel only. Cost is fuel:costs:view and tax is the ifta keys \u2014 neither rides in on this one." },
  { key: "fuel:record", label: "Record fuel purchases", description: "Enter a fuel purchase by hand.", group: "fuel", prerequisites: ["fuel:view"] },
  { key: "fuel:import", label: "Import fuel purchases", description: "Bring fuel purchases in from a fuel card or another outside system.", group: "fuel", prerequisites: ["fuel:view"] },
  { key: "fuel:review", label: "Review fuel purchases", description: "Accept a purchase, reject it, or mark it a duplicate of another.", group: "fuel", prerequisites: ["fuel:view"] },
  { key: "fuel:correct", label: "Correct fuel purchases", description: "Issue a correction. The original is never changed — a new revision replaces it and both stay on the record.", group: "fuel", sensitive: true, prerequisites: ["fuel:view"] },
  { key: "fuel:export", label: "Download fuel records", description: "Export fuel purchases and mileage out of Antcolos as a file.", group: "fuel", sensitive: true, prerequisites: ["fuel:view"] },
  { key: "fuel:costs:view", label: "See fuel cost", description: "See what fuel costs — spend, price per gallon and cost per mile. Without this, fuel shows gallons and miles but no money.", group: "fuel", sensitive: true, financial: true, prerequisites: ["fuel:view"] },
  { key: "mileage:view", label: "View jurisdiction mileage", description: "See how many miles each truck ran in each state or province.", group: "fuel" },
  { key: "mileage:record", label: "Record jurisdiction mileage", description: "Enter miles run in a state or province by hand.", group: "fuel", prerequisites: ["mileage:view"] },
  { key: "mileage:review", label: "Review jurisdiction mileage", description: "Accept or reject a mileage record, and correct one that is wrong.", group: "fuel", prerequisites: ["mileage:view"] },
  { key: "ifta:view", label: "View IFTA quarters", description: "Open the quarterly IFTA periods and the per-jurisdiction figures. Tax information — give it deliberately.", group: "fuel", sensitive: true, scopeNote: "For a dispatch organization this is necessary and not sufficient \u2014 the carrier authorizes tax access separately, per carrier." },
  { key: "ifta:manage", label: "Manage IFTA quarters", description: "Move a quarter through review, mark it ready, record that it was filed, and amend it afterwards. Antcolos never files anything itself.", group: "fuel", sensitive: true, financial: true, prerequisites: ["ifta:view"] },

  // ---- Compliance & safety -----------------------------------------------
  { key: "compliance:view", label: "View compliance", description: "See licences, inspections and what is about to expire.", group: "compliance", scopeNote: "Narrowed by record scope, so a driver sees the requirements that are theirs." },
  { key: "compliance:manage", label: "Manage compliance", description: "Record and clear compliance items.", group: "compliance", prerequisites: ["compliance:view"] },

  // ---- Maintenance -------------------------------------------------------
  { key: "maintenance:view", label: "View maintenance", description: "See what equipment is due for service, what has been reported broken, and what has been done to it.", group: "maintenance" },
  { key: "maintenance:manage", label: "Manage service schedules", description: "Add and change what a truck or trailer is due for, and defer something with a recorded reason.", group: "maintenance", prerequisites: ["maintenance:view"] },
  { key: "maintenance:defects:report", label: "Report defects", description: "Report something wrong with a truck or trailer, including how badly it affects using it.", group: "maintenance", prerequisites: ["maintenance:view"], scopeNote: "Reporting a fault on equipment this person is assigned to. It does not manage anybody's defect." },
  { key: "maintenance:defects:manage", label: "Handle reported defects", description: "Acknowledge, triage and close out defects other people reported.", group: "maintenance", prerequisites: ["maintenance:view"] },
  { key: "maintenance:repairs:manage", label: "Manage repair orders", description: "Open repair orders, put a vendor and a person on them, and move them along.", group: "maintenance", prerequisites: ["maintenance:view"] },
  { key: "maintenance:service:record", label: "Record completed service", description: "Write the permanent record of work that was done. Service history can never be edited or deleted afterwards.", group: "maintenance", sensitive: true, prerequisites: ["maintenance:view"] },
  { key: "maintenance:costs:view", label: "See maintenance costs", description: "See what repairs cost and how long equipment was down. Without this, repair orders show the work but no money.", group: "maintenance", sensitive: true, financial: true, prerequisites: ["maintenance:view"] },
  { key: "maintenance:outofservice:manage", label: "Place equipment out of service", description: "Park a truck or trailer so nobody can load it, and put it back on the road afterwards.", group: "maintenance", sensitive: true, prerequisites: ["maintenance:view"] },
  { key: "maintenance:share:manage", label: "Share maintenance with dispatch", description: "Decide which dispatch organizations may see that a piece of equipment is unavailable. They never see cost, vendor or notes.", group: "maintenance", sensitive: true, orgTypes: ["CARRIER"], prerequisites: ["maintenance:view"] },
  // ---- Insurance ---------------------------------------------------------
  { key: "insurance:view", label: "View insurance", description: "See policies, what they cover, when they expire and which certificates have gone out.", group: "insurance" },
  { key: "insurance:manage", label: "Manage insurance", description: "Record policies and coverage, renew or replace them, and issue certificates of insurance.", group: "insurance", prerequisites: ["insurance:view"] },
  { key: "insurance:sensitive:view", label: "See private policy details", description: "See premiums and the private notes on a policy. Without this, coverage and dates are visible but the money is not.", group: "insurance", sensitive: true, financial: true, prerequisites: ["insurance:view"] },
  { key: "insurance:share:manage", label: "Share insurance with others", description: "Decide which dispatch organizations and partners may see a policy, and take that access away again.", group: "insurance", sensitive: true, prerequisites: ["insurance:view"] },

  // ---- Claims ------------------------------------------------------------
  { key: "claims:view", label: "View claims", description: "See accidents, cargo damage and other claims, and where each one has got to.", group: "claims" },
  { key: "claims:create", label: "Report claims", description: "Report an accident or a loss and open a claim against a policy.", group: "claims", prerequisites: ["claims:view"] },
  { key: "claims:manage", label: "Manage claims", description: "Move a claim along, record evidence, third parties and who was responsible.", group: "claims", prerequisites: ["claims:view"] },
  { key: "claims:financials:view", label: "See claim money", description: "See reserves, repair costs, what the insurer paid and what the deductible cost you.", group: "claims", sensitive: true, financial: true, prerequisites: ["claims:view"] },

  // ---- Contracts and relationships ---------------------------------------
  // Terms, not access. Every key below decides what somebody may do to a piece
  // of PAPER; nothing here widens what anybody can do in the product. Granting
  // `contracts:terminate` does not let somebody revoke a membership, end a
  // driver relationship or release an authority lease — those need the keys in
  // the modules that own them, and the contract service only ever asks.
  { key: "contracts:view", label: "View contracts", description: "See the agreements this organization is party to, their terms, their versions and their signatures.", group: "contracts" },
  { key: "contracts:create", label: "Create contracts", description: "Start a new agreement for a business relationship and write its first draft.", group: "contracts", prerequisites: ["contracts:view"] },
  { key: "contracts:edit", label: "Edit contract drafts", description: "Change the terms of a draft. Signed terms can never be edited — they are amended.", group: "contracts", prerequisites: ["contracts:view"] },
  { key: "contracts:review", label: "Send contracts for review and issue them", description: "Put a draft up for your team to read, send it back, and issue it for signature. Nothing is sent to anybody outside Antcolos.", group: "contracts", prerequisites: ["contracts:view"] },
  { key: "contracts:sign", label: "Sign contracts", description: "Record a signature on an agreement, for a party you are personally authorised to sign for. You can never sign for the other side.", group: "contracts", sensitive: true, prerequisites: ["contracts:view"], scopeNote: "Signs this person's own side only. Who may sign for the organization is signer authority, set per contract by an owner." },
  { key: "contracts:amend", label: "Amend signed contracts", description: "Create an amendment to a signed agreement. The signed version, its signatures and its terms stay exactly as they are.", group: "contracts", sensitive: true, prerequisites: ["contracts:view"] },
  { key: "contracts:terminate", label: "Terminate contracts", description: "Give notice that an agreement is ending, and work through the closeout checklist. Access is revoked in the modules that control it, not here.", group: "contracts", sensitive: true, prerequisites: ["contracts:view"] },
  { key: "contracts:cancel", label: "Cancel contract drafts", description: "Abandon an agreement that never took effect. The record and its history are kept.", group: "contracts", prerequisites: ["contracts:view"] },
  { key: "contracts:signers:manage", label: "Authorise contract signers", description: "Say who may sign for this organization on an agreement, and withdraw that authority. The strongest contract permission there is.", group: "contracts", sensitive: true, prerequisites: ["contracts:view"] },
  { key: "contracts:requirements:waive", label: "Waive contract requirements", description: "Set aside something an agreement asks for, with a reason that goes on the record.", group: "contracts", sensitive: true, prerequisites: ["contracts:view"] },
  { key: "contracts:links:manage", label: "Link records to contracts", description: "Connect an agreement to the relationships, equipment, documents, loads, invoices and settlements it is about. Linking reads those records and never changes them.", group: "contracts", prerequisites: ["contracts:view"] },
  { key: "contracts:financials:view", label: "See contract money terms", description: "See the compensation rules an agreement sets — percentages, rates, flat amounts and deductions.", group: "contracts", sensitive: true, financial: true, prerequisites: ["contracts:view"] },
  { key: "contracts:export", label: "Download contracts", description: "Export agreements and their terms out of Antcolos as a file.", group: "contracts", sensitive: true, prerequisites: ["contracts:view"] },

  // ---- Workforce & HR ----------------------------------------------------
  { key: "workforce:view", label: "View the workforce", description: "See who works with this organization, on what basis, from when and in what status. Not their permissions, and not their pay.", group: "workforce" },
  { key: "workforce:manage", label: "Manage engagements", description: "Take somebody forward, record their classification, position and manager, and activate or suspend an engagement. This never changes anybody's permissions.", group: "workforce", sensitive: true, prerequisites: ["workforce:view"] },
  { key: "workforce:end", label: "End engagements", description: "End somebody's working relationship and work through the offboarding steps. Access is revoked by the access system, not here.", group: "workforce", sensitive: true, prerequisites: ["workforce:view"] },
  // Carrier-only, through the catalog's existing `orgTypes`: a qualification
  // file is a motor carrier's record about its own drivers, and a dispatch
  // workspace has no such file to hold.
  { key: "qualification:view", label: "View the qualification file", description: "See the exact document versions this carrier received, reviewed and relied on — including records it keeps after the relationship ends.", group: "compliance", sensitive: true, orgTypes: ["CARRIER"], scopeNote: "Retained custody records only, and only while the carrier's retention obligation lasts." },
  { key: "qualification:dispose", label: "Authorise disposal of retained records", description: "Decide that a qualification record whose retention obligation has ended may be disposed of. A record still under retention can never be disposed of, whoever holds this.", group: "compliance", sensitive: true, orgTypes: ["CARRIER"], prerequisites: ["qualification:view"] },

  // ---- Organization members ----------------------------------------------
  { key: "members:view", label: "View members", description: "See everyone who belongs to this organization.", group: "members" },
  { key: "members:edit", label: "Edit members", description: "Change someone's job title and which role they hold.", group: "members", sensitive: true, prerequisites: ["members:view"], scopeNote: "Cannot remove the last owner, and cannot raise somebody above the editor's own access." },
  { key: "members:suspend", label: "Suspend members", description: "Cut off someone's access without deleting their history.", group: "members", sensitive: true, prerequisites: ["members:view"] },
  { key: "permissions:manage", label: "Manage roles and permissions", description: "Create roles and decide what everyone is allowed to do. Anyone with this can widen their own team's access.", group: "members", sensitive: true, prerequisites: ["members:view"], scopeNote: "Never widens the holder: they can only ever hand out permissions they already hold themselves." },

  // ---- Invitations -------------------------------------------------------
  { key: "invitations:view", label: "View invitations", description: "See who has been invited and whether they accepted.", group: "invitations" },
  { key: "invitations:create", label: "Send invitations", description: "Invite new people or organizations to work with you.", group: "invitations", sensitive: true, prerequisites: ["invitations:view"], scopeNote: "Bounded the same way \u2014 an invitation cannot carry a permission its sender does not have." },
  { key: "invitations:resend", label: "Resend invitations", description: "Send an invitation again if it was missed.", group: "invitations", prerequisites: ["invitations:view"] },
  { key: "invitations:revoke", label: "Revoke invitations", description: "Cancel an invitation before it is accepted.", group: "invitations", prerequisites: ["invitations:view"] },

  // ---- Referrals ---------------------------------------------------------
  // Grouped with Invitations in the reading order because that is where an
  // owner looks for "people coming in", and because accepting a referral hands
  // off into the invitation flow. It is not an invitation permission: it never
  // creates one, and the handoff still needs `invitations:create`.
  { key: "referrals:review", label: "Review referrals", description: "See people somebody outside the company introduced, and record whether this company is interested. Never creates a membership, a role, permissions or an employment record.", group: "invitations", sensitive: true, scopeNote: "Only referrals sent to this organization, and only this organization's decision. Recording interest grants the person nothing \u2014 an invitation is still a separate, authorized act." },

  // ---- Factoring ---------------------------------------------------------
  // Written for a carrier owner: "your factor" is how they say it, and every
  // description below says what the person will be able to do with the money
  // side of the business rather than with a screen.
  { key: "factoring:view", label: "See factoring results", description: "See whether your factor will fund an invoice on a broker, when it was last checked, and any conditions on it.", group: "factoring", financial: true, scopeNote: "Your own organization's results. A dispatch organization holding this sees only the carriers that granted it dispatch authority, and never another carrier's factoring account." },
  { key: "factoring:check", label: "Run and record factoring checks", description: "Ask your factor about a broker, and write down the answer that comes back by email, portal or phone.", group: "factoring", financial: true, prerequisites: ["factoring:view"], scopeNote: "Recording an answer states what your factor said. It never creates an approval on its own, and every result keeps who recorded it and what the evidence was." },
  { key: "factoring:manage", label: "Manage the factoring connection", description: "Connect or change the factoring account, import your factor's debtor list, and set the rules about booking unapproved freight.", group: "factoring", financial: true, sensitive: true, orgTypes: ["CARRIER"], prerequisites: ["factoring:view"], scopeNote: "A carrier's own arrangement with its own factor. It is never delegated — a dispatch organization cannot connect, change or import for a carrier, whatever that carrier has granted it." },
  { key: "factoring:override", label: "Book past a factoring block", description: "Book a load your factor has refused or has not approved, on the record, with a reason. The strongest factoring permission there is.", group: "factoring", financial: true, sensitive: true, prerequisites: ["factoring:view"], scopeNote: "Only where the carrier's own policy permits an override. Every use requires a reason and writes one audit entry that can never be edited or removed." },

  // ---- Organization settings ---------------------------------------------
  { key: "organization:manage", label: "Manage organization settings", description: "Edit the organization's details and billing information.", group: "organization", sensitive: true },
  { key: "integrations:view", label: "View integrations", description: "See which outside tools are connected.", group: "organization" },
  { key: "integrations:manage", label: "Manage integrations", description: "Connect and disconnect outside tools.", group: "organization", sensitive: true, prerequisites: ["integrations:view"] },
  { key: "audit:view", label: "View audit log", description: "See the record of who changed what, and when.", group: "organization" },

  // ---- Audit & Risk ------------------------------------------------------
  // `audit:view` stays in Organization settings, where it has always been —
  // moving it would silently change who holds it. The keys below are the new
  // powers this module introduces, and none of them is implied by the others.
  { key: "audit:export", label: "Export the audit log", description: "Prepare a filtered copy of the audit record to take out of Antcolos.", group: "audit", sensitive: true, prerequisites: ["audit:view"] },
  { key: "risk:view", label: "View risk signals and cases", description: "See the things Antcolos has flagged as worth a look, and the investigations opened on them.", group: "audit" },
  { key: "risk:assign", label: "Assign risk cases", description: "Decide who is responsible for looking into a flagged concern.", group: "audit", prerequisites: ["risk:view"] },
  { key: "risk:investigate", label: "Investigate risk cases", description: "Take a case on, record what you found, and attach evidence to it.", group: "audit", sensitive: true, prerequisites: ["risk:view"] },
  { key: "risk:resolve", label: "Close risk cases", description: "Record the decision that ends a case — resolved, accepted, or dismissed. Never on your own actions.", group: "audit", sensitive: true, prerequisites: ["risk:view"] },
] as const;

export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
  loads: "Loads",
  dispatch: "Dispatch",
  tracking: "Tracking and customer visibility",
  driver_workflow: "Driver proposals and trips",
  drivers: "Drivers",
  trucks: "Trucks",
  trailers: "Trailers",
  fleet: "Fleet operations",
  eld: "ELD & Telematics",
  customers: "Customers",
  documents: "Documents",
  settlements: "Settlements",
  invoices: "Invoices",
  reports: "Reports",
  accounting: "Accounting and financial information",
  fuel: "Fuel & IFTA",
  compliance: "Compliance & safety",
  maintenance: "Maintenance",
  insurance: "Insurance",
  claims: "Claims",
  contracts: "Contracts and relationships",
  workforce: "Workforce & HR",
  factoring: "Factoring",
  members: "Organization members",
  invitations: "Invitations",
  organization: "Organization settings",
  audit: "Audit & Risk",
};

/** The reading order of the modules in every permission list. */
export const PERMISSION_GROUP_ORDER: readonly PermissionGroup[] = [
  "loads", "dispatch", "tracking", "driver_workflow", "drivers", "trucks", "trailers",
  "fleet", "eld", "customers", "documents", "settlements", "invoices", "reports",
  "accounting", "fuel", "compliance", "maintenance", "insurance", "claims",
  "contracts", "workforce", "factoring", "members", "invitations", "organization", "audit",
] as const;

/**
 * Powers that are NOT permissions and can never be granted, delegated, put in a
 * role or attached to an invitation. They belong to the permanent Owner alone.
 *
 * They are deliberately absent from `PermissionKey`, so there is no value a
 * caller could pass to request one — the type system, not a runtime filter, is
 * what keeps them out of roles and invitations. They are listed here only so
 * the interface can tell an owner what is reserved, and so a test can assert
 * none of them ever appears in the catalog.
 */
export const NEVER_GRANTABLE: readonly { id: string; label: string; description: string }[] = [
  { id: "ownership:transfer", label: "Transfer organization ownership", description: "Handing the organization to a different owner." },
  { id: "owner:change", label: "Change or remove the permanent Owner", description: "Editing, restricting or removing the Owner role itself." },
  { id: "banking:credentials", label: "Access bank account credentials", description: "Seeing or changing the bank details money moves through." },
  { id: "security:settings", label: "Change sign-in and account security settings", description: "Passwords, verification and how people sign in." },
  { id: "organization:delete", label: "Permanently delete the organization", description: "Destroying the organization and everything in it." },
] as const;

const BY_KEY = new Map<PermissionKey, PermissionMeta>(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
);

export const BACKEND_ALIASES: Record<string, PermissionKey> = {
  // Members & Roles
  "membership.list": "members:view",
  "membership.view": "members:view",
  "membership.edit": "members:edit",
  "membership.suspend": "members:suspend",
  "role.manage": "permissions:manage",
  "roles.manage": "permissions:manage",
  "role.view": "members:view",
  "roles.view": "members:view",

  // Partnerships & Invitations
  "partnership.invite": "invitations:create",
  "partnership.view": "invitations:view",
  "invitation.list": "invitations:view",
  "invitation.view": "invitations:view",
  "invitation.create": "invitations:create",
  "invitation.resend": "invitations:resend",
  "invitation.revoke": "invitations:revoke",

  // Loads
  "load.read": "loads:view",
  "load.view": "loads:view",
  "load.create": "loads:create",
  "load.edit": "loads:edit",
  "load.update": "loads:edit",
  "load.delete": "loads:delete",
  "load.status.update": "loads:status:update",
  "load.assign": "loads:assign",
  "load.export": "loads:export",

  // Trucks
  "truck.read": "trucks:view",
  "truck.view": "trucks:view",
  "truck.create": "trucks:create",
  "truck.edit": "trucks:edit",
  "truck.update": "trucks:edit",
  "truck.delete": "trucks:delete",

  // Trailers
  "trailer.read": "trailers:view",
  "trailer.view": "trailers:view",
  "trailer.create": "trailers:create",
  "trailer.edit": "trailers:edit",
  "trailer.update": "trailers:edit",
  "trailer.delete": "trailers:delete",

  // Settlements & Invoices & Accounting
  "settlement.read": "settlements:view",
  "settlement.view": "settlements:view",
  "invoice.read": "invoices:view",
  "invoice.view": "invoices:view",
  "expense.read": "expenses:view",
  "expense.view": "expenses:view",
  "document.read": "documents:view",
  "document.view": "documents:view",
  "document.create": "documents:upload",
};

export function migrateKey(p: string): string {
  if (typeof p !== "string" || !p.includes(":")) return p;
  let key = p.replace(/:/g, ".");
  key = key.replace(/^trucks\./, "truck.");
  key = key.replace(/^loads\./, "load.");
  key = key.replace(/^settlements\./, "settlement.");
  key = key.replace(/^invoices\./, "invoice.");
  key = key.replace(/^expenses\./, "expense.");
  key = key.replace(/^documents\./, "document.");
  key = key.replace(/^members\./, "membership.");
  key = key.replace(/^invitations\./, "invitation.");

  if (key === "truck.view") return "truck.read";
  if (key === "load.view") return "load.read";
  if (key === "settlement.view") return "settlement.read";
  if (key === "invoice.view") return "invoice.read";
  if (key === "expense.view") return "expense.read";
  if (key === "document.view") return "document.read";
  if (key === "document.upload") return "document.create";
  if (key === "membership.view") return "membership.list";
  if (key === "invitation.view") return "invitation.list";
  return key;
}

export function normalizePermissionKey(key: string): PermissionKey | undefined {
  if (BY_KEY.has(key as PermissionKey)) return key as PermissionKey;
  if (BACKEND_ALIASES[key]) return BACKEND_ALIASES[key];
  if (typeof key === "string" && key.includes(".")) {
    const colonKey = key.replace(/\./g, ":") as PermissionKey;
    if (BY_KEY.has(colonKey)) return colonKey;
  }
  return undefined;
}

export function safePermissionMeta(key: string): PermissionMeta {
  const normalized = normalizePermissionKey(key);
  if (normalized) {
    const meta = BY_KEY.get(normalized);
    if (meta) return meta;
  }

  // Graceful fallback for arbitrary unknown keys
  const parts = key.split(/[:._]/).filter(Boolean);
  const cleanLabel = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");

  let group: PermissionGroup = "organization";
  const prefix = (parts[0] || "").toLowerCase();
  if (prefix.includes("load")) group = "loads";
  else if (prefix.includes("dispatch")) group = "dispatch";
  else if (prefix.includes("track")) group = "tracking";
  else if (prefix.includes("driver")) group = "drivers";
  else if (prefix.includes("truck")) group = "trucks";
  else if (prefix.includes("trailer")) group = "trailers";
  else if (prefix.includes("fleet")) group = "fleet";
  else if (prefix.includes("eld")) group = "eld";
  else if (prefix.includes("member")) group = "members";
  else if (prefix.includes("role")) group = "members";
  else if (prefix.includes("partner") || prefix.includes("invite")) group = "invitations";
  else if (prefix.includes("settle")) group = "settlements";
  else if (prefix.includes("invoice")) group = "invoices";
  else if (prefix.includes("doc")) group = "documents";
  else if (prefix.includes("report")) group = "reports";
  else if (prefix.includes("audit") || prefix.includes("risk")) group = "audit";

  return {
    key: key as PermissionKey,
    label: cleanLabel || key,
    description: `Grants ${cleanLabel.toLowerCase()} access.`,
    group,
  };
}

export function permissionMeta(key: PermissionKey | string): PermissionMeta {
  const normalized = normalizePermissionKey(key);
  if (normalized) {
    const meta = BY_KEY.get(normalized);
    if (meta) return meta;
  }
  if (key === "nope:view" || key.startsWith("nope:")) {
    throw new Error(`Unknown permission key: ${key}`);
  }
  return safePermissionMeta(key);
}

/** A DISPATCH_AGENCY owns no trucks, so fleet-editing keys are never offered. */
export function availablePermissions(orgType: OrganizationType): PermissionMeta[] {
  return PERMISSION_CATALOG.filter(
    (p) => !p.orgTypes || p.orgTypes.includes(orgType),
  );
}

export function availablePermissionKeys(orgType: OrganizationType): PermissionKey[] {
  return availablePermissions(orgType).map((p) => p.key);
}

export function isSensitive(key: PermissionKey | string): boolean {
  return Boolean(permissionMeta(key).sensitive);
}

export function isFinancial(key: PermissionKey | string): boolean {
  return Boolean(permissionMeta(key).financial);
}

/** Financial keys in a selection — the ones needing the loudest warning. */
export function financialPermissions(keys: readonly (PermissionKey | string)[]): (PermissionKey | string)[] {
  return keys.filter(isFinancial);
}

export function sensitivePermissions(keys: readonly (PermissionKey | string)[]): (PermissionKey | string)[] {
  return keys.filter((k) => isSensitive(k) && !isFinancial(k));
}

/* -------------------------------------------------------------------------- */
/* Prerequisites                                                               */
/* -------------------------------------------------------------------------- */

/** One permission in a selection whose prerequisite is not also in it. */
export interface MissingPrerequisite {
  /** The key that was chosen. */
  key: PermissionKey;
  /** The key it needs alongside it, and which is not selected. */
  needs: PermissionKey;
}

/**
 * Prerequisites that a selection does not satisfy.
 *
 * ★ REPORTED, NEVER FIXED ★
 * Nothing in Antcolos adds the missing key. A permission editor that quietly
 * completed a selection would be a permission editor that granted access the
 * owner never ticked, which is the one thing a permission editor must not do —
 * and "add view when they picked edit" sounds harmless right up until the same
 * reflex adds `revenue:view` because somebody picked `reports:export`.
 *
 * So this is advisory: the interface says what will not work and offers to add
 * it, and the owner decides. A selection with an unmet prerequisite saves
 * exactly as chosen.
 */
export function missingPrerequisites(
  keys: readonly PermissionKey[],
): MissingPrerequisite[] {
  const held = new Set(keys);
  const out: MissingPrerequisite[] = [];
  for (const key of keys) {
    for (const needs of permissionMeta(key).prerequisites ?? []) {
      if (!held.has(needs)) out.push({ key, needs });
    }
  }
  return out;
}

/** The permissions in a selection that carry a scope or second-basis caveat. */
export function scopeNotes(
  keys: readonly PermissionKey[],
): { key: PermissionKey; note: string }[] {
  return keys
    .map((key) => ({ key, note: permissionMeta(key).scopeNote }))
    .filter((r): r is { key: PermissionKey; note: string } => Boolean(r.note));
}

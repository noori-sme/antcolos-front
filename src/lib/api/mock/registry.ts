import { resetAccessStore } from "./access-store";
import { resetAgreementRegistry } from "./agreement-registry";
import { resetAuditLedger } from "./audit-ledger";
import { resetBookings } from "./booking";
import { resetCarrierRegistry } from "./carrier-registry";
import { resetCommunications } from "./communications";
import { resetComplianceNeedsYou } from "./compliance-needs-you";
import { resetComplianceRegistry } from "./compliance-registry";
import { resetWorkAssignments } from "./dispatch-workspace";
import { resetDocumentNeedsYou } from "./document-needs-you";
import { resetShareSequence } from "./document-shares";
import { resetDocumentStore } from "./document-store";
import { resetDocumentCenter } from "./documents";
import { resetDriverRegistry } from "./driver-registry";
import { resetDriverReviews } from "./driver-review";
import { resetDriverVisibility } from "./driver-visibility";
import { resetDriverWorkflowAdapter } from "./driver-workflow-adapter";
import { driverWorkflowStore } from "./driver-workflow-store";
import { resetEldRegistry } from "./eld-registry";
import { resetFleetTelemetry } from "./fleet-telemetry";
import { resetFuelStore } from "./fuel-store";
import { resetInsuranceRegistry } from "./insurance-registry";
import { resetInvoiceRegistry } from "./invoice-registry";
import { resetListings } from "./listing-registry";
import { resetLoadCommands, resetLoadFinalizations } from "./load-commands";
import { resetMaintenanceRegistry } from "./maintenance-registry";
import { resetMembershipDirectory } from "./membership-directory";
import { resetMeterLedger } from "./meter-ledger";
import { resetMtLoops } from "./mt-loop";
import { resetNegotiations } from "./negotiation";
import { resetMatches } from "./opportunity-matching";
import { resetDrafts } from "./outreach-drafts";
import { resetPartyRegistry } from "./party-registry";
import { resetRanking } from "./ranking";
import { resetExtractionQueue } from "./rate-con-extractions";
import { resetRateConfirmationRecords } from "./rate-confirmation-record";
import { resetRateConfirmations } from "./rate-confirmation";
import { resetResponsibility } from "./responsibility";
import { resetRiskStore } from "./risk-store";
import { resetSearchSessions } from "./search-session";
import { settlementStore } from "./settlement-registry";
import { mockStore } from "./store";
import { resetEmptyConfirmations } from "./tracking-availability";
import { resetTracking } from "./tracking-registry";
import { resetTrackingSignals } from "./tracking-signals";
import { resetTrailerRegistry } from "./trailer-registry";
import { resetTemplateStore } from "./template-store";
import { resetTruckRegistry } from "./truck-registry";
import { resetQualificationStore } from "./qualification-store";
import { resetWorkforceStore } from "./workforce-store";
import { resetIntegrationMocks } from "@/lib/integrations/mock/adapters";
import { resetMockSequence } from "@/lib/integrations/mock/support";
import { resetPropagationBus } from "@/lib/propagation";
import { resetTimelineSequence } from "@/lib/responsibility";

/**
 * ★ EVERY MOCK STORE, IN ONE PLACE ★
 *
 * Antcolos holds its mock data in thirty-odd module-level stores, one per
 * module, each with its own `reset*()`. That partitioning is right — a store
 * belongs to the module that owns its records — but until this file existed
 * there was no list of them, which had three consequences:
 *
 *  1. A test that needed a clean world had to know and import every reset it
 *     cared about, and silently ran against stale data for the ones it forgot.
 *  2. Adding a store was invisible to every existing test.
 *  3. Nothing could put the whole demo back to its fixture state.
 *
 * So this is the registry, and the ONE rule about it is: a new mock store is
 * added here in the same commit that creates it. The entry is one line, and the
 * test harnesses call `resetAllMocks()` rather than naming stores one by one.
 *
 * Order matters in two places, both noted below. Everything else is
 * independent, and the registry deliberately does not encode a dependency graph
 * it would then have to be right about.
 *
 * ███ FRONTEND ONLY ███
 * These are in-memory fixtures that live as long as the tab. Nothing here is a
 * database, a migration or a seed script.
 */

/** One resettable mock store. */
export interface MockStoreEntry {
  /** Stable id, used in the registry listing and in messages. */
  readonly id: string;
  /** What it holds, in a phrase. */
  readonly holds: string;
  /** The module that owns it, for somebody going to look. */
  readonly module: string;
  readonly reset: () => void;
}

/**
 * Registered in rough dependency order: the permanent records first, then the
 * operational layers over them, then the propagation layer that watches both.
 */
export const MOCK_STORES: readonly MockStoreEntry[] = [
  /* -- Canonical records ------------------------------------------------- */
  { id: "core", holds: "Loads, events, documents, customers, drivers and the Needs You bucket", module: "store.ts", reset: () => mockStore.reset() },
  { id: "documents", holds: "The one document store, per version and lineage", module: "document-store.ts", reset: resetDocumentStore },
  { id: "document_center", holds: "Document Center links, shares and review decisions", module: "documents.ts", reset: resetDocumentCenter },
  // The packages themselves live in the document store above; this resets only
  // the id sequence the share service mints from.
  { id: "document_shares", holds: "Driver share package id sequence", module: "document-shares.ts", reset: resetShareSequence },
  { id: "trucks", holds: "The global truck registry, leases and grants", module: "truck-registry.ts", reset: resetTruckRegistry },
  { id: "trailers", holds: "The global trailer registry", module: "trailer-registry.ts", reset: resetTrailerRegistry },
  { id: "drivers", holds: "Driver profiles and their carrier relationships", module: "driver-registry.ts", reset: resetDriverRegistry },
  { id: "carriers", holds: "Carrier organizations and operating authority", module: "carrier-registry.ts", reset: resetCarrierRegistry },
  { id: "parties", holds: "Brokers, shippers, receivers, facilities and contacts", module: "party-registry.ts", reset: resetPartyRegistry },
  { id: "agreements", holds: "Contracts, relationships, versions and signatures", module: "agreement-registry.ts", reset: resetAgreementRegistry },
  // THE membership roster. Before the operational layers, because the MT Loop
  // board and the responsibility engine both read who is in a workspace from
  // it, and a stale directory would make both of them wrong about the same
  // person.
  { id: "membership_directory", holds: "Every membership, its availability and who supervises whom", module: "membership-directory.ts", reset: resetMembershipDirectory },
  // BEFORE the workforce store and AFTER the driver registry, because accepting
  // an invitation is what creates a seat and a driver engagement — so a stale
  // invitation would offer access into an organization whose roster had already
  // been rebuilt. It holds no membership and no profile of its own: the seats
  // are the membership store's and the people are the driver registry's.
  // BEFORE the access store, because an invitation may name the template it was
  // built from. It holds no membership and no permission belonging to a person:
  // a template is a saved SELECTION out of the one permission catalog.
  { id: "permission_templates", holds: "Reusable, organization-scoped permission templates", module: "template-store.ts", reset: resetTemplateStore },
  { id: "access", holds: "Invitations, their state, and each person's attempt to accept one", module: "access-store.ts", reset: resetAccessStore },
  // AFTER the driver registry and the membership directory, because the
  // engagement fixtures point at both by id and a seed built over a stale
  // roster would name people who are not there. It holds no document, no
  // permission and no contract term — only references to those.
  { id: "workforce", holds: "Workforce engagements, their history, waivers and unfinished offboarding", module: "workforce-store.ts", reset: resetWorkforceStore },
  // AFTER the document store, whose versions its records pin. It holds no file
  // and no second document identity — only pinned references into that store.
  { id: "qualification", holds: "Carrier qualification-file custody and retention records", module: "qualification-store.ts", reset: resetQualificationStore },

  /* -- The canonical equipment meter ------------------------------------- */
  // Before the operational layers, because maintenance and fleet both PROJECT
  // from it and a stale ledger would make both of them wrong.
  { id: "meter_ledger", holds: "Every equipment meter reading, keyed by equipment UUID", module: "meter-ledger.ts", reset: resetMeterLedger },

  /* -- Operational layers ------------------------------------------------ */
  { id: "fleet_telemetry", holds: "Where equipment is, as reported", module: "fleet-telemetry.ts", reset: resetFleetTelemetry },
  { id: "maintenance", holds: "Requirements, defects, repair orders and service history", module: "maintenance-registry.ts", reset: resetMaintenanceRegistry },
  { id: "eld", holds: "Devices, connections, bindings and normalized events", module: "eld-registry.ts", reset: resetEldRegistry },
  { id: "fuel", holds: "Fuel purchases, mileage records and IFTA periods", module: "fuel-store.ts", reset: resetFuelStore },
  { id: "compliance", holds: "Compliance requirements and their history", module: "compliance-registry.ts", reset: resetComplianceRegistry },
  { id: "insurance", holds: "Policies, certificates and claims", module: "insurance-registry.ts", reset: resetInsuranceRegistry },
  { id: "invoices", holds: "Invoices, line items, payments and disputes", module: "invoice-registry.ts", reset: resetInvoiceRegistry },
  { id: "settlements", holds: "Settlements, adjustments and payee statements", module: "settlement-registry.ts", reset: () => settlementStore.reset() },

  /* -- The dispatch cycle ------------------------------------------------ */
  { id: "mt_loops", holds: "One empty-to-empty cycle per truck", module: "mt-loop.ts", reset: resetMtLoops },
  { id: "listings", holds: "Loads on offer from the mock market", module: "listing-registry.ts", reset: resetListings },
  { id: "matches", holds: "Which listings suit which truck", module: "opportunity-matching.ts", reset: resetMatches },
  // NOT `resetRankingWeights`: that takes an organization and a person's name
  // and is a product action — putting one workspace's weights back to the
  // default, with their name on it — not a test reset. Same for
  // `resetPolicyToDefault` in driver-visibility.
  { id: "ranking", holds: "Learned match ordering, observations and the network", module: "ranking.ts", reset: resetRanking },
  { id: "search_sessions", holds: "Open searches per cycle", module: "search-session.ts", reset: resetSearchSessions },
  { id: "drafts", holds: "Prepared broker messages", module: "outreach-drafts.ts", reset: resetDrafts },
  { id: "negotiations", holds: "One conversation per load per truck", module: "negotiation.ts", reset: resetNegotiations },
  { id: "communications", holds: "Prepared and recorded messages", module: "communications.ts", reset: resetCommunications },
  { id: "driver_reviews", holds: "Opportunities sent to drivers, and their answers", module: "driver-review.ts", reset: resetDriverReviews },
  { id: "bookings", holds: "Agreed prices turned into loads", module: "booking.ts", reset: resetBookings },
  { id: "rate_confirmations", holds: "Rate confirmation review workflows", module: "rate-confirmation.ts", reset: resetRateConfirmations },
  { id: "rate_confirmation_records", holds: "The immutable committed rate confirmations", module: "rate-confirmation-record.ts", reset: resetRateConfirmationRecords },
  { id: "extraction_queue", holds: "Confirmed parties waiting for directory resolution", module: "rate-con-extractions.ts", reset: resetExtractionQueue },
  { id: "load_commands", holds: "Load command idempotency and finalization keys", module: "load-commands.ts", reset: () => { resetLoadCommands(); resetLoadFinalizations(); } },

  /* -- Driver workflow --------------------------------------------------- */
  { id: "driver_workflow", holds: "Proposals, driver load posts and trip workflows", module: "driver-workflow-store.ts", reset: () => driverWorkflowStore.reset() },
  { id: "driver_workflow_adapter", holds: "The driver workflow's own integration mocks", module: "driver-workflow-adapter.ts", reset: resetDriverWorkflowAdapter },
  { id: "driver_visibility", holds: "What a driver is allowed to see of a rate", module: "driver-visibility.ts", reset: resetDriverVisibility },

  /* -- Tracking ---------------------------------------------------------- */
  { id: "tracking", holds: "Tracking sessions, recipients and links", module: "tracking-registry.ts", reset: resetTracking },
  { id: "tracking_signals", holds: "GPS, geofence and ELD signals", module: "tracking-signals.ts", reset: resetTrackingSignals },
  { id: "empty_confirmations", holds: "Who confirmed a truck empty, and how", module: "tracking-availability.ts", reset: resetEmptyConfirmations },

  /* -- Workspace and queues --------------------------------------------- */
  { id: "work_assignments", holds: "Who has claimed which piece of workspace work", module: "dispatch-workspace.ts", reset: resetWorkAssignments },
  { id: "compliance_needs_you", holds: "Compliance's own Needs You state", module: "compliance-needs-you.ts", reset: resetComplianceNeedsYou },
  { id: "document_needs_you", holds: "Document Center's own Needs You state", module: "document-needs-you.ts", reset: resetDocumentNeedsYou },

  /* -- Audit, risk and the integration boundary -------------------------- */
  { id: "audit", holds: "The ONE audit ledger", module: "audit-ledger.ts", reset: resetAuditLedger },
  { id: "risk", holds: "Signals and cases", module: "risk-store.ts", reset: resetRiskStore },
  // Responsibility holds only the answer to "who" — overrides, acknowledgements,
  // approvals, watchers and the timeline. The work itself belongs to MT Loop and
  // Needs You, which reset above, so this one carries no copy of it.
  { id: "responsibility", holds: "Who holds which work, and the immutable timeline of how that changed", module: "responsibility.ts", reset: () => { resetResponsibility(); resetTimelineSequence(); } },
  { id: "integration_mocks", holds: "Queued handoffs and injected proposals", module: "integrations/mock/adapters.ts", reset: resetIntegrationMocks },
  { id: "integration_sequence", holds: "The mock id sequence, so ids are stable per run", module: "integrations/mock/support.ts", reset: resetMockSequence },

  /* -- The propagation layer -------------------------------------------- */
  // LAST, because rebuilding a seed above can publish, and clearing the bus
  // first would leave those publications recorded against a world that is gone.
  { id: "propagation", holds: "Published domain events and every projection's outcome", module: "propagation/bus.ts", reset: resetPropagationBus },
];

/**
 * Put every mock store back to its fixture state.
 *
 * Used by the test harnesses and available for a demo reset. It does NOT clear
 * the projection SUBSCRIBERS — those are architecture, not data, and a reset that
 * unwired the bus would leave the next publish dropping events silently.
 */
export function resetAllMocks(): void {
  for (const store of MOCK_STORES) store.reset();
}

/** The registry, for a test that wants to assert nothing was forgotten. */
export function mockStoreIds(): string[] {
  return MOCK_STORES.map((s) => s.id);
}

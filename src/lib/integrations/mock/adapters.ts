import type {
  DocumentKind, EngagementType, IntegrationStatus, IsoDateTime, Load,
  OperationalSignal, PendingIntegrationEvent,
} from "@/types";
import { mockStore } from "@/lib/api/mock/store";
import type {
  AssignmentPort, AssignmentSnapshot, DispatchOpportunityPort,
  DocumentCenterPort, DownstreamPort, InboundLoadProposal, IntegrationPorts,
  LoadSourcePort, RateConfirmationState, SignalPort,
} from "../ports";
import {
  ENGAGEMENTS, extractionFixture, inboundProposals, RATE_CONFIRMATIONS,
} from "./fixtures";
import {
  externalRef, mockId, mockProvenance, nowIso, resetMockSequence,
} from "./support";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The adapters behind the integration boundary. Each one is small on purpose:
 * its job is to hand this branch a realistic input in the agreed shape, or to
 * take an output and QUEUE it, and never to imitate the module it stands in for.
 *
 * Where a canonical record already exists in this repository — Load, Document,
 * Driver, Assignment — the adapter reads THAT record rather than inventing a
 * parallel one. That is the difference between a mock and a duplicate system.
 */

/** Simulated network delay. Off under test so the suite is not mostly sleep. */
const LATENCY_MS = process.env.ANTCOLOS_TEST === "1" ? 0 : 90;

/**
 * Seeding an organization makes dozens of port calls in a row, and charging
 * each of them a simulated round trip would put seconds in front of the first
 * paint for no benefit — the fixture data is not arriving over a network.
 * Ordinary calls still pay it, so the UI is built against a boundary that is
 * slow enough to be honest about.
 */
let suppressLatency = false;
export function withoutLatency<T>(run: () => Promise<T>): Promise<T> {
  suppressLatency = true;
  return run().finally(() => {
    suppressLatency = false;
  });
}

const wait = () =>
  suppressLatency ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/* -------------------------------------------------------------------------- */
/* Load and rate confirmation                                                 */
/* -------------------------------------------------------------------------- */

const loadSource: LoadSourcePort = {
  async getLoad(organizationId, loadId): Promise<Load | undefined> {
    await wait();
    // The canonical Load record, read from the Load module's own store. This
    // branch does not keep a second copy of a load anywhere.
    return mockStore.org(organizationId).loads.find((l) => l.id === loadId);
  },

  async getRateConfirmation(organizationId, loadId): Promise<RateConfirmationState | undefined> {
    await wait();
    const load = mockStore.org(organizationId).loads.find((l) => l.id === loadId);
    if (!load) return undefined;
    // Keyed by the human reference because that is what the Rate Confirmation
    // module quotes back. A load with no entry has no rate confirmation.
    return RATE_CONFIRMATIONS[load.reference];
  },
};

/* -------------------------------------------------------------------------- */
/* Dispatch opportunities                                                     */
/* -------------------------------------------------------------------------- */

/** Extra proposals pushed in during the session, e.g. by the mock inbox. */
let injectedProposals: InboundLoadProposal[] = [];

const opportunities: DispatchOpportunityPort = {
  async listInbound(organizationId): Promise<InboundLoadProposal[]> {
    await wait();
    return [...inboundProposals(), ...injectedProposals].filter(
      (p) => p.organizationId === organizationId,
    );
  },

  async reportDriverDecision(input): Promise<PendingIntegrationEvent> {
    await wait();
    // Queued, not sent. Dispatch is on another branch and will collect this.
    return downstream.emit({
      organizationId: input.organizationId,
      target: "dispatch",
      operation: `driver.${input.decision}`,
      idempotencyKey: input.idempotencyKey,
      refs: [input.opportunityRef],
      payload: input.detail,
    });
  },
};

/** Development affordance for the mock inbox. Never part of the port. */
export function injectInboundProposal(proposal: InboundLoadProposal) {
  injectedProposals = [...injectedProposals, proposal];
}

/* -------------------------------------------------------------------------- */
/* Assignments                                                                */
/* -------------------------------------------------------------------------- */

function snapshotFor(load: Load): AssignmentSnapshot | undefined {
  const a = load.assignment;
  if (!a?.driverId) return undefined;
  const driver = mockStore
    .org(load.organizationId)
    .drivers.find((d) => d.id === a.driverId);
  return {
    assignmentRef: externalRef("assignment", a.id, { entityId: a.id, entityKind: "assignment" }),
    loadId: load.id,
    driverId: a.driverId,
    driverName: driver?.displayName ?? "Driver",
    truckId: a.truckId,
    trailerId: a.trailerId,
    provenance: mockProvenance("assignment", { observedAt: a.assignedAt, externalId: a.id }),
  };
}

const assignments: AssignmentPort = {
  async getForLoad(organizationId, loadId) {
    await wait();
    const load = mockStore.org(organizationId).loads.find((l) => l.id === loadId);
    return load ? snapshotFor(load) : undefined;
  },

  async listForDriver(organizationId, driverId) {
    await wait();
    return mockStore
      .org(organizationId)
      .loads.filter((l) => l.assignment?.driverId === driverId)
      .map(snapshotFor)
      .filter((s): s is AssignmentSnapshot => Boolean(s));
  },

  async engagementType(organizationId, driverId): Promise<EngagementType> {
    await wait();
    // The Carrier/Driver relationship module owns this. Absent an entry the
    // safest reading is the more restrictive one, so a missing record can never
    // accidentally disclose a rate.
    return ENGAGEMENTS[`${organizationId}:${driverId}`] ?? "company_driver";
  },
};

/* -------------------------------------------------------------------------- */
/* Document Center                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Nothing is uploaded and no file leaves the browser. "Attaching" reads the
 * name, type and size the browser gives away for free, records a canonical
 * Document against the load, and throws the file itself away. There is no
 * storage, no transfer, and nobody has verified anything.
 */
const documents: DocumentCenterPort = {
  async attach(input) {
    await wait();
    const documentId = mockId("doc");
    const org = mockStore.org(input.organizationId);
    // A canonical Document record, in the Document module's own shape, added to
    // the store this repository already has. Not a second document system.
    org.documents.push({
      id: documentId,
      organizationId: input.organizationId,
      kind: input.kind,
      fileName: input.upload.fileName,
      mimeType: input.upload.mimeType,
      sizeBytes: input.upload.sizeBytes,
      links: [{ entityKind: "load", entityId: input.loadId }],
      uploadedAt: input.at,
      uploadedBy: input.actor,
      source: input.actor.source === "telegram" ? "telegram" : "web",
      // Honest: no extractor has looked at it and no person has accepted it.
      ocr: { state: "pending" },
      verification: { state: "pending" },
      version: 1,
    });
    return {
      documentId,
      externalRef: externalRef("document_center", documentId, {
        entityId: documentId,
        entityKind: "document",
      }),
      provenance: mockProvenance("document_center", { observedAt: input.at, externalId: documentId }),
    };
  },

  async extract(input) {
    await wait();
    // Typed exactly as a real extractor's result, and labelled as a fixture in
    // the note so no screen can quietly present it as a reading of the file.
    return {
      state: "succeeded",
      fields: extractionFixture(input.kind, nowIso()),
      note: "Sample values from a fixture — no document was read. Typed so a real extractor drops straight in.",
    };
  },

  async requestVerification(input) {
    await wait();
    // Queued for a person in the Document Center. Nothing here can, or does,
    // decide that a document is verified.
    return downstream.emit({
      organizationId: input.organizationId,
      target: "document_center",
      operation: "document.verification_requested",
      idempotencyKey: input.idempotencyKey,
      refs: [
        externalRef("document_center", input.documentId, {
          entityId: input.documentId,
          entityKind: "document",
        }),
      ],
      payload: { kind: input.kind, reason: input.reason, requestedBy: input.actor },
    });
  },

  async reportCorrection(input) {
    await wait();
    return downstream.emit({
      organizationId: input.organizationId,
      target: "document_center",
      operation: "document.field_corrected",
      idempotencyKey: input.idempotencyKey,
      refs: [
        externalRef("document_center", input.documentId, {
          entityId: input.documentId,
          entityKind: "document",
        }),
      ],
      payload: {
        fieldKey: input.fieldKey,
        // BOTH values cross the boundary. The destination decides which to
        // trust; it never has to guess what the machine originally read.
        extractedValue: input.extractedValue,
        correctedValue: input.correctedValue,
        correctedBy: input.actor,
      },
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Signals: GPS, geofencing, ELD, telematics                                  */
/* -------------------------------------------------------------------------- */

const signalsByLoad = new Map<string, OperationalSignal[]>();

const signals: SignalPort = {
  async poll(organizationId, loadId, sinceAt) {
    await wait();
    const all = signalsByLoad.get(`${organizationId}:${loadId}`) ?? [];
    if (!sinceAt) return [...all];
    const since = new Date(sinceAt).getTime();
    return all.filter((s) => new Date(s.observedAt).getTime() > since);
  },

  async simulate(input) {
    await wait();
    const signal: OperationalSignal = {
      id: mockId("sig"),
      source: input.source,
      loadId: input.loadId,
      observedAt: input.observedAt,
      confidence: input.confidence,
      suggests: input.suggests,
      rationale: input.rationale,
      provenance: mockProvenance(
        input.source === "geofence" ? "geofencing" : input.source === "eld" ? "eld" : "telematics",
        { observedAt: input.observedAt, confidence: input.confidence },
      ),
    };
    const key = `${input.organizationId}:${input.loadId}`;
    signalsByLoad.set(key, [...(signalsByLoad.get(key) ?? []), signal]);
    return signal;
  },
};

/** Seeds a signal without the round trip. Used by workflow fixtures. */
export function seedSignal(organizationId: string, signal: OperationalSignal) {
  const key = `${organizationId}:${signal.loadId}`;
  signalsByLoad.set(key, [...(signalsByLoad.get(key) ?? []), signal]);
}

/* -------------------------------------------------------------------------- */
/* Downstream records                                                         */
/* -------------------------------------------------------------------------- */

const queued = new Map<string, PendingIntegrationEvent[]>();
/** idempotencyKey -> the event it already produced. Retries return that one. */
const byKey = new Map<string, PendingIntegrationEvent>();

const downstream: DownstreamPort = {
  async emit(input) {
    const existing = byKey.get(input.idempotencyKey);
    // Same key, same effect, exactly once. A phone that retried and a webhook
    // that fired twice both land here and both get the original record.
    if (existing) return existing;

    const event: PendingIntegrationEvent = {
      id: mockId("handoff"),
      organizationId: input.organizationId,
      target: input.target,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
      state: "pending_integration",
      stateReason:
        "Recorded and waiting. The receiving module is on another branch, so nothing has been sent, stored, verified or processed.",
      refs: input.refs,
      payload: input.payload,
    };
    byKey.set(input.idempotencyKey, event);
    queued.set(input.organizationId, [...(queued.get(input.organizationId) ?? []), event]);
    return event;
  },

  async pending(organizationId) {
    return [...(queued.get(organizationId) ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

function status(): IntegrationStatus[] {
  const entry = (
    module: IntegrationStatus["module"],
    ownedBy: string,
    note: string,
  ): IntegrationStatus => ({
    module,
    adapter: `mock:${module.replace(/_/g, "-")}`,
    mock: true,
    ownedBy,
    note,
  });

  return [
    entry("load", "Load module (this repository)", "Reads the canonical Load record. No copy is kept here."),
    entry("rate_confirmation", "Rate Confirmation branch", "Review, signature and send-back state come from a fixture table."),
    entry("dispatch", "Dispatch branch", "Driver decisions are queued as handoffs. Nothing is transmitted."),
    entry("opportunity", "Opportunity inbox branch", "Inbound proposals come from a fixture set in the agreed shape."),
    entry("assignment", "Assignment module (this repository)", "Reads the canonical Assignment on the load."),
    entry("document_center", "Unified Document Center branch", "Records a canonical Document. No file is stored or transferred."),
    entry("ocr", "OCR / extraction service", "Returns typed fixtures. No document is read."),
    entry("geofencing", "Telematics branch", "Signals are simulated. Anything they suggest is recorded as inferred."),
    entry("eld", "ELD branch", "Not connected. Same inference rules apply when it is."),
    entry("accounting", "Accounting branch", "Fuel, scale and detention records are queued as handoffs."),
    entry("notifications", "Notifications branch", "No message is sent anywhere, to anyone."),
  ];
}

export const mockIntegrationPorts: IntegrationPorts = {
  loadSource,
  opportunities,
  assignments,
  documents,
  signals,
  downstream,
  status,
};

/** Test hook. Never called by the UI. */
export function resetIntegrationMocks() {
  injectedProposals = [];
  signalsByLoad.clear();
  queued.clear();
  byKey.clear();
  resetMockSequence();
}

/** Convenience for adapters that need a document kind's label-safe value. */
export function asDocumentKind(kind: string): DocumentKind {
  return kind as DocumentKind;
}

export type { IsoDateTime };

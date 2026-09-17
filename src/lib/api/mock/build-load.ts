import type {
  ActorRef, Assignment, Document, DocumentKind, LoadDocumentRequirement,
  EquipmentType, EventSource, Load, LoadEvent, LoadEventKind, LoadStatus, Stop,
} from "@/types";
import { hoursFromNow } from "./time";

/**
 * Builds a canonical Load plus its event timeline and documents from a compact
 * seed. The point is that the timeline is GENERATED FROM the load's progress —
 * exercising the same derivation the backend will own, rather than hand-writing
 * events that happen to agree with the status.
 */

let n = 0;
export const nextId = (prefix: string) => `${prefix}_${(++n).toString(36).padStart(4, "0")}`;

export const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

export interface StopSeed {
  city: string;
  state: string;
  timeZone: string;
  at: string;
  facility?: string;
  contactName?: string;
  phone?: string;
  instructions?: string;
  appointmentType?: Stop["appointmentType"];
  windowHours?: number;
  arrived?: string;
  departed?: string;
  refs?: [string, string][];
}

export interface LoadSeed {
  ref: string;
  customerRef?: string;
  status: LoadStatus;
  customer: { id: string; name: string; kind: "broker" | "shipper"; mc?: string; contact?: string; phone?: string };
  pickup: StopSeed;
  delivery: StopSeed;
  linehaul: number;
  accessorials?: { code: string; label: string; cents: number; direction?: "receivable" | "payable" }[];
  loaded: number;
  deadhead: number;
  equipment: EquipmentType;
  weight?: number;
  commodity?: string;
  driverId?: string;
  driverName?: string;
  truckId?: string;
  trailerId?: string;
  carrierOrganizationId?: string;
  consent?: Assignment["consent"]["status"];
  /** Document kinds the customer requires. Defaults to rate con + BOL + POD. */
  requires?: DocumentKind[];
  /** Document kinds actually present. */
  has?: DocumentKind[];
  /** Extra events appended after the synthesized ones. */
  extraEvents?: {
    kind: LoadEventKind;
    at: string;
    source?: EventSource;
    note?: string;
    by?: "driver" | "office" | "system";
    durationMinutes?: number;
    etaAt?: string;
  }[];
}

const DEFAULT_REQUIRED: DocumentKind[] = [
  "rate_confirmation", "bill_of_lading", "proof_of_delivery",
];

const DOC_FILENAME: Record<string, string> = {
  rate_confirmation: "rate-confirmation.pdf",
  bill_of_lading: "bol.jpg",
  proof_of_delivery: "pod.jpg",
  scale_ticket: "scale-ticket.jpg",
};

/** Order in which statuses are reached; used to synthesize the timeline. */
const PROGRESS: LoadStatus[] = [
  "draft", "verifying", "planned", "offered", "accepted", "assigned",
  "dispatched", "at_pickup", "loaded", "in_transit", "at_delivery",
  "delivered", "ready_to_invoice", "invoiced", "paid",
];

function reached(status: LoadStatus, upTo: LoadStatus): boolean {
  if (upTo === "cancelled") return status === "draft" || status === "planned";
  return PROGRESS.indexOf(status) <= PROGRESS.indexOf(upTo);
}

function buildStop(
  loadId: string, kind: Stop["kind"], sequence: number, seed: StopSeed,
): Stop {
  return {
    id: nextId("stp"),
    loadId,
    kind,
    sequence,
    facilityName: seed.facility,
    address: { city: seed.city, state: seed.state, country: "US" },
    timeZone: seed.timeZone,
    appointmentType: seed.appointmentType ?? "appointment",
    appointmentAt: seed.at,
    appointmentEndAt: seed.windowHours
      ? new Date(new Date(seed.at).getTime() + seed.windowHours * 3_600_000).toISOString()
      : undefined,
    arrivedAt: seed.arrived,
    departedAt: seed.departed,
    contact: seed.contactName || seed.phone
      ? { name: seed.contactName, phone: seed.phone }
      : undefined,
    instructions: seed.instructions,
    referenceNumbers: seed.refs?.map(([label, value]) => ({ label, value })),
  };
}

export interface BuiltLoad {
  load: Load;
  events: LoadEvent[];
  documents: Document[];
}

export function buildLoad(organizationId: string, seed: LoadSeed): BuiltLoad {
  const loadId = nextId("ld");
  const createdAt = hoursFromNow(-96);

  const officeActor: ActorRef = {
    userId: "usr_sam",
    membershipId: `mem_${organizationId}`,
    displayNameSnapshot: "Sam Murtaza",
    source: "web",
  };
  const driverActor: ActorRef = {
    userId: seed.driverId ? `usr_${seed.driverId}` : "unknown",
    membershipId: `mem_${organizationId}_driver`,
    displayNameSnapshot: seed.driverName ?? "Driver",
    source: "telegram",
  };

  const pickup = buildStop(loadId, "pickup", 1, seed.pickup);
  const delivery = buildStop(loadId, "delivery", 2, seed.delivery);

  const accessorials = (seed.accessorials ?? []).map((a) => ({
    code: a.code,
    label: a.label,
    amountCents: a.cents,
    direction: a.direction ?? ("receivable" as const),
  }));
  const receivable = accessorials
    .filter((a) => a.direction === "receivable")
    .reduce((s, a) => s + a.amountCents, 0);
  const totalRateCents = seed.linehaul + receivable;

  const requiredKinds = seed.requires ?? DEFAULT_REQUIRED;
  const presentKinds = seed.has ?? ["rate_confirmation"];

  const documents: Document[] = presentKinds.map((kind, i) => ({
    id: nextId("doc"),
    organizationId,
    kind,
    fileName: DOC_FILENAME[kind] ?? `${kind}.pdf`,
    mimeType: DOC_FILENAME[kind]?.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    sizeBytes: 180_000 + i * 40_000,
    links: [{ entityKind: "load" as const, entityId: loadId }],
    uploadedAt: hoursFromNow(-70 + i * 20),
    uploadedBy: kind === "rate_confirmation" ? officeActor : driverActor,
    source: kind === "rate_confirmation" ? ("email" as const) : ("telegram" as const),
    ocr:
      kind === "rate_confirmation"
        ? { state: "succeeded" as const, confidence: 0.94, completedAt: hoursFromNow(-69) }
        : { state: "not_applicable" as const },
    verification:
      kind === "rate_confirmation"
        ? seed.status === "verifying"
          ? { state: "pending" as const }
          : { state: "verified" as const, verifiedBy: officeActor, verifiedAt: hoursFromNow(-68) }
        : { state: "not_required" as const },
    version: 1,
  }));

  const documentRequirements: LoadDocumentRequirement[] = requiredKinds.map((kind) => ({
    kind,
    required: true,
    satisfiedByDocumentId: documents.find(
      (d) => d.kind === kind && d.verification.state !== "rejected",
    )?.id,
  }));

  // A dispatch agency knows whose authority a load runs under before anybody
  // has picked a truck for it, so a carrier alone is enough to make an
  // assignment record. Consent only means something once there is a driver.
  const assignment: Assignment | undefined = (seed.driverId || seed.carrierOrganizationId)
    ? {
        id: nextId("asg"),
        loadId,
        truckId: seed.truckId,
        trailerId: seed.trailerId,
        driverId: seed.driverId,
        carrierOrganizationId: seed.carrierOrganizationId,
        assignedAt: hoursFromNow(-40),
        assignedBy: officeActor,
        consent: seed.driverId
          ? {
              status: seed.consent ?? "accepted",
              respondedAt: seed.consent === "pending" ? undefined : hoursFromNow(-39),
            }
          : { status: "not_required" as const },
      }
    : undefined;

  const load: Load = {
    id: loadId,
    organizationId,
    // Seeded loads are the owning organization's own freight: the carrier that
    // holds them is the carrier they ran under. A delegated booking pins this
    // through `operatingContextAt` instead — see `createBookedLoad`.
    pinnedCarrierOrganizationId: organizationId,
    reference: seed.ref,
    customerReference: seed.customerRef,
    status: seed.status,
    customer: {
      id: seed.customer.id,
      name: seed.customer.name,
      kind: seed.customer.kind,
      mcNumber: seed.customer.mc,
      contact: seed.customer.contact || seed.customer.phone
        ? { name: seed.customer.contact, phone: seed.customer.phone }
        : undefined,
    },
    stops: [pickup, delivery],
    assignment,
    equipment: seed.equipment,
    weightLbs: seed.weight,
    commodity: seed.commodity,
    documentRequirements,
    financials: {
      currency: "USD",
      linehaulCents: seed.linehaul,
      accessorials,
      totalRateCents,
      loadedMiles: seed.loaded,
      deadheadMiles: seed.deadhead,
      ratePerMileCents: Math.round(totalRateCents / Math.max(seed.loaded, 1)),
      driverShareCents: Math.round(totalRateCents * 0.72),
      dispatcherCommissionCents: Math.round(totalRateCents * 0.08),
    },
    createdAt,
    createdBy: officeActor,
    updatedAt: hoursFromNow(-2),
  };

  const events = synthesizeEvents(load, documents, seed, {
    office: officeActor, driver: driverActor,
  });

  return { load, events, documents };
}

function synthesizeEvents(
  load: Load,
  documents: Document[],
  seed: LoadSeed,
  actors: { office: ActorRef; driver: ActorRef },
): LoadEvent[] {
  const events: LoadEvent[] = [];
  const [pickup, delivery] = load.stops;

  const push = (
    kind: LoadEventKind,
    occurredAt: string,
    actor: ActorRef,
    source: EventSource,
    payload?: LoadEvent["payload"],
  ) => {
    events.push({
      id: nextId("evt"),
      organizationId: load.organizationId,
      loadId: load.id,
      kind,
      occurredAt,
      recordedAt: occurredAt,
      actor,
      source,
      payload,
    });
  };

  const rateCon = documents.find((d) => d.kind === "rate_confirmation");
  const bol = documents.find((d) => d.kind === "bill_of_lading");
  const pod = documents.find((d) => d.kind === "proof_of_delivery");

  push("load.created", load.createdAt, actors.office, "web");

  if (rateCon) {
    push("load.rate_confirmation_received", rateCon.uploadedAt, actors.office, "email",
      { documentId: rateCon.id });
    push("load.fields_extracted", rateCon.ocr.completedAt ?? rateCon.uploadedAt,
      SYSTEM_ACTOR, "ocr",
      { documentId: rateCon.id, note: "15 fields extracted, 2 below confidence threshold" });
    if (rateCon.verification.state === "verified") {
      push("load.verified", rateCon.verification.verifiedAt!, actors.office, "web",
        { previousValue: "verifying", newValue: "planned" });
    }
  }

  if (load.assignment) {
    const a = load.assignment;
    if (a.consent.status !== "not_required") {
      push("load.offered", hoursFromNow(-41), actors.office, "telegram",
        { driverId: a.driverId });
      if (a.consent.status === "accepted") {
        push("load.accepted", a.consent.respondedAt!, actors.driver, "telegram");
      }
    }
    push("assignment.created", a.assignedAt, actors.office, "web",
      { truckId: a.truckId, trailerId: a.trailerId, driverId: a.driverId });

    if (reached("dispatched", load.status)) {
      push("load.dispatched", hoursFromNow(-38), actors.office, "web",
        { previousValue: "assigned", newValue: "dispatched" });
    }
  }

  if (pickup.arrivedAt) {
    push("stop.arrived", pickup.arrivedAt, actors.driver, "telegram", { stopId: pickup.id });
    push("stop.loading_started", pickup.arrivedAt, actors.driver, "telegram", { stopId: pickup.id });
  }
  if (bol) {
    push("document.uploaded", bol.uploadedAt, actors.driver, "telegram",
      { stopId: pickup.id, documentId: bol.id, note: "Bill of lading" });
  }
  if (pickup.departedAt) {
    push("stop.loaded", pickup.departedAt, actors.driver, "telegram", { stopId: pickup.id });
    push("stop.departed", pickup.departedAt, actors.driver, "telegram", { stopId: pickup.id });
    push("load.in_transit", pickup.departedAt, SYSTEM_ACTOR, "system",
      { previousValue: "loaded", newValue: "in_transit" });
  }

  if (delivery.arrivedAt) {
    push("stop.arrived", delivery.arrivedAt, actors.driver, "telegram", { stopId: delivery.id });
  }
  if (delivery.departedAt) {
    push("stop.unloaded", delivery.departedAt, actors.driver, "telegram", { stopId: delivery.id });
    push("load.delivered", delivery.departedAt, actors.driver, "telegram",
      { previousValue: "at_delivery", newValue: "delivered" });
  }
  if (pod) {
    push("document.uploaded", pod.uploadedAt, actors.driver, "telegram",
      { stopId: delivery.id, documentId: pod.id, note: "Proof of delivery" });
  }

  if (reached("ready_to_invoice", load.status) && load.status !== "delivered") {
    push("load.ready_to_invoice", hoursFromNow(-6), SYSTEM_ACTOR, "system",
      { note: "All required documents present" });
  }
  if (reached("invoiced", load.status) && PROGRESS.indexOf(load.status) >= PROGRESS.indexOf("invoiced")) {
    push("load.invoiced", hoursFromNow(-4), actors.office, "web");
  }
  if (load.status === "paid") {
    push("load.paid", hoursFromNow(-2), SYSTEM_ACTOR, "api");
  }
  if (load.status === "cancelled") {
    push("load.cancelled", hoursFromNow(-3), actors.office, "web",
      { note: load.cancellationReason });
  }

  for (const e of seed.extraEvents ?? []) {
    const actor =
      e.by === "driver" ? actors.driver : e.by === "system" ? SYSTEM_ACTOR : actors.office;
    push(e.kind, e.at, actor, e.source ?? "web", {
      note: e.note,
      durationMinutes: e.durationMinutes,
      etaAt: e.etaAt,
    });
  }

  // Newest first — the order the timeline is read in.
  return events.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

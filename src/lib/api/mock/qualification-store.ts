import type { QualificationEvent, QualificationRecord } from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The carrier qualification-file store: custody records, and nothing else.
 *
 * It holds NO document, NO file, NO lineage and NO review of its own. Every row
 * is a pinned reference into the one document store, plus the carrier's own
 * frozen review, provenance and retention facts. A second document identity
 * cannot be created from here, because this module imports nothing that could
 * create one.
 *
 * A LEAF, like the document store: no registry imports, and no authorization at
 * all. Permissions, organization isolation and the driver's self-access basis
 * are enforced one layer up in the service, where the caller's context exists.
 * In particular `recordsForDriver` below crosses organizations by construction
 * and is deliberately NOT safe to hand to a screen — see its comment.
 */

interface StoreState {
  records: QualificationRecord[];
}

function emptyState(): StoreState {
  return { records: [] };
}

let state: StoreState = emptyState();
let seq = 0;

const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/** Test hook. Never called by the UI. */
export function resetQualificationStore() {
  state = emptyState();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every record one carrier holds. There is no read here without one. */
export function recordsForOrganization(organizationId: string): QualificationRecord[] {
  return state.records
    .filter((r) => r.organizationId === organizationId)
    .sort((a, b) => b.adoptedAt.localeCompare(a.adoptedAt));
}

export function recordById(recordId: string): QualificationRecord | undefined {
  return state.records.find((r) => r.id === recordId);
}

/**
 * Every carrier's adoptions about one driver. CROSSES ORGANIZATIONS.
 *
 * ★ NOT AN ACCESS PATH ★
 * A6 is explicit that a field naming somebody is attribution and never a grant,
 * and `driverProfileId` is exactly such a field. This function exists for two
 * callers that narrow it immediately and in different ways: the driver's own
 * view of who holds their documents, which the service gates on the caller BEING
 * that driver and then projects field by field, and the relationship-ended
 * sweep, which filters to the acting organization on the very next line. It is
 * never returned to a screen and never used to decide a carrier's read.
 */
export function recordsForDriver(driverProfileId: string): QualificationRecord[] {
  return state.records
    .filter((r) => r.driverProfileId === driverProfileId)
    .sort((a, b) => b.adoptedAt.localeCompare(a.adoptedAt));
}

/** This carrier's adoption of one exact document version, if it has one. */
export function adoptionOfVersion(
  organizationId: string,
  documentId: string,
): QualificationRecord | undefined {
  return state.records.find(
    (r) => r.organizationId === organizationId && r.evidence.documentId === documentId,
  );
}

/** This carrier's adoptions within one lineage, newest first. */
export function adoptionsOfLineage(
  organizationId: string,
  lineageId: string,
): QualificationRecord[] {
  return state.records
    .filter((r) => r.organizationId === organizationId && r.evidence.lineageId === lineageId)
    .sort((a, b) => b.adoptedAt.localeCompare(a.adoptedAt));
}

/** For a test that wants the whole store. Never used by a screen. */
export function allQualificationRecords(): readonly QualificationRecord[] {
  return state.records;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export function nextRecordId(): string {
  return rowId("qual");
}

export function nextEventId(): string {
  return rowId("qev");
}

export function putRecord(record: QualificationRecord): QualificationRecord {
  const i = state.records.findIndex((r) => r.id === record.id);
  state.records = i >= 0
    ? state.records.map((r) => (r.id === record.id ? record : r))
    : [...state.records, record];
  return record;
}

/**
 * The only mutation path, and it APPENDS.
 *
 * `evidence`, `review`, `adoptedAt`, `adoptedBy*` and `receivedAt` are not
 * accepted here by construction, so nothing in this module can rewrite what a
 * carrier received or what it decided — which is the whole reason the record
 * exists. Retention, supersession links and history are what change.
 */
export function amendRecord(
  recordId: string,
  changes: Partial<Pick<QualificationRecord,
    "retention" | "supersededByRecordId" | "supersedesRecordId" | "engagementId">>,
  event: Omit<QualificationEvent, "id" | "at"> & { at?: string },
): QualificationRecord {
  const existing = recordById(recordId);
  if (!existing) throw new Error(`No such qualification record: ${recordId}`);
  const at = new Date().toISOString();
  return putRecord({
    ...existing,
    ...changes,
    history: [...existing.history, { id: nextEventId(), at: event.at ?? at, ...event }],
    updatedAt: at,
    version: existing.version + 1,
  });
}

import type {
  DocumentEvent, DocumentFileRef, DocumentLink, DocumentOwnerRef,
  DocumentRecord, DocumentShare, DocumentShareBasis, DocumentSharePackage,
  DocumentSnapshot, DocumentStatus,
  DocumentSubjectKind, DocumentSubjectRef, DocumentTypeKey,
} from "@/types";
import { documentTypeLabel } from "@/lib/documents/catalog";

/**
 * ███ THE DOCUMENT STORE — MOCK ONLY, NOT A BACKEND ███
 *
 * Every document in Antcolos lives here: a driver's medical card, a carrier
 * organization's insurance, a truck's registration, a trailer's inspection.
 * There is exactly one of these, and the truck registry, the trailer registry,
 * the driver mock and the Document Center all read and write it. That is what
 * "one document system" means in practice — not four tables that agree.
 *
 * This module is a LEAF on purpose. It imports no registry, so the registries
 * can import it without a cycle, and it contains no authorization at all:
 * permissions, relationship scope and cross-organization isolation are enforced
 * one layer up, in the services, where the caller's context exists.
 *
 * Nothing here uploads, stores, transmits, reads, extracts or verifies a file.
 */

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An immutable UUID for a document.
 *
 * `crypto.randomUUID` where it exists, and a v4-shaped fallback where it does
 * not, so a document created in an older browser or a test runner is still a
 * UUID rather than a sequence number that could collide across partitions.
 */
export function documentUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A stable UUID for a FIXTURE document.
 *
 * Fixture ids have to survive a page reload, or `/documents/<id>` would 404 the
 * moment somebody refreshed or pasted a link — the same reason the truck
 * registry hard-codes its truck UUIDs. Derived from the document's slot, so the
 * same seeded document is the same id every time the module loads, and shaped
 * like a v4 UUID because that is what the field is.
 *
 * Documents created at RUNTIME get a real random UUID: they live only for the
 * browser session anyway, so there is nothing for a stable id to buy.
 */
export function deterministicUuid(seed: string): string {
  // xorshift32 seeded by FNV-1a. Deterministic, and good enough to fill 16
  // bytes without collisions across a few hundred fixture rows.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const bytes = new Uint8Array(16);
  let x = h || 0x9e3779b9;
  for (let i = 0; i < 16; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    bytes[i] = x & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let rowSeq = 0;
const rowId = (prefix: string) => `${prefix}_${(++rowSeq).toString(36)}${Date.now().toString(36)}`;

const iso = (d: Date = new Date()) => d.toISOString();

/**
 * The slot a document fills.
 *
 * A slot is "the registration on truck 104" or "the CDL front for this driver":
 * one subject, one requirement. Replacing a document means a new version in the
 * same slot, which is why the slot has to be computable and stable.
 */
export function slotKey(
  subjectKind: DocumentSubjectKind,
  subjectId: string,
  requirementKeyOrType: string,
): string {
  return `${subjectKind}:${subjectId}:${requirementKeyOrType}`;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface StoreState {
  records: DocumentRecord[];
  shares: DocumentShare[];
  events: DocumentEvent[];
  snapshots: DocumentSnapshot[];
  /**
   * Share packages a driver created. They live HERE, in the one document
   * store, because a second store is how a document ends up with two
   * identities. They hold no files and no document rows — only references to
   * the records above, pinned to a version.
   */
  packages: DocumentSharePackage[];
}

function emptyState(): StoreState {
  return { records: [], shares: [], events: [], snapshots: [], packages: [] };
}

let state: StoreState = emptyState();

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function allDocuments(): readonly DocumentRecord[] {
  return state.records;
}

export function documentById(documentId: string): DocumentRecord | undefined {
  return state.records.find((d) => d.documentId === documentId);
}

/** Every version of one document, newest first. */
export function lineageVersions(lineageId: string): DocumentRecord[] {
  return state.records
    .filter((d) => d.lineageId === lineageId)
    .sort((a, b) => b.version - a.version);
}

/** The live version of a lineage — the one that is not superseded. */
export function currentVersion(lineageId: string): DocumentRecord | undefined {
  return lineageVersions(lineageId).find((d) => d.status !== "superseded");
}

/** Documents about one entity. Superseded versions included only on request. */
export function documentsForSubject(
  subjectKind: DocumentSubjectKind,
  subjectId: string,
  options: { includeSuperseded?: boolean } = {},
): DocumentRecord[] {
  return state.records.filter((d) => {
    if (!options.includeSuperseded && d.status === "superseded") return false;
    return d.links.some((l) => l.subject.kind === subjectKind && l.subject.id === subjectId);
  });
}

/** Documents an organization holds in its own right. */
export function documentsOwnedBy(organizationId: string): DocumentRecord[] {
  return state.records.filter((d) => d.organizationId === organizationId);
}

/** The live document filling one slot, if any. */
export function documentInSlot(
  subjectKind: DocumentSubjectKind,
  subjectId: string,
  requirementKey: string,
): DocumentRecord | undefined {
  return state.records.find(
    (d) =>
      d.status !== "superseded" &&
      d.links.some(
        (l) =>
          !l.unlinkedAt &&
          l.requirementKey === requirementKey &&
          l.subject.kind === subjectKind &&
          l.subject.id === subjectId,
      ),
  );
}

export function sharesForLineage(lineageId: string): DocumentShare[] {
  return state.shares.filter((s) => s.lineageId === lineageId);
}

export function activeSharesForOrganization(organizationId: string): DocumentShare[] {
  return state.shares.filter(
    (s) => s.sharedWithOrganizationId === organizationId && !s.revokedAt,
  );
}

export function allShares(): readonly DocumentShare[] {
  return state.shares;
}

/** The full history of a document, oldest first. Append-only, never pruned. */
export function eventsForLineage(lineageId: string): DocumentEvent[] {
  return state.events
    .filter((e) => e.lineageId === lineageId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function snapshotsForLineage(lineageId: string): DocumentSnapshot[] {
  return state.snapshots.filter((s) => s.lineageId === lineageId);
}

export function allSnapshots(): readonly DocumentSnapshot[] {
  return state.snapshots;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export function recordEvent(
  event: Omit<DocumentEvent, "id" | "at"> & { at?: string },
): DocumentEvent {
  const created: DocumentEvent = { id: rowId("dev"), at: event.at ?? iso(), ...event };
  state.events = [...state.events, created];
  return created;
}

export interface CreateDocumentInput {
  owner: DocumentOwnerRef;
  organizationId?: string;
  typeKey: DocumentTypeKey;
  subject: DocumentSubjectRef;
  requirementKey?: string;
  /** Omitted for a document its owner holds with no organization reviewing it. */
  contextOrganizationId?: string;
  contextOrganizationName?: string;
  status: DocumentStatus;
  file?: DocumentFileRef;
  expiresAt?: string;
  addedByName: string;
  addedByMembershipId?: string;
  /** Fixtures set these so seeded history reads as history. */
  createdAt?: string;
  /**
   * Fixtures pass their slot here so the ids are stable across page loads.
   * Runtime callers leave it unset and get a random UUID.
   */
  idSeed?: string;
  reviewedAt?: string;
  reviewedByName?: string;
  rejectionReason?: string;
}

function reviewFor(input: CreateDocumentInput): DocumentLink["review"] {
  switch (input.status) {
    case "approved":
    case "expiring_soon":
    case "expired":
      return { state: "approved", reviewedAt: input.reviewedAt ?? input.createdAt, reviewedByName: input.reviewedByName };
    case "rejected":
      return { state: "rejected", reviewedAt: input.reviewedAt ?? input.createdAt, reviewedByName: input.reviewedByName, rejectionReason: input.rejectionReason };
    case "pending_review":
      return { state: "pending" };
    default:
      return { state: "not_required" };
  }
}

/** Creates version 1 of a new document lineage. */
export function createDocument(input: CreateDocumentInput): DocumentRecord {
  const at = input.createdAt ?? iso();
  const lineageId = input.idSeed ? deterministicUuid(input.idSeed) : documentUuid();
  const record: DocumentRecord = {
    documentId: input.idSeed ? deterministicUuid(`${input.idSeed}#v1`) : documentUuid(),
    lineageId,
    owner: input.owner,
    organizationId: input.organizationId,
    typeKey: input.typeKey,
    version: 1,
    status: input.status,
    file: input.file,
    expiresAt: input.expiresAt,
    addedByName: input.addedByName,
    addedByMembershipId: input.addedByMembershipId,
    createdAt: at,
    updatedAt: at,
    links: [{
      id: rowId("dlk"),
      subject: input.subject,
      requirementKey: input.requirementKey,
      primary: true,
      contextOrganizationId: input.contextOrganizationId,
      contextOrganizationName: input.contextOrganizationName,
      review: reviewFor(input),
      linkedAt: at,
    }],
  };
  state.records = [...state.records, record];
  recordEvent({
    lineageId: record.lineageId, documentId: record.documentId, at,
    kind: "created",
    summary: `${documentTypeLabel(record.typeKey)} added`,
    detail: input.file ? `File chosen in the browser: ${input.file.fileName}. Nothing was uploaded.` : undefined,
    organizationId: input.contextOrganizationId,
    actorName: input.addedByName,
  });
  return record;
}

export interface ReplaceDocumentInput {
  file?: DocumentFileRef;
  expiresAt?: string;
  status: DocumentStatus;
  addedByName: string;
  addedByMembershipId?: string;
  /** Absent when no organization governs the document being replaced. */
  contextOrganizationId?: string;
}

/**
 * Replaces a document with a new version.
 *
 * The previous record is NOT edited beyond being marked superseded and pointed
 * at its replacement: its file reference, review decision, expiry, links and
 * history all survive exactly as they were. A snapshot is taken as well, so
 * what an organization held at the time can still be shown after the fact.
 *
 * Links and shares carry forward, because they belong to the document rather
 * than to one of its versions — re-granting access on every replacement would
 * be busywork that gets skipped, and then the dispatcher's view goes stale.
 */
export function replaceDocument(
  previous: DocumentRecord,
  input: ReplaceDocumentInput,
): DocumentRecord {
  const at = iso();
  const next: DocumentRecord = {
    ...previous,
    documentId: documentUuid(),
    version: previous.version + 1,
    supersedesDocumentId: previous.documentId,
    supersededByDocumentId: undefined,
    status: input.status,
    file: input.file,
    expiresAt: input.expiresAt,
    addedByName: input.addedByName,
    addedByMembershipId: input.addedByMembershipId,
    createdAt: at,
    updatedAt: at,
    // A new version starts unreviewed in every context it serves. An earlier
    // approval was of the earlier file, and cannot be inherited by this one.
    links: previous.links
      .filter((l) => !l.unlinkedAt)
      .map((l) => ({
        ...l,
        id: rowId("dlk"),
        review: { state: input.status === "pending_review" ? "pending" as const : "not_required" as const },
        linkedAt: at,
      })),
  };

  snapshot(previous, "replaced");

  state.records = [
    ...state.records.map((d) =>
      d.documentId === previous.documentId
        ? { ...d, status: "superseded" as const, supersededByDocumentId: next.documentId, updatedAt: at }
        : d,
    ),
    next,
  ];

  recordEvent({
    lineageId: next.lineageId, documentId: next.documentId, at, kind: "replaced",
    summary: `Replaced with version ${next.version}`,
    detail: "The previous version is kept in full and can still be opened.",
    organizationId: input.contextOrganizationId, actorName: input.addedByName,
  });
  recordEvent({
    lineageId: previous.lineageId, documentId: previous.documentId, at, kind: "superseded",
    summary: `Superseded by version ${next.version}`,
    organizationId: input.contextOrganizationId, actorName: input.addedByName,
  });
  return next;
}

/** In-place change to a document that is NOT a replacement: review, expiry. */
export function updateDocument(
  documentId: string,
  changes: Partial<Pick<DocumentRecord, "status" | "expiresAt" | "links">>,
): DocumentRecord {
  const at = iso();
  let updated: DocumentRecord | undefined;
  state.records = state.records.map((d) => {
    if (d.documentId !== documentId) return d;
    updated = { ...d, ...changes, updatedAt: at };
    return updated;
  });
  if (!updated) throw new Error(`No such document: ${documentId}`);
  return updated;
}

export interface AddLinkInput {
  subject: DocumentSubjectRef;
  requirementKey?: string;
  contextOrganizationId: string;
  contextOrganizationName: string;
  actorName: string;
  /** See `DocumentLink.basis`. Absent means the link stands on its own. */
  basis?: DocumentLink["basis"];
}

/**
 * Attaches an existing document to another context.
 *
 * This is the answer to "the same valid document applies in two places":
 * one record, two typed links, each with its own review state and its own
 * governing organization. Never a second copy of the file.
 */
/**
 * ███ TEST SEAM — NEVER SET BY THE PRODUCT ███
 *
 * Refuses the link for one requirement key, so a sharing grant can be made to
 * fail PART WAY THROUGH rather than before it starts. Inert wherever a window
 * exists, for the same reasons set out on the access module's seam, and for the
 * same honest reason it is not a security property.
 */
const LINK_SEAM_AVAILABLE = typeof window === "undefined";
let linkFaultKey: string | null = null;

export function failLinkWriteForTests(requirementKey: string | null): void {
  if (!LINK_SEAM_AVAILABLE) return;
  linkFaultKey = requirementKey;
}

export interface AddLinkEntry {
  documentId: string;
  input: AddLinkInput;
}

/**
 * ★ SEVERAL LINKS, OR NONE ★
 *
 * A carrier reads a driver's document through a LINK, so each link written is
 * access granted the instant it lands. Adding them one at a time means a
 * failure on the second leaves the first readable — access granted by a grant
 * that failed, and a consent record that disagrees with what is actually
 * shared. Nobody asked for half of it.
 *
 * So this resolves and builds EVERY link first, writing nothing, and commits
 * only once it knows all of them can be made. The commit loop cannot throw: the
 * documents are already resolved and the links already built. In this mock that
 * is genuinely atomic, because it is one synchronous block with no `await` in
 * it — and in a backend it is one transaction, which is the point of putting
 * the guarantee at the store rather than in whoever is calling it.
 *
 * Idempotence stays the caller's: this writes what it is given.
 */
export function addLinks(
  entries: readonly AddLinkEntry[],
  /**
   * ★ THE CONSENT WRITE, INSIDE THE SAME COMMIT ★
   *
   * Links are what a carrier reads through; the consent record is what says
   * they may. Written apart, in either order, there is a moment where one
   * exists and the other does not — and if that moment is where a failure
   * lands, the links are real access nobody agreed to complete.
   *
   * So the caller hands its consent write IN, and it runs inside this commit.
   * If it refuses, every link this call just wrote is removed before the
   * refusal is passed on: the store is exactly as it was.
   *
   * ███ THIS IS NOT DURABLE ATOMICITY ███
   *
   * It is one synchronous block in one tab over in-memory arrays. Nothing can
   * observe the half state because nothing else runs — not a transaction, not a
   * lock, and no guarantee whatever across two tabs, two browsers or a restart.
   *
   * ★ THE INVARIANT A BACKEND MUST HOLD ★
   *   No acceptance-derived document is readable unless its valid,
   *   purpose-bound consent is effective at the moment of the read.
   *
   * Two mechanisms, and BOTH are required — neither substitutes for the other:
   *
   *   WRITE. The link rows and the consent row are one write and belong in one
   *   transaction. Ordering them does not help: whichever goes first, a crash
   *   between them leaves the other missing. The transaction must also take the
   *   consent row's lock before inserting links (`SELECT … FOR UPDATE` on the
   *   relationship), because the consent set is read-modify-write and two
   *   concurrent grants would otherwise lose keys. Idempotence comes from a
   *   unique constraint on `(driver_profile_id, carrier_id, requirement_key)`,
   *   so a retry writes nothing rather than a duplicate.
   *
   *   READ. The read path JOINS a `driver_consent` link to its consent and
   *   requires it to be effective — it does not trust that the write was
   *   ordered or that the transaction held. This is what makes the invariant
   *   survive a partial restore, a replayed message, a migration, or a bug in
   *   some future write path. It belongs at the lowest layer that cannot be
   *   bypassed: a view, a row-level security policy, or a repository method no
   *   endpoint can go around. `consentBacked` in `documents.ts` is that guard
   *   here, and it ports directly.
   *
   * ★ WHAT AN OUTBOX IS AND IS NOT FOR ★
   * An outbox does NOT make these two writes atomic and does NOT prevent a
   * temporarily readable, consent-less link: it delivers a message AFTER a
   * transaction commits. Its place is the downstream effects of a grant that
   * has already happened — notifying the carrier, refreshing a search index,
   * forwarding the audit event to an external sink — where at-least-once
   * delivery plus an idempotency key is exactly right. Using it in place of the
   * transaction reintroduces the window this method exists to close.
   *
   * A compensating unlink is the weakest fallback of the three. It must run
   * before the caller reports success, and even then it leaves the window open
   * for as long as it takes to run.
   */
  commitConsent?: () => void,
): DocumentRecord[] {
  const at = iso();

  // Phase 1 — resolve and build. Any refusal happens HERE, before any write.
  const planned = entries.map(({ documentId, input }) => {
    const existing = documentById(documentId);
    if (!existing) throw new Error(`No such document: ${documentId}`);
    if (linkFaultKey && input.requirementKey === linkFaultKey) {
      throw new Error(
        `Injected link failure for ${input.requirementKey} (test only). In a real `
        + "system this is where the write would have refused.",
      );
    }
    const link: DocumentLink = {
      id: rowId("dlk"),
      subject: input.subject,
      requirementKey: input.requirementKey,
      primary: false,
      contextOrganizationId: input.contextOrganizationId,
      contextOrganizationName: input.contextOrganizationName,
      basis: input.basis,
      // A second context has not reviewed it, whatever the first context decided.
      review: { state: "pending" },
      linkedAt: at,
    };
    return { existing, input, link };
  });

  // Phase 2 — commit. Nothing in the link writes below can fail.
  const records = state.records;
  const events = state.events;
  const written = planned.map(({ existing, input, link }) => {
    const updated = updateDocument(existing.documentId, { links: [...existing.links, link] });
    recordEvent({
      lineageId: existing.lineageId, documentId: existing.documentId, at, kind: "linked",
      summary: `Linked to ${input.subject.label}`,
      detail: "The same document, linked with explicit permission. No copy was made.",
      organizationId: input.contextOrganizationId, actorName: input.actorName,
    });
    return updated;
  });

  // Phase 3 — the consent that makes the links mean something. Still the same
  // synchronous block, so no read can land between phase 2 and here.
  if (commitConsent) {
    try {
      commitConsent();
    } catch (error) {
      // Put the store back. Not "unlink" — these links were never real, and a
      // tombstoned `unlinkedAt` would leave a history saying a share happened.
      state.records = records;
      state.events = events;
      throw error;
    }
  }
  return written;
}

export function addLink(documentId: string, input: AddLinkInput): DocumentRecord {
  const existing = documentById(documentId);
  if (!existing) throw new Error(`No such document: ${documentId}`);
  const at = iso();
  const link: DocumentLink = {
    id: rowId("dlk"),
    subject: input.subject,
    requirementKey: input.requirementKey,
    primary: false,
    contextOrganizationId: input.contextOrganizationId,
    contextOrganizationName: input.contextOrganizationName,
    basis: input.basis,
    // A second context has not reviewed it, whatever the first context decided.
    review: { state: "pending" },
    linkedAt: at,
  };
  const updated = updateDocument(documentId, { links: [...existing.links, link] });
  recordEvent({
    lineageId: existing.lineageId, documentId, at, kind: "linked",
    summary: `Linked to ${input.subject.label}`,
    detail: "The same document, linked with explicit permission. No copy was made.",
    organizationId: input.contextOrganizationId, actorName: input.actorName,
  });
  return updated;
}

/** Ends a link. The link row survives, so the history stays readable. */
export function endLink(
  documentId: string,
  linkId: string,
  reason: string,
  actorName: string,
): DocumentRecord {
  const existing = documentById(documentId);
  if (!existing) throw new Error(`No such document: ${documentId}`);
  const at = iso();
  const target = existing.links.find((l) => l.id === linkId);
  const updated = updateDocument(documentId, {
    links: existing.links.map((l) =>
      l.id === linkId ? { ...l, unlinkedAt: at, unlinkReason: reason } : l,
    ),
  });
  recordEvent({
    lineageId: existing.lineageId, documentId, at, kind: "unlinked",
    summary: target ? `Link to ${target.subject.label} ended` : "Link ended",
    detail: reason, organizationId: target?.contextOrganizationId, actorName,
  });
  return updated;
}

export interface ShareInput {
  lineageId: string;
  sharedWithOrganizationId: string;
  sharedWithName: string;
  basis: DocumentShareBasis;
  purpose: string;
  canDownload: boolean;
  grantedByName: string;
  grantedAt?: string;
  organizationId?: string;
}

export function shareDocument(input: ShareInput): DocumentShare {
  const at = input.grantedAt ?? iso();
  const share: DocumentShare = {
    id: rowId("dsh"),
    lineageId: input.lineageId,
    sharedWithOrganizationId: input.sharedWithOrganizationId,
    sharedWithName: input.sharedWithName,
    basis: input.basis,
    purpose: input.purpose,
    canDownload: input.canDownload,
    grantedAt: at,
    grantedByName: input.grantedByName,
  };
  state.shares = [...state.shares, share];
  const current = currentVersion(input.lineageId);
  recordEvent({
    lineageId: input.lineageId,
    documentId: current?.documentId ?? input.lineageId,
    at, kind: "shared",
    summary: `Shared with ${input.sharedWithName}`,
    detail: input.purpose,
    organizationId: input.organizationId, actorName: input.grantedByName,
  });
  return share;
}

/**
 * Ends a share.
 *
 * The grant is marked revoked and kept. What the recipient already held is
 * snapshotted rather than erased — ending a relationship must not rewrite what
 * was true while it lasted.
 */
export function revokeShare(shareId: string, reason: string, actorName: string): DocumentShare {
  const at = iso();
  let revoked: DocumentShare | undefined;
  state.shares = state.shares.map((s) => {
    if (s.id !== shareId || s.revokedAt) return s;
    revoked = { ...s, revokedAt: at, revokeReason: reason };
    return revoked;
  });
  if (!revoked) throw new Error(`No such active share: ${shareId}`);
  const current = currentVersion(revoked.lineageId);
  if (current) snapshot(current, "share_revoked");
  recordEvent({
    lineageId: revoked.lineageId,
    documentId: current?.documentId ?? revoked.lineageId,
    at, kind: "share_revoked",
    summary: `Access for ${revoked.sharedWithName} ended`,
    detail: reason, actorName,
  });
  return revoked;
}

/** Point-in-time copy of what a document was. Never deleted. */
export function snapshot(
  record: DocumentRecord,
  reason: DocumentSnapshot["reason"],
): DocumentSnapshot {
  const taken: DocumentSnapshot = {
    documentId: record.documentId,
    lineageId: record.lineageId,
    typeKey: record.typeKey,
    label: documentTypeLabel(record.typeKey),
    fileName: record.file?.fileName,
    fileType: record.file?.fileType,
    sizeBytes: record.file?.sizeBytes,
    status: record.status,
    expiresAt: record.expiresAt,
    capturedAt: iso(),
    reason,
  };
  state.snapshots = [...state.snapshots, taken];
  return taken;
}

/**
 * Ends every link a departing organization held on one subject's documents.
 *
 * Nothing is deleted: links are closed, active shares are revoked, snapshots
 * are taken, and every record and event survives. This is the function a
 * relationship ending calls, and it is deliberately the only one — so there is
 * no path that could quietly drop history.
 */
export function endRelationshipDocuments(options: {
  subjectKind: DocumentSubjectKind;
  subjectId: string;
  organizationId: string;
  reason: string;
  actorName: string;
}): { linksEnded: number; sharesRevoked: number } {
  let linksEnded = 0;
  let sharesRevoked = 0;

  for (const record of documentsForSubject(options.subjectKind, options.subjectId, { includeSuperseded: true })) {
    for (const link of record.links) {
      if (link.unlinkedAt) continue;
      if (link.contextOrganizationId !== options.organizationId) continue;
      snapshot(record, "relationship_ended");
      endLink(record.documentId, link.id, options.reason, options.actorName);
      linksEnded += 1;
    }
    for (const share of sharesForLineage(record.lineageId)) {
      if (share.revokedAt) continue;
      if (share.sharedWithOrganizationId !== options.organizationId) continue;
      revokeShare(share.id, options.reason, options.actorName);
      sharesRevoked += 1;
    }
  }
  return { linksEnded, sharesRevoked };
}

/* -------------------------------------------------------------------------- */
/* Share packages                                                              */
/* -------------------------------------------------------------------------- */

export function allSharePackages(): readonly DocumentSharePackage[] {
  return state.packages;
}

export function sharePackageById(id: string): DocumentSharePackage | undefined {
  return state.packages.find((p) => p.id === id);
}

export function sharePackageByToken(token: string): DocumentSharePackage | undefined {
  return state.packages.find((p) => p.token === token);
}

export function sharePackagesForDriver(driverProfileId: string): DocumentSharePackage[] {
  return state.packages
    .filter((p) => p.driverProfileId === driverProfileId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Packages addressed to one organization. Never another organization's. */
export function sharePackagesForOrganization(organizationId: string): DocumentSharePackage[] {
  return state.packages
    .filter(
      (p) => p.recipient.kind === "organization" && p.recipient.organizationId === organizationId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function putSharePackage(pkg: DocumentSharePackage): DocumentSharePackage {
  const existing = state.packages.findIndex((p) => p.id === pkg.id);
  state.packages =
    existing >= 0
      ? state.packages.map((p) => (p.id === pkg.id ? pkg : p))
      : [...state.packages, pkg];
  return pkg;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Clears one subject kind's documents.
 *
 * The truck and trailer registries rebuild their fixtures independently, so
 * each clears only its own without disturbing the others.
 */
export function clearDocumentsForSubjectKind(kind: DocumentSubjectKind) {
  const doomed = new Set(
    state.records.filter((d) => d.links.some((l) => l.subject.kind === kind)).map((d) => d.lineageId),
  );
  state.records = state.records.filter((d) => !doomed.has(d.lineageId));
  state.shares = state.shares.filter((s) => !doomed.has(s.lineageId));
  state.events = state.events.filter((e) => !doomed.has(e.lineageId));
  state.snapshots = state.snapshots.filter((s) => !doomed.has(s.lineageId));
}

/** Test hook. Never called by the UI. */
export function resetDocumentStore() {
  state = emptyState();
  rowSeq = 0;
}

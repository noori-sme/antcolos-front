import type {
  DocumentRecord, DocumentSharePackage, ShareEvent, ShareEventKind,
  SharePackageItem, SharePackageRefusal, SharePackageState, SharePackageView,
  ShareRecipient, SharePurpose,
} from "@/types";
import { documentTypeLabel } from "@/lib/documents/catalog";
import { effectiveStatus } from "@/lib/documents/status";
import { shareReferenceCode } from "@/lib/documents/watermark";
import {
  addLink, documentById, documentsForSubject, endLink, lineageVersions,
  putSharePackage, revokeShare, shareDocument, sharePackageById,
  sharePackageByToken, sharePackagesForDriver, sharePackagesForOrganization,
  sharesForLineage, updateDocument,
} from "./document-store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The driver's side of controlled sharing: which documents go to whom, for how
 * long, and what has happened to that since. It owns NOTHING about documents —
 * every item is a reference into the one document store, pinned to a version —
 * and nothing about relationships: creating a share creates no membership, no
 * carrier relationship, no assignment and no employment, and this file has no
 * way to create one even by accident, because it imports nothing that can.
 *
 * WHAT IS REAL HERE: selection, version pinning, scope, expiry, revocation and
 * refusal are all enforced in this runtime, and the tests hold them to it.
 *
 * WHAT IS NOT: no email is sent, no token is hashed, no file exists to protect,
 * and nothing survives a page load. A real backend owes this seam encrypted
 * object storage, hashed single-purpose tokens, authenticated delivery with
 * bounce handling, server-side expiry and revocation, malware scanning, durable
 * access logs and rate limiting. See docs/driver-document-sharing.md.
 */

const DEFAULT_TTL_DAYS = 14;

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}${Date.now().toString(36)}`;

/** Test hook. Never called by the UI. */
export function resetShareSequence() {
  sequence = 0;
}

const iso = (d: Date) => d.toISOString();
const now = () => new Date();

function daysFromNow(days: number): string {
  const d = now();
  d.setDate(d.getDate() + days);
  return iso(d);
}

/**
 * The opaque token an external recipient opens.
 *
 * `Math.random` is not a security primitive and this is not a secret worth
 * keeping in a browser mock. A real backend mints a single-purpose token
 * server-side, stores only its hash, and expires it; nothing about this
 * function should survive that.
 */
function mintToken(): string {
  const body = Array.from({ length: 4 }, () =>
    Math.random().toString(36).slice(2, 8).toUpperCase(),
  ).join("");
  return `DS${body}`;
}

/** Short, printable, and not the token: safe on a page a stranger can see. */
export function shareReference(pkg: DocumentSharePackage): string {
  return shareReferenceCode(pkg.id);
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where the package is, derived from what has happened to it.
 *
 * Revocation and expiry are answered on every read rather than by a job, so a
 * link that ran out a second ago is refused a second ago. A real backend
 * enforces both server-side; the derivation is the same either way.
 */
export function shareState(pkg: DocumentSharePackage, at: Date = now()): SharePackageState {
  if (pkg.revokedAt) return "revoked";
  if (pkg.deliveryFailureReason) return "failed";
  if (new Date(pkg.expiresAt).getTime() <= at.getTime()) return "expired";
  if (pkg.accessCount > 0) return "opened";
  if (pkg.recipient.kind === "external") {
    return pkg.events.some((e) => e.kind === "delivery_recorded") ? "delivered" : "delivery_pending";
  }
  return "issued";
}

export function isShareUsable(pkg: DocumentSharePackage, at: Date = now()): boolean {
  const state = shareState(pkg, at);
  return state !== "revoked" && state !== "expired";
}

function event(kind: ShareEventKind, summary: string, extra: Partial<ShareEvent> = {}): ShareEvent {
  return { id: nextId("shev"), at: iso(now()), kind, summary, ...extra };
}

function append(pkg: DocumentSharePackage, e: ShareEvent): DocumentSharePackage {
  return putSharePackage({ ...pkg, events: [...pkg.events, e] });
}

/* -------------------------------------------------------------------------- */
/* Creating a package                                                          */
/* -------------------------------------------------------------------------- */

export interface CreateSharePackageInput {
  driverProfileId: string;
  driverName: string;
  /** Canonical document VERSION ids. Nothing is copied; these are references. */
  documentIds: string[];
  recipient: ShareRecipient;
  purpose: SharePurpose;
  note?: string;
  ttlDays?: number;
  /** The package this one replaces, when a document changed and was re-shared. */
  refreshOfPackageId?: string;
}

export type CreateShareResult =
  | { status: "ok"; pkg: DocumentSharePackage }
  | { status: "no-documents" }
  | { status: "invalid-email" }
  | { status: "unknown-document"; documentId: string };

/** RFC-shaped enough to catch a typo; the backend owns the real answer. */
export function isValidRecipientEmail(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

function itemFor(record: DocumentRecord): SharePackageItem {
  return {
    lineageId: record.lineageId,
    documentId: record.documentId,
    typeKey: record.typeKey,
    label: documentTypeLabel(record.typeKey),
    fileName: record.file?.fileName,
    statusAtShare: effectiveStatus(record),
    expiresAt: record.expiresAt,
  };
}

/**
 * Hands specific document VERSIONS to one recipient.
 *
 * A native recipient also gets a real `DocumentShare` grant per lineage, on the
 * `driver_share` basis, because that is the existing record for "this
 * organization may see that document" and sharing must not invent a second
 * access path. An external recipient gets a token instead: there is no
 * organization to grant anything to, and none is created for them.
 */
export function createSharePackage(input: CreateSharePackageInput): CreateShareResult {
  if (input.documentIds.length === 0) return { status: "no-documents" };
  if (input.recipient.kind === "external" && !isValidRecipientEmail(input.recipient.email)) {
    return { status: "invalid-email" };
  }

  const items: SharePackageItem[] = [];
  for (const documentId of input.documentIds) {
    const record = documentById(documentId);
    if (!record) return { status: "unknown-document", documentId };
    items.push(itemFor(record));
  }

  const recipient: ShareRecipient =
    input.recipient.kind === "external"
      ? { kind: "external", email: input.recipient.email.trim().toLowerCase() }
      : input.recipient;

  const pkg: DocumentSharePackage = {
    id: nextId("shp"),
    driverProfileId: input.driverProfileId,
    driverName: input.driverName,
    recipient,
    purpose: input.purpose,
    note: input.note?.trim() || undefined,
    items,
    createdAt: iso(now()),
    createdByName: input.driverName,
    expiresAt: daysFromNow(input.ttlDays ?? DEFAULT_TTL_DAYS),
    token: recipient.kind === "external" ? mintToken() : undefined,
    refreshOfPackageId: input.refreshOfPackageId,
    accessCount: 0,
    events: [],
  };

  putSharePackage(pkg);
  const created = append(
    pkg,
    event("created", `Shared ${items.length} document${items.length === 1 ? "" : "s"}`),
  );

  if (recipient.kind === "organization") {
    grantNativeAccess(created, recipient.organizationId, recipient.organizationName);
  }
  return { status: "ok", pkg: sharePackageById(created.id)! };
}

/**
 * The native grant, in the existing record for grants.
 *
 * One `DocumentShare` per lineage, already the Document Center's answer to
 * "why may this organization see this?", so the carrier's own document screens
 * work with no special case. Download is off: a share made to get somebody
 * looked at is not a licence to keep a copy.
 */
function grantNativeAccess(
  pkg: DocumentSharePackage,
  organizationId: string,
  organizationName: string,
) {
  for (const item of pkg.items) {
    const alreadyGranted = sharesForLineage(item.lineageId).some(
      (s) => !s.revokedAt && s.sharedWithOrganizationId === organizationId,
    );
    if (alreadyGranted) continue;
    shareDocument({
      lineageId: item.lineageId,
      sharedWithOrganizationId: organizationId,
      sharedWithName: organizationName,
      basis: { kind: "driver_share", id: pkg.id, label: `Shared by ${pkg.driverName}` },
      purpose: pkg.purpose,
      canDownload: false,
      grantedByName: pkg.driverName,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Delivery — a boundary, not a mailbox                                        */
/* -------------------------------------------------------------------------- */

export type DeliveryOutcome = { status: "recorded" } | { status: "failed"; reason: string };

/**
 * Records that a message WOULD be sent, and says so.
 *
 * Nothing is emailed. This queues a delivery the way the integration boundary
 * queues everything else — a record that something is owed to an outside
 * system — and the screens label it "mock delivery" rather than "sent". An
 * address in the unroutable `.invalid` TLD fails on purpose, so the failure
 * path is reachable in review instead of theoretical.
 */
export function recordDelivery(packageId: string): DeliveryOutcome {
  const pkg = sharePackageById(packageId);
  if (!pkg || pkg.recipient.kind !== "external") return { status: "failed", reason: "No external recipient." };

  // Idempotent by package: a retried confirmation, a double click or a repeated
  // callback records one delivery, not a second one. A real backend keys this
  // off the same idempotency key its outbound queue already uses.
  if (pkg.events.some((e) => e.kind === "delivery_recorded")) return { status: "recorded" };
  if (pkg.deliveryFailureReason) return { status: "failed", reason: pkg.deliveryFailureReason };

  const queued = append(pkg, event("delivery_queued", `Queued for ${pkg.recipient.email}`));

  if (queued.recipient.kind === "external" && queued.recipient.email.endsWith(".invalid")) {
    const reason = "The address was rejected as undeliverable.";
    const failed = append(queued, event("delivery_failed", reason));
    putSharePackage({ ...failed, deliveryFailureReason: reason });
    return { status: "failed", reason };
  }

  append(queued, event("delivery_recorded", `Mock delivery recorded for ${queued.recipient.kind === "external" ? queued.recipient.email : ""}`));
  return { status: "recorded" };
}

/* -------------------------------------------------------------------------- */
/* Opening a package                                                           */
/* -------------------------------------------------------------------------- */

export type ResolveResult =
  | { status: "ok"; pkg: DocumentSharePackage; view: SharePackageView }
  | { status: "refused"; reason: SharePackageRefusal };

export function packageView(pkg: DocumentSharePackage): SharePackageView {
  return {
    id: pkg.id,
    driverName: pkg.driverName,
    purpose: pkg.purpose,
    note: pkg.note,
    createdAt: pkg.createdAt,
    expiresAt: pkg.expiresAt,
    state: shareState(pkg),
    items: pkg.items,
    reference: shareReference(pkg),
  };
}

/**
 * Opens an external link, and records that it was opened.
 *
 * Every refusal is stated rather than blank: an unknown token, a withdrawn
 * share and an expired one are three different things to the person holding
 * the link, and a 404 for all three teaches them nothing.
 */
export function openSharedPackage(token: string): ResolveResult {
  const pkg = sharePackageByToken(token.trim().toUpperCase());
  if (!pkg) return { status: "refused", reason: "unknown_token" };
  if (pkg.revokedAt) {
    append(pkg, event("access_refused", "Refused: the share was revoked"));
    return { status: "refused", reason: "revoked" };
  }
  if (!isShareUsable(pkg)) {
    append(pkg, event("access_refused", "Refused: the share had expired"));
    return { status: "refused", reason: "expired" };
  }

  const opened = putSharePackage({
    ...pkg,
    accessCount: pkg.accessCount + 1,
    lastAccessedAt: iso(now()),
  });
  const withEvent = append(opened, event("opened", `Opened by ${recipientLabel(pkg)}`));
  return { status: "ok", pkg: withEvent, view: packageView(withEvent) };
}

/** One document inside a package, for a recipient who has the package open. */
export function readSharedDocument(
  pkg: DocumentSharePackage,
  documentId: string,
): { status: "ok"; record: DocumentRecord } | { status: "refused"; reason: SharePackageRefusal } {
  if (!isShareUsable(pkg)) {
    return { status: "refused", reason: pkg.revokedAt ? "revoked" : "expired" };
  }
  // Only what was selected, and only the version that was selected. Asking for
  // a document id that is not in the package is refused even when the driver
  // owns it and even when it sits in the same lineage.
  const item = pkg.items.find((i) => i.documentId === documentId);
  if (!item) {
    append(pkg, event("access_refused", "Refused: that document is not in this share", { documentId }));
    return { status: "refused", reason: "not_in_package" };
  }
  const record = documentById(documentId);
  if (!record) return { status: "refused", reason: "not_in_package" };
  append(pkg, event("document_viewed", `Viewed ${item.label}`, { documentId }));
  return { status: "ok", record };
}

export function recipientLabel(pkg: DocumentSharePackage): string {
  return pkg.recipient.kind === "organization"
    ? pkg.recipient.organizationName
    : pkg.recipient.email;
}

/* -------------------------------------------------------------------------- */
/* Native access                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Packages addressed to this organization, and usable.
 *
 * Scope is the organization's own id, never a parameter a screen supplies, so
 * one carrier cannot read another's inbox by asking differently.
 */
export function packagesForOrganization(organizationId: string): DocumentSharePackage[] {
  return sharePackagesForOrganization(organizationId);
}

export function openNativePackage(
  organizationId: string,
  packageId: string,
): ResolveResult {
  const pkg = sharePackageById(packageId);
  if (!pkg) return { status: "refused", reason: "unknown_token" };
  if (pkg.recipient.kind !== "organization" || pkg.recipient.organizationId !== organizationId) {
    // Not "forbidden": a carrier may not learn that another carrier's share
    // exists, so the answer is the same one an invented id gets.
    return { status: "refused", reason: "unknown_token" };
  }
  if (pkg.revokedAt) return { status: "refused", reason: "revoked" };
  if (!isShareUsable(pkg)) return { status: "refused", reason: "expired" };

  const opened = putSharePackage({
    ...pkg,
    accessCount: pkg.accessCount + 1,
    lastAccessedAt: iso(now()),
  });
  const withEvent = append(opened, event("opened", `Opened by ${pkg.recipient.organizationName}`, {
    organizationId,
  }));
  return { status: "ok", pkg: withEvent, view: packageView(withEvent) };
}

/**
 * The recipient organization's own review of one shared document.
 *
 * It is recorded on THAT ORGANIZATION'S link — a link created here if the
 * document has none for them — so it is their opinion, scoped to them, and it
 * leaves the driver's own link and the record's ownership untouched. A second
 * carrier reviewing the same licence reaches its own answer.
 */
export function recordShareReview(
  organizationId: string,
  organizationName: string,
  packageId: string,
  documentId: string,
  outcome: "accepted" | "rejected",
  reviewerName: string,
  reason?: string,
): { status: "ok" } | { status: "refused"; reason: SharePackageRefusal } {
  const pkg = sharePackageById(packageId);
  if (!pkg || pkg.recipient.kind !== "organization" || pkg.recipient.organizationId !== organizationId) {
    return { status: "refused", reason: "unknown_token" };
  }
  if (!isShareUsable(pkg)) return { status: "refused", reason: pkg.revokedAt ? "revoked" : "expired" };
  const item = pkg.items.find((i) => i.documentId === documentId);
  if (!item) return { status: "refused", reason: "not_in_package" };

  const record = documentById(documentId);
  if (!record) return { status: "refused", reason: "not_in_package" };

  const existing = record.links.find(
    (l) => !l.unlinkedAt && l.contextOrganizationId === organizationId,
  );
  if (!existing) {
    const own = record.links.find((l) => l.primary) ?? record.links[0];
    addLink(record.documentId, {
      subject: own.subject,
      requirementKey: own.requirementKey,
      contextOrganizationId: organizationId,
      contextOrganizationName: organizationName,
      actorName: reviewerName,
    });
  }
  const refreshed = documentById(documentId)!;
  const link = refreshed.links.find(
    (l) => !l.unlinkedAt && l.contextOrganizationId === organizationId,
  )!;
  // The review is written on the recipient's link only. The driver's link, the
  // record's owner and every other organization's link are untouched.
  updateLinkReview(refreshed, link.id, outcome, reviewerName, reason);

  append(pkg, event("review_recorded", `${organizationName} ${outcome} ${item.label}`, {
    organizationId,
    documentId,
    actorName: reviewerName,
  }));
  return { status: "ok" };
}

function updateLinkReview(
  record: DocumentRecord,
  linkId: string,
  outcome: "accepted" | "rejected",
  reviewerName: string,
  reason?: string,
) {
  const at = iso(now());
  const links = record.links.map((l) =>
    l.id === linkId
      ? {
        ...l,
        review: outcome === "accepted"
          ? { state: "approved" as const, reviewedAt: at, reviewedByName: reviewerName }
          : {
            state: "rejected" as const,
            reviewedAt: at,
            reviewedByName: reviewerName,
            rejectionReason: reason,
          },
      }
      : l,
  );
  // Written through the store's own updater so history and invariants hold.
  updateDocument(record.documentId, { links });
}

/* -------------------------------------------------------------------------- */
/* Revocation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Withdraws a share. Nothing is deleted.
 *
 * The package, its items and its whole history stay readable — what a carrier
 * saw and when it saw it is exactly the sort of thing a driver may need to
 * prove later. What stops is access from this moment on.
 *
 * ★ REVOKING THE GRANT IS NOT ENOUGH, AND THIS IS WHY ★
 * A recipient organization that reviewed a shared document holds TWO things:
 * the `DocumentShare` the driver granted, and its own `DocumentLink` carrying
 * its review. The Document Center serves a document to an organization that
 * holds EITHER. So revoking only the share left the carrier reading the
 * document through its own review link afterwards — the driver pressed
 * "withdraw" and nothing they could see actually stopped.
 *
 * So both end. The link is ENDED, not deleted: `endLink` keeps the row, the
 * review on it and the whole history, exactly as a relationship ending already
 * did through `endRelationshipDocuments`. The two paths now agree, which they
 * did not before.
 *
 * What survives is what should: a carrier that ADOPTED a version into its
 * qualification file keeps that record, and reaches it through the
 * qualification file behind `qualification:view` rather than through ordinary
 * document access. Unadopted access ends outright. See
 * `docs/driver-qualification-custody.md`.
 */
export function revokeSharePackage(
  packageId: string,
  reason: string,
  actorName: string,
): DocumentSharePackage | undefined {
  const pkg = sharePackageById(packageId);
  if (!pkg) return undefined;
  if (pkg.revokedAt) return pkg;

  const revoked = putSharePackage({
    ...pkg,
    revokedAt: iso(now()),
    revokedReason: reason.trim() || "Withdrawn by the driver.",
  });

  if (pkg.recipient.kind === "organization") {
    const organizationId = pkg.recipient.organizationId;
    for (const item of pkg.items) {
      for (const share of sharesForLineage(item.lineageId)) {
        if (share.revokedAt) continue;
        if (share.sharedWithOrganizationId !== organizationId) continue;
        if (share.basis.kind !== "driver_share" || share.basis.id !== pkg.id) continue;
        revokeShare(share.id, revoked.revokedReason!, actorName);
      }
      endRecipientAccess(item.lineageId, organizationId, revoked.revokedReason!, actorName);
    }
  }
  return append(revoked, event("revoked", revoked.revokedReason!, { actorName }));
}

/**
 * Ends the recipient's own review link on a lineage, once nothing else gives it
 * access.
 *
 * "Nothing else" has to mean BOTH access paths, and that is easy to get wrong.
 * A driver who shares the same licence with one carrier twice produces two
 * packages and only ONE `DocumentShare`: `grantNativeAccess` deliberately does
 * not grant a lineage twice. So checking live grants alone would cut the
 * carrier off the moment the first package was withdrawn, while the second was
 * still issued, still usable and still openable. Both are checked.
 *
 * Every version is walked, not just the current one, because a link lives on
 * the version it was made against and a replacement leaves the older version
 * holding its own.
 */
function endRecipientAccess(
  lineageId: string,
  organizationId: string,
  reason: string,
  actorName: string,
) {
  const stillGranted = sharesForLineage(lineageId).some(
    (s) => !s.revokedAt && s.sharedWithOrganizationId === organizationId,
  );
  if (stillGranted) return;

  const stillShared = sharePackagesForOrganization(organizationId).some(
    (p) => isShareUsable(p) && p.items.some((i) => i.lineageId === lineageId),
  );
  if (stillShared) return;

  for (const version of lineageVersions(lineageId)) {
    for (const link of version.links) {
      if (link.unlinkedAt) continue;
      if (link.contextOrganizationId !== organizationId) continue;
      endLink(version.documentId, link.id, reason, actorName);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Driver-side reads                                                           */
/* -------------------------------------------------------------------------- */

export function packagesForDriver(driverProfileId: string): DocumentSharePackage[] {
  return sharePackagesForDriver(driverProfileId);
}

/**
 * Shares whose pinned version is no longer the driver's current one.
 *
 * Replacing a licence does not reach back into what a carrier already
 * reviewed — that history is theirs and stays true — so the driver is told
 * plainly that the carrier is holding an older version and may issue a fresh
 * share. Nothing is substituted silently.
 */
export function packagesNeedingRefresh(driverProfileId: string): DocumentSharePackage[] {
  return packagesForDriver(driverProfileId).filter((pkg) => {
    if (!isShareUsable(pkg)) return false;
    return pkg.items.some((item) => {
      const current = documentsForSubject("driver", pkg.driverProfileId).find(
        (r) => r.lineageId === item.lineageId,
      );
      return current !== undefined && current.documentId !== item.documentId;
    });
  });
}

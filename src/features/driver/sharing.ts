import type {
  DocumentSharePackage, DriverDocument, SharePurpose, ShareRecipient,
} from "@/types";
import {
  createSharePackage, isValidRecipientEmail, isShareUsable, openSharedPackage,
  packagesForDriver, packagesNeedingRefresh, recordDelivery, revokeSharePackage,
  shareState,
} from "@/lib/api/mock/document-shares";
import { documentInSlot } from "@/lib/api/mock/document-store";
import { driverProfileSync, mockListDocuments } from "./mock-driver";

/**
 * The driver's side of sharing, in the driver's own terms.
 *
 * A driver is not an organization, so none of this can go through the
 * organization-scoped Document Center service — the same reason their documents
 * are read through `mock-driver` rather than through `mockDocumentsService`.
 * What it does NOT do is hold any truth: documents come from the one document
 * store, packages from the one share service, and this module only turns
 * checklist rows into canonical document ids and back.
 */

export interface ShareableDocument {
  requirementKey: string;
  documentId: string;
  label: string;
  fileName?: string;
  status: DriverDocument["status"];
  expiresAt?: string;
}

/** Only documents that actually have something to show are shareable. */
export async function shareableDocuments(): Promise<ShareableDocument[]> {
  const profile = driverProfileSync();
  if (!profile) return [];
  const rows = await mockListDocuments();
  return rows
    .filter((row) => Boolean(row.fileName))
    .map((row) => {
      const record = documentInSlot("driver", profile.id, row.requirementKey);
      return {
        requirementKey: row.requirementKey,
        // The canonical VERSION id, which is what a share pins.
        documentId: record?.documentId ?? row.documentId ?? "",
        label: row.requirementKey,
        fileName: row.fileName,
        status: row.status,
        expiresAt: row.expiresAt,
      };
    })
    .filter((row) => Boolean(row.documentId));
}

export type DriverShareResult =
  | { status: "ok"; pkg: DocumentSharePackage; delivery?: "recorded" | "failed" }
  | { status: "no-profile" }
  | { status: "no-documents" }
  | { status: "invalid-email" };

export interface DriverShareInput {
  documentIds: string[];
  recipient: ShareRecipient;
  purpose: SharePurpose;
  note?: string;
}

/**
 * Creates the share, and for an external address records a delivery attempt.
 *
 * Delivery is a record that a message is owed, never a claim that one was
 * sent — the screens say "mock delivery" and so does the audit trail.
 */
export function createDriverShare(input: DriverShareInput): DriverShareResult {
  const profile = driverProfileSync();
  if (!profile) return { status: "no-profile" };
  if (input.documentIds.length === 0) return { status: "no-documents" };
  if (input.recipient.kind === "external" && !isValidRecipientEmail(input.recipient.email)) {
    return { status: "invalid-email" };
  }

  const result = createSharePackage({
    driverProfileId: profile.id,
    driverName: profile.legalName,
    documentIds: input.documentIds,
    recipient: input.recipient,
    purpose: input.purpose,
    note: input.note,
  });

  if (result.status === "invalid-email") return { status: "invalid-email" };
  if (result.status !== "ok") return { status: "no-documents" };

  if (input.recipient.kind === "external") {
    const delivery = recordDelivery(result.pkg.id);
    return { status: "ok", pkg: result.pkg, delivery: delivery.status === "recorded" ? "recorded" : "failed" };
  }
  return { status: "ok", pkg: result.pkg };
}

export function driverShares(): DocumentSharePackage[] {
  const profile = driverProfileSync();
  return profile ? packagesForDriver(profile.id) : [];
}

export function driverSharesNeedingRefresh(): DocumentSharePackage[] {
  const profile = driverProfileSync();
  return profile ? packagesNeedingRefresh(profile.id) : [];
}

export function revokeDriverShare(packageId: string, reason: string): DocumentSharePackage | undefined {
  const profile = driverProfileSync();
  if (!profile) return undefined;
  const pkg = driverShares().find((p) => p.id === packageId);
  // A driver may withdraw their own share and nobody else's.
  if (!pkg) return undefined;
  return revokeSharePackage(packageId, reason, profile.legalName);
}

export { isShareUsable, openSharedPackage, shareState };

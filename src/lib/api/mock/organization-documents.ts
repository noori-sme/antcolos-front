import { workspaceRequirementKey } from "@/lib/documents/requirements";
import { documentType } from "@/lib/documents/catalog";
import type { DocumentStatus, DocumentTypeKey, WorkspaceKind } from "@/types";
import {
  clearDocumentsForSubjectKind, createDocument, documentsOwnedBy, shareDocument, slotKey,
} from "./document-store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The workspaces' OWN paperwork: a carrier's authority and insurance, a
 * dispatch organization's E&O and service agreement, an individual
 * dispatcher's photo ID.
 *
 * Until now nothing held these — they were the gap in the four existing
 * document surfaces. They are seeded into the same store as trucks, trailers
 * and drivers, which is what makes "one Document Center" a fact rather than a
 * screen that reads from four places.
 */

const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

export interface WorkspaceFixture {
  organizationId: string;
  name: string;
  kind: WorkspaceKind;
  documents: Array<{
    typeKey: DocumentTypeKey;
    status: DocumentStatus;
    fileName: string;
    expiresAt?: string;
    rejectionReason?: string;
    createdAt: string;
  }>;
}

/**
 * Deliberately incomplete in places.
 *
 * A workspace with every box ticked proves nothing. These leave real gaps —
 * a missing voided check, a rejected E&O certificate, an expiring drug and
 * alcohol enrolment — because missing, rejected and expiring are the states
 * the Document Center exists to surface.
 */
export const WORKSPACE_FIXTURES: WorkspaceFixture[] = [
  {
    organizationId: "org_northline",
    name: "Northline Freight",
    kind: "carrier_organization",
    documents: [
      { typeKey: "operating_authority", status: "approved", fileName: "northline-authority.pdf", createdAt: daysAgo(400) },
      { typeKey: "mc_authority_letter", status: "approved", fileName: "mc-1142908.pdf", createdAt: daysAgo(400) },
      { typeKey: "w9", status: "approved", fileName: "northline-w9-2026.pdf", createdAt: daysAgo(120) },
      { typeKey: "business_registration", status: "approved", fileName: "northline-articles.pdf", createdAt: daysAgo(400) },
      // Expiring soon: approved with a near date. The state is derived.
      { typeKey: "certificate_of_insurance", status: "approved", fileName: "northline-coi.pdf", expiresAt: daysFromNow(26), createdAt: daysAgo(340) },
      { typeKey: "ifta_license", status: "approved", fileName: "northline-ifta-2026.pdf", expiresAt: daysFromNow(190), createdAt: daysAgo(60) },
      // Expired: approved with a date that has passed.
      { typeKey: "drug_alcohol_policy", status: "approved", fileName: "consortium-enrolment.pdf", expiresAt: daysFromNow(-12), createdAt: daysAgo(380) },
      // Nothing on file for the voided check: the checklist reports it missing,
      // and there is no document row for it, because a requirement is not a
      // document.
    ],
  },
  {
    organizationId: "org_baxter",
    name: "Baxter Transit",
    kind: "carrier_organization",
    documents: [
      { typeKey: "operating_authority", status: "approved", fileName: "baxter-authority.pdf", createdAt: daysAgo(300) },
      { typeKey: "mc_authority_letter", status: "approved", fileName: "mc-1098447.pdf", createdAt: daysAgo(300) },
      { typeKey: "certificate_of_insurance", status: "approved", fileName: "baxter-coi.pdf", expiresAt: daysFromNow(150), createdAt: daysAgo(200) },
      { typeKey: "w9", status: "approved", fileName: "baxter-w9.pdf", createdAt: daysAgo(300) },
      { typeKey: "business_registration", status: "approved", fileName: "baxter-articles.pdf", createdAt: daysAgo(300) },
      { typeKey: "voided_check", status: "pending_review", fileName: "baxter-ach.pdf", createdAt: daysAgo(3) },
      { typeKey: "ifta_license", status: "approved", fileName: "baxter-ifta.pdf", expiresAt: daysFromNow(120), createdAt: daysAgo(90) },
      { typeKey: "drug_alcohol_policy", status: "approved", fileName: "baxter-consortium.pdf", expiresAt: daysFromNow(220), createdAt: daysAgo(140) },
    ],
  },
  {
    organizationId: "org_cascade",
    name: "Cascade Haul",
    kind: "carrier_organization",
    documents: [
      { typeKey: "operating_authority", status: "approved", fileName: "cascade-authority.pdf", createdAt: daysAgo(260) },
      { typeKey: "certificate_of_insurance", status: "approved", fileName: "cascade-coi.pdf", expiresAt: daysFromNow(95), createdAt: daysAgo(180) },
      { typeKey: "w9", status: "approved", fileName: "cascade-w9.pdf", createdAt: daysAgo(260) },
    ],
  },
  {
    organizationId: "org_meridian",
    name: "Meridian Dispatch",
    kind: "dispatch_organization",
    documents: [
      { typeKey: "business_registration", status: "approved", fileName: "meridian-incorporation.pdf", createdAt: daysAgo(200) },
      { typeKey: "w9", status: "approved", fileName: "meridian-w9.pdf", createdAt: daysAgo(200) },
      { typeKey: "dispatch_service_agreement", status: "approved", fileName: "meridian-dispatch-agreement.pdf", createdAt: daysAgo(180) },
      { typeKey: "errors_omissions_insurance", status: "approved", fileName: "meridian-eo.pdf", expiresAt: daysFromNow(38), createdAt: daysAgo(160) },
      { typeKey: "voided_check", status: "approved", fileName: "meridian-ach.pdf", createdAt: daysAgo(200) },
    ],
  },
  {
    organizationId: "org_summit",
    name: "Summit Dispatch",
    kind: "dispatch_organization",
    documents: [
      { typeKey: "business_registration", status: "approved", fileName: "summit-llc.pdf", createdAt: daysAgo(30) },
      { typeKey: "w9", status: "pending_review", fileName: "summit-w9.pdf", createdAt: daysAgo(4) },
      // A rejected document with a reason a person can actually act on.
      { typeKey: "errors_omissions_insurance", status: "rejected", fileName: "summit-eo-quote.pdf", createdAt: daysAgo(6),
        rejectionReason: "This is a quote, not a policy. Send the bound certificate showing the policy number and the period of cover." },
      // Missing: the dispatch service agreement and the voided check.
    ],
  },
  {
    organizationId: "org_solo",
    name: "Sam Murtaza Dispatch",
    kind: "individual_dispatcher",
    documents: [
      { typeKey: "government_id", status: "approved", fileName: "sam-drivers-licence.jpg", expiresAt: daysFromNow(410), createdAt: daysAgo(20) },
      { typeKey: "w9", status: "approved", fileName: "sam-w9.pdf", createdAt: daysAgo(20) },
      { typeKey: "voided_check", status: "selected_local", fileName: "sam-voided-check.jpg", createdAt: daysAgo(1) },
      // Missing: the dispatch service agreement. Business registration is
      // OPTIONAL here and absent, which is a valid answer for one person
      // working as themselves — it must never read as a failure.
    ],
  },
];

/**
 * Seeds every workspace's own paperwork, and the cross-organization shares.
 *
 * Shares are the only way a dispatch organization sees a carrier's documents,
 * so the fixtures include real ones: Baxter, whose trucks Meridian dispatches,
 * shares exactly the two documents a dispatcher is asked for by brokers — and
 * nothing else.
 */
export function seedOrganizationDocuments() {
  clearDocumentsForSubjectKind("organization");

  for (const workspace of WORKSPACE_FIXTURES) {
    for (const row of workspace.documents) {
      const meta = documentType(row.typeKey);
      createDocument({
        owner: { kind: "organization", id: workspace.organizationId, name: workspace.name },
        organizationId: workspace.organizationId,
        typeKey: row.typeKey,
        subject: {
          kind: "organization",
          id: workspace.organizationId,
          label: workspace.name,
          href: "/documents",
        },
        requirementKey: workspaceRequirementKey(workspace.kind, row.typeKey),
        contextOrganizationId: workspace.organizationId,
        contextOrganizationName: workspace.name,
        status: row.status,
        file: {
          fileName: row.fileName,
          fileType: row.fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
          sizeBytes: 640_000,
          selectedAt: row.createdAt,
        },
        expiresAt: meta.expires ? row.expiresAt : undefined,
        addedByName: workspace.name,
        createdAt: row.createdAt,
        idSeed: slotKey(
          "organization",
          workspace.organizationId,
          workspaceRequirementKey(workspace.kind, row.typeKey),
        ),
        reviewedAt: row.createdAt,
        reviewedByName: workspace.name,
        rejectionReason: row.rejectionReason,
      });
    }
  }

  seedShares();
}

/** Finds a seeded workspace document by its type, for the share fixtures. */
function lineageOf(organizationId: string, typeKey: DocumentTypeKey): string | undefined {
  const workspace = WORKSPACE_FIXTURES.find((w) => w.organizationId === organizationId);
  if (!workspace) return undefined;
  const key = workspaceRequirementKey(workspace.kind, typeKey);
  // The store is the source of truth; this looks the record back up by slot.
  return documentsOwnedBy(organizationId).find((d) =>
    d.links.some((l) => l.requirementKey === key && !l.unlinkedAt),
  )?.lineageId;
}

function seedShares() {
  // Meridian dispatches Baxter's trucks. Baxter shares the two documents a
  // dispatcher genuinely needs to book freight on its authority — its
  // insurance certificate and its authority letter — and nothing else. Its
  // W-9, bank details and IFTA licence are not a dispatcher's business.
  const coi = lineageOf("org_baxter", "certificate_of_insurance");
  const authority = lineageOf("org_baxter", "mc_authority_letter");

  if (coi) {
    shareDocument({
      lineageId: coi,
      sharedWithOrganizationId: "org_meridian",
      sharedWithName: "Meridian Dispatch",
      basis: { kind: "dispatch_access", id: "baxter_meridian", label: "Meridian dispatches Baxter units A-12 and A-18" },
      purpose: "Brokers ask for the carrier's insurance certificate before a load is tendered.",
      canDownload: true,
      grantedByName: "Baxter Transit",
      grantedAt: daysAgo(118),
      organizationId: "org_baxter",
    });
  }
  if (authority) {
    shareDocument({
      lineageId: authority,
      sharedWithOrganizationId: "org_meridian",
      sharedWithName: "Meridian Dispatch",
      basis: { kind: "dispatch_access", id: "baxter_meridian", label: "Meridian dispatches Baxter units A-12 and A-18" },
      purpose: "Proof of authority for broker onboarding packets.",
      // Viewing and downloading are separate grants, and this one is view-only.
      canDownload: false,
      grantedByName: "Baxter Transit",
      grantedAt: daysAgo(118),
      organizationId: "org_baxter",
    });
  }
}

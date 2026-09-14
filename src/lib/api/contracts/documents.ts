import type {
  DocumentChecklistItem, DocumentEvent, DocumentRecord, DocumentRequirement,
  DocumentShare, DocumentShareBasis, DocumentSnapshot, DocumentStatus,
  DocumentSubjectKind, DocumentSubjectRef, DocumentTypeKey, RequirementSet,
  WorkspaceKind,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * The Document Center seam.
 *
 * Every method takes a ServiceContext, so a call is always made *as a
 * membership, inside an organization*. There is no method that accepts an
 * organization id from the caller — an organization a membership does not
 * belong to is not addressable through this interface at all.
 *
 * Uploads are mock-only in this build. `addDocument` records the file name,
 * type and size the browser reported and nothing else: no file is stored,
 * transmitted, read, extracted, OCR-processed, verified or submitted anywhere.
 */

export interface DocumentFilters {
  /** Free text over label, file name, subject label and type. */
  search?: string;
  status?: DocumentStatus[];
  typeKey?: DocumentTypeKey[];
  subjectKind?: DocumentSubjectKind[];
  /** Narrow to one entity — one truck, one driver. */
  subjectId?: string;
  /** Include documents another organization shared with this one. */
  includeShared?: boolean;
  /** Include superseded versions. Off by default: they are history, not work. */
  includeSuperseded?: boolean;
  /** Only documents expiring within this many days. */
  expiringWithinDays?: number;
}

/** A document as one organization is entitled to see it. */
export interface DocumentView {
  document: DocumentRecord;
  /** Expiry applied. What the row actually says. */
  status: DocumentStatus;
  /** The requirement this fills for the viewer, when it fills one. */
  requirement?: DocumentRequirement;
  /** The subject this viewer sees it under. */
  subject: DocumentSubjectRef;
  /** True when the viewer sees it because another organization shared it. */
  shared: boolean;
  /** Present when shared: why, and what the viewer may do with it. */
  share?: DocumentShare;
  /** False for a shared document the granter did not allow downloading. */
  canDownload: boolean;
  /** Whether this membership may review it. Sharing never confers review. */
  canReview: boolean;
  versionCount: number;
}

export interface DocumentDetail extends DocumentView {
  /** Every version, newest first. */
  versions: DocumentRecord[];
  history: DocumentEvent[];
  /** Grants the viewer's organization made. Never another organization's. */
  shares: DocumentShare[];
  snapshots: DocumentSnapshot[];
}

/** One workspace's or one entity's checklist, joined to what is on file. */
export interface ChecklistView {
  set: RequirementSet;
  items: DocumentChecklistItem[];
  required: number;
  satisfied: number;
  percent: number;
}

export interface AddDocumentInput {
  typeKey: DocumentTypeKey;
  subject: DocumentSubjectRef;
  requirementKey?: string;
  /** Name, type and size as the browser reported them. Nothing is uploaded. */
  file: { name: string; type: string; size: number };
  expiresAt?: string;
}

export interface ShareDocumentInput {
  documentId: string;
  withOrganizationId: string;
  basis: DocumentShareBasis;
  purpose: string;
  canDownload: boolean;
}

export interface LinkDocumentInput {
  documentId: string;
  subject: DocumentSubjectRef;
  requirementKey?: string;
}

/**
 * What an individual dispatch workspace would have to do to become a dispatch
 * organization — computed, not guessed, and never performed as a side effect.
 */
export interface WorkspaceUpgradePlan {
  from: WorkspaceKind;
  to: WorkspaceKind;
  /** Already held and still applicable. Nothing is re-requested. */
  carriedForward: DocumentChecklistItem[];
  /** Applicable to the new workspace type and not yet held. */
  newlyRequired: DocumentRequirement[];
  /** Held, but no longer asked for. Kept, never deleted. */
  noLongerRequired: DocumentChecklistItem[];
}

export interface DocumentsService {
  /** Documents this organization may see. Never another organization's. */
  list(ctx: ServiceContext, filters?: DocumentFilters): Promise<DocumentView[]>;
  get(ctx: ServiceContext, documentId: string): Promise<DocumentDetail>;

  /**
   * The workspace's own checklist.
   *
   * It takes no workspace-kind argument on purpose: the kind comes from the
   * context, so a dispatch organization cannot ask for a carrier's checklist
   * and a carrier cannot be handed a dispatcher's.
   */
  workspaceChecklist(ctx: ServiceContext): Promise<ChecklistView>;
  /** An entity's checklist: one driver, one truck, one trailer. */
  entityChecklist(
    ctx: ServiceContext,
    subject: DocumentSubjectRef,
    setHint?: { equipment?: string; engagement?: string },
  ): Promise<ChecklistView>;

  addDocument(ctx: ServiceContext, input: AddDocumentInput): Promise<DocumentView>;
  /** Creates a NEW version. The old one is kept, with its whole history. */
  replaceDocument(ctx: ServiceContext, documentId: string, input: Omit<AddDocumentInput, "subject" | "requirementKey" | "typeKey">): Promise<DocumentView>;
  submitForReview(ctx: ServiceContext, documentId: string): Promise<DocumentView>;
  approve(ctx: ServiceContext, documentId: string): Promise<DocumentView>;
  reject(ctx: ServiceContext, documentId: string, reason: string): Promise<DocumentView>;
  setExpiry(ctx: ServiceContext, documentId: string, expiresAt: string): Promise<DocumentView>;

  /** Attach an existing document to another context instead of duplicating it. */
  link(ctx: ServiceContext, input: LinkDocumentInput): Promise<DocumentView>;

  share(ctx: ServiceContext, input: ShareDocumentInput): Promise<DocumentShare>;
  revokeShare(ctx: ServiceContext, shareId: string, reason: string): Promise<DocumentShare>;
  /** Grants this organization has made. Not grants it has received. */
  listShares(ctx: ServiceContext): Promise<DocumentShare[]>;

  upgradePlan(ctx: ServiceContext, to: WorkspaceKind): Promise<WorkspaceUpgradePlan>;
}

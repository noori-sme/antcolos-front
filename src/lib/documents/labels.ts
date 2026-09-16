import type { badgeVariants } from "@/components/ui/badge";
import type {
  DocumentApplicability, DocumentEventKind, DocumentShareBasisKind,
  DocumentStatus, DocumentSubjectKind,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

/**
 * Every word the Document Center shows for a state, in one place.
 *
 * "Selected, not uploaded" is the honest label for the state this build
 * reaches, and it stays that way until files are genuinely stored.
 */
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  missing: "Missing",
  selected_local: "Selected, not uploaded",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  superseded: "Superseded",
};

export const DOCUMENT_STATUS_DESCRIPTION: Record<DocumentStatus, string> = {
  missing: "Nothing has been supplied for this requirement yet.",
  selected_local:
    "A file was chosen in the browser. Nothing was uploaded, stored, read or sent anywhere.",
  pending_review: "Handed over for review. Nobody has decided on it yet.",
  approved: "A person accepted it.",
  rejected: "A person rejected it, and said why.",
  expiring_soon: "Accepted, but the expiry date is close enough to act on.",
  expired: "The expiry date has passed. It no longer satisfies the requirement.",
  superseded: "Replaced by a newer version. Kept for the record and never deleted.",
};

export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, Tone> = {
  missing: "danger",
  selected_local: "neutral",
  pending_review: "warning",
  approved: "success",
  rejected: "danger",
  expiring_soon: "warning",
  expired: "danger",
  superseded: "neutral",
};

export const APPLICABILITY_LABEL: Record<DocumentApplicability, string> = {
  required: "Required",
  optional: "Optional",
  not_applicable: "Not applicable",
};

export const SUBJECT_KIND_LABEL: Record<DocumentSubjectKind, string> = {
  organization: "Organization",
  driver: "Driver",
  truck: "Truck",
  trailer: "Trailer",
  load: "Load",
};

export const SHARE_BASIS_LABEL: Record<DocumentShareBasisKind, string> = {
  dispatch_access: "Dispatch access",
  carrier_relationship: "Carrier relationship",
  driver_relationship: "Driver relationship",
  load: "Load",
  driver_share: "Shared by the driver",
  workspace_upgrade: "Workspace upgrade",
};

export const DOCUMENT_EVENT_LABEL: Record<DocumentEventKind, string> = {
  created: "Created",
  file_selected: "File selected",
  submitted: "Sent for review",
  approved: "Approved",
  rejected: "Rejected",
  replaced: "Replaced",
  superseded: "Superseded",
  expiry_set: "Expiry recorded",
  linked: "Linked",
  unlinked: "Link ended",
  shared: "Shared",
  share_revoked: "Share revoked",
  relationship_ended: "Relationship ended",
  carried_forward: "Carried forward",
};

export function formatDocumentDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatFileSize(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

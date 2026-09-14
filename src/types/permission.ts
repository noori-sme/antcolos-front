/** Flat, granular, composable. `domain:action`. A typo is a compile error. */
export type PermissionKey =
  // Loads
  | "loads:view" | "loads:create" | "loads:edit"
  | "loads:delete" | "loads:status:update" | "loads:export"
  // Dispatch
  | "dispatch:view" | "loads:assign"
  // Drivers
  | "drivers:view" | "drivers:create" | "drivers:edit" | "drivers:delete"
  // Trucks
  | "trucks:view" | "trucks:create" | "trucks:edit" | "trucks:delete"
  | "trucks:documents:manage" | "trucks:assignments:manage"
  | "trucks:relationships:manage" | "trucks:ownership:review"
  // Trailers — a separate module from trucks, never the same permission
  | "trailers:view" | "trailers:create" | "trailers:edit" | "trailers:delete"
  | "trailers:documents:manage" | "trailers:attachments:manage"
  | "trailers:relationships:manage" | "trailers:ownership:review"
  | "trailers:status:manage"
  // Customers
  | "customers:view" | "customers:create" | "customers:edit" | "customers:delete"
  // Documents
  | "documents:view" | "documents:upload" | "documents:download"
  | "documents:approve" | "documents:delete"
  // Settlements
  | "settlements:view" | "settlements:create" | "settlements:approve" | "settlements:export"
  // Invoices
  | "invoices:view" | "invoices:create" | "invoices:edit"
  | "invoices:send" | "invoices:export"
  // Reports
  | "reports:view" | "reports:export"
  // Accounting and financial information
  | "rates:view" | "rates:edit"
  | "revenue:view" | "expenses:view" | "profitability:view"
  // Compliance & safety
  | "compliance:view" | "compliance:manage"
  // Insurance and claims — a module of its own, never folded into compliance
  | "insurance:view" | "insurance:manage"
  | "insurance:sensitive:view" | "insurance:share:manage"
  | "claims:view" | "claims:create" | "claims:manage" | "claims:financials:view"
  // Organization members
  | "members:view" | "members:edit" | "members:suspend" | "permissions:manage"
  // Invitations
  | "invitations:view" | "invitations:create" | "invitations:resend" | "invitations:revoke"
  // Organization settings
  | "organization:manage" | "integrations:view" | "integrations:manage" | "audit:view";

/**
 * One group per product module, in the order an owner reads them: the daily
 * work first, then the money, then who is allowed in.
 */
export type PermissionGroup =
  | "loads" | "dispatch" | "drivers" | "trucks" | "trailers"
  | "customers" | "documents" | "settlements" | "invoices" | "reports"
  | "accounting" | "compliance" | "insurance" | "claims"
  | "members" | "invitations" | "organization";

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  /** Plain language. Written for an owner who has never seen a permission UI. */
  description: string;
  group: PermissionGroup;
  /** Shown with a warning before it can be granted. */
  sensitive?: boolean;
  /** Money and margin. Warned about separately and more loudly. */
  financial?: boolean;
  /** Absent = available to every organization type. */
  orgTypes?: OrganizationType[];
}

export type OrganizationType = "CARRIER" | "DISPATCH_AGENCY";

export interface PermissionTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** Seeded templates may be edited but not deleted. */
  seeded: boolean;
}

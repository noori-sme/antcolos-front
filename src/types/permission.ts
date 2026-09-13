/** Flat, granular, composable. `domain:action`. A typo is a compile error. */
export type PermissionKey =
  // Loads
  | "loads:view" | "loads:create" | "loads:edit"
  | "loads:delete" | "loads:assign" | "loads:status:update"
  // Money — separated from loads so a dispatcher can work without seeing margin
  | "rates:view" | "rates:edit"
  | "revenue:view" | "expenses:view"
  | "settlements:view" | "settlements:create" | "settlements:export"
  | "invoices:view" | "invoices:create"
  // People & equipment
  | "drivers:view" | "drivers:manage"
  | "equipment:view" | "equipment:manage"
  // Documents
  | "documents:view" | "documents:upload" | "documents:approve"
  // Compliance & safety
  | "compliance:view" | "compliance:manage"
  // Customers
  | "customers:view" | "customers:manage"
  // Platform
  | "integrations:view" | "integrations:manage"
  | "users:view" | "users:invite" | "users:suspend"
  | "permissions:manage"
  | "audit:view"
  | "organization:manage";

export type PermissionGroup =
  | "loads" | "money" | "people" | "equipment"
  | "documents" | "compliance" | "customers" | "platform";

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  description: string;
  group: PermissionGroup;
  /** Requires a second confirmation before it can be granted. */
  sensitive?: boolean;
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

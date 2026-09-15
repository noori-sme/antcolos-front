/** Flat, granular, composable. `domain:action`. A typo is a compile error. */
export type PermissionKey =
  // Loads
  | "loads:view" | "loads:create" | "loads:edit"
  | "loads:delete" | "loads:status:update" | "loads:export"
  // Dispatch
  | "dispatch:view" | "loads:assign"
  // Tracking — watching a load run, and letting a customer watch a little of it.
  // Seeing where a truck is, sharing that outside the organization, and sending
  // an update to a broker are three different powers and three different keys.
  | "tracking:view" | "tracking:share" | "tracking:update:send"
  // Driver decision and trip workflow
  | "proposals:view" | "proposals:respond" | "trips:execute"
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
  // Fleet operations — the shared layer over trucks, trailers and drivers.
  // Deliberately small: assigning and attaching already have their own keys in
  // the modules that own those records, and duplicating them here would create
  // two permissions that can disagree about one action.
  | "fleet:view" | "fleet:telemetry:record"
  // Customers
  | "customers:view" | "customers:create" | "customers:edit" | "customers:delete"
  | "customers:private:manage" | "customers:resolve"
  // Documents
  | "documents:view" | "documents:upload" | "documents:download"
  | "documents:approve" | "documents:delete"
  // Settlements
  | "settlements:view" | "settlements:create" | "settlements:approve" | "settlements:export"
  | "settlements:dispute" | "settlements:dispute:resolve" | "settlements:adjust"
  | "settlements:pay" | "settlements:void"
  // Invoices
  | "invoices:view" | "invoices:create" | "invoices:edit"
  | "invoices:send" | "invoices:export"
  // Reports
  | "reports:view" | "reports:export"
  // Accounting and financial information
  | "rates:view" | "rates:edit"
  | "revenue:view" | "expenses:view" | "profitability:view"
  // Fuel and IFTA — a fuel purchase and a mileage record are separate powers
  | "fuel:view" | "fuel:record" | "fuel:import"
  | "fuel:review" | "fuel:correct" | "fuel:export" | "fuel:costs:view"
  | "mileage:view" | "mileage:record" | "mileage:review"
  | "ifta:view" | "ifta:manage"
  // Compliance & safety
  | "compliance:view" | "compliance:manage"
  // Maintenance — equipment upkeep. Separate from compliance, which is paperwork.
  | "maintenance:view" | "maintenance:manage"
  | "maintenance:defects:report" | "maintenance:defects:manage"
  | "maintenance:repairs:manage" | "maintenance:service:record"
  | "maintenance:costs:view" | "maintenance:outofservice:manage"
  | "maintenance:share:manage"
  // Insurance and claims — a module of its own, never folded into compliance
  | "insurance:view" | "insurance:manage"
  | "insurance:sensitive:view" | "insurance:share:manage"
  | "claims:view" | "claims:create" | "claims:manage" | "claims:financials:view"
  // Contracts and relationships — the TERMS of a business relationship.
  // Deliberately separate from the keys that control access: `members:edit`,
  // `invitations:create` and `trucks:relationships:manage` are what actually
  // change what somebody can do. A contract permission never grants access.
  | "contracts:view" | "contracts:create" | "contracts:edit"
  | "contracts:review" | "contracts:sign" | "contracts:amend"
  | "contracts:terminate" | "contracts:cancel"
  | "contracts:signers:manage" | "contracts:requirements:waive"
  | "contracts:links:manage" | "contracts:financials:view" | "contracts:export"
  // Organization members
  | "members:view" | "members:edit" | "members:suspend" | "permissions:manage"
  // Invitations
  | "invitations:view" | "invitations:create" | "invitations:resend" | "invitations:revoke"
  // Organization settings
  | "organization:manage" | "integrations:view" | "integrations:manage" | "audit:view"
  // Audit & Risk — the one ledger, and the cases opened off it.
  //
  // Reading the ledger, reading risk, and WORKING risk are three different
  // powers on purpose: a compliance reviewer who may read everything is not
  // thereby somebody who may close an investigation into a colleague.
  | "audit:export"
  | "risk:view" | "risk:assign" | "risk:investigate" | "risk:resolve";

/**
 * One group per product module, in the order an owner reads them: the daily
 * work first, then the money, then who is allowed in.
 */
export type PermissionGroup =
  | "loads" | "dispatch" | "tracking" | "drivers" | "trucks" | "trailers" | "fleet"
  | "loads" | "dispatch" | "driver_workflow" | "drivers" | "trucks" | "trailers"
  | "customers" | "documents" | "settlements" | "invoices" | "reports"
  | "accounting" | "fuel" | "compliance"
  | "accounting" | "compliance" | "maintenance" | "insurance" | "claims"
  | "contracts"
  | "members" | "invitations" | "organization" | "audit";

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

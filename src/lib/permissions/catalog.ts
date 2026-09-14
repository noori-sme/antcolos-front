import type {
  OrganizationType,
  PermissionGroup,
  PermissionKey,
  PermissionMeta,
} from "@/types";

/**
 * THE permission catalog. Adding a key here makes it appear in the permission
 * editor, the invitation summary, the audit log and the docs — there is nowhere
 * else to register it.
 *
 * Descriptions are written for a carrier owner, not an engineer: they say what
 * the person will be able to do, in the words that owner would use.
 *
 * For Taqi: UI permission checks are user experience, not security. Hiding a
 * button prevents confusion, not attack. Every key below must be enforced
 * server-side on the matching endpoint. This catalog is the shared vocabulary.
 */
export const PERMISSION_CATALOG: readonly PermissionMeta[] = [
  // ---- Loads -------------------------------------------------------------
  { key: "loads:view", label: "View loads", description: "See loads, their stops and where they are.", group: "loads" },
  { key: "loads:create", label: "Create loads", description: "Add new loads by hand or by import.", group: "loads" },
  { key: "loads:edit", label: "Edit loads", description: "Change load details, stops and reference numbers.", group: "loads" },
  { key: "loads:status:update", label: "Update load status", description: "Move a load along — picked up, in transit, delivered.", group: "loads" },
  { key: "loads:export", label: "Download loads", description: "Export load lists out of Antcolos as a file.", group: "loads" },
  { key: "loads:delete", label: "Delete loads", description: "Permanently remove a load and its history.", group: "loads", sensitive: true },

  // ---- Dispatch ----------------------------------------------------------
  { key: "dispatch:view", label: "Open the dispatch board", description: "See the planning board of trucks and available freight.", group: "dispatch" },
  { key: "loads:assign", label: "Assign loads", description: "Put a driver, truck and trailer on a load.", group: "dispatch" },

  // ---- Driver decision and trip workflow ---------------------------------
  { key: "proposals:view", label: "See load proposals", description: "See load opportunities dispatch sends you before they are booked.", group: "driver_workflow" },
  { key: "proposals:respond", label: "Answer load proposals", description: "Approve, reject, pause, comment on or counter a load proposal.", group: "driver_workflow" },
  { key: "trips:execute", label: "Run the trip workflow", description: "Record trip milestones, fuel, rest and other operational updates, and attach the paperwork they produce.", group: "driver_workflow" },

  // ---- Drivers -----------------------------------------------------------
  { key: "drivers:view", label: "View drivers", description: "See driver records, contact details and availability.", group: "drivers" },
  { key: "drivers:create", label: "Add drivers", description: "Create a new driver record.", group: "drivers" },
  { key: "drivers:edit", label: "Edit drivers", description: "Change driver details and mark them active or inactive.", group: "drivers" },
  { key: "drivers:delete", label: "Delete drivers", description: "Permanently remove a driver record.", group: "drivers", sensitive: true },

  // ---- Trucks ------------------------------------------------------------
  { key: "trucks:view", label: "View trucks", description: "See trucks, where they are and when they come empty.", group: "trucks" },
  { key: "trucks:create", label: "Add trucks", description: "Add a truck to the fleet.", group: "trucks", orgTypes: ["CARRIER"] },
  { key: "trucks:edit", label: "Edit trucks", description: "Change truck details and status.", group: "trucks", orgTypes: ["CARRIER"] },
  { key: "trucks:delete", label: "Delete trucks", description: "Permanently remove a truck.", group: "trucks", sensitive: true, orgTypes: ["CARRIER"] },
  { key: "trucks:documents:manage", label: "Manage truck documents", description: "Add, replace and review registration, title, insurance and inspection paperwork.", group: "trucks" },
  { key: "trucks:assignments:manage", label: "Assign drivers to trucks", description: "Put a driver on a truck, swap them, or end the assignment.", group: "trucks" },
  { key: "trucks:relationships:manage", label: "Manage truck carrier relationships", description: "Connect a truck to this organization, or end that connection.", group: "trucks", sensitive: true },
  { key: "trucks:ownership:review", label: "Review truck ownership claims", description: "Decide who legally owns a truck when somebody claims it. The strongest truck permission there is.", group: "trucks", sensitive: true },

  // ---- Trailers ----------------------------------------------------------
  { key: "trailers:view", label: "View trailers", description: "See trailers and what they are attached to.", group: "trailers" },
  { key: "trailers:create", label: "Add trailers", description: "Add a trailer to the fleet.", group: "trailers", orgTypes: ["CARRIER"] },
  { key: "trailers:edit", label: "Edit trailers", description: "Change trailer details and status.", group: "trailers", orgTypes: ["CARRIER"] },
  { key: "trailers:delete", label: "Delete trailers", description: "Permanently remove a trailer.", group: "trailers", sensitive: true, orgTypes: ["CARRIER"] },
  { key: "trailers:documents:manage", label: "Manage trailer documents", description: "Add, replace and review registration, title, insurance and inspection paperwork for trailers.", group: "trailers" },
  { key: "trailers:attachments:manage", label: "Attach and detach trailers", description: "Put a trailer on a power unit, reserve one, move it to another, or unhook it.", group: "trailers" },
  { key: "trailers:relationships:manage", label: "Manage trailer carrier relationships", description: "Connect a trailer to this organization, take operating authority over it, or end that connection.", group: "trailers", sensitive: true },
  { key: "trailers:status:manage", label: "Change trailer status and availability", description: "Mark a trailer available, loaded, in maintenance or out of service, and set where it will be free.", group: "trailers" },
  { key: "trailers:ownership:review", label: "Review trailer ownership claims", description: "Decide who legally owns a trailer when somebody claims it. The strongest trailer permission there is.", group: "trailers", sensitive: true },

  // ---- Customers ---------------------------------------------------------
  { key: "customers:view", label: "View customers", description: "See the brokers and shippers you haul for.", group: "customers" },
  { key: "customers:create", label: "Add customers", description: "Add a new broker or shipper.", group: "customers" },
  { key: "customers:edit", label: "Edit customers", description: "Change customer details and contacts.", group: "customers" },
  { key: "customers:delete", label: "Delete customers", description: "Permanently remove a customer record.", group: "customers", sensitive: true },

  // ---- Documents ---------------------------------------------------------
  { key: "documents:view", label: "View documents", description: "Open uploaded paperwork such as BOLs and PODs.", group: "documents" },
  { key: "documents:upload", label: "Upload documents", description: "Attach paperwork to a load or a driver.", group: "documents" },
  { key: "documents:download", label: "Download documents", description: "Save copies of paperwork onto their own device.", group: "documents" },
  { key: "documents:approve", label: "Approve documents", description: "Accept or reject paperwork someone submitted.", group: "documents" },
  { key: "documents:delete", label: "Delete documents", description: "Permanently remove uploaded paperwork.", group: "documents", sensitive: true },

  // ---- Settlements -------------------------------------------------------
  { key: "settlements:view", label: "View settlements", description: "See driver pay statements.", group: "settlements" },
  { key: "settlements:create", label: "Create settlements", description: "Build pay periods and add pay lines.", group: "settlements" },
  { key: "settlements:approve", label: "Approve settlements", description: "Sign off a settlement so it can be paid.", group: "settlements", sensitive: true, financial: true },
  { key: "settlements:export", label: "Download settlements", description: "Export pay statements out of Antcolos.", group: "settlements", sensitive: true, financial: true },

  // ---- Invoices ----------------------------------------------------------
  { key: "invoices:view", label: "View invoices", description: "See customer invoices and what is unpaid.", group: "invoices" },
  { key: "invoices:create", label: "Create invoices", description: "Invoice a customer for delivered freight.", group: "invoices" },
  { key: "invoices:edit", label: "Edit invoices", description: "Change an invoice before it is sent.", group: "invoices" },
  { key: "invoices:send", label: "Send invoices", description: "Send an invoice to the customer.", group: "invoices", financial: true },
  { key: "invoices:export", label: "Download invoices", description: "Export invoices out of Antcolos.", group: "invoices", sensitive: true, financial: true },

  // ---- Reports -----------------------------------------------------------
  { key: "reports:view", label: "View reports", description: "Open performance and operations reports.", group: "reports" },
  { key: "reports:export", label: "Download reports", description: "Export reports out of Antcolos as a file.", group: "reports", sensitive: true },

  // ---- Accounting and financial information ------------------------------
  { key: "rates:view", label: "See rates", description: "See what each load pays. Without this, loads show no money at all.", group: "accounting", sensitive: true, financial: true },
  { key: "rates:edit", label: "Change rates", description: "Change what a load pays, including accessorials.", group: "accounting", sensitive: true, financial: true },
  { key: "revenue:view", label: "See revenue", description: "See total revenue across the business.", group: "accounting", sensitive: true, financial: true },
  { key: "expenses:view", label: "See expenses", description: "See what the business is spending.", group: "accounting", sensitive: true, financial: true },
  { key: "profitability:view", label: "See profit and margin", description: "See what the business actually makes after costs.", group: "accounting", sensitive: true, financial: true },

  // ---- Compliance & safety -----------------------------------------------
  { key: "compliance:view", label: "View compliance", description: "See licences, inspections and what is about to expire.", group: "compliance" },
  { key: "compliance:manage", label: "Manage compliance", description: "Record and clear compliance items.", group: "compliance" },

  // ---- Organization members ----------------------------------------------
  { key: "members:view", label: "View members", description: "See everyone who belongs to this organization.", group: "members" },
  { key: "members:edit", label: "Edit members", description: "Change someone's job title and which role they hold.", group: "members", sensitive: true },
  { key: "members:suspend", label: "Suspend members", description: "Cut off someone's access without deleting their history.", group: "members", sensitive: true },
  { key: "permissions:manage", label: "Manage roles and permissions", description: "Create roles and decide what everyone is allowed to do. Anyone with this can widen their own team's access.", group: "members", sensitive: true },

  // ---- Invitations -------------------------------------------------------
  { key: "invitations:view", label: "View invitations", description: "See who has been invited and whether they accepted.", group: "invitations" },
  { key: "invitations:create", label: "Send invitations", description: "Invite new people or organizations to work with you.", group: "invitations", sensitive: true },
  { key: "invitations:resend", label: "Resend invitations", description: "Send an invitation again if it was missed.", group: "invitations" },
  { key: "invitations:revoke", label: "Revoke invitations", description: "Cancel an invitation before it is accepted.", group: "invitations" },

  // ---- Organization settings ---------------------------------------------
  { key: "organization:manage", label: "Manage organization settings", description: "Edit the organization's details and billing information.", group: "organization", sensitive: true },
  { key: "integrations:view", label: "View integrations", description: "See which outside tools are connected.", group: "organization" },
  { key: "integrations:manage", label: "Manage integrations", description: "Connect and disconnect outside tools.", group: "organization", sensitive: true },
  { key: "audit:view", label: "View audit log", description: "See the record of who changed what, and when.", group: "organization" },
] as const;

export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
  loads: "Loads",
  dispatch: "Dispatch",
  driver_workflow: "Driver proposals and trips",
  drivers: "Drivers",
  trucks: "Trucks",
  trailers: "Trailers",
  customers: "Customers",
  documents: "Documents",
  settlements: "Settlements",
  invoices: "Invoices",
  reports: "Reports",
  accounting: "Accounting and financial information",
  compliance: "Compliance & safety",
  members: "Organization members",
  invitations: "Invitations",
  organization: "Organization settings",
};

/** The reading order of the modules in every permission list. */
export const PERMISSION_GROUP_ORDER: readonly PermissionGroup[] = [
  "loads", "dispatch", "driver_workflow", "drivers", "trucks", "trailers", "customers",
  "documents", "settlements", "invoices", "reports", "accounting",
  "compliance", "members", "invitations", "organization",
] as const;

/**
 * Powers that are NOT permissions and can never be granted, delegated, put in a
 * role or attached to an invitation. They belong to the permanent Owner alone.
 *
 * They are deliberately absent from `PermissionKey`, so there is no value a
 * caller could pass to request one — the type system, not a runtime filter, is
 * what keeps them out of roles and invitations. They are listed here only so
 * the interface can tell an owner what is reserved, and so a test can assert
 * none of them ever appears in the catalog.
 */
export const NEVER_GRANTABLE: readonly { id: string; label: string; description: string }[] = [
  { id: "ownership:transfer", label: "Transfer organization ownership", description: "Handing the organization to a different owner." },
  { id: "owner:change", label: "Change or remove the permanent Owner", description: "Editing, restricting or removing the Owner role itself." },
  { id: "banking:credentials", label: "Access bank account credentials", description: "Seeing or changing the bank details money moves through." },
  { id: "security:settings", label: "Change sign-in and account security settings", description: "Passwords, verification and how people sign in." },
  { id: "organization:delete", label: "Permanently delete the organization", description: "Destroying the organization and everything in it." },
] as const;

const BY_KEY = new Map<PermissionKey, PermissionMeta>(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
);

export function permissionMeta(key: PermissionKey): PermissionMeta {
  const meta = BY_KEY.get(key);
  if (!meta) throw new Error(`Unknown permission key: ${key}`);
  return meta;
}

/** A DISPATCH_AGENCY owns no trucks, so fleet-editing keys are never offered. */
export function availablePermissions(orgType: OrganizationType): PermissionMeta[] {
  return PERMISSION_CATALOG.filter(
    (p) => !p.orgTypes || p.orgTypes.includes(orgType),
  );
}

export function availablePermissionKeys(orgType: OrganizationType): PermissionKey[] {
  return availablePermissions(orgType).map((p) => p.key);
}

export function isSensitive(key: PermissionKey): boolean {
  return Boolean(permissionMeta(key).sensitive);
}

export function isFinancial(key: PermissionKey): boolean {
  return Boolean(permissionMeta(key).financial);
}

/** Financial keys in a selection — the ones needing the loudest warning. */
export function financialPermissions(keys: readonly PermissionKey[]): PermissionKey[] {
  return keys.filter(isFinancial);
}

export function sensitivePermissions(keys: readonly PermissionKey[]): PermissionKey[] {
  return keys.filter((k) => isSensitive(k) && !isFinancial(k));
}

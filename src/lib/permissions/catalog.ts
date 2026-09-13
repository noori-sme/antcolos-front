import type {
  OrganizationType,
  PermissionGroup,
  PermissionKey,
  PermissionMeta,
} from "@/types";

/**
 * THE permission catalog. Adding a key here makes it appear in the permission
 * editor, the audit log and the docs — there is nowhere else to register it.
 *
 * For Taqi: UI permission checks are user experience, not security. Hiding a
 * button prevents confusion, not attack. Every key below must be enforced
 * server-side on the matching endpoint. This catalog is the shared vocabulary.
 */
export const PERMISSION_CATALOG: readonly PermissionMeta[] = [
  // ---- Loads -------------------------------------------------------------
  { key: "loads:view", label: "View loads", description: "See loads and their status.", group: "loads" },
  { key: "loads:create", label: "Create loads", description: "Add new loads manually or by import.", group: "loads" },
  { key: "loads:edit", label: "Edit loads", description: "Change load details, stops and references.", group: "loads" },
  { key: "loads:delete", label: "Delete loads", description: "Permanently remove a load.", group: "loads", sensitive: true },
  { key: "loads:assign", label: "Assign loads", description: "Assign a driver, truck and trailer to a load.", group: "loads" },
  { key: "loads:status:update", label: "Update load status", description: "Move a load through its lifecycle.", group: "loads" },

  // ---- Money -------------------------------------------------------------
  { key: "rates:view", label: "View rates", description: "See what a load pays. Separate from viewing loads.", group: "money", sensitive: true },
  { key: "rates:edit", label: "Edit rates", description: "Change load rates and accessorials.", group: "money", sensitive: true },
  { key: "revenue:view", label: "View revenue", description: "See revenue totals and margin.", group: "money", sensitive: true },
  { key: "expenses:view", label: "View expenses", description: "See operating expenses.", group: "money", sensitive: true },
  { key: "settlements:view", label: "View settlements", description: "See driver settlement statements.", group: "money" },
  { key: "settlements:create", label: "Create settlements", description: "Build settlement periods and pay lines.", group: "money" },
  { key: "settlements:export", label: "Export settlements", description: "Export statements out of Antcolos.", group: "money", sensitive: true },
  { key: "invoices:view", label: "View invoices", description: "See customer invoices and aging.", group: "money" },
  { key: "invoices:create", label: "Create invoices", description: "Invoice customers for delivered loads.", group: "money" },

  // ---- People ------------------------------------------------------------
  { key: "drivers:view", label: "View drivers", description: "See driver records and availability.", group: "people" },
  { key: "drivers:manage", label: "Manage drivers", description: "Add, edit and deactivate drivers.", group: "people" },

  // ---- Equipment ---------------------------------------------------------
  { key: "equipment:view", label: "View equipment", description: "See trucks and trailers, including carrier equipment a dispatch agency runs.", group: "equipment" },
  { key: "equipment:manage", label: "Manage equipment", description: "Add and edit trucks and trailers.", group: "equipment", orgTypes: ["CARRIER"] },

  // ---- Documents ---------------------------------------------------------
  { key: "documents:view", label: "View documents", description: "See uploaded documents.", group: "documents" },
  { key: "documents:upload", label: "Upload documents", description: "Attach BOLs, PODs, scale tickets and more.", group: "documents" },
  { key: "documents:approve", label: "Approve documents", description: "Accept or reject submitted documents.", group: "documents" },

  // ---- Compliance --------------------------------------------------------
  { key: "compliance:view", label: "View compliance", description: "See licences, inspections and expiries.", group: "compliance" },
  { key: "compliance:manage", label: "Manage compliance", description: "Record and resolve compliance items.", group: "compliance" },

  // ---- Customers ---------------------------------------------------------
  { key: "customers:view", label: "View customers", description: "See brokers and shippers.", group: "customers" },
  { key: "customers:manage", label: "Manage customers", description: "Add and edit customer records.", group: "customers" },

  // ---- Platform ----------------------------------------------------------
  { key: "integrations:view", label: "View integrations", description: "See connected external tools.", group: "platform" },
  { key: "integrations:manage", label: "Manage integrations", description: "Connect and disconnect external tools.", group: "platform", sensitive: true },
  { key: "users:view", label: "View users", description: "See who belongs to this organization.", group: "platform" },
  { key: "users:invite", label: "Invite users", description: "Invite people into this organization.", group: "platform" },
  { key: "users:suspend", label: "Suspend users", description: "Suspend or end a membership.", group: "platform", sensitive: true },
  { key: "permissions:manage", label: "Manage permissions", description: "Grant, revoke and edit permission templates.", group: "platform", sensitive: true },
  { key: "audit:view", label: "View audit log", description: "See the record of access changes.", group: "platform" },
  { key: "organization:manage", label: "Manage organization", description: "Edit organization details and billing.", group: "platform", sensitive: true },
] as const;

export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
  loads: "Loads",
  money: "Money",
  people: "People",
  equipment: "Equipment",
  documents: "Documents",
  compliance: "Compliance & safety",
  customers: "Customers",
  platform: "Platform & access",
};

const BY_KEY = new Map<PermissionKey, PermissionMeta>(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
);

export function permissionMeta(key: PermissionKey): PermissionMeta {
  const meta = BY_KEY.get(key);
  if (!meta) throw new Error(`Unknown permission key: ${key}`);
  return meta;
}

/** A DISPATCH_AGENCY owns no trucks, so equipment keys are never offered there. */
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

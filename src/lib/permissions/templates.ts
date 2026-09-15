import type { PermissionKey, PermissionTemplate } from "@/types";

/**
 * Templates are conveniences, not roles: additive, non-exclusive, editable,
 * and detached once applied. Nothing in the app may branch on a template name.
 */
type SeedTemplate = Omit<PermissionTemplate, "id" | "organizationId">;

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    name: "Owner",
    description: "Full access. At least one owner must always exist.",
    seeded: true,
    permissions: [],
  },
  {
    name: "Dispatcher",
    description: "Moves freight. Does not see what a load pays.",
    seeded: true,
    permissions: [
      "loads:view", "loads:create", "loads:edit", "loads:assign", "loads:status:update",
      "proposals:view",
      "drivers:view", "trucks:view", "trailers:view",
      "customers:view", "customers:create", "customers:private:manage", "customers:resolve",
      "documents:view", "documents:upload", "compliance:view",
      // Their own income, loads and activity — never the organization's.
      "reports:view",
      "fleet:view", "fleet:telemetry:record",
      "maintenance:view",
      // A dispatcher is usually the first to hear about a wreck, so they can
      // open a claim. They are not given the policy, and never the money.
      "claims:view", "claims:create",
    ],
  },
  {
    name: "Driver",
    description: "Own assigned loads and own documents only. Pair with assigned/own scope.",
    seeded: true,
    permissions: [
      "loads:view", "loads:status:update",
      "proposals:view", "proposals:respond", "trips:execute",
      "documents:view", "documents:upload",
      "settlements:view",
      // A driver must be able to see what they themselves owe — their licence,
      // their medical card. Record scope keeps it to their own record; without
      // this they cannot see why they are about to be taken off dispatch.
      "compliance:view",
      // A driver sees their own settlements and may say one looks wrong. They
      // cannot approve, correct or pay one — including their own.
      "settlements:view", "settlements:dispute",
      // Their own assigned truck, and the ability to report a fault on it.
      "trucks:view", "maintenance:view", "maintenance:defects:report",
    ],
  },
  {
    name: "Accountant",
    description: "Settlements, invoices and revenue. No dispatch.",
    seeded: true,
    permissions: [
      "loads:view", "rates:view", "revenue:view", "expenses:view",
      "settlements:view", "settlements:create", "settlements:export",
      "settlements:dispute:resolve", "settlements:pay",
      "invoices:view", "invoices:create", "customers:view", "documents:view",
      "reports:view", "reports:export",
      "insurance:view", "insurance:sensitive:view", "claims:view", "claims:financials:view",
    ],
  },
  {
    name: "Safety",
    description: "Driver and equipment compliance.",
    seeded: true,
    permissions: [
      "drivers:view", "trucks:view", "trailers:view", "fleet:view",
      "compliance:view", "compliance:manage",
      "trucks:documents:manage", "trailers:documents:manage",
      "documents:view", "documents:upload", "documents:approve", "loads:view",
      "maintenance:view", "maintenance:manage", "maintenance:defects:manage",
      "maintenance:outofservice:manage",
      "insurance:view", "claims:view", "claims:create", "claims:manage",
    ],
  },
  {
    name: "Compliance",
    description: "Document review and expiry tracking.",
    seeded: true,
    permissions: [
      "compliance:view", "compliance:manage",
      "documents:view", "documents:approve", "drivers:view", "trucks:view", "trailers:view",
      "trailers:documents:manage",
      "insurance:view", "insurance:manage", "claims:view",
    ],
  },
  {
    name: "Risk and insurance",
    description: "Policies, coverage, certificates and claims, including the money on a claim.",
    seeded: true,
    permissions: [
      "insurance:view", "insurance:manage", "insurance:sensitive:view",
      "insurance:share:manage",
      "claims:view", "claims:create", "claims:manage", "claims:financials:view",
      "trucks:view", "trailers:view", "drivers:view", "loads:view",
      "documents:view", "documents:upload", "compliance:view",
    ],
  },
  {
    name: "Maintenance",
    description: "Equipment upkeep.",
    seeded: true,
    permissions: [
      "trucks:view", "trucks:edit", "trucks:documents:manage", "fleet:view",
      "fleet:telemetry:record",
      "trailers:view", "trailers:edit", "trailers:documents:manage",
      "trailers:status:manage", "trailers:attachments:manage",
      "documents:view", "documents:upload",
      "maintenance:view", "maintenance:manage",
      "maintenance:defects:report", "maintenance:defects:manage",
      "maintenance:repairs:manage", "maintenance:service:record",
      "maintenance:costs:view", "maintenance:outofservice:manage",
    ],
  },
] as const;

export function seedTemplates(organizationId: string): PermissionTemplate[] {
  return SEED_TEMPLATES.map((t) => ({
    ...t,
    id: `tpl_${organizationId}_${t.name.toLowerCase()}`,
    organizationId,
    permissions: [...t.permissions] as PermissionKey[],
  }));
}

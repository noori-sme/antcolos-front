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
      "drivers:view", "trucks:view", "trailers:view", "customers:view",
      "documents:view", "documents:upload", "compliance:view",
    ],
  },
  {
    name: "Driver",
    description: "Own assigned loads and own documents only. Pair with assigned/own scope.",
    seeded: true,
    permissions: [
      "loads:view", "loads:status:update",
      "documents:view", "documents:upload",
      "settlements:view",
      // A driver must be able to see what they themselves owe — their licence,
      // their medical card. Record scope keeps it to their own record; without
      // this they cannot see why they are about to be taken off dispatch.
      "compliance:view",
    ],
  },
  {
    name: "Accountant",
    description: "Settlements, invoices and revenue. No dispatch.",
    seeded: true,
    permissions: [
      "loads:view", "rates:view", "revenue:view", "expenses:view",
      "settlements:view", "settlements:create", "settlements:export",
      "invoices:view", "invoices:create", "customers:view", "documents:view",
    ],
  },
  {
    name: "Safety",
    description: "Driver and equipment compliance.",
    seeded: true,
    permissions: [
      "drivers:view", "trucks:view", "trailers:view", "compliance:view", "compliance:manage",
      "trucks:documents:manage", "trailers:documents:manage",
      "documents:view", "documents:upload", "documents:approve", "loads:view",
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
    ],
  },
  {
    name: "Maintenance",
    description: "Equipment upkeep.",
    seeded: true,
    permissions: [
      "trucks:view", "trucks:edit", "trucks:documents:manage",
      "trailers:view", "trailers:edit", "trailers:documents:manage",
      "trailers:status:manage", "trailers:attachments:manage",
      "documents:view", "documents:upload",
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

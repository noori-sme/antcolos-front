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
      // Operational fuel only. No cost, and deliberately no IFTA: tax access
      // is never something a dispatcher picks up by being a dispatcher.
      "fuel:view", "mileage:view",
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
      "fuel:view", "fuel:costs:view", "fuel:export", "mileage:view", "ifta:view",
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
  {
    name: "Fuel and tax",
    description:
      "Fuel purchases, jurisdiction mileage and the quarterly IFTA return. The only seeded template that carries tax access.",
    seeded: true,
    permissions: [
      "fuel:view", "fuel:record", "fuel:import", "fuel:review", "fuel:correct",
      "fuel:export", "fuel:costs:view",
      "mileage:view", "mileage:record", "mileage:review",
      "ifta:view", "ifta:manage",
      "trucks:view", "drivers:view", "documents:view", "documents:upload",
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

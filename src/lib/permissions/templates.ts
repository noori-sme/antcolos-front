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
      // Watching the freight run, and telling the customer about it, is the
      // dispatcher's job rather than something they are lent for an afternoon.
      "tracking:view", "tracking:share", "tracking:update:send",
      "drivers:view", "trucks:view", "trailers:view",
      "customers:view", "customers:create", "customers:private:manage", "customers:resolve",
      "documents:view", "documents:upload", "compliance:view",
      // Operational fuel only. No cost, and deliberately no IFTA: tax access
      // is never something a dispatcher picks up by being a dispatcher.
      "fuel:view", "mileage:view",
      // Their own income, loads and activity — never the organization's.
      "reports:view",
      "fleet:view", "fleet:telemetry:record",
      // Where the equipment is, and whether its device is reporting. Not the
      // engine's faults, not the driver's clock, and not the raw payloads.
      "eld:view",
      // Exact position — but only ever for the trucks a carrier has explicitly
      // shared with this workspace, and only while that carrier keeps sharing
      // it. The permission says what a dispatcher may hold; the carrier's
      // per-truck share says which trucks it reaches, and both have to agree.
      // A dispatcher covering a truck needs to know how far out it is; a
      // dispatcher who is not covering it learns nothing either way.
      "eld:location:precise:view",
      "maintenance:view",
      // A dispatcher is usually the first to hear about a wreck, so they can
      // open a claim. They are not given the policy, and never the money.
      "claims:view", "claims:create",
      // A dispatcher works inside the terms somebody else agreed — which
      // carriers, which equipment, what the agreement allows. They read them and
      // never the money, and cannot issue, sign, amend or end one.
      "contracts:view",
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
      // A driver reads the agreement that governs their own work and signs
      // their own side of it. Signer authority is what decides which party
      // that is, so this key can never reach the carrier's signature line —
      // and it grants nothing about anybody else's agreement.
      "contracts:view", "contracts:sign",
      // Their own pay terms. Without this a driver is asked to sign an
      // agreement whose compensation they are not allowed to read.
      "contracts:financials:view",
      // The device on the truck they are on, and their OWN clock. The service
      // layer narrows hours of service to the driver themselves — this key
      // does not open anybody else's.
      "eld:view", "eld:hos:view",
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
      "fuel:view", "fuel:costs:view", "fuel:export", "mileage:view", "ifta:view",
      "reports:view", "reports:export",
      "insurance:view", "insurance:sensitive:view", "claims:view", "claims:financials:view",
      // Settlements price work under the agreement in force when it was
      // performed, so whoever builds them has to be able to read the terms.
      "contracts:view", "contracts:financials:view",
    ],
  },
  {
    name: "Safety",
    description: "Driver and equipment compliance.",
    seeded: true,
    permissions: [
      "drivers:view", "trucks:view", "trailers:view", "fleet:view",
      "compliance:view", "compliance:manage",
      // Safety investigates incidents, so it gets the engine's own account of
      // itself and the exact position — the two things an investigation turns
      // on, and two of the most intrusive keys in the catalog.
      "eld:view", "eld:diagnostics:view", "eld:location:precise:view",
      "trucks:documents:manage", "trailers:documents:manage",
      "documents:view", "documents:upload", "documents:approve", "loads:view",
      "maintenance:view", "maintenance:manage", "maintenance:defects:manage",
      "maintenance:outofservice:manage",
      "insurance:view", "claims:view", "claims:create", "claims:manage",
      // Safety is usually the first to be shown a flagged concern. Reading one
      // is not the same as working it, so this is `risk:view` alone.
      "risk:view",
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
      // An agreement asks for documents. Whoever chases documents needs to see
      // which agreement is asking and why.
      "contracts:view",
      // Reading the record of what happened is the compliance job. Exporting
      // it, and closing an investigation, are not — those stay separate keys.
      "audit:view", "risk:view",
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
      // The one seeded template that WORKS risk cases rather than only reading
      // them. Separation of duties still applies to everyone in it: holding
      // `risk:resolve` never lets somebody close a case about themselves.
      "audit:view", "audit:export",
      "risk:view", "risk:assign", "risk:investigate", "risk:resolve",
    ],
  },
  {
    name: "Maintenance",
    description: "Equipment upkeep.",
    seeded: true,
    permissions: [
      "trucks:view", "trucks:edit", "trucks:documents:manage", "fleet:view",
      "fleet:telemetry:record",
      // Maintenance owns the hardware, so it registers devices, binds them and
      // reads what the engine reports. It is not given the driver's clock.
      "eld:view", "eld:devices:manage", "eld:bindings:manage", "eld:diagnostics:view",
      "trailers:view", "trailers:edit", "trailers:documents:manage",
      "trailers:status:manage", "trailers:attachments:manage",
      "documents:view", "documents:upload",
      "maintenance:view", "maintenance:manage",
      "maintenance:defects:report", "maintenance:defects:manage",
      "maintenance:repairs:manage", "maintenance:service:record",
      "maintenance:costs:view", "maintenance:outofservice:manage",
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
  {
    name: "Contracts and relationships",
    description:
      "Writes, issues, amends and ends the agreements behind the business relationships. Carries no power to change anybody's access — that stays with the modules that own it.",
    seeded: true,
    permissions: [
      "contracts:view", "contracts:create", "contracts:edit", "contracts:review",
      "contracts:amend", "contracts:terminate", "contracts:cancel",
      "contracts:requirements:waive", "contracts:links:manage",
      "contracts:financials:view", "contracts:export",
      // Reading the records an agreement points at. All read-only: none of
      // these lets somebody start, approve or end a relationship.
      "members:view", "invitations:view", "drivers:view", "trucks:view",
      "trailers:view", "documents:view",
      // Deliberately absent, and the point of the template:
      //   contracts:sign            a signature is a party's act, authorised per
      //                             contract by an owner, never by a template
      //   contracts:signers:manage  who may sign is an owner's decision
      //   members:edit / suspend    access is changed where access lives
      //   invitations:create        proposing access is not papering it
      //   *:relationships:manage    business scope is the registries' to change
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

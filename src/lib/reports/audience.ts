import type { OrganizationType, PermissionKey, ReportAudience } from "@/types";

/**
 * Who a caller is, for reporting.
 *
 * One rule, and it is a permission rule rather than a role: seeing the
 * organization's numbers requires `revenue:view`. A membership without it is an
 * individual contributor and gets its own work — its income, its loads, its
 * carriers, its activity — and has no path to an organization-wide total.
 *
 * Returning null means the caller may not open reporting at all.
 */
export function resolveAudience(
  organizationType: OrganizationType,
  permissions: ReadonlySet<PermissionKey>,
): ReportAudience | null {
  if (!permissions.has("reports:view")) return null;
  if (!permissions.has("revenue:view")) return "dispatcher_individual";
  return organizationType === "CARRIER" ? "carrier_org" : "dispatch_org";
}

/** Plain-language answer to "why am I seeing this set of reports?" */
export function audienceExplanation(
  audience: ReportAudience,
  organizationName: string,
): string {
  switch (audience) {
    case "carrier_org":
      return `Organization-wide reporting for ${organizationName}. Every number covers the whole carrier.`;
    case "dispatch_org":
      return `Organization-wide reporting for ${organizationName}, across the carriers that have shared their records.`;
    case "dispatcher_individual":
      return `Your own work in ${organizationName}. Organization-wide reporting needs revenue:view, which this membership does not have.`;
  }
}

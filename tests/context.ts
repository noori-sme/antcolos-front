import type { PermissionKey } from "@/types";
import type { ServiceContext } from "@/lib/api/contracts/context";

/**
 * Test service contexts. Built by hand rather than through the session
 * provider, so a test can express exactly one membership shape — including
 * ones the fixtures do not ship — and prove the seam enforces it.
 */
export function ctx(
  organizationId: string,
  permissions: PermissionKey[],
  overrides: Partial<ServiceContext> = {},
): ServiceContext {
  return {
    organizationId,
    membershipId: `mem_${organizationId}_test`,
    permissions: new Set(permissions),
    scope: { loads: "all", financials: "all" },
    actor: {
      userId: "usr_test",
      membershipId: `mem_${organizationId}_test`,
      displayNameSnapshot: "Test Actor",
      source: "web",
    },
    ...overrides,
  };
}

export const BILLER: PermissionKey[] = [
  "invoices:view", "invoices:create", "invoices:edit", "invoices:send",
  "loads:view", "documents:view", "rates:view",
];

export const VIEWER: PermissionKey[] = ["invoices:view", "loads:view"];

import type {
  Membership,
  Organization,
  PermissionKey,
  PermissionTemplate,
} from "@/types";
import { availablePermissionKeys } from "./catalog";

/**
 * effective = (template permissions ∪ explicit grants) − explicit revocations
 *
 * Revocation beating grant lets an Owner apply a template and then remove one
 * single permission without building a custom template for one person.
 *
 * The one hard rule: `isOwner` implies every permission available to the
 * organization type and cannot be revoked. That is a lockout guard, not a role.
 */
export function effectivePermissions(
  membership: Membership,
  organization: Organization,
  templates: readonly PermissionTemplate[],
): Set<PermissionKey> {
  const available = new Set(availablePermissionKeys(organization.type));

  if (membership.isOwner && membership.status === "active") return available;

  // A membership that is not active grants nothing at all.
  if (membership.status !== "active") return new Set<PermissionKey>();

  const effective = new Set<PermissionKey>();

  for (const templateId of membership.templateIds) {
    const template = templates.find((t) => t.id === templateId);
    if (!template || template.organizationId !== organization.id) continue;
    for (const key of template.permissions) {
      if (available.has(key)) effective.add(key);
    }
  }

  for (const key of membership.grants) {
    if (available.has(key)) effective.add(key);
  }

  for (const key of membership.revocations) {
    effective.delete(key);
  }

  return effective;
}

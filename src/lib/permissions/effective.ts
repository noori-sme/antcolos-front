import type { Membership, Organization, PermissionKey } from "@/types";
import { availablePermissionKeys } from "./catalog";

/**
 * effective = (applied template snapshots ∪ explicit grants) − explicit revocations
 *
 * ★ THE MEMBERSHIP IS THE AUTHORITATIVE ANSWER ★
 * Note what this function does not take: a list of templates. It cannot read
 * one, so a template's current contents cannot reach a person's access. Each
 * `AppliedTemplate` carries the permission snapshot taken when somebody applied
 * it, and that snapshot is what counts — which is why editing a saved template
 * changes nobody, and why re-applying an updated one has to be its own
 * deliberate, authorized act with its own before/after preview.
 *
 * Revocation beating grant lets an owner apply a template and then remove one
 * single permission, without building a template for one person.
 *
 * The one hard rule: `isOwner` implies every permission available to the
 * organization type and cannot be revoked. That is a lockout guard, not a role.
 */
export function effectivePermissions(
  membership: Membership,
  organization: Organization,
): Set<PermissionKey> {
  // FIRST, and before the owner branch: a seat belongs to one organization and
  // reaches nothing in another. Being an owner somewhere is not a reason to be
  // read as one somewhere else, which is exactly what checking ownership first
  // would make it.
  if (membership.organizationId !== organization.id) return new Set<PermissionKey>();

  const available = new Set(availablePermissionKeys(organization.type));

  if (membership.isOwner && membership.status === "active") return available;

  // A membership that is not active grants nothing at all.
  if (membership.status !== "active") return new Set<PermissionKey>();

  const effective = new Set<PermissionKey>();

  for (const applied of membership.appliedTemplates) {
    for (const key of applied.permissions) {
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

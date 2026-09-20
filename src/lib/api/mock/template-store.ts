import type { PermissionKey, PermissionTemplate } from "@/types";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { seedTemplates } from "@/lib/permissions/templates";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE permission templates, one list for every organization.
 *
 * ★ WHY THIS REPLACED A FEATURE-LOCAL STORE ★
 * Templates used to exist twice. `PermissionTemplate` was wired into the
 * Membership model, and a second type called `CustomRole` lived inside
 * `src/features/access/mock-access.ts` with a hand-written `memberCount` and no
 * connection to any seat — so the Roles screen edited things that granted
 * nobody anything, and the number it printed beside each one was invented.
 * Two answers to "what is a role" is exactly the second source of authorization
 * this module exists to not be, so there is now one type, one store, and the
 * member count is COUNTED off the roster rather than stored here.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT HOLD ★
 * No membership, no permission set belonging to a person, and no copy of the
 * catalog. A template is a saved SELECTION out of `@/lib/permissions/catalog`,
 * scoped to one organization, and nothing downstream reads it to decide what
 * somebody may do.
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab. Organization scoping here is a filter, not
 * a boundary: every read and write still passes `organizationId`, which pins
 * the shape a server must enforce, and proves nothing on its own.
 */

function seedAll(): PermissionTemplate[] {
  return MOCK_ORGANIZATIONS.flatMap((org) => seedTemplates(org.id));
}

let TEMPLATES: PermissionTemplate[] = seedAll();
let sequence = 0;

/** Test hook, and the registry's entry. Never called by the UI. */
export function resetTemplateStore(): void {
  TEMPLATES = seedAll();
  sequence = 0;
}

function nextId(): string {
  sequence += 1;
  return `tpl_custom_${sequence.toString(36)}${Date.now().toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function templatesForOrganization(organizationId: string): PermissionTemplate[] {
  return TEMPLATES
    .filter((t) => t.organizationId === organizationId)
    .map((t) => ({ ...t, permissions: [...t.permissions] }));
}

/**
 * One template, BY ORGANIZATION AS WELL AS ID.
 *
 * The organization is required rather than derived from the record, so a caller
 * holding an id from somewhere else cannot read across the boundary by
 * accident. A template from another organization reads as absent, which is the
 * same answer a server should give.
 */
export function templateById(
  organizationId: string,
  templateId: string,
): PermissionTemplate | undefined {
  const found = TEMPLATES.find(
    (t) => t.id === templateId && t.organizationId === organizationId,
  );
  return found ? { ...found, permissions: [...found.permissions] } : undefined;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface TemplateDraft {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

export function putTemplate(template: PermissionTemplate): PermissionTemplate {
  const index = TEMPLATES.findIndex((t) => t.id === template.id);
  if (index < 0) TEMPLATES = [template, ...TEMPLATES];
  else TEMPLATES = TEMPLATES.map((t) => (t.id === template.id ? template : t));
  return { ...template, permissions: [...template.permissions] };
}

export function createTemplate(
  organizationId: string,
  draft: TemplateDraft,
): PermissionTemplate {
  const at = nowIso();
  return putTemplate({
    id: nextId(),
    organizationId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    permissions: [...draft.permissions],
    version: 1,
    seeded: false,
    archived: false,
    createdAt: at,
    updatedAt: at,
  });
}

function sameSelection(a: readonly PermissionKey[], b: readonly PermissionKey[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((k) => set.has(k));
}

/**
 * Saves an edit, bumping `version` only when the PERMISSIONS changed.
 *
 * A rename or a reworded description leaves the version where it was, on
 * purpose: version is what tells an owner "the people holding this are on an
 * older selection than the one saved here", and raising it for a typo fix would
 * ask them to review a change to nobody's access.
 */
export function updateTemplate(
  organizationId: string,
  templateId: string,
  draft: TemplateDraft,
): PermissionTemplate | undefined {
  const existing = TEMPLATES.find(
    (t) => t.id === templateId && t.organizationId === organizationId,
  );
  if (!existing) return undefined;
  const permissionsChanged = !sameSelection(existing.permissions, draft.permissions);
  return putTemplate({
    ...existing,
    name: draft.name.trim(),
    description: draft.description.trim(),
    permissions: [...draft.permissions],
    version: permissionsChanged ? existing.version + 1 : existing.version,
    updatedAt: nowIso(),
  });
}

export function setTemplateArchived(
  organizationId: string,
  templateId: string,
  archived: boolean,
): PermissionTemplate | undefined {
  const existing = TEMPLATES.find(
    (t) => t.id === templateId && t.organizationId === organizationId,
  );
  if (!existing) return undefined;
  return putTemplate({ ...existing, archived, updatedAt: nowIso() });
}

export function deleteTemplate(organizationId: string, templateId: string): boolean {
  const before = TEMPLATES.length;
  TEMPLATES = TEMPLATES.filter(
    (t) => !(t.id === templateId && t.organizationId === organizationId),
  );
  return TEMPLATES.length !== before;
}

/** A name not already taken in this organization, for a duplicate. */
export function availableCopyName(organizationId: string, base: string): string {
  const taken = new Set(
    templatesForOrganization(organizationId).map((t) => t.name.trim().toLowerCase()),
  );
  const root = `${base} (copy)`;
  if (!taken.has(root.toLowerCase())) return root;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} (copy ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}

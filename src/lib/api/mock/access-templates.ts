import type {
  Membership, Organization, OrganizationType, PermissionKey, PermissionTemplate,
} from "@/types";
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  clampToGrantable,
  grantablePermissionKeys,
  isOwnerTemplate,
  previewTemplateApplication,
  previewTemplateRemoval,
  ungrantablePermissions,
  validateRoleName,
  withTemplateApplied,
  withTemplateRemoved,
} from "@/lib/permissions";
import type { AccessDiff } from "@/lib/permissions/applied";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import type { ServiceContext } from "../contracts/context";
import type {
  ApplyRefusal, ApplyTemplateResult, RemoveTemplateResult, TemplateDeleteResult,
  TemplateDraft, TemplateSummary, TemplateWriteResult,
} from "../contracts/access";
import { appendAuditEvent } from "./audit";
import { rosterOf, writeSeatAccess } from "./access";
import { memberById } from "./membership-directory";
import {
  availableCopyName, createTemplate, deleteTemplate, setTemplateArchived,
  templateById, templatesForOrganization, updateTemplate,
} from "./template-store";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The template half of the Access service.
 *
 * ★ EVERY REFUSAL HERE IS A SHAPE, NOT A DEFENCE ★
 * `ctx.permissions` is a set the browser assembled out of fixtures, so a caller
 * who wanted to get past these checks would edit the caller. What the checks
 * are worth is that they are EXACT: each one names the authority it needs, the
 * organization it is scoped to and the clamp it applies, so the server has
 * something specific to implement rather than "and then check permissions".
 *
 * The five rules, and why each exists:
 *
 *   AUTHORITY        `permissions:manage` to touch a template at all;
 *                    `members:edit` as well to put one on somebody's seat.
 *                    Saving a selection and changing a person's access are two
 *                    different acts and one of them is much larger.
 *
 *   NO ESCALATION    A saved template may not contain a key the author does not
 *                    hold. Otherwise "manage roles" silently becomes every
 *                    permission, because its holder writes themselves a
 *                    template containing the rest.
 *
 *   NO SELF-APPLY    Nobody applies a template to their own seat. Clamping
 *                    would make it a no-op that looked like it worked, and the
 *                    clamp is the only thing standing between `permissions:manage`
 *                    and a self-service promotion.
 *
 *   ONE ORGANIZATION Every lookup is (organizationId, id). A template from
 *                    another organization reads as absent, and a seat in
 *                    another organization cannot be reached at all. Dispatch
 *                    delegation into a carrier's data stays where it lives —
 *                    on the truck, as a `TruckDispatchAccess` — and no template
 *                    in a provider organization can substitute for it.
 *
 *   LAST OWNER       Nothing here can produce an organization with no owner.
 *                    The owner seat's access is structural rather than composed
 *                    from templates, so applying one to it is refused outright.
 */

const LATENCY_MS = 260;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function orgTypeOf(ctx: ServiceContext): OrganizationType {
  return ctx.workspaceKind === "carrier_organization" ? "CARRIER" : "DISPATCH_AGENCY";
}

function organizationOf(ctx: ServiceContext): Organization | undefined {
  return MOCK_ORGANIZATIONS.find((o) => o.id === ctx.organizationId);
}

function refusal(
  ctx: ServiceContext,
  templateId: string | undefined,
  refusalKind: string,
  message: string,
  required: PermissionKey[] = [],
) {
  appendAuditEvent(ctx, {
    module: "access",
    action: "access.permission_denied",
    outcome: "denied",
    entity: {
      kind: "permission_template",
      id: templateId ?? "—",
      label: templateId ?? "permission template",
    },
    summary: `Refused (${refusalKind}): ${message}`,
    permissionContext: required.length
      ? { required, missing: required.filter((k) => !ctx.permissions.has(k)) }
      : undefined,
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Counted, never stored.
 *
 * A `memberCount` written onto a template is a number that is wrong the moment
 * somebody leaves, and the previous implementation's was simply invented. This
 * one walks the live roster, which is the same list the People screen shows.
 */
function countsFor(
  template: PermissionTemplate,
  roster: readonly Membership[],
): { memberCount: number; behindCount: number } {
  let memberCount = 0;
  let behindCount = 0;
  for (const seat of roster) {
    const applied = seat.appliedTemplates.find((a) => a.templateId === template.id);
    if (!applied) continue;
    memberCount += 1;
    if (applied.version !== template.version) behindCount += 1;
  }
  return { memberCount, behindCount };
}

export async function templatesImpl(ctx: ServiceContext): Promise<TemplateSummary[]> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("permissions:manage")) return [];
  const roster = rosterOf(ctx.organizationId);
  return templatesForOrganization(ctx.organizationId).map((template) => ({
    template,
    ...countsFor(template, roster),
  }));
}

/* -------------------------------------------------------------------------- */
/* Writing a template                                                          */
/* -------------------------------------------------------------------------- */

function validateDraft(
  ctx: ServiceContext,
  draft: TemplateDraft,
  excludingId?: string,
): TemplateWriteResult | null {
  if (!ctx.permissions.has("permissions:manage")) {
    refusal(ctx, excludingId, "not_permitted",
      "No authority to manage roles and permissions.", ["permissions:manage"]);
    return {
      status: "refused", refusal: "not_permitted",
      message: "You do not have permission to manage roles in this organization.",
    };
  }

  const existingNames = templatesForOrganization(ctx.organizationId)
    .filter((t) => t.id !== excludingId)
    .map((t) => t.name);
  const nameError = validateRoleName(draft.name, existingNames);
  if (nameError) {
    return {
      status: "refused",
      refusal: /owner/i.test(nameError) ? "reserved" : "invalid_name",
      message: nameError,
    };
  }
  if (draft.description.length > ROLE_DESCRIPTION_MAX_LENGTH) {
    return {
      status: "refused", refusal: "invalid_name",
      message: `Keep the description under ${ROLE_DESCRIPTION_MAX_LENGTH} characters.`,
    };
  }

  // The escalation guard. Refused rather than trimmed: a template silently
  // shorter than what somebody ticked is one they will hand out believing it
  // does something it does not.
  const beyond = ungrantablePermissions(draft.permissions, ctx.permissions);
  if (beyond.length > 0) {
    refusal(ctx, excludingId, "escalation",
      `Selection contained ${beyond.length} permission(s) the author does not hold.`);
    return {
      status: "refused", refusal: "escalation",
      message:
        `A role cannot contain permissions you do not have yourself. `
        + `${beyond.length} of the ones selected ${beyond.length === 1 ? "is" : "are"} outside your own access.`,
    };
  }
  return null;
}

export async function createTemplateImpl(
  ctx: ServiceContext,
  draft: TemplateDraft,
): Promise<TemplateWriteResult> {
  await sleep(LATENCY_MS);
  const invalid = validateDraft(ctx, draft);
  if (invalid) return invalid;

  const template = createTemplate(ctx.organizationId, {
    ...draft,
    permissions: clampToGrantable(draft.permissions, ctx.permissions, orgTypeOf(ctx)),
  });
  appendAuditEvent(ctx, {
    module: "access",
    action: "access.role_changed",
    entity: { kind: "permission_template", id: template.id, label: template.name },
    summary: `Created the role “${template.name}” with ${template.permissions.length} permissions.`,
    changes: [{ field: "permissions", before: null, after: `${template.permissions.length} permissions` }],
  });
  return { status: "saved", template };
}

export async function updateTemplateImpl(
  ctx: ServiceContext,
  templateId: string,
  draft: TemplateDraft,
): Promise<TemplateWriteResult> {
  await sleep(LATENCY_MS);
  const existing = templateById(ctx.organizationId, templateId);
  if (!existing) {
    return { status: "refused", refusal: "not_found", message: "That role no longer exists." };
  }
  if (isOwnerTemplate(existing)) {
    return {
      status: "refused", refusal: "reserved",
      message: "Owner is permanent. It cannot be edited, restricted or handed out.",
    };
  }
  const invalid = validateDraft(ctx, draft, templateId);
  if (invalid) return invalid;

  const saved = updateTemplate(ctx.organizationId, templateId, {
    ...draft,
    permissions: clampToGrantable(draft.permissions, ctx.permissions, orgTypeOf(ctx)),
  })!;

  const roster = rosterOf(ctx.organizationId);
  const { memberCount } = countsFor(saved, roster);
  appendAuditEvent(ctx, {
    module: "access",
    action: "access.role_changed",
    entity: { kind: "permission_template", id: saved.id, label: saved.name },
    summary:
      saved.version === existing.version
        ? `Edited the role “${saved.name}”. Its permissions are unchanged.`
        // The sentence an auditor needs: an edit moved the TEMPLATE, and moved
        // nobody. Whoever holds it keeps what they were given until somebody
        // applies the new version to them, seat by seat.
        : `Saved version ${saved.version} of the role “${saved.name}”. `
          + `${memberCount} ${memberCount === 1 ? "person keeps" : "people keep"} the access they already had.`,
    changes: [
      { field: "version", before: String(existing.version), after: String(saved.version) },
      {
        field: "permissions",
        before: `${existing.permissions.length} permissions`,
        after: `${saved.permissions.length} permissions`,
      },
    ],
  });
  return { status: "saved", template: saved };
}

export async function duplicateTemplateImpl(
  ctx: ServiceContext,
  templateId: string,
): Promise<TemplateWriteResult> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("permissions:manage")) {
    refusal(ctx, templateId, "not_permitted", "No authority to manage roles.", ["permissions:manage"]);
    return {
      status: "refused", refusal: "not_permitted",
      message: "You do not have permission to manage roles in this organization.",
    };
  }
  const source = templateById(ctx.organizationId, templateId);
  if (!source) {
    return { status: "refused", refusal: "not_found", message: "That role no longer exists." };
  }

  // A copy starts on version 1, held by nobody, and carries only what the
  // person making it could grant. Duplicating a template an owner wrote is a
  // legitimate way for a senior dispatcher to start from a good selection; it
  // is not a way to acquire the parts of it they do not have.
  const copy = createTemplate(ctx.organizationId, {
    name: availableCopyName(ctx.organizationId, source.name),
    description: source.description,
    permissions: clampToGrantable(source.permissions, ctx.permissions, orgTypeOf(ctx)),
  });
  appendAuditEvent(ctx, {
    module: "access",
    action: "access.role_changed",
    entity: { kind: "permission_template", id: copy.id, label: copy.name },
    relatedEntities: [{ kind: "permission_template", id: source.id, label: source.name }],
    summary: `Duplicated “${source.name}” as “${copy.name}”. Nobody holds the copy.`,
  });
  return { status: "saved", template: copy };
}

export async function setTemplateArchivedImpl(
  ctx: ServiceContext,
  templateId: string,
  archived: boolean,
): Promise<TemplateWriteResult> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("permissions:manage")) {
    refusal(ctx, templateId, "not_permitted", "No authority to manage roles.", ["permissions:manage"]);
    return {
      status: "refused", refusal: "not_permitted",
      message: "You do not have permission to manage roles in this organization.",
    };
  }
  const existing = templateById(ctx.organizationId, templateId);
  if (!existing) {
    return { status: "refused", refusal: "not_found", message: "That role no longer exists." };
  }
  if (isOwnerTemplate(existing)) {
    return {
      status: "refused", refusal: "reserved",
      message: "Owner is permanent and cannot be archived.",
    };
  }
  const saved = setTemplateArchived(ctx.organizationId, templateId, archived)!;
  appendAuditEvent(ctx, {
    module: "access",
    action: "access.role_changed",
    entity: { kind: "permission_template", id: saved.id, label: saved.name },
    // Archiving takes nothing away. Said explicitly, because "archived" reads
    // like "switched off" and an owner who believed that would think they had
    // removed somebody's access when they had not.
    summary: archived
      ? `Archived “${saved.name}”. Everyone holding it keeps their access; it cannot be given out again.`
      : `Restored “${saved.name}”. It can be given out again.`,
    changes: [{ field: "archived", before: String(existing.archived), after: String(archived) }],
  });
  return { status: "saved", template: saved };
}

export async function deleteTemplateImpl(
  ctx: ServiceContext,
  templateId: string,
): Promise<TemplateDeleteResult> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("permissions:manage")) {
    refusal(ctx, templateId, "not_permitted", "No authority to manage roles.", ["permissions:manage"]);
    return {
      status: "refused", refusal: "not_permitted",
      message: "You do not have permission to manage roles in this organization.",
    };
  }
  const existing = templateById(ctx.organizationId, templateId);
  if (!existing) return { status: "refused", refusal: "not_found", message: "That role no longer exists." };
  if (existing.seeded) {
    return {
      status: "refused", refusal: "reserved",
      message: "Roles that came with the workspace can be edited or archived, but not deleted.",
    };
  }

  /*
   * ★ WHY DELETING A HELD TEMPLATE IS REFUSED, AND NOT CASCADED ★
   * Deleting it does not strip anybody — each seat carries its own snapshot, so
   * the people holding it would keep working. What they would lose is the
   * ANSWER to "where did this access come from", and a permission set nobody
   * can account for is worse than a tidy list. Archiving keeps the provenance
   * and stops the template being handed out, which is what deleting was for.
   */
  const { memberCount } = countsFor(existing, rosterOf(ctx.organizationId));
  if (memberCount > 0) {
    return {
      status: "refused", refusal: "in_use", memberCount,
      message:
        `${memberCount} ${memberCount === 1 ? "person holds" : "people hold"} this role. `
        + "Deleting it would leave their permissions with nothing to trace them back to. "
        + "Archive it instead — everyone keeps working and it cannot be handed out again.",
    };
  }

  deleteTemplate(ctx.organizationId, templateId);
  appendAuditEvent(ctx, {
    module: "access",
    action: "access.role_changed",
    entity: { kind: "permission_template", id: existing.id, label: existing.name },
    summary: `Deleted the role “${existing.name}”. Nobody held it.`,
  });
  return { status: "deleted" };
}

/* -------------------------------------------------------------------------- */
/* Putting one on a seat                                                       */
/* -------------------------------------------------------------------------- */

interface Resolved {
  seat: Membership;
  template: PermissionTemplate;
  organization: Organization;
}

/** The shared refusal shape of `applyToMembership` and `removeFromMembership`. */
type ApplyRefusalResult = { status: "refused"; refusal: ApplyRefusal; message: string };

function resolve(
  ctx: ServiceContext,
  membershipId: string,
  templateId: string,
): Resolved | ApplyRefusalResult {
  if (!ctx.permissions.has("permissions:manage") || !ctx.permissions.has("members:edit")) {
    const required: PermissionKey[] = ["permissions:manage", "members:edit"];
    refusal(ctx, templateId, "not_permitted",
      "Applying a role to somebody needs both role authority and member authority.", required);
    return {
      status: "refused", refusal: "not_permitted",
      message:
        "Changing what somebody can do needs permission to manage both roles and members.",
    };
  }

  const organization = organizationOf(ctx);
  if (!organization) {
    return { status: "refused", refusal: "not_found", message: "This organization is not reachable." };
  }

  const template = templateById(ctx.organizationId, templateId);
  if (!template) {
    // Deliberately the same answer as "no such template": a caller holding an
    // id from another organization learns nothing about whether it exists.
    refusal(ctx, templateId, "cross_organization",
      "Template id does not belong to the active organization.");
    return { status: "refused", refusal: "not_found", message: "That role no longer exists." };
  }

  const seat = rosterOf(ctx.organizationId).find((m) => m.id === membershipId);
  if (!seat) {
    refusal(ctx, templateId, "cross_organization",
      `Membership ${membershipId} is not in the active organization.`);
    return {
      status: "refused", refusal: "cross_organization",
      message: "That person is not in this organization.",
    };
  }

  if (seat.id === ctx.membershipId) {
    refusal(ctx, templateId, "self_escalation", "Refused a self-application.");
    return {
      status: "refused", refusal: "self_escalation",
      message:
        "You cannot apply a role to your own seat. Ask another owner to change your access.",
    };
  }

  if (seat.isOwner) {
    return {
      status: "refused", refusal: "owner_seat",
      message:
        "An owner already has everything this workspace supports, so a role would change nothing. "
        + "Transferring ownership is a separate, deliberate act.",
    };
  }

  return { seat, template, organization };
}

function isRefusal(r: Resolved | ApplyRefusalResult): r is ApplyRefusalResult {
  return "status" in r;
}

/** Who a seat belongs to, for the record. Never its title: that is a job. */
function nameOf(seat: Membership): string {
  return memberById(seat.id)?.displayName ?? seat.title ?? seat.userId;
}

function actorOf(ctx: ServiceContext) {
  return {
    membershipId: ctx.membershipId,
    displayName: ctx.actor.displayNameSnapshot,
    grantable: new Set(grantablePermissionKeys(ctx.permissions, orgTypeOf(ctx))),
  };
}

export async function previewApplicationImpl(
  ctx: ServiceContext,
  membershipId: string,
  templateId: string,
): Promise<AccessDiff | null> {
  await sleep(LATENCY_MS);
  const resolved = resolve(ctx, membershipId, templateId);
  if (isRefusal(resolved)) return null;
  const { seat, template, organization } = resolved;
  return previewTemplateApplication(seat, organization, template, actorOf(ctx), nowIso());
}

export async function applyToMembershipImpl(
  ctx: ServiceContext,
  membershipId: string,
  templateId: string,
): Promise<ApplyTemplateResult> {
  await sleep(LATENCY_MS);
  const resolved = resolve(ctx, membershipId, templateId);
  if (isRefusal(resolved)) return resolved as ApplyTemplateResult;
  const { seat, template, organization } = resolved;

  if (template.archived) {
    return {
      status: "refused", refusal: "archived",
      message:
        `“${template.name}” is archived. People already holding it keep their access, `
        + "but it cannot be given to anybody new. Restore it first.",
    };
  }

  const actor = actorOf(ctx);
  const at = nowIso();
  // The SAME call the preview made, so the sentence the owner read and the
  // change that happens cannot be two different things.
  const diff = previewTemplateApplication(seat, organization, template, actor, at);
  const applied = {
    templateId: template.id,
    templateName: template.name,
    version: template.version,
    permissions: clampToGrantable(template.permissions, actor.grantable, organization.type),
    appliedAt: at,
    appliedByMembershipId: ctx.membershipId,
    appliedByName: ctx.actor.displayNameSnapshot,
  };
  const next = withTemplateApplied(seat, applied);
  writeSeatAccess(seat, { appliedTemplates: next.appliedTemplates });

  appendAuditEvent(ctx, {
    module: "access",
    action: diff.removed.length > 0 ? "access.permission_revoked" : "access.permission_granted",
    sourceAction: "access.template_applied",
    entity: { kind: "membership", id: seat.id, label: nameOf(seat) },
    relatedEntities: [{ kind: "permission_template", id: template.id, label: template.name }],
    summary:
      `Applied “${template.name}” (version ${template.version}) to ${nameOf(seat)}: `
      + `${diff.added.length} added, ${diff.removed.length} removed.`,
    changes: [
      { field: "appliedTemplates", before: `${seat.appliedTemplates.length} applied`, after: `${next.appliedTemplates.length} applied` },
      { field: "permissions", before: `${diff.before.length} permissions`, after: `${diff.after.length} permissions` },
    ],
  });

  return { status: "applied", membership: next, applied, diff };
}

export async function removeFromMembershipImpl(
  ctx: ServiceContext,
  membershipId: string,
  templateId: string,
): Promise<RemoveTemplateResult> {
  await sleep(LATENCY_MS);
  const resolved = resolve(ctx, membershipId, templateId);
  if (isRefusal(resolved)) return resolved as RemoveTemplateResult;
  const { seat, organization, template } = resolved;

  const diff = previewTemplateRemoval(seat, organization, templateId);
  const next = withTemplateRemoved(seat, templateId);
  writeSeatAccess(seat, { appliedTemplates: next.appliedTemplates });

  appendAuditEvent(ctx, {
    module: "access",
    action: "access.permission_revoked",
    sourceAction: "access.template_removed",
    entity: { kind: "membership", id: seat.id, label: nameOf(seat) },
    relatedEntities: [{ kind: "permission_template", id: template.id, label: template.name }],
    summary:
      `Removed “${template.name}” from ${nameOf(seat)}: `
      + `${diff.removed.length} ${diff.removed.length === 1 ? "permission" : "permissions"} taken away.`,
    changes: [
      { field: "permissions", before: `${diff.before.length} permissions`, after: `${diff.after.length} permissions` },
    ],
  });

  return { status: "removed", membership: next, diff };
}

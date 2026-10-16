import type {
  AppliedTemplate,
  Membership,
  Organization,
  PermissionKey,
  PermissionTemplate,
} from "@/types";
import { availablePermissionKeys } from "./catalog";
import { effectivePermissions } from "./effective";
import { clampToGrantable, ungrantablePermissions } from "./grantable";

/**
 * Applying a template, and every question an owner has to be able to answer
 * about one afterwards.
 *
 * ★ WHY THIS IS A MODULE AND NOT A SCREEN ★
 * "What would this template give this person?" and "what would moving them to
 * the current version change?" are the same computation as "what do they have
 * now", and a screen that worked either of them out by hand would eventually
 * disagree with `effectivePermissions` — which is the one thing the preview
 * exists to be trusted about. Every function here derives its answer from that
 * one, over a membership it constructs rather than one it mutates.
 *
 * ███ FRONTEND ONLY ███
 * None of this is authorization. `grantable` is a set the browser assembled, so
 * `applyTemplateToMembership` refusing an escalation is a statement about a
 * value the caller passed in. It pins the SHAPE a server has to implement: the
 * same clamp, against the acting membership's own permissions as the server
 * derives them.
 */

/* -------------------------------------------------------------------------- */
/* Taking the snapshot                                                         */
/* -------------------------------------------------------------------------- */

export interface ApplyActor {
  membershipId: string;
  displayName: string;
  /** What the acting membership may hand out. Nothing above this is ever written. */
  grantable: ReadonlySet<PermissionKey>;
}

/**
 * The snapshot, clamped to what the person applying it may actually grant.
 *
 * A template may legitimately contain more than the person applying it holds —
 * an owner writes "Limited Dispatcher" and a senior dispatcher later applies it
 * to a new hire. The snapshot written to that seat is the INTERSECTION, and the
 * caller is told what was left out rather than the difference being hidden.
 */
export function snapshotOf(
  template: PermissionTemplate,
  actor: ApplyActor,
  orgType: Organization["type"],
  at: string,
): { applied: AppliedTemplate; withheld: PermissionKey[] } {
  const permitted = clampToGrantable(template.permissions, actor.grantable, orgType);
  const withheld = ungrantablePermissions(
    template.permissions.filter((k) => availablePermissionKeys(orgType).includes(k)),
    actor.grantable,
  );
  return {
    applied: {
      templateId: template.id,
      templateName: template.name,
      version: template.version,
      permissions: permitted,
      appliedAt: at,
      appliedByMembershipId: actor.membershipId,
      appliedByName: actor.displayName,
    },
    withheld: withheld as PermissionKey[],
  };
}

/* -------------------------------------------------------------------------- */
/* Before and after                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a change to a seat would do, in the only terms that matter: the
 * permissions the person effectively has before, and effectively has after.
 *
 * Both sides come from `effectivePermissions`, so the preview cannot claim an
 * outcome the product would not actually produce.
 */
export interface AccessDiff {
  before: PermissionKey[];
  after: PermissionKey[];
  added: PermissionKey[];
  removed: PermissionKey[];
  unchanged: PermissionKey[];
  /**
   * Keys the template asked for that this seat would NOT receive, because the
   * person applying it does not hold them. Shown, never silently dropped.
   */
  withheld: PermissionKey[];
  /**
   * Person-specific adjustments that survive the change and why the result is
   * not simply the template's contents.
   */
  adjustments: PersonAdjustments;
}

export interface PersonAdjustments {
  /** Extra keys this one person was given on top of any template. */
  grants: PermissionKey[];
  /** Keys taken back from this one person. These beat everything. */
  revocations: PermissionKey[];
  /**
   * Revocations that cancel part of the template being applied — the reason an
   * owner sees fewer permissions than the template lists, and the single most
   * confusing thing about a preview that does not mention it.
   */
  revocationsHidingTemplate: PermissionKey[];
}

function sorted(keys: Iterable<PermissionKey>): PermissionKey[] {
  return [...keys].sort();
}

export function adjustmentsOf(
  membership: Membership,
  templatePermissions: readonly PermissionKey[],
): PersonAdjustments {
  const fromTemplate = new Set(templatePermissions);
  return {
    grants: sorted(membership.grants),
    revocations: sorted(membership.revocations),
    revocationsHidingTemplate: sorted(
      membership.revocations.filter((k) => fromTemplate.has(k)),
    ),
  };
}

function diff(
  before: ReadonlySet<PermissionKey>,
  after: ReadonlySet<PermissionKey>,
): Pick<AccessDiff, "before" | "after" | "added" | "removed" | "unchanged"> {
  return {
    before: sorted(before),
    after: sorted(after),
    added: sorted([...after].filter((k) => !before.has(k))),
    removed: sorted([...before].filter((k) => !after.has(k))),
    unchanged: sorted([...after].filter((k) => before.has(k))),
  };
}

/* -------------------------------------------------------------------------- */
/* Applying                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The membership as it WOULD be. A pure function: the seat passed in is not
 * touched, which is what lets the same call serve the preview and the write.
 *
 * Re-applying a template the seat already carries REPLACES that entry rather
 * than adding a second one. Two snapshots of the same template on one seat
 * would make "which version is this person on" unanswerable, and their union
 * would mean a permission removed in v2 kept working forever.
 */
export function withTemplateApplied(
  membership: Membership,
  applied: AppliedTemplate,
): Membership {
  const others = membership.appliedTemplates.filter(
    (a) => a.templateId !== applied.templateId,
  );
  return { ...membership, appliedTemplates: [...others, applied] };
}

export function withTemplateRemoved(
  membership: Membership,
  templateId: string,
): Membership {
  return {
    ...membership,
    appliedTemplates: membership.appliedTemplates.filter((a) => a.templateId !== templateId),
  };
}

/**
 * What applying this template to this seat would do — computed, not described.
 *
 * Used by the confirmation screen and by the command itself, so the sentence an
 * owner reads and the change that happens are the same value.
 */
export function previewTemplateApplication(
  membership: Membership,
  organization: Organization,
  template: PermissionTemplate,
  actor: ApplyActor,
  at: string,
): AccessDiff {
  const { applied, withheld } = snapshotOf(template, actor, organization.type, at);
  const next = withTemplateApplied(membership, applied);
  return {
    ...diff(
      effectivePermissions(membership, organization),
      effectivePermissions(next, organization),
    ),
    withheld: sorted(withheld),
    adjustments: adjustmentsOf(membership, applied.permissions),
  };
}

/** The same, for taking a template back off a seat. */
export function previewTemplateRemoval(
  membership: Membership,
  organization: Organization,
  templateId: string,
): AccessDiff {
  const next = withTemplateRemoved(membership, templateId);
  const removedEntry = membership.appliedTemplates.find((a) => a.templateId === templateId);
  return {
    ...diff(
      effectivePermissions(membership, organization),
      effectivePermissions(next, organization),
    ),
    withheld: [],
    adjustments: adjustmentsOf(membership, removedEntry?.permissions ?? []),
  };
}

/* -------------------------------------------------------------------------- */
/* Drift                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A seat carrying an older version of a template than the template now has.
 *
 * ★ THIS IS THE PRODUCT BEHAVIOUR, NOT A WARNING ABOUT A BUG ★
 * Drift is the expected, correct state after somebody edits a template: the
 * people who already hold it keep exactly the access they were given. The
 * screens surface it so an owner can ACT on it deliberately — never so the
 * product can resolve it on their behalf.
 */
export interface TemplateDrift {
  templateId: string;
  templateName: string;
  /** The version on the seat. */
  appliedVersion: number;
  /** The version the template is on now. */
  currentVersion: number;
  /** The template was archived after this seat received it. */
  archived: boolean;
}

export function driftFor(
  membership: Membership,
  templates: readonly PermissionTemplate[],
): TemplateDrift[] {
  const out: TemplateDrift[] = [];
  for (const applied of membership.appliedTemplates) {
    const template = templates.find(
      (t) => t.id === applied.templateId && t.organizationId === membership.organizationId,
    );
    if (!template) continue;
    if (template.version === applied.version && !template.archived) continue;
    out.push({
      templateId: template.id,
      templateName: template.name,
      appliedVersion: applied.version,
      currentVersion: template.version,
      archived: template.archived,
    });
  }
  return out;
}

/** Whether a seat is behind on this one template. */
export function isBehind(membership: Membership, template: PermissionTemplate): boolean {
  const applied = membership.appliedTemplates.find((a) => a.templateId === template.id);
  return Boolean(applied) && applied!.version !== template.version;
}

/** Everyone in a roster who carries this template, whatever version. */
export function holdersOf(
  roster: readonly Membership[],
  templateId: string,
): Membership[] {
  return roster.filter(
    (m) => m.status !== "left" && m.appliedTemplates.some((a) => a.templateId === templateId),
  );
}

import { COMPLIANCE_EXTENSION_POINTS, complianceOrder, isOpen } from "@/lib/compliance";
import type {
  ComplianceAccessReason, ComplianceFilters, ComplianceRequirement,
  ComplianceShare, ComplianceSnapshot, ComplianceStatus, ComplianceSubjectGroup,
  ComplianceSubjectKind, ComplianceSummary, PermissionKey,
} from "@/types";
import { COMPLIANCE_STATUS_ORDER } from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AssignResponsibilityInput, ComplianceService, RecordResolutionInput,
  SuspendRequirementInput,
} from "../contracts/compliance";
import {
  activeShareFor, addNote, allRequirements, allShares, allSnapshots,
  assignResponsibility, recordResolution, reinstateRequirement,
  suspendRequirement, syncOrganization,
} from "./compliance-registry";

const LATENCY_MS = 220;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/**
 * The compliance service — and the boundary.
 *
 * Hiding a button is a courtesy. This file is where permissions, responsibility
 * scope, relationship scope and cross-organization isolation are actually
 * enforced, so a UI bug that renders a forbidden action still fails here.
 *
 * The rules, in the order they are applied:
 *
 *  1. `compliance:view` to read anything, `compliance:manage` to change anything.
 *  2. Each requirement declares its own permissions on top of that — you cannot
 *     read a driver's medical requirement without `drivers:view`.
 *  3. A record belongs to exactly one organization. Another organization reaches
 *     it ONLY through an active share that names both the subject and the exact
 *     requirement — there is no wildcard share. This is what keeps a dispatch
 *     organization to the units it books and away from the carrier's files.
 *  4. A driver-scoped membership sees its own record and the requirements it is
 *     personally responsible for, and nothing else.
 *  5. Frozen records are history. They are readable by the organization that
 *     holds them and by nobody else, and they can never be changed.
 */

function requireView(ctx: ServiceContext) {
  if (!ctx.permissions.has("compliance:view")) {
    throw new PermissionDeniedError(["compliance:view"]);
  }
}

function requireManage(ctx: ServiceContext) {
  requireView(ctx);
  if (!ctx.permissions.has("compliance:manage")) {
    throw new PermissionDeniedError(["compliance:manage"]);
  }
}

/** A membership scoped to its own records — a driver, in practice. */
function isSelfScoped(ctx: ServiceContext): boolean {
  return ctx.scope.loads === "assigned" && Boolean(ctx.driverProfileId);
}

/**
 * Why this membership may see this requirement, or nothing at all.
 *
 * Returning `null` for both "you may not" and "it does not exist" is
 * deliberate, and matches the truck and trailer registries: anything else turns
 * a requirement id into a directory of other organizations' compliance.
 */
export function accessReasonFor(
  ctx: ServiceContext,
  requirement: ComplianceRequirement,
): ComplianceAccessReason | null {
  if (!ctx.permissions.has("compliance:view")) return null;

  const isOwnRecord =
    requirement.subject.kind === "driver" &&
    Boolean(ctx.driverProfileId) &&
    requirement.subject.id === ctx.driverProfileId;

  // A requirement's own permissions gate reading about SOMEBODY ELSE. Reading
  // your own licence and medical card is not a `drivers:view` question — a
  // driver is not entitled to the carrier's roster, and is entitled to know why
  // they are about to be taken off dispatch.
  if (!isOwnRecord && !requirement.requires.every((k: PermissionKey) => ctx.permissions.has(k))) {
    return null;
  }

  if (requirement.organizationId === ctx.organizationId) {
    if (isSelfScoped(ctx)) {
      // A driver sees their own record, and anything they personally owe.
      if (isOwnRecord) return "own_driver_record";
      if (
        requirement.responsible.driverProfileId === ctx.driverProfileId &&
        requirement.requires.every((k: PermissionKey) => ctx.permissions.has(k))
      ) {
        return "responsible_party";
      }
      return null;
    }
    if (requirement.responsible.membershipId === ctx.membershipId) return "responsible_party";
    return requirement.subject.kind === "carrier" ? "own_organization" : "subject_relationship";
  }

  // Another organization's record. Frozen history never travels, and neither
  // does anything that was not explicitly named in a live share.
  if (requirement.frozenAt) return null;
  return activeShareFor(requirement, ctx.organizationId) ? "shared_with_dispatch" : null;
}

function visible(ctx: ServiceContext): ComplianceRequirement[] {
  // Bring this organization's records up to date with the systems that own the
  // subjects, so an ended relationship is frozen before it is ever read.
  syncOrganization(ctx.organizationId);
  // …and the organizations that have shared something with it, so a dispatcher
  // reads the carrier's live state rather than whatever was last materialized.
  // Only organizations that granted a share are touched: nothing here widens
  // what the caller can see, it only keeps what they may see current.
  for (const owner of sharingOrganizations(ctx.organizationId)) {
    syncOrganization(owner);
  }
  return allRequirements().filter((r) => accessReasonFor(ctx, r) !== null);
}

/** Organizations that have granted this one an active share. */
function sharingOrganizations(viewerOrganizationId: string): string[] {
  const owners = new Set<string>();
  for (const share of allShares()) {
    if (share.status !== "active") continue;
    if (share.viewerOrganizationId !== viewerOrganizationId) continue;
    if (share.ownerOrganizationId === viewerOrganizationId) continue;
    owners.add(share.ownerOrganizationId);
  }
  return [...owners];
}

function matches(
  ctx: ServiceContext,
  requirement: ComplianceRequirement,
  f: ComplianceFilters,
): boolean {
  // Two things are hidden unless explicitly asked for: requirements that do not
  // reach the subject, and frozen history. Neither is actionable, and both
  // would otherwise drown the queue.
  if (!f.includeNotApplicable && requirement.status === "not_applicable") return false;
  if (!f.includeFrozen && requirement.frozenAt) return false;

  if (f.subjectKind?.length && !f.subjectKind.includes(requirement.subject.kind)) return false;
  if (f.status?.length && !f.status.includes(requirement.status)) return false;
  if (f.severity?.length && !f.severity.includes(requirement.severity)) return false;
  if (f.subjectId && requirement.subject.id !== f.subjectId) return false;

  if (f.responsibility === "me") {
    const mine =
      requirement.responsible.membershipId === ctx.membershipId ||
      (Boolean(ctx.driverProfileId) &&
        requirement.responsible.driverProfileId === ctx.driverProfileId);
    if (!mine) return false;
  }
  if (f.responsibility === "unassigned" && requirement.responsible.kind !== "organization") {
    return false;
  }

  if (f.dueWithinDays != null) {
    if (!requirement.dueAt) return false;
    const limit = Date.now() + f.dueWithinDays * 86_400_000;
    if (new Date(requirement.dueAt).getTime() > limit) return false;
  }

  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = [
      requirement.label, requirement.description, requirement.subject.label,
      requirement.subject.detail ?? "", requirement.responsible.displayName,
      requirement.evidence?.label ?? "",
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function find(ctx: ServiceContext, requirementId: string): ComplianceRequirement {
  syncOrganization(ctx.organizationId);
  const found = allRequirements().find((r) => r.id === requirementId);
  // Unknown and forbidden are deliberately the same answer.
  if (!found || accessReasonFor(ctx, found) === null) {
    throw new NotFoundError("Compliance requirement");
  }
  return found;
}

/** Mutating anything requires the record to be this organization's own. */
function findMutable(ctx: ServiceContext, requirementId: string): ComplianceRequirement {
  const found = find(ctx, requirementId);
  if (found.organizationId !== ctx.organizationId) {
    // A share is a window, never a handle. A dispatcher can read a carrier's
    // inspection record; they cannot resolve it on the carrier's behalf.
    throw new PermissionDeniedError(["compliance:manage"]);
  }
  return found;
}

const EMPTY_COUNTS: Record<ComplianceStatus, number> = {
  compliant: 0, action_required: 0, expiring: 0, expired: 0,
  suspended: 0, not_applicable: 0,
};

const EMPTY_SUBJECT_COUNTS: Record<ComplianceSubjectKind, number> = {
  carrier: 0, driver: 0, truck: 0, trailer: 0,
};

export const mockComplianceService: ComplianceService = {
  async list(ctx, filters = {}) {
    await wait();
    requireView(ctx);
    return visible(ctx)
      .filter((r) => matches(ctx, r, filters))
      .sort(complianceOrder);
  },

  async get(ctx, requirementId) {
    await wait();
    requireView(ctx);
    return find(ctx, requirementId);
  },

  async bySubject(ctx, filters = {}) {
    await wait();
    requireView(ctx);
    const rows = visible(ctx).filter((r) => matches(ctx, r, filters));

    const groups = new Map<string, ComplianceSubjectGroup>();
    for (const requirement of rows) {
      const existing = groups.get(requirement.subject.id);
      if (existing) {
        existing.requirements.push(requirement);
      } else {
        groups.set(requirement.subject.id, {
          subject: requirement.subject,
          requirements: [requirement],
          worstStatus: requirement.status,
          openCount: 0,
        });
      }
    }
    for (const group of groups.values()) {
      group.requirements.sort(complianceOrder);
      group.worstStatus = group.requirements.reduce<ComplianceStatus>(
        (worst, r) =>
          COMPLIANCE_STATUS_ORDER[r.status] < COMPLIANCE_STATUS_ORDER[worst] ? r.status : worst,
        "not_applicable",
      );
      group.openCount = group.requirements.filter((r) => !r.frozenAt && isOpen(r.status)).length;
    }
    return [...groups.values()].sort(
      (a, b) =>
        COMPLIANCE_STATUS_ORDER[a.worstStatus] - COMPLIANCE_STATUS_ORDER[b.worstStatus] ||
        a.subject.label.localeCompare(b.subject.label),
    );
  },

  async summary(ctx): Promise<ComplianceSummary> {
    requireView(ctx);
    const rows = visible(ctx);
    const live = rows.filter((r) => !r.frozenAt);
    const counts = { ...EMPTY_COUNTS };
    const subjectsNeedingAction = { ...EMPTY_SUBJECT_COUNTS };
    const seen = new Map<ComplianceSubjectKind, Set<string>>();

    for (const requirement of live) {
      counts[requirement.status] += 1;
      if (isOpen(requirement.status)) {
        const bucket = seen.get(requirement.subject.kind) ?? new Set<string>();
        bucket.add(requirement.subject.id);
        seen.set(requirement.subject.kind, bucket);
      }
    }
    for (const [kind, ids] of seen) subjectsNeedingAction[kind] = ids.size;

    const horizon = Date.now() + 30 * 86_400_000;
    return {
      counts,
      criticalOpen: live.filter((r) => r.severity === "critical" && isOpen(r.status)).length,
      dueWithin30Days: live.filter(
        (r) => r.dueAt && new Date(r.dueAt).getTime() <= horizon && isOpen(r.status),
      ).length,
      subjectsNeedingAction,
      frozenRecords: rows.filter((r) => r.frozenAt).length,
    };
  },

  async openCount(ctx) {
    if (!ctx.permissions.has("compliance:view")) return 0;
    return visible(ctx).filter((r) => !r.frozenAt && isOpen(r.status)).length;
  },

  async snapshots(ctx, subjectId): Promise<ComplianceSnapshot[]> {
    await wait();
    requireView(ctx);
    // Snapshots are the organization's own history and are never shared.
    return allSnapshots()
      .filter((s) => s.organizationId === ctx.organizationId)
      .filter((s) => !subjectId || s.subject.id === subjectId)
      .sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime());
  },

  async shares(ctx): Promise<ComplianceShare[]> {
    await wait();
    requireView(ctx);
    syncOrganization(ctx.organizationId);
    return allShares()
      .filter(
        (s) =>
          s.ownerOrganizationId === ctx.organizationId ||
          s.viewerOrganizationId === ctx.organizationId,
      )
      .sort((a, b) => new Date(b.grantedAt).getTime() - new Date(a.grantedAt).getTime());
  },

  async recordResolution(ctx, requirementId, input: RecordResolutionInput) {
    await wait();
    requireManage(ctx);
    const requirement = findMutable(ctx, requirementId);
    return recordResolution(requirement.id, ctx.actor, input);
  },

  async assignResponsibility(ctx, requirementId, input: AssignResponsibilityInput) {
    await wait();
    requireManage(ctx);
    const requirement = findMutable(ctx, requirementId);
    return assignResponsibility(requirement.id, ctx.actor, input);
  },

  async suspend(ctx, requirementId, input: SuspendRequirementInput) {
    await wait();
    requireManage(ctx);
    const requirement = findMutable(ctx, requirementId);
    return suspendRequirement(requirement.id, ctx.actor, input.reason);
  },

  async reinstate(ctx, requirementId) {
    await wait();
    requireManage(ctx);
    const requirement = findMutable(ctx, requirementId);
    return reinstateRequirement(requirement.id, ctx.actor);
  },

  async addNote(ctx, requirementId, note) {
    await wait();
    requireManage(ctx);
    const requirement = findMutable(ctx, requirementId);
    return addNote(requirement.id, ctx.actor, note);
  },

  async extensionPoints(ctx) {
    requireView(ctx);
    // Every one of these reports available: false. Nothing is connected, and no
    // record of these kinds exists anywhere in this build.
    return [...COMPLIANCE_EXTENSION_POINTS];
  },
};

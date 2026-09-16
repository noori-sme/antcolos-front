import {
  QUALIFICATION_CATEGORY_LABEL,
  type NeedsYouCategory, type NeedsYouItem, type NeedsYouRecommendedAction,
  type NeedsYouSeverity, type PermissionKey, type WorkforceEngagement,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import { buildOnboardingChecklist } from "./workforce-onboarding";
import { engagementsFor, outstandingOffboarding } from "./workforce";
import { recordsWithNewerVersion } from "./qualification";
import { packagesForOrganization, isShareUsable } from "./document-shares";
import { liveEngagementFor } from "./workforce-store";
import { nowIso } from "./time";

/**
 * Workforce and qualification-file items that are REAL.
 *
 * Every item here is computed from live state on each read: deal with the thing
 * and the item stops existing, without anybody resolving it. That is the same
 * rule the Document Center and Compliance derivations keep, and it is the whole
 * difference between a queue and a screenshot.
 *
 * ★ WHAT DELIBERATELY RAISES NOTHING ★
 * An active engagement with nothing outstanding. A completed checklist row. A
 * retained qualification record sitting quietly under its obligation. A person
 * who simply works here. None of those need anybody, and a module that put them
 * in a queue would be building the HR inbox this milestone exists not to build
 * — and would train people to scroll past the four items that do matter.
 *
 * Retained records are the sharpest case and are worth saying out loud: there
 * is no "you have 400 records in retention" item, because nobody can act on it.
 * A disposal decision appears only when a backend policy has actually said an
 * obligation ended, which in this build is never.
 *
 * ★ ROUTING COMES FREE ★
 * Nothing here names a person. Each item declares the permissions it needs, and
 * `functionForPermissions` in the responsibility layer derives the function
 * from exactly those — so a qualification review routes to whoever holds
 * `compliance:manage` rather than to whoever the engagement calls a manager.
 * The manager field is never read here, and that is deliberate.
 */

export const WORKFORCE_ITEM_PREFIX = "nywf_";

export function isWorkforceNeedsYouId(id: string): boolean {
  return id.startsWith(WORKFORCE_ITEM_PREFIX);
}

const SYSTEM = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system" as const,
};

function item(input: {
  id: string;
  organizationId: string;
  category: NeedsYouCategory;
  severity: NeedsYouSeverity;
  title: string;
  reason: string;
  detail?: string;
  entity: NeedsYouItem["entity"];
  relatedEntities?: NeedsYouItem["relatedEntities"];
  action: NeedsYouRecommendedAction;
  requires: PermissionKey[];
  createdAt: string;
  dueAt?: string;
}): NeedsYouItem {
  return {
    id: input.id,
    organizationId: input.organizationId,
    category: input.category,
    severity: input.severity,
    status: "open",
    title: input.title,
    reason: input.reason,
    detail: input.detail,
    entity: input.entity,
    relatedEntities: input.relatedEntities,
    recommendedAction: input.action,
    dueAt: input.dueAt,
    source: "system",
    requires: input.requires,
    // Derived: there is nothing to write to, and hiding the row would not fix
    // the thing it is about. It stops appearing when the state stops producing
    // it, which is the only honest way to close it.
    derived: true,
    createdAt: input.createdAt,
    history: [{
      id: `${input.id}_created`,
      at: input.createdAt,
      actor: SYSTEM,
      action: "created",
      note: input.reason,
    }],
  };
}

/* -------------------------------------------------------------------------- */
/* Workforce                                                                   */
/* -------------------------------------------------------------------------- */

function engagementItems(ctx: ServiceContext, engagement: WorkforceEngagement): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  const entity = {
    kind: "workforce_engagement" as const,
    id: engagement.id,
    label: `${engagement.person.displayName} · ${engagement.positionTitle}`,
    href: `/workforce/${engagement.id}`,
  };

  // 1. Somebody was taken forward and nobody has decided about them. A
  //    prospective person who is simply sitting there IS somebody waiting.
  if (engagement.state === "prospective") {
    out.push(item({
      id: `${WORKFORCE_ITEM_PREFIX}applicant_${engagement.id}`,
      organizationId: engagement.organizationId,
      category: "workforce_applicant_review",
      severity: "medium",
      title: `Decide about ${engagement.person.displayName}`,
      reason: `${engagement.person.displayName} was taken forward as a prospective ${engagement.positionTitle.toLowerCase()} and nobody has started onboarding or turned them down.`,
      detail: engagement.source.label,
      entity,
      action: {
        kind: "review_applicant",
        label: "Open the engagement and decide",
        requires: ["workforce:manage"],
        href: `/workforce/${engagement.id}`,
      },
      requires: ["workforce:view"],
      createdAt: engagement.createdAt,
    }));
  }

  // 2 and 3. Onboarding: blocked somewhere, or finished and waiting to start.
  //    Only for an engagement actually IN onboarding — an active person's
  //    checklist is interesting on their page and is not work.
  if (engagement.state === "onboarding") {
    const checklist = buildOnboardingChecklist(engagement);
    const blocked = checklist.outstanding.filter((s) => s.status === "blocked");
    if (blocked.length > 0) {
      out.push(item({
        id: `${WORKFORCE_ITEM_PREFIX}blocked_${engagement.id}`,
        organizationId: engagement.organizationId,
        category: "workforce_onboarding_blocked",
        severity: "high",
        title: `Onboarding blocked for ${engagement.person.displayName}`,
        reason: blocked.map((s) => `${s.label}: ${s.detail}`).join(" "),
        // Names the module, so nobody goes looking for an HR bug.
        detail: `Blocked in ${blocked.map((s) => s.domain).join(", ")}. The module that owns the step is where it is fixed.`,
        entity,
        relatedEntities: blocked[0].sourceRef?.href
          ? [{
            kind: "document",
            id: blocked[0].sourceRef.id,
            label: blocked[0].sourceRef.label,
            href: blocked[0].sourceRef.href,
          }]
          : undefined,
        action: {
          kind: "open_engagement",
          label: "Open the engagement",
          requires: ["workforce:view"],
          href: `/workforce/${engagement.id}`,
        },
        requires: ["workforce:view"],
        createdAt: engagement.updatedAt,
      }));
    } else if (checklist.readyToActivate) {
      out.push(item({
        id: `${WORKFORCE_ITEM_PREFIX}start_${engagement.id}`,
        organizationId: engagement.organizationId,
        category: "workforce_start_approval",
        severity: "medium",
        title: `${engagement.person.displayName} is ready to start`,
        reason: "Every step required before starting is satisfied or waived in the module that owns it. Somebody has to say go.",
        entity,
        action: {
          kind: "start_engagement",
          label: "Review and start them",
          requires: ["workforce:manage"],
          href: `/workforce/${engagement.id}`,
        },
        requires: ["workforce:view"],
        createdAt: engagement.updatedAt,
        dueAt: engagement.startDate,
      }));
    }
  }

  // 4. The loudest one. Somebody has gone and something they held has not been
  //    dealt with — a former worker still holding access or work.
  const unfinished = outstandingOffboarding(engagement.id);
  if (unfinished.length > 0) {
    out.push(item({
      id: `${WORKFORCE_ITEM_PREFIX}offboard_${engagement.id}`,
      organizationId: engagement.organizationId,
      category: "workforce_offboarding_incomplete",
      severity: "critical",
      title: `Offboarding unfinished for ${engagement.person.displayName}`,
      reason: `${unfinished.length} step${unfinished.length === 1 ? "" : "s"} did not complete: ${unfinished.map((s) => s.label).join(", ")}. They have left and this is still outstanding.`,
      detail: unfinished.map((s) => s.reason).filter(Boolean).join(" "),
      entity,
      action: {
        kind: "finish_offboarding",
        label: "Finish the offboarding",
        requires: ["workforce:end"],
        href: `/workforce/${engagement.id}`,
      },
      requires: ["workforce:view"],
      createdAt: engagement.endDate ?? engagement.updatedAt,
    }));
  }

  void ctx;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Qualification file                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Two things, and only two, genuinely need a person here.
 *
 * A driver has shared documents this carrier has not reviewed, and a driver has
 * replaced a version this carrier is relying on. Everything else the
 * qualification file holds — a current adoption, a superseded record, a record
 * under retention — is a fact, not a task.
 */
function qualificationItems(ctx: ServiceContext): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];

  for (const record of recordsWithNewerVersion(ctx.organizationId)) {
    out.push(item({
      id: `${WORKFORCE_ITEM_PREFIX}newer_${record.id}`,
      organizationId: ctx.organizationId,
      category: "qualification_replacement_available",
      severity: "high",
      title: `${record.driverName} replaced their ${QUALIFICATION_CATEGORY_LABEL[record.category].toLowerCase()}`,
      reason: `This carrier's qualification file is pinned to version ${record.evidence.documentVersion}, and a newer version exists. The pinned record is still exactly what was relied on, and nothing moved on its own.`,
      detail: "Review the new version and adopt it explicitly if you rely on it. Both decisions stay visible.",
      entity: {
        kind: "qualification_record",
        id: record.id,
        label: `${QUALIFICATION_CATEGORY_LABEL[record.category]} · ${record.driverName}`,
        href: "/documents/shared",
      },
      relatedEntities: [{
        kind: "driver",
        id: record.driverProfileId,
        label: record.driverName,
        href: `/people/drivers/${record.driverProfileId}`,
      }],
      action: {
        kind: "review_qualification_document",
        label: "Review the newer version",
        requires: ["compliance:manage"],
        href: "/documents/shared",
      },
      // Only somebody entitled to the qualification file. Not every dispatcher
      // holding `documents:view`.
      requires: ["qualification:view"],
      createdAt: record.updatedAt,
    }));
  }

  // A driver has handed this carrier documents and is waiting on a decision —
  // but only where they have actually been taken forward as a candidate or a
  // worker. A cold share with nobody behind it is the Document Center's
  // existing "review what they shared" item, not an HR obligation.
  for (const pkg of packagesForOrganization(ctx.organizationId)) {
    if (!isShareUsable(pkg)) continue;
    const engagement = liveEngagementFor(ctx.organizationId, {
      driverProfileId: pkg.driverProfileId,
    });
    if (!engagement) continue;
    if (engagement.state !== "prospective" && engagement.state !== "onboarding") continue;
    const reviewed = pkg.events.filter((e) => e.kind === "review_recorded").length;
    if (reviewed >= pkg.items.length) continue;

    out.push(item({
      id: `${WORKFORCE_ITEM_PREFIX}qualreview_${engagement.id}_${pkg.id}`,
      organizationId: ctx.organizationId,
      category: "qualification_review_required",
      severity: "high",
      title: `Review the documents ${pkg.driverName} shared`,
      reason: `${pkg.items.length - reviewed} of ${pkg.items.length} shared documents have not been reviewed, and their onboarding is waiting on a qualification decision.`,
      detail: "Reviewing is not adopting, and adopting is not verifying. Each is an explicit step.",
      entity: {
        kind: "workforce_engagement",
        id: engagement.id,
        label: `${engagement.person.displayName} · ${engagement.positionTitle}`,
        href: `/workforce/${engagement.id}`,
      },
      action: {
        kind: "review_qualification_document",
        label: "Review what they shared",
        requires: ["compliance:manage"],
        href: "/documents/shared",
      },
      requires: ["qualification:view"],
      createdAt: pkg.createdAt,
      dueAt: pkg.expiresAt,
    }));
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* The contribution                                                            */
/* -------------------------------------------------------------------------- */

export function workforceNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  // Gated at the source: a membership that may not see the workforce gets no
  // workforce items at all, rather than items it is then filtered out of.
  if (!ctx.permissions.has("workforce:view") && !ctx.permissions.has("qualification:view")) {
    return [];
  }
  const out: NeedsYouItem[] = [];
  if (ctx.permissions.has("workforce:view")) {
    for (const engagement of engagementsFor(ctx.organizationId)) {
      out.push(...engagementItems(ctx, engagement));
    }
  }
  if (ctx.permissions.has("qualification:view")) {
    out.push(...qualificationItems(ctx));
  }
  void nowIso;
  return out;
}

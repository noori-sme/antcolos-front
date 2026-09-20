import type { NeedsYouItem, PermissionKey } from "@/types";
import { isDecidable } from "@/lib/referrals/state";
import type { ServiceContext } from "../contracts/context";
import { ensureSeeded, referralsForOrganization } from "./referral-store";
import { seedReferrals } from "./referral-seed";

/**
 * The one thing about referrals that genuinely needs somebody.
 *
 * An introduction nobody has answered. Not "you have four referrals" — a
 * decided one needs nobody, and a queue that kept showing them would be the
 * inbox this codebase keeps refusing to build.
 *
 * DERIVED, like every other item here: record a decision, or withdraw the
 * referral, and the item stops existing with nobody resolving anything. And
 * nothing in it names a person — it declares the permission it needs and the
 * responsibility layer routes from exactly that, so it reaches whoever reviews
 * referrals rather than whoever the referrer happened to know.
 *
 * ★ WHAT THE ITEM DELIBERATELY DOES NOT CARRY ★
 * The candidate's email and phone. Those live in the inbox behind
 * `referrals:review`; a queue card is read over shoulders, forwarded and
 * screenshotted, and a stranger's contact details do not belong on one. The
 * card carries a name, a company and a free-text title, which is the whole of
 * what somebody needs to decide whether to go and look.
 */

export const REFERRAL_ITEM_PREFIX = "nyref_";

export function isReferralNeedsYouId(id: string): boolean {
  return id.startsWith(REFERRAL_ITEM_PREFIX);
}

const REQUIRES: PermissionKey[] = ["referrals:review"];

/** Older than this and an unanswered introduction is embarrassing. */
const STALE_DAYS = 7;

export function referralNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!REQUIRES.every((k) => ctx.permissions.has(k))) return [];
  // The queue can be the first thing a session reads, so it seeds like every
  // other entry point rather than showing an empty inbox until somebody opens
  // the referrals screen.
  ensureSeeded(seedReferrals);

  return referralsForOrganization(ctx.organizationId)
    .filter(isDecidable)
    .map((referral) => {
      const ageDays =
        (Date.now() - new Date(referral.createdAt).getTime()) / 86_400_000;
      return {
        id: `${REFERRAL_ITEM_PREFIX}${referral.id}`,
        organizationId: referral.targetOrganizationId,
        category: "referral_review" as const,
        // Never louder than medium. Nobody's freight is stopped by this, and an
        // introduction that shouted would train people to ignore the queue.
        severity: ageDays >= STALE_DAYS ? ("medium" as const) : ("low" as const),
        status: "open" as const,
        title: `${referral.referrerNameSnapshot} referred `
          + `${referral.candidate.fullName} to your company`,
        reason: `Proposed as ${referral.proposedTitle}. Nobody here has said yes `
          + "or no yet.",
        detail: "Recording interest does not create a membership, permissions, "
          + "an engagement or employment. It only lets somebody start the normal "
          + "invitation, where all of that is decided separately.",
        entity: {
          kind: "referral" as const,
          id: referral.id,
          label: `${referral.candidate.fullName} · ${referral.proposedTitle}`,
          href: "/referrals",
        },
        recommendedAction: {
          kind: "review_referral" as const,
          label: "Open the referral",
          requires: REQUIRES,
          href: "/referrals",
        },
        requires: REQUIRES,
        source: "system" as const,
        createdAt: referral.createdAt,
        derived: true,
        history: [],
      };
    });
}

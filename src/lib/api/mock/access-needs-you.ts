import {
  ACCEPTANCE_STEP_LABEL, acceptanceOutstanding,
  type NeedsYouItem, type PermissionKey,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import { incompleteRuns, invitationById } from "./access-store";

/**
 * The one thing about invitations that genuinely needs somebody.
 *
 * Not "you have four invitations outstanding" — an unaccepted invitation needs
 * the recipient, not the sender, and a queue full of them would be the inbox
 * this codebase keeps refusing to build. What DOES need somebody here is
 * narrower and worse: a person who accepted and is only part-connected, because
 * one of the five records acceptance creates did not finish.
 *
 * That is the most dangerous state the access module can produce. Somebody
 * believes they have joined. Depending on which step failed, they may have a
 * relationship and no portal, or a portal and no documents. It is recoverable —
 * they accept again and it finishes what is missing — but only if anybody
 * knows, and nobody looks at a half-written record they cannot see.
 *
 * DERIVED, like every other item in this queue: finish the acceptance and it
 * stops existing, with nobody resolving anything. And nothing here names a
 * person — the item declares the permissions it needs and the responsibility
 * layer routes from exactly those, so it reaches whoever runs access rather
 * than whoever happens to be named on the invitation.
 */

export const ACCESS_ITEM_PREFIX = "nyacc_";

export function isAccessNeedsYouId(id: string): boolean {
  return id.startsWith(ACCESS_ITEM_PREFIX);
}

const REQUIRES: PermissionKey[] = ["invitations:view"];

export function accessNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!REQUIRES.every((k) => ctx.permissions.has(k))) return [];

  const out: NeedsYouItem[] = [];
  for (const run of incompleteRuns()) {
    const invitation = invitationById(run.invitationId);
    if (!invitation || invitation.organizationId !== ctx.organizationId) continue;

    const outstanding = acceptanceOutstanding(run);

    // Every step done and the run STILL not complete means the last thing
    // acceptance owes — the ledger line saying somebody joined — did not get
    // written, so `completedAt` was deliberately withheld. Nothing is missing
    // from the person's side and everything is missing from the record's, which
    // is precisely the state nobody would go looking for. Skipping it here (as
    // an earlier version did, by checking only `outstanding.length`) made the
    // one unfinished acceptance with no visible symptom the one nobody saw.
    const ledgerOnly = outstanding.length === 0;

    const names = ledgerOnly
      ? "the record of them joining"
      : outstanding.map((s) => ACCEPTANCE_STEP_LABEL[s.key]).join(", ");
    const reasons = outstanding
      .map((s) => s.failureReason)
      .filter((r): r is string => Boolean(r));

    out.push({
      id: `${ACCESS_ITEM_PREFIX}${run.invitationId}_${run.userId}`,
      organizationId: invitation.organizationId,
      category: "invitation_acceptance_incomplete",
      // Loud on purpose. The person thinks they have joined.
      severity: "high",
      status: "open",
      title: ledgerOnly
        ? `${invitation.recipientName} joined without a record of joining`
        : `${invitation.recipientName} is only part-connected`,
      reason: ledgerOnly
        ? "They accepted their invitation and every record it creates was made, but "
          + `${names} was not written, so the acceptance is not finished. Nothing they `
          + "hold is wrong; nothing says how they came to hold it."
        : `They accepted their invitation, and ${outstanding.length} of the records that `
          + `creates did not finish: ${names}. They may believe they have joined.`,
      detail: reasons.length > 0
        ? reasons.join(" ")
        : "Accepting again finishes what is missing and repeats nothing.",
      entity: {
        kind: "invitation",
        id: invitation.id,
        label: `${invitation.recipientName} · ${invitation.roleName}`,
        href: "/settings/invitations",
      },
      recommendedAction: {
        kind: "review_acceptance",
        label: "Look at what is missing",
        requires: ["invitations:view"],
        href: "/settings/invitations",
      },
      requires: REQUIRES,
      source: "system",
      createdAt: run.acceptedAt,
      history: [],
    });
  }
  return out;
}

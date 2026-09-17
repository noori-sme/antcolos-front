"use client";

import { ShieldCheck, UserMinus, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/states";
import { FormAlert } from "@/features/auth/form-alert";
import { useActiveMembership } from "@/lib/session/hooks";
import { useServiceContext } from "@/lib/api/use-service-context";
import { subscribeRoster } from "@/lib/session/membership-store";
import { services } from "@/lib/api";
import type { RosterEntry } from "@/lib/api/contracts/access";
import { permissionMeta } from "@/lib/permissions";
import { ENGAGEMENT_LABEL } from "@/features/driver/driver-rules";
import type { CarrierRelationship, Membership } from "@/types";

/**
 * Who is in this organization, what they may do, and how to take it away.
 *
 * ★ WHY THIS SCREEN IS PART OF PR-2 RATHER THAN A NICETY ★
 *
 * An access flow that can only add is not reviewable. "Accepting produced a
 * real seat" and "the seat is exactly what the invitation said" are claims you
 * can only check by looking at the roster from the OTHER side — the
 * organization's, not the joiner's — and "removing access removes access and
 * nothing else" cannot be checked at all without somewhere to remove it.
 *
 * It reads the membership store PR-1 built and derives every permission through
 * `effectivePermissions`. There is no second roster here, and no permission is
 * computed by this screen.
 */
export function PeopleScreen() {
  const { organization } = useActiveMembership();
  const ctx = useServiceContext();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /*
   * The roster can change while this page is open — somebody accepting an
   * invitation, or this screen removing a seat — so it is RE-READ from the
   * store on every change rather than snapshotted into state. `tick` exists
   * only to make that re-read happen; the answer always comes from the store.
   */
  const [tick, setTick] = useState(0);
  const [people, setPeople] = useState<RosterEntry[]>([]);
  useEffect(() => subscribeRoster(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void services.access.roster(ctx).then((rows) => {
      if (!cancelled) setPeople(rows);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.organizationId, ctx?.membershipId, tick]);

  const remove = useCallback(async (membership: Membership) => {
    if (!ctx || busyId) return;
    setBusyId(membership.id);
    setRefusal(null);
    // Your own seat and somebody else's are two different commands. Removing
    // another person needs `members:suspend`; putting your own seat down needs
    // nothing, because a workspace you cannot leave is not one you agreed to.
    const result = membership.id === ctx.membershipId
      ? await services.access.leaveOrganization(ctx)
      : await services.access.endSeat(ctx, membership.id, "Removed from the People screen.");
    setBusyId(null);
    if (result.status === "refused") setRefusal(result.message);
  }, [ctx, busyId]);

  if (!organization) return null;

  return (
    <div className="space-y-section">
      <PageHeader
        title="People"
        description={`Who belongs to ${organization.displayName} and what they may do here.`}
      />

      {refusal ? (
        <FormAlert tone="danger" title="That seat was not removed.">{refusal}</FormAlert>
      ) : null}

      {people.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          description="Invitations that have been accepted show up here."
        />
      ) : (
        <ul className="space-y-3" data-testid="people-list">
          {people.map((entry) => (
            <PersonRow
              key={entry.membership.id}
              entry={entry}
              isSelf={entry.membership.id === ctx?.membershipId}
              busy={busyId === entry.membership.id}
              onRemove={() => remove(entry.membership)}
            />
          ))}
        </ul>
      )}

      <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
        Removing somebody ends their access to this workspace and nothing else. Their Antcolos
        account, their driver profile, the documents they own and their seats in other
        organizations are untouched — and if they drive for you, they still do. Ending the working
        relationship is a separate, deliberate decision.
      </p>
    </div>
  );
}

function PersonRow({
  entry, isSelf, busy, onRemove,
}: {
  entry: RosterEntry;
  isSelf: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  // Everything here comes from the service. This row derives nothing: not the
  // permissions, not the person, not the relationship.
  const { membership, account, permissions } = entry;
  const engagement = entry.relationships[0];

  return (
    <li
      className="rounded-lg border border-border bg-surface p-3.5"
      data-testid="person-row"
      data-user-id={membership.userId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted"
          >
            {membership.isOwner ? <ShieldCheck className="size-[1.125rem]" /> : <UserRound className="size-[1.125rem]" />}
          </span>
          <div className="min-w-0">
            <p className="text-[0.875rem] font-semibold text-fg">
              {account?.displayName ?? membership.userId}
              {isSelf ? <span className="ml-1.5 text-[0.75rem] font-normal text-fg-muted">(you)</span> : null}
            </p>
            <p className="mt-0.5 text-[0.75rem] text-fg-muted">
              {membership.title ?? (membership.isOwner ? "Owner" : "Member")}
              {membership.isOwner ? " · owner" : null}
              {" · joined "}
              {new Date(membership.joinedAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              })}
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={onRemove}
          disabled={busy}
          aria-busy={busy || undefined}
          data-testid={isSelf ? "leave-organization" : "remove-access"}
        >
          <UserMinus aria-hidden />
          {busy ? "Removing…" : isSelf ? "Leave this organization" : "Remove access"}
        </Button>
      </div>

      {engagement ? <EngagementRow engagement={engagement} /> : null}

      <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">
          {membership.isOwner
            ? "Everything this workspace supports"
            : `${permissions.length} ${permissions.length === 1 ? "permission" : "permissions"}`}
        </span>
        {membership.isOwner ? null : (
          <>
            {" — "}
            {permissions.slice(0, 8).map((k) => permissionMeta(k).label).join(" · ")}
            {permissions.length > 8 ? ` · +${permissions.length - 8} more` : null}
          </>
        )}
      </p>
    </li>
  );
}

/**
 * The engagement, with acceptance and activation shown as different things.
 *
 * A row that printed only "engaged since —" would be a row that quietly asked
 * somebody to fill the blank in. This one says which date exists, which does
 * not, and whose claim it is when one does.
 */
function EngagementRow({ engagement }: { engagement: CarrierRelationship }) {
  return (
    <dl
      className="mt-2.5 grid gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-[0.75rem] sm:grid-cols-3"
      data-testid="engagement-row"
    >
      <div>
        <dt className="text-fg-muted">Engagement</dt>
        <dd className="mt-0.5 font-medium text-fg">
          {ENGAGEMENT_LABEL[engagement.engagementType]}
          {" · "}
          {engagement.status === "onboarding" ? "onboarding" : engagement.status}
        </dd>
      </div>
      <div>
        <dt className="text-fg-muted">Accepted</dt>
        <dd className="mt-0.5 font-medium text-fg">
          {engagement.acceptedAt
            ? new Date(engagement.acceptedAt).toLocaleDateString(undefined, {
              month: "short", day: "numeric", year: "numeric",
            })
            : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-fg-muted">Started</dt>
        <dd className="mt-0.5 font-medium text-fg" data-testid="started-cell">
          {engagement.startedAt
            ? `${new Date(engagement.startedAt).toLocaleDateString(undefined, {
              month: "short", day: "numeric", year: "numeric",
            })}${engagement.startedAtBasis === "carrier_asserted" ? " (as imported)" : ""}`
            : "Not started yet"}
        </dd>
      </div>
    </dl>
  );
}

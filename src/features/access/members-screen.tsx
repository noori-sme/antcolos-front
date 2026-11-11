"use client";

import { UserMinus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useServiceContext } from "@/lib/api/use-service-context";
import { useActiveMembership } from "@/lib/session/hooks";
import type { OrgMember } from "@/types/org-members";
import { useOrgMembers, useRemoveOrgMember } from "./hooks";

const PAGE_SIZE = 20;

/**
 * Settings → People in http mode (plan 12): everyone in the organization,
 * every role, from `GET /organizations/members`. An admin can remove a member.
 * Leaving yourself has no backend yet, so your own row has no remove button.
 */
export function MembersScreen() {
  const { organization } = useActiveMembership();
  const ctx = useServiceContext();
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useOrgMembers({ page, pageSize: PAGE_SIZE });
  const remove = useRemoveOrgMember();
  const meta = data?.meta;

  return (
    <div className="space-y-section">
      <PageHeader
        title="People"
        description={`Everyone who belongs to ${organization?.displayName ?? "this organization"}, in every role.`}
      />

      {remove.error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{remove.error.message}</p>
      ) : null}

      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : error ? (
        <ErrorState
          title="We couldn't load your members"
          description={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          description="People show up here once they accept an invitation."
          action={
            <Can permission="invitations:create">
              <Button asChild variant="primary" size="sm">
                <Link href="/settings/invitations">Invite someone</Link>
              </Button>
            </Can>
          }
        />
      ) : (
        <>
          <ul className="space-y-3" aria-label="Members">
            {data.data.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                isSelf={member.userId === ctx?.actor.userId}
                removing={remove.isPending && remove.variables === member.userId}
                onRemove={() => remove.mutateAsync(member.userId).then(() => undefined)}
              />
            ))}
          </ul>
          {meta && meta.totalPages > 1 ? (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
              <p className="text-[0.8125rem] text-fg-muted tabular-nums">
                Showing {(meta.page - 1) * meta.pageSize + 1}–
                {Math.min(meta.page * meta.pageSize, meta.totalItems)} of {meta.totalItems} members
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <span className="px-2 text-[0.8125rem] font-medium text-fg tabular-nums">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
        Removing somebody ends their access to this organization and nothing else. Their Antcolos
        account and their seats in other organizations are untouched. To change what someone may
        do, edit their role in{" "}
        <Link href="/settings/permissions" className="text-primary underline-offset-2 hover:underline">
          Roles and permissions
        </Link>
        .
      </p>
    </div>
  );
}

function MemberRow({
  member, isSelf, removing, onRemove,
}: {
  member: OrgMember;
  isSelf: boolean;
  removing: boolean;
  onRemove: () => Promise<void>;
}) {
  const joined = member.joinedAt
    ? new Date(member.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.9375rem] font-medium text-fg">
          {member.name}
          {isSelf ? <span className="ml-1.5 text-[0.8125rem] font-normal text-fg-subtle">(you)</span> : null}
        </p>
        <p className="truncate text-[0.8125rem] text-fg-muted">
          {member.email}
          {joined ? ` · joined ${joined}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Badge>{member.roleName || "Member"}</Badge>
        {member.hasPermissionOverrides ? <Badge tone="info">Custom access</Badge> : null}
      </div>
      {isSelf ? null : (
        <Can permission="members:suspend">
          <ConfirmDialog
            title={`Remove ${member.name}?`}
            description="They lose access to this organization straight away. Their account and their other organizations are untouched."
            confirmLabel="Remove"
            destructive
            onConfirm={onRemove}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                disabled={removing}
                aria-busy={removing || undefined}
                aria-label={`Remove ${member.name}`}
              >
                <UserMinus aria-hidden className="size-4" />
              </Button>
            }
          />
        </Can>
      )}
    </li>
  );
}

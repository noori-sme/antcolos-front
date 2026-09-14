"use client";

import { Link2, ShieldOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { SHARE_BASIS_LABEL, formatDocumentDate } from "@/lib/documents/labels";
import { useDocumentAction, useDocumentShares } from "./hooks";

/**
 * What this organization has given other organizations.
 *
 * A dispatch organization sees a carrier's document only because a grant like
 * one of these exists, so the grants have to be visible and revocable in one
 * place rather than buried on each document.
 */
export function SharesPanel({ canManage }: { canManage: boolean }) {
  const { data: shares, isPending } = useDocumentShares();
  const action = useDocumentAction();
  const [revoking, setRevoking] = useState<string | null>(null);

  if (isPending) return <LoadingSkeleton rows={3} />;

  const live = (shares ?? []).filter((s) => !s.revokedAt);
  const ended = (shares ?? []).filter((s) => s.revokedAt);

  if (live.length === 0 && ended.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="Nothing is shared"
        description="No other organization can see any of this workspace's documents."
      />
    );
  }

  return (
    <div className="space-y-4">
      <section aria-labelledby="live-shares">
        <h2 id="live-shares" className="mb-2 text-[0.9375rem] font-semibold text-fg">
          Active access ({live.length})
        </h2>
        <ul className="space-y-2">
          {live.map((share) => (
            <li key={share.id} className="rounded-lg border border-border bg-surface p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.875rem] font-medium text-fg">
                      {share.sharedWithName}
                    </span>
                    <Badge tone="outline">{SHARE_BASIS_LABEL[share.basis.kind]}</Badge>
                    {/* Viewing and downloading are separate grants. */}
                    <Badge tone={share.canDownload ? "info" : "neutral"}>
                      {share.canDownload ? "View and download" : "View only"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                    {share.purpose}
                  </p>
                  <p className="mt-1 text-[0.75rem] text-fg-subtle">
                    {share.basis.label} · granted {formatDocumentDate(share.grantedAt)} by{" "}
                    {share.grantedByName}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={action.isPending && revoking === share.id}
                    onClick={() => {
                      setRevoking(share.id);
                      action.mutate({
                        kind: "revoke",
                        shareId: share.id,
                        reason: "Access ended from the Document Center.",
                      });
                    }}
                  >
                    <ShieldOff aria-hidden />
                    End access
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {live.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">No organization currently has access.</p>
        ) : null}
      </section>

      {ended.length > 0 ? (
        <section aria-labelledby="ended-shares">
          <h2 id="ended-shares" className="mb-2 text-[0.9375rem] font-semibold text-fg">
            Ended access ({ended.length})
          </h2>
          <p className="mb-2 text-[0.8125rem] leading-relaxed text-fg-muted">
            Revoked grants are kept rather than deleted, and so is a snapshot of what the
            organization held while the access lasted.
          </p>
          <ul className="space-y-2">
            {ended.map((share) => (
              <li key={share.id} className="rounded-lg border border-border bg-surface-sunken p-3.5">
                <p className="text-[0.875rem] font-medium text-fg">{share.sharedWithName}</p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Ended {formatDocumentDate(share.revokedAt)}
                  {share.revokeReason ? ` · ${share.revokeReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

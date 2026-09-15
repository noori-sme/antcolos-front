"use client";

import { Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useActiveMembership } from "@/lib/session/hooks";
import type { ComplianceShare } from "@/types";
import { formatDate } from "./format";
import { useComplianceShares } from "./use-compliance";

/**
 * Exactly what leaves this organization, and exactly what came in.
 *
 * A dispatch organization sees a carrier's compliance only through one of
 * these, and only the requirements it names. Showing the shares themselves is
 * the point: "who can see our safety records" should never be a question you
 * have to ask support.
 */
export function SharingPanel() {
  const { organization } = useActiveMembership();
  const shares = useComplianceShares();
  const rows = shares.data ?? [];
  if (rows.length === 0) return null;

  const orgId = organization?.id;
  const granted = rows.filter((s) => s.ownerOrganizationId === orgId);
  const received = rows.filter((s) => s.viewerOrganizationId === orgId);

  return (
    <section
      aria-labelledby="compliance-sharing"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Share2 aria-hidden className="size-4 text-fg-subtle" />
        <h2 id="compliance-sharing" className="text-[0.875rem] font-semibold text-fg">
          Shared compliance
        </h2>
      </div>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        Each share names one subject and the exact requirements that travel with it.
        There is no &ldquo;share everything&rdquo;, and a share ends when the
        relationship it was granted for ends.
      </p>

      {granted.length > 0 ? (
        <Group title="Shared by this organization" rows={granted} label={(s) => s.viewerOrganizationName} />
      ) : null}
      {received.length > 0 ? (
        <Group title="Shared with this organization" rows={received} label={(s) => s.grantedByName} />
      ) : null}
    </section>
  );
}

function Group({
  title, rows, label,
}: {
  title: string;
  rows: ComplianceShare[];
  label: (share: ComplianceShare) => string;
}) {
  return (
    <div className="mt-3">
      <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
        {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {rows.map((share) => (
          <li
            key={share.id}
            className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[0.8125rem] font-medium text-fg">
                {share.subject.label} → {label(share)}
              </p>
              <Badge tone={share.status === "active" ? "success" : "neutral"}>
                {share.status === "active" ? "Active" : "Revoked"}
              </Badge>
            </div>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {share.purpose}
            </p>
            <p className="mt-1 text-[0.75rem] text-fg-subtle">
              {share.requirementKeys.length} requirement
              {share.requirementKeys.length === 1 ? "" : "s"} · granted{" "}
              {formatDate(share.grantedAt)}
              {share.revokedAt ? ` · revoked ${formatDate(share.revokedAt)}` : ""}
            </p>
            {share.revokedReason ? (
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{share.revokedReason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

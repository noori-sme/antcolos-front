"use client";

import { ArrowUpRight, CircleCheck, Plus } from "lucide-react";
import { LoadingSkeleton } from "@/components/data/states";
import { WORKSPACE_KIND_LABEL } from "@/types";
import { useUpgradePlan } from "./hooks";
import { DocumentStatusBadge } from "./chips";

/**
 * What upgrading would cost, honestly.
 *
 * An individual dispatch workspace becoming a dispatch organization is a change
 * of legal shape, not a restart. Everything the person already holds that the
 * company checklist also asks for is carried forward — they are not asked for
 * their W-9 again because they filed articles of organization — and the panel
 * says exactly which documents those are, which are genuinely new, and which
 * stop being asked for without being deleted.
 *
 * Nothing here performs the upgrade. It is a plan.
 */
export function UpgradePanel() {
  const { data: plan, isPending, error } = useUpgradePlan(true);

  if (isPending) return <LoadingSkeleton rows={3} />;
  if (error || !plan) {
    return (
      <p className="rounded-lg border border-border bg-surface px-3.5 py-6 text-center text-[0.8125rem] text-fg-muted">
        There is no upgrade available from this workspace.
      </p>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="upgrade-heading">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 id="upgrade-heading" className="flex items-center gap-2 text-[0.9375rem] font-semibold text-fg">
          <ArrowUpRight className="size-4 text-primary" aria-hidden />
          Becoming a {WORKSPACE_KIND_LABEL[plan.to].toLowerCase()}
        </h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
          Your {WORKSPACE_KIND_LABEL[plan.from].toLowerCase()} keeps everything it already holds.
          Only the documents a company is asked for that you do not already have are requested.
        </p>
      </div>

      <Group
        title={`Carried forward (${plan.carriedForward.length})`}
        description="Already on file and still applicable. You are not asked for these again."
        empty="Nothing on file carries forward yet."
      >
        {plan.carriedForward.map((item) => (
          <Row
            key={item.requirement.key}
            label={item.requirement.label}
            detail={item.document?.file?.fileName}
            icon={<CircleCheck className="size-4 text-st-success" aria-hidden />}
            status={item.status}
          />
        ))}
      </Group>

      <Group
        title={`Newly required (${plan.newlyRequired.length})`}
        description="Asked of a dispatch organization and not of an individual workspace."
        empty="Nothing extra would be asked of you."
      >
        {plan.newlyRequired.map((requirement) => (
          <Row
            key={requirement.key}
            label={requirement.label}
            detail={requirement.reason}
            icon={<Plus className="size-4 text-fg-subtle" aria-hidden />}
          />
        ))}
      </Group>

      <Group
        title={`No longer asked for (${plan.noLongerRequired.length})`}
        description="Kept in full, with their history. Nothing is deleted by an upgrade."
        empty="Everything you hold is still asked for."
      >
        {plan.noLongerRequired.map((item) => (
          <Row
            key={item.requirement.key}
            label={item.requirement.label}
            detail={item.document?.file?.fileName}
            status={item.status}
          />
        ))}
      </Group>
    </section>
  );
}

function Group({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-[0.875rem] font-semibold text-fg">{title}</h3>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{description}</p>
      {children.length === 0 ? (
        <p className="mt-2.5 text-[0.8125rem] text-fg-subtle">{empty}</p>
      ) : (
        <ul className="mt-2.5 space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

function Row({
  label,
  detail,
  icon,
  status,
}: {
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  status?: Parameters<typeof DocumentStatusBadge>[0]["status"];
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-surface-sunken px-3 py-2">
      {icon}
      <span className="text-[0.8125rem] font-medium text-fg">{label}</span>
      {status ? <DocumentStatusBadge status={status} /> : null}
      {detail ? (
        <span className="min-w-0 flex-1 truncate text-[0.75rem] text-fg-subtle">{detail}</span>
      ) : null}
    </li>
  );
}

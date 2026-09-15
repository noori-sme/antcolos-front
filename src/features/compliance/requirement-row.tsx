"use client";

import { ChevronRight, Lock, Paperclip, UserRound } from "lucide-react";
import Link from "next/link";
import { RENEWAL_BASIS_LABEL } from "@/config/compliance";
import type { ComplianceRequirement } from "@/types";
import { cn } from "@/lib/utils";
import { DueLabel } from "./due-label";
import { ComplianceStatusBadge, SeverityBadge, StatusBar } from "./status-chips";

/**
 * One requirement, in a list.
 *
 * Every row carries the three things somebody needs to decide whether to click
 * it: what state it is in, when it bites, and who owes it.
 */
export function RequirementRow({ requirement }: { requirement: ComplianceRequirement }) {
  const muted = requirement.status === "not_applicable" || Boolean(requirement.frozenAt);

  return (
    <Link
      href={`/compliance/${requirement.id}`}
      className={cn(
        "group flex w-full gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover sm:p-3.5",
        muted && "opacity-70",
      )}
    >
      <StatusBar status={requirement.status} className="self-stretch" />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ComplianceStatusBadge status={requirement.status} />
          <SeverityBadge severity={requirement.severity} />
          {requirement.frozenAt ? (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              <Lock aria-hidden className="size-3" />
              History
            </span>
          ) : null}
        </span>

        <span className="mt-1.5 block text-[0.9375rem] leading-5 font-semibold text-fg">
          {requirement.label}
        </span>
        {requirement.statusReason ? (
          <span className="mt-1 block line-clamp-2 text-[0.8125rem] leading-5 text-fg-muted">
            {requirement.statusReason}
          </span>
        ) : null}

        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <DueLabel dueAt={requirement.dueAt} status={requirement.status} />
          <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-fg-subtle">
            <UserRound aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{requirement.responsible.displayName}</span>
          </span>
          {requirement.evidence ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.75rem] text-fg-subtle">
              <Paperclip aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {requirement.evidence.fileName ?? requirement.evidence.label}
              </span>
            </span>
          ) : (
            <span className="text-[0.75rem] text-fg-subtle">No evidence linked</span>
          )}
          <span className="text-[0.75rem] text-fg-subtle">
            · {RENEWAL_BASIS_LABEL[requirement.renewal.basis]}
            {requirement.renewal.basis === "fixed_interval" && requirement.renewal.intervalMonths
              ? `, every ${requirement.renewal.intervalMonths} months`
              : ""}
          </span>
        </span>
      </span>

      <ChevronRight
        aria-hidden
        className="mt-1 size-4 shrink-0 self-start text-fg-subtle transition-colors group-hover:text-fg-muted"
      />
    </Link>
  );
}

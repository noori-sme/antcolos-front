"use client";

import {
  Building2, ChevronDown, ChevronRight, Container, Truck, UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { COMPLIANCE_SUBJECT_LABEL } from "@/config/compliance";
import { isOpen } from "@/lib/compliance";
import type { ComplianceSubjectGroup, ComplianceSubjectKind } from "@/types";
import { RequirementRow } from "./requirement-row";
import { ComplianceStatusBadge, StatusBar } from "./status-chips";

const SUBJECT_ICON: Record<ComplianceSubjectKind, LucideIcon> = {
  carrier: Building2, driver: UsersRound, truck: Truck, trailer: Container,
};

/**
 * One subject's requirements.
 *
 * What needs doing is always on screen; what is already satisfied is one click
 * away. A compliant fleet produces hundreds of green rows, and a page that
 * makes you scroll past all of them to find the three red ones is a page
 * nobody opens twice.
 */
export function SubjectGroup({ group }: { group: ComplianceSubjectGroup }) {
  const Icon = SUBJECT_ICON[group.subject.kind];
  const open = group.requirements.filter((r) => !r.frozenAt && isOpen(r.status));
  const rest = group.requirements.filter((r) => !open.includes(r));
  const [showRest, setShowRest] = useState(false);

  return (
    <section
      aria-labelledby={`subject-${group.subject.id}`}
      className="overflow-hidden rounded-lg border border-border bg-surface-sunken"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
        <StatusBar status={group.worstStatus} className="h-8" />
        <Icon aria-hidden className="size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <h2
            id={`subject-${group.subject.id}`}
            className="truncate text-[0.9375rem] font-semibold text-fg"
          >
            {group.subject.label}
          </h2>
          <p className="truncate text-[0.75rem] text-fg-subtle">
            {COMPLIANCE_SUBJECT_LABEL[group.subject.kind]}
            {group.subject.detail ? ` · ${group.subject.detail}` : ""}
          </p>
        </div>
        <ComplianceStatusBadge status={group.worstStatus} />
        {group.openCount > 0 ? <Badge tone="outline">{group.openCount} open</Badge> : null}
        {/* Straight through to the entity itself — the driver, the truck, the
            trailer, the organization record. */}
        {group.subject.href ? (
          <Link
            href={group.subject.href}
            className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-primary hover:underline"
          >
            Open {COMPLIANCE_SUBJECT_LABEL[group.subject.kind].toLowerCase()}
            <ChevronRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </header>

      {open.length > 0 ? (
        <ul className="space-y-2 border-t border-border p-2.5">
          {open.map((requirement) => (
            <li key={requirement.id}>
              <RequirementRow requirement={requirement} />
            </li>
          ))}
        </ul>
      ) : null}

      {rest.length > 0 ? (
        <div className="border-t border-border">
          <button
            type="button"
            aria-expanded={showRest}
            aria-controls={`rest-${group.subject.id}`}
            onClick={() => setShowRest((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-left text-[0.8125rem] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {showRest ? (
              <ChevronDown aria-hidden className="size-4" />
            ) : (
              <ChevronRight aria-hidden className="size-4" />
            )}
            {showRest ? "Hide" : "Show"} {rest.length}{" "}
            {open.length > 0 ? "that need nothing" : "requirement"}
            {open.length === 0 && rest.length !== 1 ? "s" : ""}
          </button>
          {showRest ? (
            <ul id={`rest-${group.subject.id}`} className="space-y-2 p-2.5 pt-0">
              {rest.map((requirement) => (
                <li key={requirement.id}>
                  <RequirementRow requirement={requirement} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

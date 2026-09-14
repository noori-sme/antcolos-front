"use client";

import {
  BellOff, CheckCircle2, ChevronRight, FileText, Package, Truck, User,
  Building2, Receipt, ArrowUpCircle, RefreshCw, Radar, Mail, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABEL, type NeedsYouEntityKind, type NeedsYouItem } from "@/types";
import { cn } from "@/lib/utils";
import { DueLabel } from "./due-label";
import { SeverityBar } from "./severity";

const ENTITY_ICON: Record<NeedsYouEntityKind, LucideIcon> = {
  load: Package, truck: Truck, driver: User, document: FileText,
  customer: Building2, settlement: Receipt, invoice: Receipt, mt_loop: RefreshCw,
  carrier: Building2, listing: Radar, draft: Mail,
};

export function NeedsYouCard({
  item, selected, onOpen, assigneeName,
}: {
  item: NeedsYouItem;
  selected?: boolean;
  onOpen: () => void;
  assigneeName?: string;
}) {
  const Icon = ENTITY_ICON[item.entity.kind];
  const muted = item.status === "snoozed" || item.status === "resolved";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group flex w-full gap-3 rounded-lg border bg-surface p-3 text-left transition-colors sm:p-4",
        selected
          ? "border-primary ring-1 ring-primary/25"
          : "border-border hover:border-border-strong hover:bg-surface-hover",
        muted && "opacity-70",
      )}
    >
      <SeverityBar severity={item.severity} className="self-stretch" />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
            {CATEGORY_LABEL[item.category]}
          </span>
          {item.status === "snoozed" ? (
            <Badge tone="neutral"><BellOff aria-hidden className="size-3" />Snoozed</Badge>
          ) : null}
          {item.status === "escalated" ? (
            <Badge tone="danger"><ArrowUpCircle aria-hidden className="size-3" />Escalated</Badge>
          ) : null}
          {item.status === "resolved" ? (
            <Badge tone="success"><CheckCircle2 aria-hidden className="size-3" />Resolved</Badge>
          ) : null}
        </span>

        <span className="mt-1 block text-[0.9375rem] leading-5 font-semibold text-fg">
          {item.title}
        </span>
        <span className="mt-1 block line-clamp-2 text-[0.8125rem] leading-5 text-fg-muted">
          {item.reason}
        </span>

        <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.75rem] text-fg-subtle">
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{item.entity.label}</span>
          </span>
          <DueLabel dueAt={item.dueAt} />
          {assigneeName ? (
            <span className="text-[0.75rem] text-fg-subtle">· {assigneeName}</span>
          ) : (
            <span className="text-[0.75rem] text-fg-subtle">· Unassigned</span>
          )}
        </span>
      </span>

      <ChevronRight
        aria-hidden
        className="mt-1 size-4 shrink-0 self-start text-fg-subtle transition-colors group-hover:text-fg-muted"
      />
    </button>
  );
}

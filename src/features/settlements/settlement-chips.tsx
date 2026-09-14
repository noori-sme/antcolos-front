import {
  Building2, CircleUser, IdCard, MessageSquareWarning, Scale, TriangleAlert, UserRound,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PAYEE_KIND_LABEL, SETTLEMENT_STATUS } from "@/config/statuses";
import type { PayeeKind, SettlementKind, SettlementStatus } from "@/types";
import { cn } from "@/lib/utils";
import { SETTLEMENT_KIND_LABEL } from "./settlement-labels";

/** One status vocabulary, so a status reads the same on every screen. */
export function SettlementStatusChip({ status }: { status: SettlementStatus }) {
  const { label, tone } = SETTLEMENT_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const PAYEE_ICON: Record<PayeeKind, LucideIcon> = {
  company_driver: UserRound,
  owner_operator: IdCard,
  dispatcher: CircleUser,
  dispatch_organization: Building2,
  other_payee: Scale,
};

export function PayeeKindChip({ kind, className }: { kind: PayeeKind; className?: string }) {
  const Icon = PAYEE_ICON[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted",
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {PAYEE_KIND_LABEL[kind]}
    </span>
  );
}

/** Only shown for corrections and revisions — a regular settlement needs no label. */
export function SettlementKindChip({ kind }: { kind: SettlementKind }) {
  if (kind === "regular") return null;
  return <Badge tone="outline">{SETTLEMENT_KIND_LABEL[kind]}</Badge>;
}

export function BlockedChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge tone="warning">
      <TriangleAlert aria-hidden className="size-3" />
      {count} to sort out
    </Badge>
  );
}

export function DisputeChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge tone="danger">
      <MessageSquareWarning aria-hidden className="size-3" />
      {count === 1 ? "Disputed" : `${count} disputes`}
    </Badge>
  );
}

/**
 * Overdue is about money still owed, not about the calendar. A settlement with
 * nothing outstanding is never late, whatever its due date says.
 */
export function OverdueChip({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <Badge tone="danger">
      {days} {days === 1 ? "day" : "days"} overdue
    </Badge>
  );
}

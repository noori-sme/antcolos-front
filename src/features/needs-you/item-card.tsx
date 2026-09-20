"use client";

import {
  ArrowUpCircle, BellOff, Briefcase, Building2, CalendarClock, CheckCircle2, ChevronRight,
  ClipboardCheck, ClipboardList, Container, FileSignature, FileText, Fuel, Handshake, IdCard,
  Mail, MailQuestion, Map, Package, Radar, Receipt, RefreshCw, Router, Satellite,
  ScrollText, ShieldAlert, ShieldCheck, TriangleAlert, Truck, User, UserCheck, UserPlus, UserSearch,
  UserCircle, Wrench, type LucideIcon,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CATEGORY_LABEL, SEVERITY_LABEL, type NeedsYouEntityKind, type NeedsYouItem,
} from "@/types";
import { cn } from "@/lib/utils";
import { AutomationMeter, DecisionActions, DecisionOutcome, PreworkTrail } from "./decision";
import { DueLabel } from "./due-label";
import { SeverityBar } from "./severity";

/**
 * One item, as a decision row.
 *
 * ★ WHAT A ROW IS FOR ★
 * Scanning, then one press. So the row carries no prose: a severity rail, a
 * work-type label, a title, a strip of key-value facts, a meter saying how much
 * of this the system already did, and the buttons that finish it. The reason
 * the item exists — a sentence somebody wrote for the queue — is on hover and
 * in the drawer, because a person who is about to press "Confirm $2,200" does
 * not need to read why the load was flagged.
 *
 * ★ NOT A BUTTON ★
 * The row used to be one big button. It cannot be: it now holds the decision
 * buttons themselves, and a button inside a button is invalid. The row is an
 * article carrying its own severity for tests and for anybody querying the
 * list, and the title is the control that opens the drawer.
 */

const ENTITY_ICON: Record<NeedsYouEntityKind, LucideIcon> = {
  load: Package, truck: Truck, trailer: Container, driver: User, document: FileText,
  customer: Building2, settlement: Receipt, invoice: Receipt,
  fuel_transaction: Fuel, mileage_record: Map, ifta_period: CalendarClock,
  organization: Building2, person: UserCircle, compliance_requirement: ShieldCheck,
  maintenance_requirement: Wrench, defect: TriangleAlert, repair_order: ClipboardList,
  policy: ShieldCheck, claim: TriangleAlert, carrier: Building2, mt_loop: RefreshCw,
  listing: Radar, draft: Mail, negotiation: Handshake, booking: ClipboardCheck,
  message: MailQuestion, rate_confirmation: FileSignature, driver_review: UserCheck,
  contract: ScrollText, contract_version: FileSignature,
  risk_case: ShieldAlert,
  eld_device: Satellite, eld_connection: Router,
  workforce_engagement: Briefcase, qualification_record: IdCard, invitation: Mail,
  import_claim: UserSearch,
  referral: UserPlus,
};

/** Severity as a two-letter mark rather than a word. Colour is never the only cue. */
const SEVERITY_MARK: Record<NeedsYouItem["severity"], { text: string; className: string }> = {
  critical: { text: "P1", className: "bg-st-danger-bg text-st-danger" },
  high: { text: "P2", className: "bg-st-warning-bg text-st-warning" },
  medium: { text: "P3", className: "bg-st-info-bg text-st-info" },
  low: { text: "P4", className: "bg-st-neutral-bg text-fg-muted" },
};

export function NeedsYouCard({
  item, selected, onOpen, assigneeName, onDecide, pending, mayAct,
}: {
  item: NeedsYouItem;
  selected?: boolean;
  onOpen: () => void;
  assigneeName?: string;
  /** Takes the pre-analysed decision and lets the system run the rest. */
  onDecide?: (optionId: string) => void;
  pending?: boolean;
  /** False when this membership may see the item but not act on it. */
  mayAct?: boolean;
}) {
  const Icon = ENTITY_ICON[item.entity.kind];
  const muted = item.status === "snoozed" || item.status === "resolved";
  const mark = SEVERITY_MARK[item.severity];
  const automation = item.automation;
  const decided = Boolean(automation?.decision);

  return (
    <article
      data-needs-you-item=""
      data-severity={item.severity}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "rounded-lg border bg-surface transition-colors",
        selected ? "border-primary ring-1 ring-primary/25" : "border-border",
        muted && !decided && "opacity-70",
      )}
    >
      <div className="flex items-stretch gap-2.5 p-2.5 sm:gap-3 sm:p-3">
        <SeverityBar severity={item.severity} className="self-stretch" />

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Line one: what kind of thing this is, and when it is due. */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "shrink-0 rounded-sm px-1 text-[0.625rem] font-bold tracking-wide",
                mark.className,
              )}
            >
              {mark.text}
            </span>
            <span className="sr-only">{SEVERITY_LABEL[item.severity]} severity.</span>
            <span className="min-w-0 truncate text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              {CATEGORY_LABEL[item.category]}
            </span>
            {item.status === "snoozed" ? (
              <BellOff aria-label="Snoozed" className="size-3 shrink-0 text-fg-subtle" />
            ) : null}
            {item.status === "escalated" ? (
              <ArrowUpCircle aria-label="Escalated" className="size-3 shrink-0 text-st-danger" />
            ) : null}
            {item.status === "resolved" ? (
              <CheckCircle2 aria-label="Resolved" className="size-3 shrink-0 text-st-success" />
            ) : null}

            <span className="ml-auto flex shrink-0 items-center gap-1">
              <DueLabel dueAt={item.dueAt} />
              <button
                type="button"
                onClick={onOpen}
                aria-label={`Details of ${item.title}`}
                className="inline-flex size-5 items-center justify-center rounded-sm text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </span>
          </div>

          {/* Line two: the title. The whole explanation is behind it. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpen}
                className="block max-w-full truncate text-left text-[0.875rem] leading-5 font-semibold text-fg underline-offset-4 hover:underline"
              >
                {item.title}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[26rem] font-normal">
              {item.reason}
            </TooltipContent>
          </Tooltip>

          {/* Line three: the facts, as a strip. No sentences. */}
          <dl className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.75rem] text-fg-subtle">
            <div className="flex min-w-0 items-center gap-1">
              <dt className="sr-only">Record</dt>
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <dd className="max-w-[16rem] truncate">{item.entity.label}</dd>
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <dt className="sr-only">Held by</dt>
              <dd className="truncate">{assigneeName ?? "Unassigned"}</dd>
            </div>
          </dl>

          {/* Line four: how much of this the system already did. */}
          {automation ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <AutomationMeter automation={automation} />
              <PreworkTrail automation={automation} />
            </div>
          ) : null}

          {/* Line five: the press. */}
          {automation ? (
            decided ? (
              <DecisionOutcome automation={automation} onOpen={onOpen} />
            ) : item.status === "resolved" ? null : (
              <DecisionActions
                automation={automation}
                onDecide={(optionId) => onDecide?.(optionId)}
                pending={pending}
                disabled={mayAct === false}
                disabledReason={
                  mayAct === false
                    ? `Needs ${item.recommendedAction.requires.join(", ")}`
                    : undefined
                }
              />
            )
          ) : null}
        </div>
      </div>
    </article>
  );
}

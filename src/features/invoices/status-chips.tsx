import { AlertTriangle, Check, CircleAlert, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUS } from "@/config/invoices";
import { cn } from "@/lib/utils";
import type { InvoiceReadinessCheck, InvoiceStatus } from "@/types";

export function InvoiceStatusBadge({
  status, withTitle = true,
}: {
  status: InvoiceStatus;
  withTitle?: boolean;
}) {
  const meta = INVOICE_STATUS[status];
  return (
    <Badge tone={meta.tone} title={withTitle ? meta.description : undefined}>
      {meta.label}
    </Badge>
  );
}

const CHECK_ICON = {
  pass: Check,
  warn: AlertTriangle,
  fail: CircleAlert,
} as const;

const CHECK_CLASS = {
  pass: "text-st-success",
  warn: "text-st-warning",
  fail: "text-st-danger",
} as const;

/** One readiness check, stated plainly: what it is, and why it is where it is. */
export function ReadinessRow({ check }: { check: InvoiceReadinessCheck }) {
  const Icon = CHECK_ICON[check.state];
  return (
    <li className="flex items-start gap-2.5 px-5 py-2.5">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", CHECK_CLASS[check.state])} />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-medium text-fg">
          {check.label}
          {check.state === "warn" ? (
            <span className="ml-1.5 text-[0.6875rem] font-normal text-fg-subtle">
              does not block
            </span>
          ) : null}
        </span>
        <span className="block text-[0.75rem] leading-5 text-fg-muted">{check.detail}</span>
      </span>
    </li>
  );
}

/** The one-line "why can this not be sent" summary. */
export function ReadinessSummary({
  ready, failing, alreadySent,
}: {
  ready: boolean;
  failing: InvoiceReadinessCheck[];
  alreadySent?: boolean;
}) {
  if (ready) {
    return (
      <p className="flex items-start gap-2 text-[0.8125rem] text-fg-muted">
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-st-success" />
        {alreadySent
          ? "Every check still passes on what was billed."
          : "Every check passed. This invoice can go to the payer."}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-[0.8125rem] text-fg-muted">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
      Held by {failing.length} check{failing.length > 1 ? "s" : ""}:{" "}
      {failing.map((c) => c.label.toLowerCase()).join(", ")}.
    </p>
  );
}

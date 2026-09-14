import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMpg } from "@/lib/fuel/units";
import { NO_FILING_NOTICE } from "@/lib/fuel/labels";

/** A single figure. Renders "—" rather than 0 when the value is withheld. */
export function Figure({
  label, value, hint, tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <p className="text-[0.75rem] font-medium text-fg-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-[1.375rem] leading-7 font-semibold tabular-nums",
          tone === "warning" && "text-st-warning",
          tone === "danger" && "text-st-danger",
          tone === "default" && "text-fg",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[0.75rem] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

/**
 * What the interface says when a figure exists but the caller may not see it.
 *
 * Never a zero and never a blank: an absent number and a number that happens
 * to be nothing are different facts, and a fuel screen that blurs them is
 * lying about the money.
 */
export function Withheld({ what = "this figure" }: { what?: string }) {
  return (
    <span className="text-[0.9375rem] font-normal text-fg-subtle" title={`You do not have permission to see ${what}.`}>
      Not shown
    </span>
  );
}

export function Mpg({ hundredths }: { hundredths: number }) {
  return <span className="tabular-nums">{formatMpg(hundredths)}</span>;
}

/** The sentence that has to appear wherever a return is shown. */
export function FilingNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted",
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{NO_FILING_NOTICE}</span>
    </p>
  );
}

export function SectionHeading({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[1rem] leading-6 font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Secondary detail, one hover away.
 *
 * ★ WHAT MAY GO IN HERE, AND WHAT MAY NOT ★
 *
 * A tooltip is for the EXPLANATION behind something the screen already states:
 * the carrier rule behind a skipped stage, the provenance behind a badge, the
 * sentence behind a blocker's label. The thing being explained stays on the
 * page. A dispatch-stopping conflict is never reduced to a hover — its label
 * and its colour remain visible, and only its paragraph moves.
 *
 * ★ AND IT IS NEVER THE ONLY WAY TO READ SOMETHING ★
 * Hover does not exist on a phone. Everything reachable through a tip here is
 * also in the actions panel, which is an ordinary tappable drawer — so nothing
 * critical is hover-only. Radix opens these on keyboard focus too, so a tip is
 * reachable by tab.
 */
export function Tip({
  text, children, className,
}: {
  /** The long form. Kept out of the layout. */
  text: ReactNode;
  /** What is always visible, and what the tip explains. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "cursor-help underline decoration-dotted decoration-from-font underline-offset-2",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-relaxed font-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/** A tip with nothing to attach to: a small ⓘ that carries the detail. */
export function InfoTip({ text, className }: { text: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label="More detail"
          className={cn(
            "inline-flex cursor-help items-center text-fg-subtle hover:text-fg-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-relaxed font-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A key and its value, side by side.
 *
 * ★ THE UNIT OF THIS UI ★
 * "24 listings from 3 sources, 10 the same load" is a sentence a dispatcher
 * reads. `Listings 24 · Sources 3/6 · Dupes 10` is three numbers they see.
 * Same information, a fraction of the scan cost, and the numbers line up
 * between one stage and the next.
 */
export function Metric({
  label, value, tone = "muted", title,
}: {
  label: string;
  value: string;
  tone?: "muted" | "good" | "warn" | "bad";
  title?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={title}>
      <span className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">{label}</span>
      <span
        className={cn(
          "text-[0.75rem] font-semibold tabular-nums",
          tone === "good" && "text-st-success",
          tone === "warn" && "text-st-warning",
          tone === "bad" && "text-st-danger",
          tone === "muted" && "text-fg",
        )}
      >
        {value}
      </span>
    </span>
  );
}

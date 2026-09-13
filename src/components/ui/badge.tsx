import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.75rem] font-medium leading-5 whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-st-neutral-bg text-fg-muted",
        info: "border-transparent bg-st-info-bg text-st-info",
        progress: "border-transparent bg-st-progress-bg text-st-progress",
        success: "border-transparent bg-st-success-bg text-st-success",
        warning: "border-transparent bg-st-warning-bg text-st-warning",
        danger: "border-transparent bg-st-danger-bg text-st-danger",
        outline: "border-border-strong bg-transparent text-fg-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };

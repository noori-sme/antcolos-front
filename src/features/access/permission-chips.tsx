import { cn } from "@/lib/utils";

/** Marks money permissions apart from merely powerful ones. */
export function FinancialChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-st-warning-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-warning",
        className,
      )}
    >
      Financial
    </span>
  );
}

export function SensitiveChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-st-danger-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-danger",
        className,
      )}
    >
      Sensitive
    </span>
  );
}

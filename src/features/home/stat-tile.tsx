import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatTile({
  icon: Icon, label, value, hint, tone = "default", href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
  href?: string;
}) {
  const valueClass = {
    default: "text-fg",
    danger: "text-st-danger",
    warning: "text-st-warning",
    success: "text-st-success",
  }[tone];

  const body = (
    <CardContent className="pt-4">
      <span className="flex items-center gap-2 text-fg-muted">
        <Icon aria-hidden className="size-4 text-fg-subtle" />
        <span className="text-[0.8125rem] font-medium">{label}</span>
      </span>
      <span
        className={cn(
          "tnum mt-1.5 block text-[1.5rem] leading-8 font-semibold tracking-[-0.02em] sm:text-[1.75rem] sm:leading-9",
          valueClass,
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 block min-h-4 text-[0.75rem] text-fg-subtle">{hint}</span>
    </CardContent>
  );

  if (href) {
    return (
      <Card className="transition-colors hover:border-border-strong hover:bg-surface-hover">
        <Link href={href} className="block rounded-lg">{body}</Link>
      </Card>
    );
  }
  return <Card>{body}</Card>;
}

/** Shown in place of a financial tile when the membership may not see money. */
export function HiddenFinancialTile({ permission }: { permission: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex h-full flex-col justify-center gap-1 pt-4">
        <p className="text-[0.8125rem] font-medium text-fg-muted">Revenue is hidden</p>
        <p className="text-[0.75rem] text-fg-subtle">
          This membership does not include{" "}
          <code className="font-mono">{permission}</code>. Loads can still be moved.
        </p>
      </CardContent>
    </Card>
  );
}

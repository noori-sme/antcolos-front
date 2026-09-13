import {
  AlertOctagon, AlertTriangle, CircleDot, Info, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABEL, type NeedsYouSeverity } from "@/types";
import { cn } from "@/lib/utils";

const META: Record<
  NeedsYouSeverity,
  { icon: LucideIcon; tone: "danger" | "warning" | "info" | "neutral"; bar: string; fg: string }
> = {
  critical: { icon: AlertOctagon, tone: "danger", bar: "bg-st-danger", fg: "text-st-danger" },
  high: { icon: AlertTriangle, tone: "warning", bar: "bg-st-warning", fg: "text-st-warning" },
  medium: { icon: CircleDot, tone: "info", bar: "bg-st-info", fg: "text-st-info" },
  low: { icon: Info, tone: "neutral", bar: "bg-st-neutral", fg: "text-fg-subtle" },
};

export function SeverityBadge({ severity }: { severity: NeedsYouSeverity }) {
  const meta = META[severity];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon aria-hidden className="size-3" />
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export function SeverityBar({
  severity, className,
}: {
  severity: NeedsYouSeverity;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("w-1 shrink-0 rounded-full", META[severity].bar, className)}
    />
  );
}

export function severityTextClass(severity: NeedsYouSeverity) {
  return META[severity].fg;
}

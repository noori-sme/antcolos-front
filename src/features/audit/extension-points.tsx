"use client";

import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AUDIT_MODULE_LABEL } from "@/lib/audit/actions";
import { useRiskExtensionPoints } from "./use-audit";

/**
 * What is NOT built.
 *
 * Security monitoring, fraud detection, identity verification, legal holds,
 * retention policies and outside compliance tools are later milestones. They
 * are listed here — rather than left as an empty tab or a zero — because a
 * panel reading "0 fraud alerts" means Antcolos looked and found none, and
 * Antcolos has not looked and is connected to nothing that could.
 */
export function ExtensionPointsPanel() {
  const points = useRiskExtensionPoints();
  if (!points.data?.length) return null;

  return (
    <section
      aria-labelledby="risk-extensions"
      className="rounded-lg border border-dashed border-border bg-surface-sunken p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Construction aria-hidden className="size-4 text-fg-subtle" />
        <h2 id="risk-extensions" className="text-[0.875rem] font-semibold text-fg">
          Not built yet
        </h2>
        <Badge tone="outline">{points.data.length} later milestones</Badge>
      </div>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        These are listed rather than shown as empty counts. Each one is a typed seam into the
        ledger above, so when it is built it extends this module instead of growing a second
        audit system beside it.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {points.data.map((point) => (
          <li key={point.kind} className="rounded-md border border-border bg-surface px-3.5 py-2.5">
            <p className="text-[0.8125rem] font-medium text-fg">{point.label}</p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {point.description}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              {point.wouldAdd}
            </p>
            <p className="mt-1.5 text-[0.6875rem] text-fg-subtle">
              Would read: {point.consumes.map((m) => AUDIT_MODULE_LABEL[m]).join(", ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

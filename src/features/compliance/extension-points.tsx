"use client";

import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useComplianceExtensionPoints } from "./use-compliance";

/**
 * What is NOT built.
 *
 * Roadside inspections, violations, accidents, claims, hours-of-service,
 * CSA/SMS monitoring and full audit preparation are later milestones. They are
 * listed here — rather than left as an empty tab or a zero — because an empty
 * "Violations: 0" reads as a clean record, and this product does not know that.
 */
export function ExtensionPointsPanel() {
  const points = useComplianceExtensionPoints();
  if (!points.data?.length) return null;

  return (
    <section
      aria-labelledby="compliance-extensions"
      className="rounded-lg border border-dashed border-border bg-surface-sunken p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Construction aria-hidden className="size-4 text-fg-subtle" />
        <h2 id="compliance-extensions" className="text-[0.875rem] font-semibold text-fg">
          Not built yet
        </h2>
        <Badge tone="outline">{points.data.length} later milestones</Badge>
      </div>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        These are listed rather than shown as empty tabs. A screen reading
        &ldquo;0 violations&rdquo; would mean Antcolos had looked and found none; it has
        not looked, and is not connected to anything that could.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {points.data.map((point) => (
          <li
            key={point.kind}
            className="rounded-md border border-border bg-surface px-3.5 py-2.5"
          >
            <p className="text-[0.8125rem] font-medium text-fg">{point.label}</p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {point.description}
            </p>
            <p className="mt-1.5 text-[0.6875rem] text-fg-subtle">
              Will attach to {point.attachesTo.length} requirement
              {point.attachesTo.length === 1 ? "" : "s"} tracked above.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

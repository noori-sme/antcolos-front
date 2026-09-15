"use client";

import { BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SOURCE_LABEL } from "@/lib/reports/sources/types";
import type { MetricDefinition, ReportSourceKey } from "@/types";

/**
 * What every number on the screen means and how it was worked out.
 *
 * This is not help text bolted on afterwards: a metric cannot exist without a
 * definition, so this panel is complete by construction.
 */
export function DefinitionsPanel({ definitions }: { definitions: MetricDefinition[] }) {
  if (definitions.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen aria-hidden className="size-4 text-fg-subtle" />
          How these numbers are calculated
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {definitions.map((definition) => (
          <div key={definition.key} className="border-t border-border pt-3 first:border-0 first:pt-0">
            <p className="text-[0.875rem] font-semibold text-fg">{definition.label}</p>
            <p className="mt-1 text-[0.8125rem] leading-5 text-fg-muted">
              {definition.definition}
            </p>
            <p className="mt-1.5 font-mono text-[0.75rem] leading-5 text-fg-subtle">
              {definition.formula}
            </p>
            <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
              Source:{" "}
              {definition.sources
                .map((s: ReportSourceKey) => SOURCE_LABEL[s])
                .join(", ")}
              {definition.requires?.length
                ? ` · Requires ${definition.requires.join(", ")}`
                : ""}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

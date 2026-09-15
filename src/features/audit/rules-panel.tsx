"use client";

import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RISK_SEVERITY_TONE } from "@/config/audit";
import { RISK_SEVERITY_LABEL } from "@/types";
import { useRiskRules } from "./use-audit";

/**
 * The rule catalogue, on screen.
 *
 * Every rule shows what it flags, how loudly, and — in the same box, not in a
 * footnote — what it cannot do. A rule whose limitations are hidden is a rule
 * somebody will read as a finding.
 */
export function RulesPanel() {
  const rules = useRiskRules();
  if (!rules.data?.length) return null;

  return (
    <section
      aria-labelledby="risk-rules"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical aria-hidden className="size-4 text-fg-subtle" />
        <h2 id="risk-rules" className="text-[0.875rem] font-semibold text-fg">
          What is being looked for
        </h2>
        <Badge tone="outline">{rules.data.length} mock rules</Badge>
      </div>
      <ul className="mt-3 grid gap-2 lg:grid-cols-2">
        {rules.data.map((rule) => (
          <li key={rule.id} className="rounded-md border border-border bg-surface-sunken p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[0.8125rem] font-medium text-fg">{rule.label}</p>
              <Badge tone={RISK_SEVERITY_TONE[rule.severity]}>
                {RISK_SEVERITY_LABEL[rule.severity]}
              </Badge>
            </div>
            <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
              {rule.description}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              <span className="font-medium">What it cannot do: </span>
              {rule.limitations}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

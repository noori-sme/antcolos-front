"use client";

import { Info } from "lucide-react";
import { RISK_RULES_NOTICE } from "@/lib/risk/rules";
import { RISK_SCOPE_NOTICE } from "@/lib/risk/extensions";

/**
 * What this module is NOT.
 *
 * Shown at the top of the Audit & Risk area rather than buried in a help page,
 * because the gap between "records what happened inside Antcolos" and "monitors
 * your business for fraud" is exactly the gap somebody will otherwise assume
 * has been closed.
 */
export function ScopeNotice() {
  return (
    <section
      aria-label="What this does and does not do"
      className="rounded-lg border border-dashed border-border bg-surface-sunken p-4"
    >
      <div className="flex gap-3">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">{RISK_SCOPE_NOTICE}</p>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">{RISK_RULES_NOTICE}</p>
        </div>
      </div>
    </section>
  );
}

/** The narrower version, for a screen that is only about signals or cases. */
export function RulesNotice() {
  return (
    <p className="rounded-md border border-dashed border-border bg-surface-sunken px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
      {RISK_RULES_NOTICE}
    </p>
  );
}

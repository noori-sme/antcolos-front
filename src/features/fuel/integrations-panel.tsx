"use client";

import { Plug, Plus } from "lucide-react";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import { useFuelAction, useFuelIntegrations } from "./hooks";

const WRITES_LABEL: Record<string, string> = {
  fuel_transaction: "fuel purchases",
  mileage_record: "mileage records",
  document: "documents",
  nothing: "nothing",
};

/**
 * The extension points, and their honest status.
 *
 * Every row says "Not connected", and there is no code path that can make one
 * say anything else — the status type has exactly one member. Trying it is
 * allowed, and returns the same answer from the service rather than a spinner
 * that resolves into a lie.
 */
export function IntegrationsPanel() {
  const { data } = useFuelIntegrations();
  const action = useFuelAction();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-[0.8125rem] leading-relaxed text-fg-muted">
        <Plug className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          No fuel card, ELD, GPS, telematics, receipt reading, toll, accounting or IFTA provider is
          connected. Every purchase and every mile in Antcolos today was put there by a person or
          by the development fixtures. These are the seams a real adapter will plug into — the
          shape of what each one returns is already decided, so the ledger will not have to move
          when one arrives.
        </span>
      </div>

      {result ? (
        <p role="status" className="rounded-md border border-st-info/30 bg-st-info-bg/40 px-3.5 py-2.5 text-[0.8125rem] text-fg-muted">
          {result}
        </p>
      ) : null}

      <ul className="grid gap-2.5 sm:grid-cols-2">
        {(data ?? []).map((integration) => (
          <li key={integration.id} className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-[0.875rem] font-semibold text-fg">{integration.label}</span>
              <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
                Not connected
              </span>
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
              {integration.description}
            </p>
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              Would write {integration.writes.map((w) => WRITES_LABEL[w] ?? w).join(" and ")}.
            </p>
            {integration.writes.includes("fuel_transaction") ||
            integration.writes.includes("mileage_record") ? (
              <Can permission="fuel:import">
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 -ml-2"
                  disabled={action.isPending}
                  onClick={async () => {
                    const outcome = await action.mutateAsync({ kind: "import", adapterId: integration.id });
                    const message = (outcome as { message?: string })?.message;
                    setResult(message ?? `${integration.label} is not connected.`);
                  }}
                >
                  <Plus aria-hidden />
                  Try an import
                </Button>
              </Can>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

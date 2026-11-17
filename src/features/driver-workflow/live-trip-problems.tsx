"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { ExceptionSeverityBadge, ExceptionStatusBadge } from "@/components/common/status-badge";
import {
  ReportExceptionDialog, type ReportedException,
} from "@/components/load-exceptions/report-exception-dialog";
import { Button } from "@/components/ui/button";
import { EXCEPTION_TYPE_LABEL, sortExceptions } from "@/lib/load-exceptions/forms";
import type { DriverLoad } from "@/types/driver-load";
import { useDriverLoadAction, useIntentKeys } from "./hooks";

/** "Report a problem" from the phone, and what was already reported (F1.5). */
export function DriverLoadProblems({ load }: { load: DriverLoad }) {
  const action = useDriverLoadAction(load.id);
  const keys = useIntentKeys();
  const [open, setOpen] = useState(false);
  const items = sortExceptions(load.exceptions);

  const report = (input: ReportedException) =>
    action
      .mutateAsync({
        action: { kind: "report", input: { ...input, source: "mobile_web" } },
        idempotencyKey: keys.keyFor(`report:${JSON.stringify(input)}`),
      })
      .then(() => keys.clear());

  return (
    <section aria-labelledby="driver-problems" className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="driver-problems" className="text-[0.9375rem] font-semibold text-fg">
          Problems
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <AlertTriangle aria-hidden />
          Report a problem
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">
          Running late, a breakdown, a problem at the dock? Tell dispatch here.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[0.875rem] font-medium text-fg">{EXCEPTION_TYPE_LABEL[e.type]}</p>
                <div className="flex gap-1.5">
                  <ExceptionSeverityBadge severity={e.severity} />
                  <ExceptionStatusBadge status={e.status} />
                </div>
              </div>
              <p className="mt-1 whitespace-pre-line break-words text-[0.8125rem] text-fg-muted">{e.notes}</p>
              {e.resolution ? <p className="mt-1 text-[0.8125rem] text-fg-muted">Dispatch: {e.resolution}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <ReportExceptionDialog
        loadNumber={load.brokerLoadNumber}
        stops={load.stops.map((s) => ({
          sequence: s.sequence,
          label: `Stop ${s.sequence} · ${s.type === "pickup" ? "Pickup" : "Delivery"} · ${s.city}, ${s.state}`,
        }))}
        open={open}
        onOpenChange={(next) => {
          if (!next) action.reset();
          setOpen(next);
        }}
        onSubmit={report}
        pending={action.isPending}
        error={action.error}
      />
    </section>
  );
}

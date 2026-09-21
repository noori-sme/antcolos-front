"use client";

import { Landmark, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FACTORING_DECISION_LABEL, FACTORING_SOURCE_LABEL, type FactoringBookingGate,
} from "@/types";
import { services } from "@/lib/api";
import type { ServiceContext } from "@/lib/api/contracts/context";
import { FactoringChip } from "./factoring-chip";

/**
 * What the booking confirmation says about factoring.
 *
 * Three things, always, and in this order:
 *
 *  1. THE DECISION, as it stands right now.
 *  2. WHERE IT CAME FROM AND HOW FRESH IT IS — including, when nothing was
 *     rechecked, a sentence saying so. A confirmation screen that implied a
 *     live recheck happened when a person read a spreadsheet on Tuesday is the
 *     exact dishonesty this module exists to avoid.
 *  3. WHAT IS BLOCKING, and the authorized way past it when the carrier's
 *     policy permits one.
 *
 * The override is not a checkbox. It takes a typed reason, it refuses an empty
 * one, and it writes an audit entry nothing can edit or remove.
 */
export function BookingFactoringPanel({
  gate, ctx, busy, onOverridden,
}: {
  gate: FactoringBookingGate;
  ctx: ServiceContext;
  busy: boolean;
  /** Called after an override is recorded, so the caller re-evaluates. */
  onOverridden: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function record() {
    const text = reason.trim();
    if (!text) {
      setError("An override needs a reason.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await services.factoring.override(ctx, { ...gate.subject, reason: text });
      setAsking(false);
      setReason("");
      onOverridden();
    } catch {
      setError("That override was refused. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid="booking-factoring"
      className="mt-2 rounded-md border border-border bg-surface-sunken px-3 py-2.5"
    >
      <p className="flex flex-wrap items-center gap-2 text-[0.75rem] font-medium text-fg">
        <Landmark className="size-3.5 text-fg-subtle" aria-hidden />
        Factoring
        <FactoringChip status={gate.status} />
        {gate.status.providerName ? (
          <span className="font-normal text-fg-muted">{gate.status.providerName}</span>
        ) : null}
      </p>

      {/* Freshness and provenance, said plainly rather than implied. */}
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
        {gate.recheckNote}
      </p>

      {gate.conditions.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {/* A conditional approval is only usable if the conditions are on
              the screen. They are never folded into a tooltip here. */}
          {gate.conditions.map((c) => (
            <li key={c} className="text-[0.75rem] leading-relaxed text-st-warning">· {c}</li>
          ))}
        </ul>
      ) : null}

      {gate.override ? (
        <p className="mt-1.5 rounded-md border border-st-warning/40 bg-st-warning-bg/35 px-2.5 py-1.5 text-[0.75rem] leading-relaxed text-fg">
          <ShieldAlert className="mr-1 inline size-3.5 align-text-bottom text-st-warning" aria-hidden />
          {gate.override.actor.displayNameSnapshot} booked past
          {" "}{FACTORING_DECISION_LABEL[gate.override.overriddenDecision].toLowerCase()}:
          {" "}&ldquo;{gate.override.reason}&rdquo;
        </p>
      ) : gate.block ? (
        <div className="mt-1.5 rounded-md border border-st-danger/40 bg-st-danger-bg/45 px-2.5 py-1.5">
          <p className="text-[0.75rem] leading-relaxed text-fg">{gate.block.detail}</p>

          {gate.overrideAvailable ? (
            asking ? (
              <div className="mt-2">
                <label htmlFor="factoring-override-reason" className="text-[0.75rem] font-medium text-fg">
                  Why book it anyway?
                </label>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Input
                    id="factoring-override-reason"
                    data-testid="factoring-override-reason"
                    value={reason}
                    placeholder="Broker is paying direct on this one"
                    onChange={(e) => setReason(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy || saving || !reason.trim()}
                    onClick={() => void record()}
                  >
                    Record the override
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Cancel</Button>
                </div>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-fg-subtle">
                  This writes an audit entry with your name and this reason on it. It cannot be
                  edited or removed afterwards.
                </p>
                {error ? (
                  <p role="alert" className="mt-1 text-[0.75rem] text-st-danger">{error}</p>
                ) : null}
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1.5"
                data-testid="factoring-override"
                onClick={() => setAsking(true)}
              >
                Book it anyway, with a reason
              </Button>
            )
          ) : (
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-fg-subtle">
              {gate.status.decision === "not_connected"
                ? "Connect a factoring account in Settings → Factoring, or change the policy."
                : "This carrier does not permit booking past a factoring block, or you are not authorized to."}
            </p>
          )}
        </div>
      ) : null}

      {gate.status.source && !gate.status.liveApi ? (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-fg-subtle">
          Source: {FACTORING_SOURCE_LABEL[gate.status.source]}. Antcolos is not connected to a
          factoring company.
        </p>
      ) : null}
    </div>
  );
}

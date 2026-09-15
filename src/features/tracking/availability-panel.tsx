"use client";

import { CheckCircle2, ChevronDown, ScanEye } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AVAILABILITY_EVIDENCE_LABEL, AVAILABILITY_STATE_DESCRIPTION,
  type AvailabilityDecision,
} from "@/types";
import { AvailabilityChip, BasisChip } from "./chips";

/**
 * The availability decision, with the whole argument behind it.
 *
 * The evidence list is the point of this panel. A dispatcher about to book
 * against "Likely Available" can read exactly what that rests on, including
 * the readings the engine looked at and refused to use — which is usually the
 * line that answers "why does it not just say empty".
 *
 * The confirm button is the only route from inferred to confirmed anywhere in
 * the product, and it says whose word is being recorded.
 */
export function AvailabilityPanel({
  decision, truckUnit, onConfirm, busy,
}: {
  decision: AvailabilityDecision;
  truckUnit?: string;
  onConfirm?: (empty: boolean, note: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const used = decision.evidence.filter((e) => !e.disregardedReason);
  const disregarded = decision.evidence.filter((e) => e.disregardedReason);

  return (
    <section
      aria-labelledby="availability-heading"
      className="rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2
            id="availability-heading"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
          >
            <ScanEye className="size-4 text-fg-subtle" aria-hidden />
            Availability{truckUnit ? ` — unit ${truckUnit}` : ""}
          </h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {AVAILABILITY_STATE_DESCRIPTION[decision.state]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AvailabilityChip state={decision.state} />
          <BasisChip basis={decision.basis} confidence={decision.confidence} />
        </div>
      </div>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg">{decision.rationale}</p>

      {decision.awaiting ? (
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Waiting on:</span> {decision.awaiting}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.75rem] sm:grid-cols-4">
        <Fact label="Expected empty" value={
          decision.expectedEmptyAt ? new Date(decision.expectedEmptyAt).toLocaleString() : "Not derivable"
        } />
        <Fact label="Where" value={
          decision.expectedEmptyCity
            ? `${decision.expectedEmptyCity}, ${decision.expectedEmptyState ?? ""}`
            : "Unknown"
        } />
        <Fact label="Decided" value={new Date(decision.decidedAt).toLocaleTimeString()} />
        <Fact label="Source" value={`${decision.provenance.adapter}${decision.provenance.mock ? " (mock)" : ""}`} />
      </dl>

      {onConfirm && decision.basis !== "confirmed" ? (
        <div className="mt-4 rounded-md border border-dashed border-border px-3.5 py-3">
          <p className="text-[0.8125rem] font-medium text-fg">
            Only a person can confirm this truck is empty
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            Recording it here is your confirmation as the dispatcher, not the driver&rsquo;s.
            Antcolos will not write a driver action nobody took.
          </p>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you check? (optional)"
              aria-label="Confirmation note"
              className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 placeholder:text-fg-subtle focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:outline-none"
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => onConfirm(true, note)}
              >
                <CheckCircle2 aria-hidden />
                It is empty
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onConfirm(false, note)}
              >
                Not empty
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            aria-hidden
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
          {open ? "Hide" : "Show"} the evidence ({used.length} used
          {disregarded.length > 0 ? `, ${disregarded.length} set aside` : ""})
        </Button>

        {open ? (
          <ul className="mt-2 divide-y divide-border">
            {decision.evidence.map((item, i) => (
              <li key={`${item.kind}-${i}`} className="py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.75rem]">
                  <Badge tone={item.disregardedReason ? "outline" : item.basis === "confirmed" ? "success" : "warning"}>
                    {AVAILABILITY_EVIDENCE_LABEL[item.kind]}
                  </Badge>
                  <span className="text-fg-subtle">
                    {item.basis === "confirmed" ? "Confirmed" : "Inferred"} · {item.attribution}
                    {" · "}
                    <span className="tnum">{Math.round(item.confidence * 100)}%</span>
                    {" · "}
                    {new Date(item.observedAt).toLocaleString()}
                  </span>
                </p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg">{item.summary}</p>
                {item.disregardedReason ? (
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-st-warning">
                    Set aside: {item.disregardedReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-[0.8125rem] text-fg">{value}</dd>
    </div>
  );
}

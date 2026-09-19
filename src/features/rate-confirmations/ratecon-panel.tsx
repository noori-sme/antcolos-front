"use client";

import { FileSignature } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BookingRecord, RateConWorkflow } from "@/types";
import { RATECON_STATUS_LABEL } from "@/types";
import { relativeTime } from "@/lib/utils/format";
import { InfoTip, Metric } from "@/features/mt-loop/tip";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { progressOf, receiveRateConfirmation } from "@/lib/api/mock/rate-confirmation";
import { PROJECTION_STATE_LABEL } from "@/types";
import { PROJECTION_TONE } from "./projection-tone";

/**
 * Where the rate confirmation is, on the truck's own page.
 *
 * Deliberately a summary with a link rather than the review itself: checking a
 * document field by field is a job somebody sits down to do, and burying it in
 * a panel among eight others is how it gets skimmed. The panel's job is to say
 * whether it has arrived, what it disagrees about, and how much is left.
 */
export function RateConSummary({ rateCon }: { rateCon: RateConWorkflow }) {
  const progress = progressOf(rateCon);
  const done = rateCon.status === "returned";

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <FileSignature className="size-4 text-fg-subtle" aria-hidden />
            Rate confirmation
            <Badge tone={done ? "success" : rateCon.status === "rejected" ? "danger" : "info"}>
              {RATECON_STATUS_LABEL[rateCon.status]}
            </Badge>
            {progress.disagreements > 0 && !done ? (
              <Badge tone="warning">
                {progress.disagreements} do not match
              </Badge>
            ) : null}
          </h2>
          {/* Broker, age, progress — three facts, not two sentences. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Metric label="From" value={rateCon.brokerName} />
            <Metric label="Age" value={relativeTime(rateCon.email.receivedAt)} />
            <Metric
              label="Checked"
              value={`${progress.reviewed}/${progress.required}`}
              tone={progress.reviewed === progress.required ? "good" : "warn"}
            />
            <InfoTip
              text={done
                ? `Signed as ${rateCon.carrierName} on the broker's own document — their page, unchanged, with a signature block added. Antcolos never returns a rewritten document.`
                : "Nothing is signed until every required field has been looked at by a person."}
            />
          </p>
        </div>
        <Button variant={done ? "secondary" : "primary"} size="sm" asChild>
          <Link href={`/dispatch/rate-confirmations/${rateCon.rateConId}`}>
            {done ? "Look at it" : "Check it"}
          </Link>
        </Button>
      </div>

      {done ? (
        <ul className="mt-3 space-y-0.5">
          {rateCon.distribution.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-muted">
              <Badge tone={PROJECTION_TONE[d.state]}>
                {PROJECTION_STATE_LABEL[d.state]}
              </Badge>
              {d.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Booked, and nothing has come from the broker yet.
 *
 * The button is the honest part. In a real system a mailbox rule would put the
 * document here; there is no mailbox, so a person asks for a sample one and the
 * panel says exactly that rather than implying an integration.
 */
export function RateConAwaiting({
  booking, ctx, onChanged,
}: {
  booking: BookingRecord;
  ctx: MtLoopContext | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await receiveRateConfirmation(booking.bookingId, ctx).catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    onChanged();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <FileSignature className="size-4 text-fg-subtle" aria-hidden />
            Rate confirmation
            <Badge tone="warning">Not here yet</Badge>
          </h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {booking.loadReference} is booked and {booking.brokerName} has not sent one. A load
            without a signed confirmation is not a confirmed load, whatever was agreed on the phone.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void ask()}>
          Bring in a sample one
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[0.75rem] text-st-danger">{error}</p>
      ) : null}
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-subtle">
        No mailbox is connected, so nothing can arrive by itself. The sample is generated by
        Antcolos and behaves like a real one — including disagreeing with what was booked.
      </p>
    </section>
  );
}

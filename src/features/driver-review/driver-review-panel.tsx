"use client";

import { Eye, EyeOff, SlidersHorizontal, UserCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  DriverReview, DriverVisibilityField, DriverVisibilityPolicy, EngagementType,
} from "@/types";
import { DRIVER_REVIEW_STATUS_LABEL, VISIBILITY_FIELD_LABEL } from "@/types";
import { money, ratePerMile, relativeTime } from "@/lib/utils/format";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import {
  portDescription, recordDriverDecision, sendProgressUpdate, withdrawReview,
} from "@/lib/api/mock/driver-review";
import {
  ALL_VISIBILITY_FIELDS, labelOf, resetPolicyToDefault, setVisibilityField,
} from "@/lib/api/mock/driver-visibility";
import { InfoTip } from "@/features/mt-loop/tip";
import { cn } from "@/lib/utils";

/**
 * What the driver was sent, what they said, and what they are allowed to see.
 *
 * Three things a dispatcher has to be able to answer at a glance, and the third
 * is the one that is usually invisible: not "did I send it" but "what did they
 * actually receive". A driver who says "you never told me the rate" and a
 * dispatcher who says "I sent you everything" are both right when nobody can
 * see the redaction, so this panel shows exactly what crossed the boundary.
 *
 * Nothing here reaches a driver. Every screen that shows the port's output says
 * what the port is, in the port's own words, so the day the Driver Workflow is
 * merged the wording changes by itself.
 */
export function DriverReviewPanel({
  reviews, policies, carrierOrganizationId, carrierName, ctx, onChanged,
}: {
  reviews: DriverReview[];
  /** From the payload, so the editor re-renders when a policy changes. */
  policies: DriverVisibilityPolicy[];
  carrierOrganizationId?: string;
  carrierName?: string;
  ctx: MtLoopContext | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);

  async function act(fn: () => Promise<{ status: string }>) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await fn().catch(() => null) as { status: string; reason?: string } | null;
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    else if (outcome.status === "needs_reason") setError("That needs a reason in your own words.");
    else if (outcome.status === "no_driver") setError("There is no driver on this truck to send it to.");
    else if (outcome.status === "undeliverable") setError(outcome.reason ?? "It could not go.");
    onChanged();
  }

  function adjust(fn: () => void) {
    fn();
    onChanged();
  }

  const port = portDescription();
  const live = reviews.filter((r) => r.status !== "withdrawn");

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <UserCheck className="size-4 text-fg-subtle" aria-hidden />
            Sent to the driver
            <InfoTip text="Ask the driver before you negotiate. Once you have asked, nothing is negotiated until they answer." />
            {live.filter((r) => r.status === "waiting").length > 0 ? (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {live.filter((r) => r.status === "waiting").length}
              </span>
            ) : null}
          </h2>
        </div>
        {carrierOrganizationId ? (
          <Button variant="secondary" size="sm" onClick={() => setTuning((v) => !v)}>
            <SlidersHorizontal className="size-3.5" aria-hidden />
            What drivers see
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}

      {tuning && carrierOrganizationId ? (
        <VisibilityEditor
          policies={policies}
          carrierName={carrierName ?? "This carrier"}
          onSet={(engagementType, field, visible) =>
            adjust(() => setVisibilityField(
              carrierOrganizationId, engagementType, field, visible,
              ctx?.actor.displayNameSnapshot ?? "You",
            ))}
          onReset={(engagementType) =>
            adjust(() => resetPolicyToDefault(
              carrierOrganizationId, engagementType, ctx?.actor.displayNameSnapshot ?? "You",
            ))}
        />
      ) : null}

      {reviews.length === 0 ? (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3.5 py-4 text-[0.8125rem] font-medium text-fg">
          Nothing sent yet
          <InfoTip text="Use Driver on a load above. Sending is your choice unless the carrier asks for it." />
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {reviews.map((review) => (
            <ReviewRow
              key={review.reviewId}
              review={review}
              busy={busy}
              onAnswer={(kind, input) =>
                void act(() => recordDriverDecision(review.reviewId, kind, ctx!, input))}
              onUpdate={(note) => void act(() => sendProgressUpdate(review.reviewId, note, ctx!))}
              onWithdraw={(reason) => void act(() => withdrawReview(review.reviewId, reason, ctx!))}
            />
          ))}
        </ul>
      )}

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-fg-subtle">{port.statement}</p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewRow({
  review, busy, onAnswer, onUpdate, onWithdraw,
}: {
  review: DriverReview;
  busy: boolean;
  onAnswer: (
    kind: "approved" | "declined" | "paused" | "countered",
    input?: { comment?: string; wantedRateCents?: number },
  ) => void;
  onUpdate: (note: string) => void;
  onWithdraw: (reason: string) => void;
}) {
  const [showSent, setShowSent] = useState(false);
  const [form, setForm] = useState<"none" | "answer" | "update" | "withdraw">("none");
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const s = review.sent;
  // Answerable while the ball is still with the driver in any sense. A pause is
  // a question, not an ending: the dispatcher answers it and the driver says
  // yes or no, and a screen that hides the button after a pause makes the
  // review unfinishable.
  const open = review.status === "waiting"
    || review.status === "paused"
    || review.status === "countered";

  return (
    <li className={cn(
      "rounded-md border bg-surface-sunken px-3.5 py-3",
      review.status === "approved" ? "border-st-success/45"
        : review.status === "declined" ? "border-st-danger/40"
          : review.status === "waiting" ? "border-primary/40"
            : "border-border",
      review.status === "withdrawn" && "opacity-70",
    )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {s.originCity}, {s.originState} → {s.destinationCity}, {s.destinationState}
            <Badge tone={
              review.status === "approved" ? "success"
                : review.status === "declined" ? "danger"
                  : review.status === "waiting" ? "info" : "outline"
            }
            >
              {DRIVER_REVIEW_STATUS_LABEL[review.status]}
            </Badge>
          </p>
          <p className="mt-0.5 text-[0.75rem] text-fg-muted">
            {review.driverName} · unit {review.truckUnit} · sent by {review.sentByName}{" "}
            {relativeTime(review.sentAt)}
          </p>
          {review.withdrawnReason ? (
            <p className="mt-1 text-[0.75rem] text-fg-muted">{review.withdrawnReason}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {open ? (
            <>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setForm("answer"); setComment(""); setAmount(""); }}>
                They answered
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setForm("update"); setNote(""); }}>
                Keep them posted
              </Button>
            </>
          ) : null}
          {review.status !== "withdrawn" && review.status !== "approved" ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setForm("withdraw"); setNote(""); }}>
              Pull it back
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setShowSent((v) => !v)}>
            {showSent ? "Hide" : "What they got"}
          </Button>
        </div>
      </div>

      {review.decisions.length > 0 ? (
        <ol className="mt-2 space-y-1 border-t border-border pt-2">
          {review.decisions.map((d) => (
            <li key={d.decisionId} className="flex flex-wrap items-baseline gap-x-2 text-[0.75rem]">
              <span className="font-medium text-fg">{review.driverName}</span>
              <span className="text-fg-muted">{DRIVER_REVIEW_STATUS_LABEL[d.kind]}</span>
              {d.wantedRateCents !== undefined ? (
                <span className="font-medium tabular-nums text-fg">{money(d.wantedRateCents)}</span>
              ) : null}
              <Badge tone="warning">Recorded by a dispatcher — no driver app is connected</Badge>
              <span className="text-fg-subtle">{relativeTime(d.at)}</span>
              {d.comment ? <span className="w-full text-fg-muted">{d.comment}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {review.updates.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {review.updates.map((u) => (
            <li key={u.updateId} className="text-[0.75rem] text-fg-muted">
              <span className="font-medium text-fg">{u.byName}</span> told them:{" "}
              {u.note}
              {u.onTheTableCents !== undefined ? ` (${money(u.onTheTableCents)})` : ""}
              <span className="text-fg-subtle"> · {relativeTime(u.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {form === "answer" ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
          <p className="text-[0.75rem] font-medium text-fg">What did {review.driverName} say?</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={comment}
              placeholder="Too far from home this weekend"
              aria-label="What the driver said"
              onChange={(e) => setComment(e.target.value)}
              className="max-w-sm"
            />
            <Input
              inputMode="decimal"
              value={amount}
              placeholder="1050"
              aria-label="What they want for it, in dollars"
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-[9rem]"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => { onAnswer("approved", { comment }); setForm("none"); }}>
              They will take it
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !amount.trim()}
              onClick={() => {
                onAnswer("countered", { comment, wantedRateCents: Math.round(Number.parseFloat(amount || "0") * 100) });
                setForm("none");
              }}
            >
              At a different number
            </Button>
            <Button variant="ghost" size="sm" disabled={busy || !comment.trim()} onClick={() => { onAnswer("paused", { comment }); setForm("none"); }}>
              They have a question
            </Button>
            <Button variant="ghost" size="sm" disabled={busy || !comment.trim()} onClick={() => { onAnswer("declined", { comment }); setForm("none"); }}>
              They said no
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setForm("none")}>Cancel</Button>
          </div>
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-subtle">
            Typed in by you, after a call. The driver&apos;s own screen is built in its own module
            and is not connected here.
          </p>
        </div>
      ) : null}

      {form === "update" || form === "withdraw" ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
          <label className="block text-[0.75rem] font-medium text-fg">
            {form === "update" ? "What do you want to tell them?" : "Why are you pulling it back?"}
            <Input
              value={note}
              placeholder={form === "update" ? "Broker came up $75" : "Truck went somewhere else"}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 max-w-sm"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !note.trim()}
              onClick={() => {
                if (form === "update") onUpdate(note.trim());
                else onWithdraw(note.trim());
                setForm("none");
              }}
            >
              {form === "update" ? "Send it" : "Pull it back"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setForm("none")}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {showSent ? <WhatTheyGot review={review} /> : null}
    </li>
  );
}

/**
 * Exactly what crossed the boundary, and exactly what did not.
 *
 * Both halves matter. A dispatcher who cannot see what was withheld cannot tell
 * whether the driver is missing the rate because the carrier hides it or
 * because nobody has one yet, and those are different conversations.
 */
function WhatTheyGot({ review }: { review: DriverReview }) {
  const s = review.sent;
  const rows: [string, string][] = [
    ["Lane", `${s.originCity}, ${s.originState} → ${s.destinationCity}, ${s.destinationState}`],
    ["Equipment", s.equipmentLabel],
  ];
  if (s.pickupAt) rows.push(["Picks up", new Date(s.pickupAt).toLocaleString()]);
  if (s.loadedMiles !== undefined) rows.push(["Loaded miles", s.loadedMiles.toLocaleString()]);
  if (s.deadheadMiles !== undefined) rows.push(["Empty miles", s.deadheadMiles.toLocaleString()]);
  if (s.commodity) rows.push(["Commodity", s.commodity]);
  if (s.weightLbs !== undefined) rows.push(["Weight", `${s.weightLbs.toLocaleString()} lb`]);
  if (s.brokerName) rows.push(["Broker", s.brokerName]);
  if (s.brokerContact) rows.push(["Broker contact", s.brokerContact]);
  if (s.totalRateCents !== undefined) rows.push(["What it pays", money(s.totalRateCents)]);
  if (s.ratePerMileCents !== undefined) rows.push(["Rate per mile", ratePerMile(s.ratePerMileCents)]);
  if (s.driverPayEstimateCents !== undefined) {
    rows.push(["Their estimated pay", `${money(s.driverPayEstimateCents)} (estimate)`]);
  }
  if (s.note) rows.push(["Your note", s.note]);

  return (
    <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface px-3 py-2.5 sm:grid-cols-2">
      <div>
        <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg">
          <Eye className="size-3.5 text-fg-subtle" aria-hidden />
          What {review.driverName} was sent
        </p>
        <dl className="mt-1 space-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-2 text-[0.75rem]">
              <dt className="text-fg-subtle">{label}</dt>
              <dd className="text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg">
          <EyeOff className="size-3.5 text-fg-subtle" aria-hidden />
          What was held back
        </p>
        {review.visibility.withheld.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">Nothing. They saw all of it.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {review.visibility.withheld.map((w) => (
              <li key={w.field} className="text-[0.75rem]">
                <span className="text-fg">{VISIBILITY_FIELD_LABEL[w.field]}</span>
                <span className="block text-fg-subtle">{w.because}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * What this carrier shows its drivers, by pay model.
 *
 * Two lists rather than one, because the whole point is that a company driver
 * and an owner-operator are not the same person to a carrier. Changing either
 * is a carrier's decision and is recorded as theirs.
 */
function VisibilityEditor({
  policies, carrierName, onSet, onReset,
}: {
  policies: DriverVisibilityPolicy[];
  carrierName: string;
  onSet: (engagementType: EngagementType, field: DriverVisibilityField, visible: boolean) => void;
  onReset: (engagementType: EngagementType) => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
      <p className="text-[0.8125rem] font-medium text-fg">
        What {carrierName} shows its drivers
      </p>
      <p className="text-[0.75rem] leading-relaxed text-fg-muted">
        Applies to every driver of theirs on that pay model. You can never send more than you can
        see yourself, whatever is set here.
      </p>
      {policies.map((policy) => (
        <PolicyBlock
          key={policy.engagementType}
          policy={policy}
          onSet={(field, visible) => onSet(policy.engagementType, field, visible)}
          onReset={() => onReset(policy.engagementType)}
        />
      ))}
    </div>
  );
}

function PolicyBlock({
  policy, onSet, onReset,
}: {
  policy: DriverVisibilityPolicy;
  onSet: (field: DriverVisibilityField, visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <fieldset className="rounded-md border border-border bg-surface px-3 py-2.5">
      {/* A legend names its fieldset only as the fieldset's first child. Nested
          in a wrapper it names nothing, and the group becomes unreachable to
          anybody navigating by landmark. */}
      <legend className="text-[0.8125rem] font-medium text-fg">
        {labelOf(policy.engagementType)}
      </legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.75rem] text-fg-muted">
          {policy.customized ? `changed by ${policy.updatedByName}` : "as shipped"}
        </p>
        {policy.customized ? (
          <Button variant="ghost" size="sm" onClick={onReset}>Put back</Button>
        ) : null}
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {ALL_VISIBILITY_FIELDS.map((field) => {
          const on = policy.visible.includes(field);
          return (
            <li key={field}>
              <label className="flex items-center gap-2 text-[0.75rem] text-fg">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onSet(field, e.target.checked)}
                  className="size-3.5 accent-[var(--color-primary)]"
                />
                {VISIBILITY_FIELD_LABEL[field]}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

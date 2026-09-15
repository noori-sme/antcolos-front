"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/lib/utils/format";
import type { DisputeReason, SettlementPaymentMethod, Settlement } from "@/types";
import { DISPUTE_REASON_LABEL, PAYMENT_METHOD_LABEL } from "./settlement-labels";
import type { SettlementMutation } from "./hooks";

/**
 * The dialogs that change a settlement.
 *
 * Each one says plainly what it is about to do before it does it — approving
 * freezes the figures, correcting creates a second record, recording a payment
 * does not move any money. None of them decides whether the action is allowed:
 * that is the service's answer, and these are only opened for capabilities the
 * service has already said yes to.
 */

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

interface DialogProps {
  settlement: Settlement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: SettlementMutation;
}

function useRun(action: SettlementMutation, onOpenChange: (open: boolean) => void) {
  return (settlementId: string, next: Parameters<SettlementMutation["mutate"]>[0]["action"]) => {
    action.mutate(
      { id: settlementId, action: next },
      { onSuccess: () => onOpenChange(false) },
    );
  };
}

function ErrorLine({ action }: { action: SettlementMutation }) {
  if (!action.isError) return null;
  return (
    <p role="alert" className="mt-3 text-[0.8125rem] text-st-danger">
      {action.error.message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Approve                                                                     */
/* -------------------------------------------------------------------------- */

export function ApproveDialog({ settlement, open, onOpenChange, action }: DialogProps) {
  const [note, setNote] = useState("");
  const run = useRun(action, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Approve ${settlement.number}?`}
        description={`${settlement.payee.displayNameSnapshot} will be owed ${money(
          settlement.totals.netPayCents,
        )} for ${settlement.period.label}.`}
      >
        <p className="mt-3 rounded-md bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          Approving freezes the figures. From here they cannot be edited — if
          something turns out to be wrong, the fix is a correction, which is a
          new settlement linked to this one.
        </p>

        <div className="mt-4">
          <Field label="Note (optional)" htmlFor="approve-note" hint="Goes on the audit trail.">
            <Textarea
              id="approve-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Checked against the invoices and the fuel advances."
            />
          </Field>
        </div>

        <ErrorLine action={action} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={action.isPending}
            onClick={() => run(settlement.id, { kind: "approve", note: note.trim() || undefined })}
          >
            Approve and freeze
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispute                                                                     */
/* -------------------------------------------------------------------------- */

export function DisputeDialog({ settlement, open, onOpenChange, action }: DialogProps) {
  const [reason, setReason] = useState<DisputeReason>("incorrect_rate");
  const [summary, setSummary] = useState("");
  const [claimed, setClaimed] = useState("");
  const run = useRun(action, onOpenChange);

  const claimedCents = claimed.trim() ? Math.round(Number(claimed) * 100) : undefined;
  const claimedInvalid = claimed.trim() !== "" && !Number.isFinite(claimedCents);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Something wrong with ${settlement.number}?`}
        description="Say what looks wrong. The settlement is put on hold until somebody answers."
      >
        <div className="mt-4 space-y-4">
          <Field label="What is the problem?" htmlFor="dispute-reason">
            <select
              id="dispute-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as DisputeReason)}
              className={SELECT}
            >
              {(Object.keys(DISPUTE_REASON_LABEL) as DisputeReason[]).map((r) => (
                <option key={r} value={r}>{DISPUTE_REASON_LABEL[r]}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Tell them what happened"
            htmlFor="dispute-summary"
            hint="In your own words. Whoever looks at this sees exactly what you write."
          >
            <Textarea
              id="dispute-summary"
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="The Boise run was 501 miles, not 430 — the ELD trace shows the full route."
            />
          </Field>

          <Field
            label="Amount in question (optional)"
            htmlFor="dispute-amount"
            hint="If you know what you think you are owed, put it here."
            error={claimedInvalid ? "Enter an amount in dollars, like 38.00." : undefined}
          >
            <Input
              id="dispute-amount"
              inputMode="decimal"
              value={claimed}
              onChange={(e) => setClaimed(e.target.value)}
              placeholder="38.00"
            />
          </Field>
        </div>

        <ErrorLine action={action} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={action.isPending || !summary.trim() || claimedInvalid}
            onClick={() =>
              run(settlement.id, {
                kind: "raiseDispute",
                input: {
                  reason,
                  summary: summary.trim(),
                  claimedAmountCents: claimedInvalid ? undefined : claimedCents,
                },
              })
            }
          >
            Raise it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Resolve a dispute                                                           */
/* -------------------------------------------------------------------------- */

export function ResolveDisputeDialog({
  settlement,
  disputeId,
  open,
  onOpenChange,
  action,
}: DialogProps & { disputeId: string }) {
  const [outcome, setOutcome] = useState<"upheld" | "adjusted">("upheld");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const run = useRun(action, onOpenChange);

  const cents = Math.round(Number(amount) * 100);
  const correctionValid = outcome === "upheld" || (Number.isFinite(cents) && cents > 0 && label.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Close this dispute"
        description={`${settlement.payee.displayNameSnapshot} raised it against ${settlement.number}.`}
      >
        <div className="mt-4 space-y-4">
          <Field label="What did you decide?" htmlFor="resolve-outcome">
            <select
              id="resolve-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as "upheld" | "adjusted")}
              className={SELECT}
            >
              <option value="upheld">The settlement is right — it stands</option>
              <option value="adjusted">They were right — correct it</option>
            </select>
          </Field>

          <Field
            label="Explain the decision"
            htmlFor="resolve-note"
            hint="The payee sees this, and it goes on the audit trail."
          >
            <Textarea
              id="resolve-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {outcome === "adjusted" ? (
            <>
              <p className="rounded-md bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                This does not edit {settlement.number}. It raises a separate
                correction for the difference, linked to it both ways, so the
                record shows what actually happened.
              </p>
              <Field label="What is the correction for?" htmlFor="resolve-label">
                <Input
                  id="resolve-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Cargo claim deduction reversed"
                />
              </Field>
              <Field label="Amount to pay them" htmlFor="resolve-amount">
                <Input
                  id="resolve-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="250.00"
                />
              </Field>
            </>
          ) : null}
        </div>

        <ErrorLine action={action} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={action.isPending || !note.trim() || !correctionValid}
            onClick={() =>
              run(settlement.id, {
                kind: "resolveDispute",
                disputeId,
                input: {
                  resolution: outcome,
                  note: note.trim(),
                  adjustment:
                    outcome === "adjusted"
                      ? {
                          reason: note.trim(),
                          lines: [
                            {
                              kind: "adjustment",
                              direction: "addition",
                              label: label.trim(),
                              amountCents: cents,
                            },
                          ],
                        }
                      : undefined,
                },
              })
            }
          >
            {outcome === "adjusted" ? "Correct it" : "Close as it stands"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Record a payment                                                            */
/* -------------------------------------------------------------------------- */

export function RecordPaymentDialog({ settlement, open, onOpenChange, action }: DialogProps) {
  const outstanding = settlement.amountOutstandingCents;
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [method, setMethod] = useState<SettlementPaymentMethod>("ach");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const run = useRun(action, onOpenChange);

  const cents = Math.round(Number(amount) * 100);
  const amountError = !Number.isFinite(cents) || cents <= 0
    ? "Enter an amount in dollars, like 250.00."
    : cents > outstanding
      ? `That is more than the ${money(outstanding)} still outstanding.`
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record a payment"
        description={`${money(outstanding)} is still owed on ${settlement.number}.`}
      >
        <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          Antcolos does not move money. This records a payment that was made
          somewhere else, so the settlement reflects what actually happened.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Amount" htmlFor="payment-amount" error={amountError}>
            <Input
              id="payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label="How was it paid?" htmlFor="payment-method">
            <select
              id="payment-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as SettlementPaymentMethod)}
              className={SELECT}
            >
              {(Object.keys(PAYMENT_METHOD_LABEL) as SettlementPaymentMethod[]).map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Reference (optional)"
            htmlFor="payment-reference"
            hint="A check number or transfer reference. Never an account number."
          >
            <Input
              id="payment-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="CHK-2041"
            />
          </Field>

          <Field label="Date paid" htmlFor="payment-date">
            <Input
              id="payment-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </Field>
        </div>

        <ErrorLine action={action} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={action.isPending || Boolean(amountError)}
            onClick={() =>
              run(settlement.id, {
                kind: "recordPayment",
                input: {
                  amountCents: cents,
                  method,
                  referenceNumber: reference.trim() || undefined,
                  paidAt: new Date(`${paidAt}T12:00:00.000Z`).toISOString(),
                },
              })
            }
          >
            Record it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Raise a correction                                                          */
/* -------------------------------------------------------------------------- */

export function AdjustmentDialog({ settlement, open, onOpenChange, action }: DialogProps) {
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"addition" | "subtraction">("addition");
  const run = useRun(action, onOpenChange);

  const cents = Math.round(Number(amount) * 100);
  const amountError =
    amount.trim() === ""
      ? undefined
      : !Number.isFinite(cents) || cents <= 0
        ? "Enter an amount in dollars, like 68.00."
        : undefined;
  const ready = reason.trim() && label.trim() && Number.isFinite(cents) && cents > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Correct ${settlement.number}`}
        description="The original settlement is never edited. This raises a new one for the difference."
      >
        <p className="mt-3 rounded-md bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          {settlement.number} keeps its figures and its history exactly as they
          are. The correction gets its own number and its own audit trail, and
          the two point at each other — so the record reads as what happened,
          not as a number that changed by itself.
        </p>

        <div className="mt-4 space-y-4">
          <Field
            label="Why is this needed?"
            htmlFor="adjust-reason"
            hint="Goes on both records and on the payee's statement."
          >
            <Textarea
              id="adjust-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Detention on NL-24710 was approved after the settlement was paid."
            />
          </Field>

          <Field label="What is the line called?" htmlFor="adjust-label">
            <Input
              id="adjust-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Detention, NL-24710"
            />
          </Field>

          <Field label="Which way does it go?" htmlFor="adjust-direction">
            <select
              id="adjust-direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "addition" | "subtraction")}
              className={SELECT}
            >
              <option value="addition">Pay the payee more</option>
              <option value="subtraction">Take it back off them</option>
            </select>
          </Field>

          <Field label="Amount" htmlFor="adjust-amount" error={amountError}>
            <Input
              id="adjust-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="68.00"
            />
          </Field>
        </div>

        <ErrorLine action={action} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={action.isPending || !ready}
            onClick={() =>
              run(settlement.id, {
                kind: "createAdjustment",
                input: {
                  reason: reason.trim(),
                  lines: [
                    { kind: "adjustment", direction, label: label.trim(), amountCents: cents },
                  ],
                },
              })
            }
          >
            Raise the correction
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Void                                                                        */
/* -------------------------------------------------------------------------- */

export function VoidDialog({ settlement, open, onOpenChange, action }: DialogProps) {
  const [reason, setReason] = useState("");
  const run = useRun(action, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Void ${settlement.number}?`}
        description="It stays visible with your reason on it. Nothing is deleted."
      >
        <div className="mt-4">
          <Field
            label="Why is it being voided?"
            htmlFor="void-reason"
            hint="Required. Anyone looking at this settlement later will read it."
          >
            <Textarea
              id="void-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Raised twice for the same period. This is the duplicate."
            />
          </Field>
        </div>

        <ErrorLine action={action} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={action.isPending || !reason.trim()}
            onClick={() => run(settlement.id, { kind: "void", reason: reason.trim() })}
          >
            Void it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

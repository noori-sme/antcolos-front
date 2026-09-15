"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DISPUTE_REASON_LABEL, PAYMENT_METHOD_LABEL, SUBMISSION_CHANNEL_LABEL,
} from "@/config/invoices";
import { money } from "@/lib/utils";
import type {
  DisputeReasonCode, Invoice, PaymentMethod, SubmissionChannel,
} from "@/types";
import type { InvoiceableLoad } from "@/lib/api/contracts/invoices";

const today = () => new Date().toISOString().slice(0, 10);

/** Dollars in the field, cents in the record. Nothing floats past this line. */
function toCents(dollars: string): number {
  const parsed = Number.parseFloat(dollars);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 100);
}

/* -------------------------------------------------------------------------- */

export function NewInvoiceDialog({
  open, onOpenChange, loads, pending, error, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loads: InvoiceableLoad[];
  pending?: boolean;
  error?: string;
  onConfirm: (loadId: string) => void;
}) {
  const available = loads.filter((l) => !l.existingInvoiceId);
  const [loadId, setLoadId] = useState<string | null>(null);
  const selected = available.find((l) => l.loadId === loadId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        title="Invoice a load"
        description="Delivered loads the Loads module says may be billed. The invoice is built from the rate confirmation, the approved accessorials and the documents already on file."
      >
        <div className="mt-4 max-h-[22rem] space-y-2 overflow-y-auto">
          {available.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[0.8125rem] text-fg-muted">
              Every delivered load already has an invoice.
            </p>
          ) : (
            available.map((load) => (
              <button
                key={load.loadId}
                type="button"
                onClick={() => setLoadId(load.loadId)}
                aria-pressed={loadId === load.loadId}
                className={
                  "block w-full rounded-md border px-3 py-2.5 text-left transition-colors " +
                  (loadId === load.loadId
                    ? "border-primary bg-primary/8"
                    : "border-border hover:bg-surface-hover")
                }
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-mono text-[0.8125rem] font-medium text-fg">
                      {load.reference}
                    </span>
                    <span className="block truncate text-[0.75rem] text-fg-muted">
                      {load.billingPartyName} · {load.lane}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[0.8125rem] font-medium text-fg">
                    {money(load.totalRateCents)}
                  </span>
                </span>
                {load.missingDocumentKinds.length > 0 ? (
                  <Badge tone="warning" className="mt-1.5">
                    {load.missingDocumentKinds.length} document missing
                  </Badge>
                ) : null}
              </button>
            ))
          )}
        </div>

        {selected && selected.missingDocumentKinds.length > 0 ? (
          <p className="mt-3 rounded-md bg-st-warning-bg/60 px-3 py-2 text-[0.75rem] leading-5 text-fg-muted">
            This load is still short of paperwork. The invoice will be created and
            held at Needs Documents rather than refused — billing starts before
            the last POD arrives more often than not.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-[0.75rem] text-st-danger">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={!loadId || pending}
            onClick={() => loadId && onConfirm(loadId)}
          >
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const CHANNELS: SubmissionChannel[] = ["email", "portal", "factoring", "manual"];

export function SubmitDialog({
  invoice, open, onOpenChange, pending, error, onConfirm,
}: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending?: boolean;
  error?: string;
  onConfirm: (channel: SubmissionChannel, destination: string, note: string) => void;
}) {
  const [channel, setChannel] = useState<SubmissionChannel>(
    invoice.billingParty.submissionPortal ? "portal" : "email",
  );
  const [destination, setDestination] = useState(
    invoice.billingParty.billingContact?.email ??
      invoice.billingParty.submissionPortal ??
      "",
  );
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record this invoice as sent"
        description="Antcolos does not send invoices. Send it yourself, then record here what you did — that record is what the payment clock is counted from."
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">Sent by</span>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <Chip
                  key={c}
                  label={SUBMISSION_CHANNEL_LABEL[c]}
                  selected={channel === c}
                  onToggle={() => setChannel(c)}
                />
              ))}
            </div>
          </div>

          <Field
            label="Where it went"
            htmlFor="submit-destination"
            hint="The address, portal or factoring batch. Kept on the record."
          >
            <Input
              id="submit-destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="ap@broker.example"
            />
          </Field>

          <Field label="Note" htmlFor="submit-note" hint="Optional.">
            <Textarea
              id="submit-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Sent with the POD and the lumper receipt attached…"
            />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[0.75rem] text-st-danger">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => onConfirm(channel, destination.trim(), note.trim())}
          >
            {pending ? "Recording…" : "Record as sent"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const METHODS: PaymentMethod[] = ["ach", "check", "wire", "factoring", "other"];

export function RecordPaymentDialog({
  invoice, open, onOpenChange, pending, error, onConfirm,
}: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending?: boolean;
  error?: string;
  onConfirm: (input: {
    amountCents: number; method: PaymentMethod; receivedAt: string; reference: string;
  }) => void;
}) {
  const [amount, setAmount] = useState((invoice.balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [receivedAt, setReceivedAt] = useState(today());
  const [reference, setReference] = useState("");
  const [touched, setTouched] = useState(false);

  const cents = toCents(amount);
  const invalid =
    !Number.isFinite(cents) || cents <= 0 || cents > invoice.balanceCents;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record a payment"
        description="No payment processor is connected. This records what somebody saw arrive, and who said so."
      >
        <div className="mt-4 space-y-4">
          <Field
            label="Amount"
            htmlFor="payment-amount"
            hint={`${money(invoice.balanceCents)} outstanding.`}
            error={
              touched && invalid
                ? `Enter an amount between $0.01 and ${money(invoice.balanceCents)}.`
                : undefined
            }
          >
            <Input
              id="payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          </Field>

          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">Method</span>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <Chip
                  key={m}
                  label={PAYMENT_METHOD_LABEL[m]}
                  selected={method === m}
                  onToggle={() => setMethod(m)}
                />
              ))}
            </div>
          </div>

          <Field label="Received on" htmlFor="payment-date">
            <Input
              id="payment-date"
              type="date"
              value={receivedAt}
              max={today()}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </Field>

          <Field
            label="Reference"
            htmlFor="payment-reference"
            hint="Check number, ACH trace or factoring advice. Optional."
          >
            <Input
              id="payment-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check 20418"
            />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[0.75rem] text-st-danger">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={invalid || pending}
            onClick={() => {
              setTouched(true);
              if (invalid) return;
              onConfirm({
                amountCents: cents,
                method,
                receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(),
                reference: reference.trim(),
              });
            }}
          >
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const REASONS: DisputeReasonCode[] = [
  "rate_mismatch", "accessorial_rejected", "missing_documents",
  "duplicate_invoice", "load_not_recognized", "other",
];

export function DisputeDialog({
  invoice, open, onOpenChange, pending, error, onConfirm,
}: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending?: boolean;
  error?: string;
  onConfirm: (input: {
    reasonCode: DisputeReasonCode; detail: string; disputedAmountCents?: number;
  }) => void;
}) {
  const [reasonCode, setReasonCode] = useState<DisputeReasonCode>("rate_mismatch");
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);

  const invalid = detail.trim().length < 5;
  const cents = amount.trim() ? toCents(amount) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Open a dispute"
        description="Record what the payer is contesting, in their words. The invoice stays outstanding — a dispute is not a write-off."
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">Reason</span>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <Chip
                  key={r}
                  label={DISPUTE_REASON_LABEL[r]}
                  selected={reasonCode === r}
                  onToggle={() => setReasonCode(r)}
                />
              ))}
            </div>
          </div>

          <Field
            label="What they said"
            htmlFor="dispute-detail"
            error={touched && invalid ? "Say what is being contested." : undefined}
          >
            <Textarea
              id="dispute-detail"
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Their AP says the lumper was prepaid at the dock…"
            />
          </Field>

          <Field
            label="Amount contested"
            htmlFor="dispute-amount"
            hint={`Leave empty if the whole ${money(invoice.totalCents)} is in dispute.`}
          >
            <Input
              id="dispute-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="125.00"
            />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[0.75rem] text-st-danger">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={invalid || pending}
            onClick={() => {
              setTouched(true);
              if (invalid) return;
              onConfirm({
                reasonCode,
                detail: detail.trim(),
                disputedAmountCents:
                  cents != null && Number.isFinite(cents) && cents > 0 ? cents : undefined,
              });
            }}
          >
            {pending ? "Opening…" : "Open dispute"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/** One dialog for the two actions that just need a sentence: resolve and void. */
export function ReasonDialog({
  open, onOpenChange, title, description, label, placeholder, confirmLabel,
  danger, pending, error, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: string;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const invalid = reason.trim().length < 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="mt-4">
          <Field
            label={label}
            htmlFor="reason-dialog-text"
            hint="Recorded in the invoice's history against your name."
            error={touched && invalid ? "Say what happened, in a sentence." : undefined}
          >
            <Textarea
              id="reason-dialog-text"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={placeholder}
            />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[0.75rem] text-st-danger">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={invalid || pending}
            onClick={() => {
              setTouched(true);
              if (!invalid) onConfirm(reason.trim());
            }}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

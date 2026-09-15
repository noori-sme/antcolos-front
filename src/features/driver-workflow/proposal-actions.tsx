"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CounterofferKind, DriverProposalView } from "@/types";
import { COUNTEROFFER_HINT, COUNTEROFFER_LABEL } from "./labels";

/**
 * The driver's answers. Each dialog states the consequence of the action in the
 * driver's own terms before they commit to it — above all, that approving is
 * not the same as agreeing to be booked.
 */

export function ApproveDialog({
  proposal, open, onOpenChange, onConfirm, pending,
}: {
  proposal: DriverProposalView;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (note: string) => void;
  pending?: boolean;
}) {
  const [note, setNote] = useState("");
  const grantsConsent = proposal.policy.approvalGrantsBookingConsent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Approve continued negotiation"
        description={
          grantsConsent
            ? `Under ${proposal.policyLabel}, approving this also gives your consent to be booked on this load.`
            : "This tells dispatch to keep working the load. It is NOT your consent to be booked — they have to come back to you for that."
        }
      >
        <div className="mt-4">
          <Field
            label="Anything to add"
            htmlFor="approve-note"
            hint="Optional. Goes to dispatch with your answer."
          >
            <Textarea
              id="approve-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Works for me if the Boise appointment holds…"
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" disabled={pending} onClick={() => onConfirm(note.trim())}>
            {pending ? "Sending…" : grantsConsent ? "Approve and consent" : "Approve negotiation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RejectDialog({
  open, onOpenChange, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Reject this proposal"
        description="Dispatch stops working it for you. The proposal and everything on it stays on the record."
      >
        <div className="mt-4">
          <Field
            label="Reason"
            htmlFor="reject-reason"
            // Deliberately optional: requiring a reason produces "no" as the
            // reason, which tells dispatch less than an honest blank.
            hint="Optional, but it helps dispatch find you something better."
          >
            <Textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="That delivery window puts me over on hours…"
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="danger" disabled={pending} onClick={() => onConfirm(reason.trim())}>
            {pending ? "Sending…" : "Reject"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PauseDialog({
  proposal, open, onOpenChange, onConfirm, pending,
}: {
  proposal: DriverProposalView;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (minutes: number, reason: string) => void;
  pending?: boolean;
}) {
  const choices = proposal.policy.pauseDurationsMinutes;
  const [minutes, setMinutes] = useState(choices[0]);
  const [reason, setReason] = useState("");
  const used = proposal.pauses.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Pause this proposal"
        description="When the time is up it comes back to you for an answer. It is never taken as a yes or a no."
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">Pause for</span>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((m) => (
                <Chip
                  key={m}
                  label={m < 60 ? `${m} min` : `${m / 60}h`}
                  selected={minutes === m}
                  onToggle={() => setMinutes(m)}
                />
              ))}
            </div>
            <p className="text-[0.75rem] text-fg-subtle">
              {proposal.policyLabel} allows {proposal.policy.maxPauses} pause
              {proposal.policy.maxPauses === 1 ? "" : "s"} on one proposal. You have used {used}.
            </p>
          </div>

          <Field
            label="Why"
            htmlFor="pause-reason"
            hint="Optional. Dispatch sees this while they wait."
          >
            <Textarea
              id="pause-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Checking my hours…"
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" disabled={pending} onClick={() => onConfirm(minutes, reason.trim())}>
            {pending ? "Pausing…" : "Pause"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommentDialog({
  open, onOpenChange, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (body: string) => void;
  pending?: boolean;
}) {
  const [body, setBody] = useState("");
  const invalid = body.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a comment"
        description="Goes on the proposal's record where dispatch can see it. It is not an answer."
      >
        <div className="mt-4">
          <Field label="Comment" htmlFor="proposal-comment">
            <Textarea
              id="proposal-comment"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="I know that receiver — they run late on Fridays."
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" disabled={invalid || pending} onClick={() => onConfirm(body.trim())}>
            {pending ? "Adding…" : "Add comment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const FINANCIAL: CounterofferKind[] = ["rate", "accessorial"];

/**
 * Only the subjects carrier policy allows are offered — and the service refuses
 * the rest independently, so this list is a courtesy rather than the rule.
 */
export function CounterofferDialog({
  proposal, open, onOpenChange, onConfirm, pending,
}: {
  proposal: DriverProposalView;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (input: { kind: CounterofferKind; message: string; amountCents?: number }) => void;
  pending?: boolean;
}) {
  const allowed = proposal.policy.allowedCounterofferKinds;
  const [kind, setKind] = useState<CounterofferKind>(allowed[0] ?? "other");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");

  const wantsAmount = FINANCIAL.includes(kind);
  const parsed = Number(amount.replace(/[^0-9.]/g, ""));
  const amountCents = wantsAmount && amount.trim() !== "" ? Math.round(parsed * 100) : undefined;
  const amountInvalid = wantsAmount && amount.trim() !== "" && (!Number.isFinite(parsed) || parsed <= 0);
  const invalid = message.trim().length === 0 || amountInvalid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Submit a counteroffer"
        description={`Under ${proposal.policyLabel} you can raise ${allowed.length} subject${allowed.length === 1 ? "" : "s"} on this load.`}
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">What is this about</span>
            <div className="flex flex-wrap gap-1.5">
              {allowed.map((k) => (
                <Chip
                  key={k}
                  label={COUNTEROFFER_LABEL[k]}
                  selected={kind === k}
                  onToggle={() => setKind(k)}
                />
              ))}
            </div>
            <p className="text-[0.75rem] text-fg-subtle">{COUNTEROFFER_HINT[kind]}</p>
          </div>

          {wantsAmount ? (
            <Field
              label="Your number"
              htmlFor="counter-amount"
              hint="Optional — you can make the ask in words instead."
              error={amountInvalid ? "Enter an amount greater than zero." : undefined}
            >
              <Input
                id="counter-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1350.00"
              />
            </Field>
          ) : null}

          <Field
            label="What you need"
            htmlFor="counter-message"
            hint="Dispatch takes this to the broker, so say it the way you would say it to them."
          >
            <Textarea
              id="counter-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="I can do it if the pickup moves to after 09:00 — otherwise I am short on my break."
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={invalid || pending}
            onClick={() => onConfirm({ kind, message: message.trim(), amountCents })}
          >
            {pending ? "Sending…" : "Send counteroffer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

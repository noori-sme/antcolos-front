"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { MAX_SNOOZE_HOURS, type NeedsYouItem } from "@/types";
import { Chip } from "@/components/ui/chip";

const SNOOZE_CHOICES = [1, 2, 4, 8, 24, 48];

/**
 * Snooze always requires a reason and is capped by severity, so a critical item
 * can be cleared from the queue for a couple of hours but never parked.
 */
export function SnoozeDialog({
  item, open, onOpenChange, onConfirm, pending,
}: {
  item: NeedsYouItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (hours: number, reason: string) => void;
  pending?: boolean;
}) {
  const cap = MAX_SNOOZE_HOURS[item.severity];
  const choices = SNOOZE_CHOICES.filter((h) => h <= cap);
  const [hours, setHours] = useState(choices[0]);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const invalid = reason.trim().length < 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Snooze this item"
        description={`A ${item.severity} item can be snoozed for at most ${cap} hours. It returns to the queue automatically.`}
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">Snooze for</span>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((h) => (
                <Chip
                  key={h}
                  label={h < 24 ? `${h}h` : `${h / 24}d`}
                  selected={hours === h}
                  onToggle={() => setHours(h)}
                />
              ))}
            </div>
          </div>

          <Field
            label="Reason"
            htmlFor="snooze-reason"
            hint="Recorded in the item's history. Required."
            error={touched && invalid ? "Give a reason of at least 3 characters." : undefined}
          >
            <Textarea
              id="snooze-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Driver called, POD coming after the next stop…"
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
            onClick={() => {
              setTouched(true);
              if (!invalid) onConfirm(hours, reason.trim());
            }}
          >
            {pending ? "Snoozing…" : "Snooze"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EscalateDialog({
  open, onOpenChange, onConfirm, pending, members,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (note: string, toMembershipId?: string) => void;
  pending?: boolean;
  members: { membershipId: string; displayName: string; title?: string }[];
}) {
  const [note, setNote] = useState("");
  const [to, setTo] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  const invalid = note.trim().length < 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Escalate this item"
        description="The item stays open, is marked escalated, and the note is written to its history."
      >
        <div className="mt-4 space-y-4">
          {members.length > 0 ? (
            <div className="space-y-1.5">
              <span className="block text-[0.8125rem] font-medium text-fg">Escalate to</span>
              <div className="flex flex-wrap gap-1.5">
                <Chip label="An owner" selected={!to} onToggle={() => setTo(undefined)} />
                {members.map((m) => (
                  <Chip
                    key={m.membershipId}
                    label={m.displayName}
                    selected={to === m.membershipId}
                    onToggle={() => setTo(m.membershipId)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <Field
            label="Why"
            htmlFor="escalate-note"
            hint="Required. Goes into the audit history."
            error={touched && invalid ? "Give a short explanation." : undefined}
          >
            <Textarea
              id="escalate-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Broker is refusing detention; need an owner decision."
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
            onClick={() => {
              setTouched(true);
              if (!invalid) onConfirm(note.trim(), to);
            }}
          >
            {pending ? "Escalating…" : "Escalate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResolveDialog({
  open, onOpenChange, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (note?: string) => void;
  pending?: boolean;
}) {
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Mark as handled"
        description="The item leaves the queue and the resolution is recorded with your name and the time."
      >
        <div className="mt-4">
          <Field label="Note" htmlFor="resolve-note" hint="Optional.">
            <Textarea
              id="resolve-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Called the receiver, POD uploaded."
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => onConfirm(note.trim() || undefined)}
          >
            {pending ? "Saving…" : "Mark handled"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/**
 * The dialogs behind the distinct actions.
 *
 * Two things every one of them does, and both are the product rather than
 * decoration:
 *
 *  1. A REASON IS REQUIRED. An override with no reason is a decision nobody can
 *     review later, and the service refuses one anyway — so the form says so
 *     up front instead of letting somebody type a name and hit an error.
 *
 *  2. THE CONSEQUENCE IS STATED. Each dialog says in a sentence what will
 *     happen to accountability, because delegating, reassigning and taking over
 *     differ in exactly that and a person choosing between them from a menu
 *     cannot otherwise tell.
 */

interface MemberOption {
  membershipId: string;
  displayName: string;
  title?: string;
  available: boolean;
}

/* -------------------------------------------------------------------------- */
/* Picking a person                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A plain select rather than a search box.
 *
 * A workspace with a hundred people would want something better; a workspace
 * with three would find a search box slower than a list. The names come from
 * the service, never from a constant in this folder.
 */
function MemberSelect({
  members, value, onChange, label,
}: {
  members: MemberOption[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Field label={label} htmlFor="responsibility-member">
      <select
        id="responsibility-member"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg"
      >
        <option value="">Choose somebody…</option>
        {members.map((m) => (
          <option key={m.membershipId} value={m.membershipId}>
            {m.displayName}
            {m.title ? ` — ${m.title}` : ""}
            {m.available ? "" : " (not available)"}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Move work                                                                   */
/* -------------------------------------------------------------------------- */

export type MoveKind = "delegate" | "reassign" | "changeAccountable";

const MOVE_COPY: Record<
  MoveKind,
  { title: string; consequence: string; memberLabel: string; verb: string }
> = {
  delegate: {
    title: "Delegate this work",
    consequence:
      "They do the work. Whoever answers for the result stays exactly where it is.",
    memberLabel: "Who should do it",
    verb: "Delegate",
  },
  reassign: {
    title: "Reassign this work",
    consequence:
      "They do the work, and who answers for the result is worked out again from where it lands.",
    memberLabel: "Who should do it",
    verb: "Reassign",
  },
  changeAccountable: {
    title: "Change who answers for this",
    consequence:
      "They own the result and receive any escalation. Whoever is doing the work carries on.",
    memberLabel: "Who answers for it",
    verb: "Change",
  },
};

export function MoveWorkDialog({
  kind, open, onOpenChange, members, onSubmit, pending, error,
}: {
  kind: MoveKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: MemberOption[];
  onSubmit: (toMembershipId: string, note: string) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [member, setMember] = useState("");
  const [note, setNote] = useState("");
  const copy = MOVE_COPY[kind];
  const ready = member !== "" && note.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={copy.title} description={copy.consequence}>
        <div className="mt-4 space-y-4">
          <MemberSelect
            members={members}
            value={member}
            onChange={setMember}
            label={copy.memberLabel}
          />
          <Field
            label="Why"
            htmlFor="responsibility-note"
            hint="Required. It goes on the timeline, where it stays."
          >
            <Textarea
              id="responsibility-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Paige knows this broker and is on shift."
            />
          </Field>
          {error ? <p className="text-[0.8125rem] text-st-danger">{error}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || pending}
            onClick={() => onSubmit(member, note.trim())}
          >
            {pending ? "Working…" : copy.verb}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Note-only actions                                                           */
/* -------------------------------------------------------------------------- */

export type NoteActionKind = "escalate" | "takeOver" | "requestApproval" | "keep";

const NOTE_COPY: Record<
  NoteActionKind,
  { title: string; consequence: string; verb: string; required: boolean; placeholder: string }
> = {
  escalate: {
    title: "Escalate this",
    // The central rule, said out loud at the moment somebody might assume
    // otherwise.
    consequence:
      "The accountable manager can see it from now on. Nobody is reassigned — whoever holds this work still holds it.",
    verb: "Escalate",
    required: true,
    placeholder: "Nobody has moved this all day and the truck goes empty at six.",
  },
  takeOver: {
    title: "Take this over",
    consequence:
      "You become responsible for it. The person who had it is released and the handover is recorded.",
    verb: "Take over",
    required: true,
    placeholder: "I am already on the phone to this broker.",
  },
  requestApproval: {
    title: "Request approval",
    consequence:
      "It appears on the approver's queue. Nothing is emailed, texted or sent anywhere — see the note below the panel.",
    verb: "Request",
    required: true,
    placeholder: "Over the limit I can sign off.",
  },
  keep: {
    title: "Keep this",
    consequence:
      "Says this is yours and you are on it. Reminders go quiet for a while; the resolution target is unchanged.",
    verb: "Keep",
    required: false,
    placeholder: "Picking this up after the 2pm call.",
  },
};

export function NoteActionDialog({
  kind, open, onOpenChange, onSubmit, pending, error,
}: {
  kind: NoteActionKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (note: string) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [note, setNote] = useState("");
  const copy = NOTE_COPY[kind];
  const ready = !copy.required || note.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={copy.title} description={copy.consequence}>
        <div className="mt-4 space-y-4">
          <Field
            label="Why"
            htmlFor="responsibility-action-note"
            hint={copy.required ? "Required. It goes on the timeline." : "Optional."}
          >
            <Textarea
              id="responsibility-action-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={copy.placeholder}
            />
          </Field>
          {error ? <p className="text-[0.8125rem] text-st-danger">{error}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || pending}
            onClick={() => onSubmit(note.trim())}
          >
            {pending ? "Working…" : copy.verb}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Approval decision                                                           */
/* -------------------------------------------------------------------------- */

export function ApprovalDialog({
  open, onOpenChange, onSubmit, pending, error,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (decision: "approve" | "decline", note: string) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [note, setNote] = useState("");
  const ready = note.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Approve this work"
        description="Either answer is recorded against your membership and stays on the timeline."
      >
        <div className="mt-4 space-y-4">
          <Field label="Your decision, in a sentence" htmlFor="responsibility-approval-note">
            <Textarea
              id="responsibility-approval-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Numbers check out against the rate confirmation."
            />
          </Field>
          {error ? <p className="text-[0.8125rem] text-st-danger">{error}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="secondary"
            disabled={!ready || pending}
            onClick={() => onSubmit("decline", note.trim())}
          >
            Decline
          </Button>
          <Button
            variant="primary"
            disabled={!ready || pending}
            onClick={() => onSubmit("approve", note.trim())}
          >
            {pending ? "Working…" : "Approve"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

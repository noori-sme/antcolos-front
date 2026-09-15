"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { RecordResolutionInput } from "@/lib/api/contracts/compliance";
import type { ComplianceRequirement } from "@/types";
import { cn } from "@/lib/utils";
import type { ComplianceMutation } from "./use-compliance";

/**
 * Every one of these writes to a permanent, append-only record, so every one of
 * them insists on a sentence explaining what happened. The form lives inside
 * the dialog content, which Radix unmounts on close — so reopening starts
 * clean without an effect reaching in to reset it.
 */

interface DialogProps {
  requirement: ComplianceRequirement;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: ComplianceMutation;
  onDone: () => void;
}

/**
 * Whether a resolution can be recorded here at all.
 *
 * A requirement whose due date comes from a document is fixed by fixing the
 * document. Asserting here that it is fine would put the requirement and the
 * document into disagreement, so the option is absent rather than disabled with
 * an explanation nobody reads. Waiving it is still allowed — a waiver is a
 * decision somebody is accountable for, not a claim about a file.
 */
function documentBacked(requirement: ComplianceRequirement): boolean {
  return requirement.renewal.basis === "document_expiry";
}

/**
 * "No longer applicable" is deliberately not offered: whether a requirement
 * reaches a subject is decided by that subject's real facts, not by somebody
 * declaring it. Change the equipment type or the engagement and it becomes
 * not-applicable by itself, with a reason attached.
 */
type Method = RecordResolutionInput["method"];

const METHODS: Array<{ value: Method; label: string; help: string }> = [
  {
    value: "evidence_accepted",
    label: "Evidence accepted",
    help: "Somebody has seen what satisfies this and accepted it.",
  },
  {
    value: "renewed",
    label: "Renewed",
    help: "It was renewed, and the next cycle starts today.",
  },
  {
    value: "corrected",
    label: "Corrected",
    help: "It was wrong, and it has been put right.",
  },
  {
    value: "waived",
    label: "Waived",
    help: "Deliberately set aside for 90 days. It comes back after that.",
  },
];

export function ResolveDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        title="Record a resolution"
        description={`${props.requirement.subject.label} · ${props.requirement.label}`}
      >
        <ResolveForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ResolveForm({ requirement, onOpenChange, action, onDone }: DialogProps) {
  const locked = documentBacked(requirement);
  const available = locked ? METHODS.filter((m) => m.value === "waived") : METHODS;
  const [method, setMethod] = useState<Method>(available[0].value);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const invalid = note.trim().length < 3;

  return (
    <>
      {locked ? (
        <p className="mt-3 rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          This requirement&apos;s due date comes from the document that satisfies it, so it
          is fixed where that document lives — not here. You can still waive it while the
          replacement is on its way.
        </p>
      ) : null}

      <fieldset className="mt-4">
        <legend className="text-[0.8125rem] font-medium text-fg">What happened</legend>
        <div className="mt-2 space-y-1.5">
          {available.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
                method === option.value
                  ? "border-primary bg-primary/8"
                  : "border-border hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="resolution-method"
                value={option.value}
                checked={method === option.value}
                onChange={() => setMethod(option.value)}
                className="mt-0.5 size-4 accent-[var(--brand-primary)]"
              />
              <span className="min-w-0">
                <span className="block text-[0.8125rem] font-medium text-fg">
                  {option.label}
                </span>
                <span className="block text-[0.75rem] leading-relaxed text-fg-muted">
                  {option.help}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <Field
          label="What was done, and by whom"
          htmlFor="resolution-note"
          hint="Goes onto the permanent record and cannot be edited later."
          error={touched && invalid ? "Give a reason of at least 3 characters." : undefined}
        >
          <Textarea
            id="resolution-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="The renewal was filed this morning; the receipt follows tomorrow."
          />
        </Field>
      </div>

      <Footer
        action={action}
        confirmLabel="Record"
        disabled={invalid}
        onCancel={() => onOpenChange(false)}
        onConfirm={() =>
          action.mutate(
            { id: requirement.id, action: { kind: "resolve", input: { method, note } } },
            { onSuccess: onDone },
          )
        }
      />
    </>
  );
}

export function SuspendDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        title="Suspend this requirement"
        description="Use this when the subject is genuinely not operating. It pauses the requirement; it does not satisfy it."
      >
        <ReasonForm
          {...props}
          fieldId="suspend-reason"
          label="Why"
          placeholder="Unit is off the road until the spring."
          confirmLabel="Suspend"
          toAction={(reason) => ({ kind: "suspend", reason })}
        />
      </DialogContent>
    </Dialog>
  );
}

export function AddNoteDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        title="Add a note"
        description="Goes onto the permanent timeline. It changes no status."
      >
        <ReasonForm
          {...props}
          fieldId="compliance-note"
          label="Note"
          placeholder="Chased the broker; they are sending the certificate on Monday."
          confirmLabel="Add note"
          toAction={(note) => ({ kind: "note", note })}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  requirement, onOpenChange, action, onDone, fieldId, label, placeholder,
  confirmLabel, toAction,
}: DialogProps & {
  fieldId: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  toAction: (value: string) => Parameters<ComplianceMutation["mutate"]>[0]["action"];
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const invalid = value.trim().length < 3;

  return (
    <>
      <div className="mt-4">
        <Field
          label={label}
          htmlFor={fieldId}
          error={touched && invalid ? "Give at least 3 characters." : undefined}
        >
          <Textarea
            id={fieldId}
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={placeholder}
          />
        </Field>
      </div>
      <Footer
        action={action}
        confirmLabel={confirmLabel}
        disabled={invalid}
        onCancel={() => onOpenChange(false)}
        onConfirm={() =>
          action.mutate({ id: requirement.id, action: toAction(value) }, { onSuccess: onDone })
        }
      />
    </>
  );
}

function Footer({
  action, confirmLabel, disabled, onCancel, onConfirm,
}: {
  action: ComplianceMutation;
  confirmLabel: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {action.isError ? (
        <p className="mt-3 rounded-md border border-st-danger/35 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={action.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={disabled || action.isPending}>
          {action.isPending ? "Saving…" : confirmLabel}
        </Button>
      </div>
    </>
  );
}

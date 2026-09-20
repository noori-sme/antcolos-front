"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/form-alert";
import {
  WORKFORCE_LEAVE_NOTICE, WORKFORCE_LEAVE_REASON_LABEL,
  type WorkforceLeaveReason,
} from "@/types";
import type { RecordLeaveInput } from "@/lib/api/contracts/workforce";
import { useWorkspaceColleagues } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 "
  + "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none "
  + "focus-visible:ring-2 focus-visible:ring-ring/35";

const REASONS = Object.keys(WORKFORCE_LEAVE_REASON_LABEL) as WorkforceLeaveReason[];

const iso = (value: string) => new Date(`${value}T00:00:00Z`).toISOString();

/**
 * Recording that somebody is away.
 *
 * ★ WHAT THIS FORM DOES NOT ASK FOR ★
 * A diagnosis, a condition, an accommodation, a doctor's name or a certificate.
 * The reason is one of eight coarse words and there is nowhere to type more,
 * because an operational availability record is not a medical record and a free
 * text box on an HR screen is where one accidentally becomes the other. The
 * notice above the fields says so, and it is printed rather than hidden behind
 * a question mark.
 *
 * It also does not change anybody's engagement state. Somebody on leave is
 * still active — "away until the 14th" and "we have stood them down" must never
 * be the same row to whoever reads this a year from now.
 */
export function LeaveDialog({
  personName,
  open,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  personName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: RecordLeaveInput) => void;
  pending: boolean;
  error?: string;
}) {
  const colleagues = useWorkspaceColleagues();
  const today = new Date().toISOString().slice(0, 10);

  const [reason, setReason] = useState<WorkforceLeaveReason>("planned_time_off");
  const [startDate, setStartDate] = useState(today);
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [note, setNote] = useState("");

  const backwards = expectedReturnDate.length > 0 && expectedReturnDate < startDate;
  const blocked = startDate.length === 0 || backwards;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Record that ${personName} is away`}
        description="Their engagement stays active. Work stops being routed to them while they are away."
        className="max-w-xl"
      >
        <div className="mt-4 space-y-4">
          {error ? <FormAlert tone="danger" title="That did not work">{error}</FormAlert> : null}

          <p
            data-testid="leave-notice"
            className="rounded-md border border-dashed border-border px-3 py-2 text-[0.75rem] leading-relaxed text-fg-subtle"
          >
            {WORKFORCE_LEAVE_NOTICE}
          </p>

          <Field label="Reason" htmlFor="leave-reason">
            <select
              id="leave-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as WorkforceLeaveReason)}
              className={SELECT}
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{WORKFORCE_LEAVE_REASON_LABEL[r]}</option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="leave-start">
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field
              label="Expected back (optional)"
              htmlFor="leave-return"
              hint="Leave it empty when nobody knows. Antcolos will not invent one."
              error={backwards ? "That is before the leave starts." : undefined}
            >
              <Input
                id="leave-return"
                type="date"
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Approved by (optional)"
            htmlFor="leave-approver"
            hint="Plenty of carriers do not approve leave. Left empty, nobody is recorded as having — which is better than recording the wrong person."
          >
            <select
              id="leave-approver"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className={SELECT}
            >
              <option value="">Nobody</option>
              {(colleagues.data ?? []).map((c) => (
                <option key={c.membershipId} value={c.membershipId}>{c.displayName}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Operational note (optional)"
            htmlFor="leave-note"
            hint="What dispatch needs to know. No medical or other sensitive detail."
          >
            <Textarea
              id="leave-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Back for the Monday run."
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={blocked || pending}
            data-testid="record-leave-submit"
            onClick={() => {
              if (blocked) return;
              onSubmit({
                reason,
                startDate: iso(startDate),
                expectedReturnDate: expectedReturnDate ? iso(expectedReturnDate) : undefined,
                approvedByMembershipId: approvedBy || undefined,
                note: note.trim() || undefined,
              });
            }}
          >
            {pending ? "Recording…" : "Record the leave"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

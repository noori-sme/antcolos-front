"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/form-alert";
import { ASSIGNABLE_FUNCTIONS } from "@/lib/workforce/functions";
import {
  RESPONSIBILITY_FUNCTION_LABEL, WORKFORCE_CLASSIFICATION_DESCRIPTION,
  WORKFORCE_CLASSIFICATION_LABEL, WORKFORCE_CLASSIFICATION_NOTICE,
  WORKFORCE_START_BASIS_DESCRIPTION, WORKFORCE_START_BASIS_LABEL,
  type ResponsibilityFunction, type WorkforceClassification,
  type WorkforceStartDateBasis,
} from "@/types";
import type { CreateEngagementInput } from "@/lib/api/contracts/workforce";
import { useWorkspaceColleagues } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 "
  + "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none "
  + "focus-visible:ring-2 focus-visible:ring-ring/35";

const CLASSIFICATIONS = Object.keys(
  WORKFORCE_CLASSIFICATION_LABEL,
) as WorkforceClassification[];

/**
 * Recording that somebody works here.
 *
 * ★ ONE FORM, NOT TWO ★
 * There is no "invite" tab and no second flow for somebody with an account.
 * Connecting a known person and recording a yard hand who will never sign in
 * are the same command with different identity fields, and splitting them is
 * how two paths come to disagree about whether this person already has a live
 * engagement. Inviting somebody remains the access system's, on its own screen.
 *
 * Three things this form says out loud rather than implying:
 *
 *  1. Classification is the ORGANIZATION's fact. Antcolos applies no
 *     classification test and the notice says so above the dropdown, not in a
 *     tooltip — the distinction between employee and contractor is the one a
 *     regulator audits.
 *  2. A start date has to say where it came from. A carrier migrating on
 *     records dates it is asserting, and the form refuses to guess on its
 *     behalf.
 *  3. Functions grant nothing. The checkboxes sit under a line saying so,
 *     because a list of job-shaped words on an HR form reads like a role
 *     picker unless somebody says it is not one.
 */
export function CreateEngagementDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateEngagementInput) => void;
  pending: boolean;
  error?: string;
}) {
  const colleagues = useWorkspaceColleagues();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [classification, setClassification] = useState<WorkforceClassification>("employee");
  const [positionTitle, setPositionTitle] = useState("");
  const [managerMembershipId, setManagerMembershipId] = useState("");
  const [functions, setFunctions] = useState<ResponsibilityFunction[]>([]);
  const [startDate, setStartDate] = useState("");
  const [startBasis, setStartBasis] = useState<WorkforceStartDateBasis | "">("");
  const [startNote, setStartNote] = useState("");

  const nameMissing = displayName.trim().length === 0;
  const positionMissing = positionTitle.trim().length === 0;
  // A date with no basis is refused by the service. Refusing it here too means
  // somebody is told before they press, not after.
  const basisMissing = startDate.length > 0 && startBasis === "";
  const blocked = nameMissing || positionMissing || basisMissing;

  const toggleFunction = (key: ResponsibilityFunction) => {
    setFunctions((current) => (current.includes(key)
      ? current.filter((f) => f !== key)
      : [...current, key]));
  };

  const submit = () => {
    if (blocked) return;
    onSubmit({
      person: {
        displayName: displayName.trim(),
        email: email.trim() || undefined,
      },
      classification,
      positionTitle: positionTitle.trim(),
      source: {
        kind: "manual_entry",
        label: email.trim()
          ? "Entered by hand from the workforce directory"
          : "Entered by hand; no contact address was given",
      },
      managerMembershipId: managerMembershipId || undefined,
      functions: functions.length > 0 ? functions : undefined,
      startDate: startDate ? new Date(`${startDate}T00:00:00Z`).toISOString() : undefined,
      startDateBasis: startBasis || undefined,
      startDateNote: startNote.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record somebody who works here"
        description="An engagement says on what basis a person works with this organization. It is not an account, not access and not a driver record."
        className="max-w-2xl"
      >
        <div className="mt-4 max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {error ? <FormAlert tone="danger" title="That did not work">{error}</FormAlert> : null}

          <section className="space-y-3">
            <h3 className="text-[0.8125rem] font-semibold text-fg">Who</h3>
            <Field
              label="Name"
              htmlFor="engagement-name"
              hint="As this organization knows them. This is a display snapshot, not a second identity record."
            >
              <Input
                id="engagement-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Priya Raman"
              />
            </Field>
            <Field
              label="Email (optional)"
              htmlFor="engagement-email"
              hint="Somebody can work here without an Antcolos account. Leaving this empty creates no account and sends nothing."
            >
              <Input
                id="engagement-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@example.com"
              />
            </Field>
          </section>

          <section className="space-y-3">
            <h3 className="text-[0.8125rem] font-semibold text-fg">On what basis</h3>
            {/* Printed, not tucked into a tooltip. See the header comment. */}
            <p
              data-testid="classification-notice"
              className="rounded-md border border-dashed border-border px-3 py-2 text-[0.75rem] leading-relaxed text-fg-subtle"
            >
              {WORKFORCE_CLASSIFICATION_NOTICE}
            </p>
            <Field label="Classification" htmlFor="engagement-classification">
              <select
                id="engagement-classification"
                value={classification}
                onChange={(e) => setClassification(e.target.value as WorkforceClassification)}
                className={SELECT}
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{WORKFORCE_CLASSIFICATION_LABEL[c]}</option>
                ))}
              </select>
            </Field>
            <p className="text-[0.75rem] leading-relaxed text-fg-muted">
              {WORKFORCE_CLASSIFICATION_DESCRIPTION[classification]}
            </p>
            <Field
              label="Position"
              htmlFor="engagement-position"
              hint="In this organization's own words. A label, never a permission."
            >
              <Input
                id="engagement-position"
                value={positionTitle}
                onChange={(e) => setPositionTitle(e.target.value)}
                placeholder="Yard hand"
              />
            </Field>
            <Field
              label="Supervisor (optional)"
              htmlFor="engagement-manager"
              hint="A supervisor, not an assignment. Operational responsibility stays with the Responsibility Engine."
            >
              <select
                id="engagement-manager"
                value={managerMembershipId}
                onChange={(e) => setManagerMembershipId(e.target.value)}
                className={SELECT}
              >
                <option value="">Nobody</option>
                {(colleagues.data ?? []).map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>{c.displayName}</option>
                ))}
              </select>
            </Field>
          </section>

          <section className="space-y-3">
            <h3 className="text-[0.8125rem] font-semibold text-fg">When it began</h3>
            <Field
              label="Start date (optional)"
              htmlFor="engagement-start"
              hint="Leave it empty for somebody who has not started. Activating them later records that date instead."
            >
              <Input
                id="engagement-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            {startDate ? (
              <>
                <Field
                  label="Where does that date come from?"
                  htmlFor="engagement-start-basis"
                  error={basisMissing ? "Say where the date came from. Antcolos will not guess." : undefined}
                >
                  <select
                    id="engagement-start-basis"
                    value={startBasis}
                    onChange={(e) => setStartBasis(e.target.value as WorkforceStartDateBasis | "")}
                    className={SELECT}
                  >
                    <option value="">Choose one</option>
                    <option value="asserted_by_organization">
                      {WORKFORCE_START_BASIS_LABEL.asserted_by_organization}
                    </option>
                    <option value="observed_by_antcolos">
                      {WORKFORCE_START_BASIS_LABEL.observed_by_antcolos}
                    </option>
                  </select>
                </Field>
                {startBasis ? (
                  <p className="text-[0.75rem] leading-relaxed text-fg-muted">
                    {WORKFORCE_START_BASIS_DESCRIPTION[startBasis]}
                  </p>
                ) : null}
                <Field label="Note (optional)" htmlFor="engagement-start-note">
                  <Textarea
                    id="engagement-start-note"
                    rows={2}
                    value={startNote}
                    onChange={(e) => setStartNote(e.target.value)}
                    placeholder="Where the date came from — payroll records, the old system, a signed agreement."
                  />
                </Field>
              </>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-[0.8125rem] font-semibold text-fg">What they do here</h3>
            <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
              Recording a function grants nothing. Permissions are granted only in Access, and
              where somebody&rsquo;s access does not match what they do, this page says so.
            </p>
            <div className="flex flex-wrap gap-2" data-testid="function-picker">
              {ASSIGNABLE_FUNCTIONS.map((key) => {
                const on = functions.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    data-function={key}
                    aria-pressed={on}
                    onClick={() => toggleFunction(key)}
                    className={`rounded-full border px-3 py-1 text-[0.75rem] transition-colors ${
                      on
                        ? "border-primary bg-primary/10 text-fg"
                        : "border-border bg-surface text-fg-muted hover:border-border-strong"
                    }`}
                  >
                    {RESPONSIBILITY_FUNCTION_LABEL[key]}
                  </button>
                );
              })}
            </div>
          </section>
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
            onClick={submit}
            data-testid="create-engagement-submit"
          >
            {pending ? "Recording…" : "Record the engagement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

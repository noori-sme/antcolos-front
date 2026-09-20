"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  ambiguous,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateEngagementInput) => void;
  pending: boolean;
  error?: string;
  /**
   * People already on this roster who may be the person being entered.
   *
   * Present when the service refused to decide. It is not an error the form
   * should clear on the next keystroke — it is a question only somebody who
   * knows these people can answer.
   */
  ambiguous?: { engagementId: string; label: string; detail: string }[];
}) {
  const colleagues = useWorkspaceColleagues();

  /*
   * ★ A REFUSAL NOBODY CAN SEE IS A FORM THAT DID NOTHING ★
   * The candidates render at the top of a scrolling dialog. On a phone the
   * submit button sits well below that, so pressing it appeared to do nothing
   * at all: the answer was on screen in the DOM sense and off screen in the
   * only sense that matters. Bringing it into view is the whole fix.
   */
  const ambiguousRef = useRef<HTMLDivElement>(null);
  const ambiguousCount = ambiguous?.length ?? 0;
  useEffect(() => {
    if (ambiguousCount > 0) {
      // Instant, not smooth: this is an answer to something somebody just
      // pressed, and animating it means a window where the form still looks
      // like it did nothing.
      ambiguousRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      ambiguousRef.current?.focus({ preventScroll: true });
    }
  }, [ambiguousCount]);

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

  const submit = (confirmedDistinctFrom?: string[]) => {
    if (blocked) return;
    onSubmit({
      confirmedDistinctFrom,
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
          {/*
            ★ THE QUESTION ANTCOLOS REFUSES TO ANSWER ★
            A name and an address are evidence, not identity. When somebody on
            the roster may already be this person, linking the wrong record and
            creating a second one are both permanent, and only a person who
            knows them can tell. So the form stops, names who it found with
            enough detail to tell them apart, and offers the two honest ways
            out — open the existing record, or say they are different people.
            There is no third button that merges them.
          */}
          {ambiguous && ambiguous.length > 0 ? (
            <div
              ref={ambiguousRef}
              className="rounded-lg border border-st-warning/40 bg-st-warning/5 p-4"
              data-testid="ambiguous-person"
              tabIndex={-1}
              role="alert"
            >
              <p className="text-[0.875rem] font-medium text-fg">
                Somebody here may already be this person
              </p>
              <ul className="mt-2 space-y-1.5">
                {ambiguous.map((c) => (
                  <li key={c.engagementId} className="text-[0.8125rem]">
                    <Link
                      href={`/workforce/${c.engagementId}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {c.label}
                    </Link>
                    {c.detail ? <span className="text-fg-subtle"> · {c.detail}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">
                Open one of them if it is the same person — recording them twice cannot be
                undone. If these are genuinely different people, say so and this will be
                recorded as a separate engagement. Nothing is linked or merged either way.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-2.5"
                disabled={pending}
                data-testid="confirm-distinct"
                onClick={() => submit(ambiguous.map((c) => c.engagementId))}
              >
                These are different people
              </Button>
            </div>
          ) : null}

          {error && !(ambiguous && ambiguous.length > 0)
            ? <FormAlert tone="danger" title="That did not work">{error}</FormAlert>
            : null}

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
            onClick={() => submit()}
            data-testid="create-engagement-submit"
          >
            {pending ? "Recording…" : "Record the engagement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

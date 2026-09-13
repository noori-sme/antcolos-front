"use client";

import { useId, useState } from "react";
import { BackLink, SubmitButton } from "./controls";
import { FormAlert } from "./form-alert";
import { PasswordChecklist } from "./password-checklist";
import { PasswordField } from "./password-field";
import { mockCreateAccount } from "./mock-backend";
import { isPasswordStrongEnough } from "./rules";

/**
 * Sign up, step 4 — create and confirm the password.
 *
 * The requirement checklist updates on every keystroke, but the "does not
 * match" error waits until the confirmation box has been left alone: flagging a
 * mismatch on the second character of a password someone is still typing is
 * noise, not help.
 */
export function StepPassword({
  email,
  username,
  onCreated,
  onBack,
}: {
  email: string;
  username: string;
  onCreated: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const passwordId = `${uid}-password`;
  const confirmId = `${uid}-confirm`;
  const checklistId = `${uid}-checklist`;
  const mismatchId = `${uid}-mismatch`;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmBlurred, setConfirmBlurred] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  const strongEnough = isPasswordStrongEnough(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const showMismatch = mismatch && (confirmBlurred || submitted);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (!strongEnough || !confirm || mismatch) return;

    setPending(true);
    await mockCreateAccount({ email, username, password });
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {submitted && !strongEnough ? (
        <FormAlert tone="danger" title="Your password does not meet every requirement yet." />
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={passwordId} className="block text-[0.8125rem] font-medium text-fg">
          Password
        </label>
        <PasswordField
          id={passwordId}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="Create a password"
          disabled={pending}
          invalid={submitted && !strongEnough}
          describedBy={checklistId}
        />
        <PasswordChecklist id={checklistId} value={password} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={confirmId} className="block text-[0.8125rem] font-medium text-fg">
          Confirm password
        </label>
        <PasswordField
          id={confirmId}
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            if (confirmBlurred && value === password) setConfirmBlurred(false);
          }}
          onBlur={() => setConfirmBlurred(true)}
          autoComplete="new-password"
          placeholder="Type it once more"
          disabled={pending}
          invalid={showMismatch}
          describedBy={showMismatch ? mismatchId : undefined}
        />
        <p id={mismatchId} aria-live="polite" className="min-h-4 text-[0.75rem]">
          {showMismatch ? (
            <span className="text-st-danger">Both passwords must match exactly.</span>
          ) : null}
        </p>
      </div>

      <SubmitButton pending={pending} pendingLabel="Creating your account…">
        Create account
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

"use client";

import { useId, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "./controls";
import { mockSendVerificationCode } from "./mock-backend";
import { normalizeEmail, validateEmail } from "./rules";
import { cn } from "@/lib/utils";

/** Sign up, step 1 — the email address the verification code is sent to. */
export function StepEmail({
  email,
  onEmailChange,
  onSent,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  onSent: () => void;
}) {
  const uid = useId();
  const emailId = `${uid}-email`;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const nextError = validateEmail(email);
    setError(nextError);
    if (nextError) return;

    setPending(true);
    await mockSendVerificationCode(normalizeEmail(email));
    setPending(false);
    onSent();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Email address"
        htmlFor={emailId}
        hint={error ? undefined : "We'll send a 6-digit code here to confirm it's yours."}
        error={error ?? undefined}
      >
        <Input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => {
            onEmailChange(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => onEmailChange(email.trim())}
          autoComplete="email"
          placeholder="name@company.com"
          disabled={pending}
          aria-invalid={error ? true : undefined}
          className={cn(error && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <SubmitButton pending={pending} pendingLabel="Sending code…">
        Continue
      </SubmitButton>
    </form>
  );
}

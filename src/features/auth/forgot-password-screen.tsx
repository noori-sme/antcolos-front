"use client";

import { MailCheck } from "lucide-react";
import { useId, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthShell, AuthSwitchLink } from "./shell";
import { SubmitButton } from "./controls";
import { mockSendResetLink } from "./mock-backend";
import { normalizeEmail, validateEmail } from "./rules";
import { cn } from "@/lib/utils";

/**
 * Forgot password — request a reset link.
 *
 * The confirmation never says whether the address has an account. Saying so
 * would turn this box into a way to find out who is a customer.
 */
export function ForgotPasswordScreen() {
  const uid = useId();
  const emailId = `${uid}-email`;

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const nextError = validateEmail(email);
    setError(nextError);
    if (nextError) return;

    setPending(true);
    await mockSendResetLink(normalizeEmail(email));
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        description={
          <>
            If an account exists for{" "}
            <span className="font-medium text-fg">{normalizeEmail(email)}</span>, we&apos;ve sent it
            a link to set a new password. The link is good for one hour.
          </>
        }
        footer={<AuthSwitchLink prompt="Remembered it?" href="/sign-in" label="Back to sign in" />}
      >
        <div className="flex items-center gap-3 rounded-lg border border-st-info/35 bg-st-info-bg/50 px-4 py-3.5">
          <MailCheck className="size-5 shrink-0 text-st-info" aria-hidden />
          <p className="text-[0.8125rem] text-fg-muted">
            Nothing after a few minutes? Check your spam folder before trying again.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email address on your account and we'll send you a link to set a new password."
      footer={<AuthSwitchLink prompt="Remembered it?" href="/sign-in" label="Back to sign in" />}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Email address" htmlFor={emailId} error={error ?? undefined}>
          <Input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            autoComplete="email"
            placeholder="name@company.com"
            disabled={pending}
            aria-invalid={error ? true : undefined}
            className={cn(error && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>

        <SubmitButton pending={pending} pendingLabel="Sending link…">
          Send reset link
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

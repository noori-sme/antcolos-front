"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthShell, AuthSwitchLink } from "./shell";
import { FormAlert } from "./form-alert";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./controls";
import { mockSignIn } from "./mock-backend";
import { normalizeEmail, validateEmail } from "./rules";
import { useInvitationReturnPath } from "@/features/access/use-invitation-return";
import { cn } from "@/lib/utils";

/**
 * Sign In — for people who already have an account.
 *
 * A returning user never sees onboarding again: they already chose how they use
 * Antcolos and already belong to an organization, so a successful sign in goes
 * straight to the product. (Which organization they land in is the session
 * layer's job, not this screen's.)
 */
export function SignInScreen() {
  const router = useRouter();
  const invitationReturn = useInvitationReturnPath();
  const uid = useId();
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const nextEmailError = validateEmail(email);
    // Sign In never re-states the strength rules: a wrong password and a weak
    // password are the same answer here, and hinting otherwise leaks whether
    // the account exists.
    const nextPasswordError = password ? null : "Enter your password.";

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFormError(null);
    if (nextEmailError || nextPasswordError) return;

    setPending(true);
    const result = await mockSignIn(normalizeEmail(email), password);
    if (result.status === "ok") {
      // An invitation that sent them here is where they go back to.
      router.push(invitationReturn ?? "/home");
      return;
    }
    setPending(false);
    setFormError("Email or password is incorrect. Check both and try again.");
  }

  return (
    <AuthShell
      title="Sign in to Antcolos"
      description="Welcome back. Enter your details to open your dashboard."
      footer={
        <AuthSwitchLink prompt="New to Antcolos?" href="/sign-up" label="Create an account" />
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {invitationReturn ? (
          <FormAlert tone="info" role="none" title="Sign in to accept your invitation.">
            We&apos;ll take you straight back to it.
          </FormAlert>
        ) : null}
        {formError ? <FormAlert tone="danger" title={formError} /> : null}

        <Field label="Email address" htmlFor={emailId} error={emailError ?? undefined}>
          <Input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
              if (formError) setFormError(null);
            }}
            onBlur={() => setEmail((v) => v.trim())}
            autoComplete="email"
            placeholder="name@company.com"
            disabled={pending}
            aria-invalid={emailError ? true : undefined}
            className={cn(emailError && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={passwordId} className="block text-[0.8125rem] font-medium text-fg">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-[0.75rem] font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordField
            id={passwordId}
            value={password}
            onChange={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(null);
              if (formError) setFormError(null);
            }}
            autoComplete="current-password"
            placeholder="Your password"
            disabled={pending}
            invalid={Boolean(passwordError)}
          />
          {passwordError ? (
            <p role="alert" className="text-[0.75rem] text-st-danger">{passwordError}</p>
          ) : null}
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-2 text-[0.8125rem] text-fg-muted select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={pending}
            className="size-4 shrink-0 cursor-pointer accent-primary"
          />
          Keep me signed in on this device
        </label>

        <SubmitButton pending={pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

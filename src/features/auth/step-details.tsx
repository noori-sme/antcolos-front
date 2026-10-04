"use client";

import { useId, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { SubmitButton } from "./controls";
import { normalizeEmail, validateEmail, isPasswordStrongEnough, unmetPasswordRequirements } from "./rules";
import { cn } from "@/lib/utils";
import { FormAlert } from "./form-alert";
import { PasswordField } from "./password-field";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { PasswordChecklist } from "./password-checklist";

export function StepDetails({
  onSent,
  onEmailChange,
}: {
  onSent: () => void;
  onEmailChange: (email: string) => void;
}) {
  const uid = useId();
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [confirmBlurred, setConfirmBlurred] = useState(false);

  const signUpMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { data } = await apiClient.post("/auth/signup", payload);
      return data;
    },
    onSuccess: (_, variables) => {
      onEmailChange(variables.email);
      onSent();
    },
    onError: (error) => {
      const msg = error.message || "";
      if (
        msg.toLowerCase().includes("already registered") ||
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("taken") ||
        msg.toLowerCase().includes("in use")
      ) {
        toast.info("This email is already registered. Redirecting to sign in...");
        router.push(`/sign-in?email=${encodeURIComponent(email)}`);
      } else {
        toast.error(msg || "Failed to create account. Please try again.");
      }
    }
  });

  const pending = signUpMutation.isPending;

  const strongEnough = isPasswordStrongEnough(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const showMismatch = mismatch && (confirmBlurred || submitted);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);

    const nextErrors: Record<string, string> = {};

    if (!firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!lastName.trim()) nextErrors.lastName = "Last name is required.";

    const emailError = validateEmail(email);
    if (emailError) nextErrors.email = emailError;

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0 || !strongEnough || !confirm || mismatch) {
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    signUpMutation.mutate({
      firstName,
      lastName,
      email: normalizedEmail,
      phone: phone ? Number(phone.replace(/^\+?91/, "")) : undefined,
      password,
      confirmPassword: confirm,
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {submitted && !strongEnough ? (
        <FormAlert tone="danger" title="Your password does not meet every requirement yet." />
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <Field label="First name" htmlFor={`${uid}-first`} error={errors.firstName} required>
          <Input
            id={`${uid}-first`}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={pending}
            aria-invalid={!!errors.firstName}
            className={cn(errors.firstName && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>

        <Field label="Last name" htmlFor={`${uid}-last`} error={errors.lastName} required>
          <Input
            id={`${uid}-last`}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={pending}
            aria-invalid={!!errors.lastName}
            className={cn(errors.lastName && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>
      </div>

      <Field label="Email address" htmlFor={`${uid}-email`} error={errors.email} required>
        <Input
          id={`${uid}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={pending}
          aria-invalid={!!errors.email}
          className={cn(errors.email && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <Field label="Phone number" htmlFor={`${uid}-phone`} error={errors.phone}>
        <Input
          id={`${uid}-phone`}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          disabled={pending}
          aria-invalid={!!errors.phone}
          className={cn(errors.phone && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={`${uid}-password`} className="block text-[0.8125rem] font-medium text-fg">
            Password
            <span className="ml-1 text-st-danger">*</span>
          </label>
          <Badge tone="info" className="py-0 text-[10px]">
            <Lock className="size-3" />
            Strong password required
          </Badge>
        </div>
        <PasswordField
          id={`${uid}-password`}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={pending}
          invalid={submitted && !strongEnough}
          describedBy={`${uid}-checklist`}
        />
        <PasswordChecklist id={`${uid}-checklist`} value={password} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${uid}-confirm`} className="block text-[0.8125rem] font-medium text-fg">
          Confirm password
          <span className="ml-1 text-st-danger">*</span>
        </label>
        <PasswordField
          id={`${uid}-confirm`}
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            if (confirmBlurred && value === password) setConfirmBlurred(false);
          }}
          onBlur={() => setConfirmBlurred(true)}
          autoComplete="new-password"
          disabled={pending}
          invalid={showMismatch}
          describedBy={showMismatch ? `${uid}-mismatch` : undefined}
        />
        <p id={`${uid}-mismatch`} aria-live="polite" className="min-h-4 text-[0.75rem]">
          {showMismatch ? (
            <span className="text-st-danger">Both passwords must match exactly.</span>
          ) : null}
        </p>
      </div>

      <SubmitButton pending={pending} pendingLabel="Creating account…">
        Create Account
      </SubmitButton>
    </form>
  );
}

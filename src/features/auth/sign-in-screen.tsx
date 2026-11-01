"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useEffect } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuthShell, AuthSwitchLink } from "./shell";
import { FormAlert } from "./form-alert";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./controls";
import { UnverifiedEmailModal } from "./modals/unverified-email-modal";
import { VerifyEmailModal } from "./modals/verify-email-modal";
import { normalizeEmail, validateEmail } from "./rules";
import { useInvitationReturnPath } from "@/features/access/use-invitation-return";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { fetchAndStoreUserPermissions } from "@/lib/session/permissions-sync";
import {
  clearNextStep, clearPermissionCookies, readCookie, setCarrierData, setNextStep, setSessionToken,
} from "@/lib/api/auth-cookies";
import { toast } from "sonner";
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
  const queryClient = useQueryClient();
  const invitationReturn = useInvitationReturnPath();
  const searchParams = useSearchParams();
  const verifyToken = searchParams?.get("verifyToken") || searchParams?.get("token") || null;

  const uid = useId();
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;

  const [email, setEmail] = useState(searchParams?.get("email") || "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    const savedEmail = localStorage.getItem("antcolos_remember_email");
    
    // Only prefill from localStorage if searchParams didn't already provide an email
    if (savedEmail && !searchParams?.get("email")) {
      setEmail(savedEmail);
    }
  }, [searchParams]);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  const signInMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { data } = await apiClient.post("/auth/login", payload);
      return data;
    },
    onSuccess: async (data) => {
      if (remember) {
        localStorage.setItem("antcolos_remember_email", email);
      } else {
        localStorage.removeItem("antcolos_remember_email");
      }

      const user = data.user || data.data?.user || (data.data?.id ? data.data : data);
      const nextStep = user?.nextStep || data.nextStep || data.data?.nextStep;

      // Extract access token robustly from response or cookies
      const token =
        data.accessToken ||
        data.access_token ||
        data.token ||
        data.data?.accessToken ||
        data.data?.access_token ||
        data.data?.token ||
        readCookie("antcolos_token");

      if (token) {
        setSessionToken(token);
      }

      if (user) {
        queryClient.setQueryData(["currentUser"], user);
      }

      if (nextStep) {
        setNextStep(nextStep);

        if (user?.carrierVerification) {
          const existingData = readCookie("antcolos_carrier_data");
          let parsed: any = {};
          try {
            if (existingData) parsed = JSON.parse(existingData);
          } catch (e) {}
          setCarrierData(JSON.stringify({
              legalName: parsed.legalName || user.name || "Your Carrier",
              mc: parsed.mc || "",
              dot: parsed.dot || "",
              ...parsed,
              email: user.carrierVerification.email || parsed.email,
            }));
        }

        if (nextStep === "choose-username") {
          sessionStorage.setItem("antcolos_signup_step", "username");
          sessionStorage.setItem("antcolos_signup_email", email);
          sessionStorage.setItem("antcolos_signup_from_login", "true");
          router.push("/sign-up");
          return;
        }

        if (nextStep === "verify-carrier") {
          router.push("/onboarding?step=verify-carrier");
          return;
        }

        if (nextStep === "carrier-onboarding") {
          router.push("/onboarding?step=carrier");
          return;
        }

        if (nextStep === "select-role") {
          router.push("/onboarding?step=role");
          return;
        }

        if (nextStep === "company-details") {
          router.push("/onboarding?step=create-org");
          return;
        }

        router.push(`/onboarding?step=${nextStep}`);
        return;
      }

      // Remove any onboarding next_step cookie because user is fully onboarded
      clearNextStep();

      // Clear previous user's permission cookies to ensure no stale permissions persist
      clearPermissionCookies();

      // Fully authenticated (no nextStep). Update current user cache.
      queryClient.setQueryData(["currentUser"], user);

      // Call permissions API immediately so after login user only sees their permitted modules and actions
      const permData = await fetchAndStoreUserPermissions(queryClient, token);
      if (!permData) {
        return;
      }

      sessionStorage.setItem("antcolos_pending_toast", data.message || "Successfully signed in.");

      const roleId =
        permData?.roleId ||
        user?.roleId ||
        user?.individualRole ||
        readCookie("antcolos_role_id") ||
        readCookie("antcolos_user_role");

      const isDriver = String(roleId || "").toUpperCase() === "DRIVER";
      const targetPath = invitationReturn ?? (isDriver ? "/driver/home" : "/home");

      router.push(targetPath);
    },
    onError: (error) => {
      const msg = error.message || "";
      if (msg.toLowerCase().includes("verify your email")) {
        setUnverifiedEmail(email);
      } else {
        toast.error(msg || "Email or password is incorrect. Check both and try again.");
      }
    }
  });

  const pending = signInMutation.isPending;

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
    if (nextEmailError || nextPasswordError) return;

    signInMutation.mutate({
      email: normalizeEmail(email),
      password
    });
  }

  return (
    <>
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

        <Field label="Email address" htmlFor={emailId} error={emailError ?? undefined}>
          <Input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
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
          Remember me
        </label>

        <SubmitButton pending={pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>

    <UnverifiedEmailModal
      email={unverifiedEmail}
      onClose={() => setUnverifiedEmail(null)}
    />

    <VerifyEmailModal 
      token={verifyToken} 
      onClose={() => {}} 
    />
    </>
  );
}

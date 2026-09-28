"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { AuthShell, AuthSwitchLink } from "./shell";
import { StepProgress } from "./controls";
import { StepDetails } from "./step-details";
import { StepVerify } from "./step-verify";
import { StepUsername } from "./step-username";
import { CODE_LENGTH } from "./rules";
import { useStageFocus } from "./use-stage-focus";
import { useInvitationReturnPath } from "@/features/access/use-invitation-return";

const STEPS = ["details", "verify", "username"] as const;
type Step = (typeof STEPS)[number];

/**
 * Sign Up — four steps behind one URL.
 *
 * Keeping the steps in a single screen means going back never loses what was
 * already typed, and the browser's back button never drops someone into the
 * middle of a half-finished signup.
 *
 * Once the account exists the person still has to say how they will use
 * Antcolos, so the flow hands off to onboarding rather than the dashboard.
 */
export function SignUpScreen() {
  const router = useRouter();
  const invitationReturn = useInvitationReturnPath();
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [mounted, setMounted] = useState(false);
  const [fromLogin, setFromLogin] = useState(false);
  const headingRef = useStageFocus<HTMLHeadingElement>(step);

  useEffect(() => {
    setMounted(true);
    const savedStep = sessionStorage.getItem("antcolos_signup_step") as Step | null;
    const savedEmail = sessionStorage.getItem("antcolos_signup_email");
    const isFromLogin = sessionStorage.getItem("antcolos_signup_from_login") === "true";

    if (savedStep && STEPS.includes(savedStep)) {
      setStep(savedStep);
    }
    if (savedEmail) {
      setEmail(savedEmail);
    }
    if (isFromLogin) {
      setFromLogin(true);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    sessionStorage.setItem("antcolos_signup_step", step);
    sessionStorage.setItem("antcolos_signup_email", email);
  }, [step, email, mounted]);

  // Clear storage when successfully finishing the flow
  const handleFinished = () => {
    sessionStorage.removeItem("antcolos_signup_step");
    sessionStorage.removeItem("antcolos_signup_email");
    sessionStorage.removeItem("antcolos_signup_from_login");
    router.push(
      invitationReturn
        ? `/onboarding/profile?next=${encodeURIComponent(invitationReturn)}`
        : "/onboarding/profile",
    );
  };

  if (!mounted) {
    return null; // Prevent hydration mismatch
  }

  const copy: Record<Step, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Create your Antcolos account",
      description: "Start with your details and the email address you use for work.",
    },
    verify: {
      title: "Check your email",
      description: "We just need to verify your email address to continue.",
    },
    username: {
      title: "Choose your username",
      description:
        "This is how teammates and dispatchers will see you across Antcolos. It is permanent, so pick carefully.",
    },
  };

  const stepNumber = STEPS.indexOf(step) + 1;

  return (
    <AuthShell
      title={copy[step].title}
      description={copy[step].description}
      headingRef={headingRef}
      footer={
        step === "details" ? (
          <AuthSwitchLink prompt="Already have an account?" href="/sign-in" label="Sign in" />
        ) : null
      }
    >
      {invitationReturn ? (
        <div className="mb-4 rounded-md border border-st-info/35 bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed">
          <p className="font-medium text-fg">You&apos;re creating an account to accept an invitation.</p>
          <p className="mt-0.5 text-fg-muted">We&apos;ll bring you straight back to it when you&apos;re done.</p>
        </div>
      ) : null}

      <StepProgress current={stepNumber} total={STEPS.length} />

      {step === "details" ? (
        <StepDetails onEmailChange={setEmail} onSent={() => setStep("verify")} />
      ) : step === "verify" ? (
        <StepVerify
          email={email}
          onVerified={() => setStep("username")}
          onBack={() => setStep("details")}
        />
      ) : (
        <StepUsername
          username={username}
          onUsernameChange={setUsername}
          onChosen={handleFinished}
          onBack={fromLogin ? undefined : () => setStep("verify")}
        />
      )}
    </AuthShell>
  );
}

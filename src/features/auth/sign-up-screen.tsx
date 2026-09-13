"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthShell, AuthSwitchLink } from "./shell";
import { StepProgress } from "./controls";
import { StepEmail } from "./step-email";
import { StepVerify } from "./step-verify";
import { StepUsername } from "./step-username";
import { StepPassword } from "./step-password";
import { CODE_LENGTH } from "./rules";

const STEPS = ["email", "verify", "username", "password"] as const;
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");

  // Moving focus to the new step's heading is what tells a screen-reader user
  // that the screen changed. Skipped on first paint so loading /sign-up does not
  // yank focus out of the browser chrome.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const copy: Record<Step, { title: string; description: React.ReactNode }> = {
    email: {
      title: "Create your Antcolos account",
      description: "Start with the email address you use for work.",
    },
    verify: {
      title: "Check your email",
      description: (
        <>
          We sent a {CODE_LENGTH}-digit code to{" "}
          <span className="font-medium text-fg">{email || "your email address"}</span>. Enter it
          below to confirm the address is yours.
        </>
      ),
    },
    username: {
      title: "Choose your username",
      description:
        "This is how teammates and dispatchers will see you across Antcolos. It is permanent, so pick carefully.",
    },
    password: {
      title: "Create a password",
      description: "Last step. Choose something strong that you do not use anywhere else.",
    },
  };

  const stepNumber = STEPS.indexOf(step) + 1;

  return (
    <AuthShell
      title={copy[step].title}
      description={copy[step].description}
      headingRef={headingRef}
      footer={
        step === "email" ? (
          <AuthSwitchLink prompt="Already have an account?" href="/sign-in" label="Sign in" />
        ) : null
      }
    >
      <StepProgress current={stepNumber} total={STEPS.length} />

      {step === "email" ? (
        <StepEmail email={email} onEmailChange={setEmail} onSent={() => setStep("verify")} />
      ) : step === "verify" ? (
        <StepVerify
          email={email}
          onVerified={() => setStep("username")}
          onBack={() => setStep("email")}
        />
      ) : step === "username" ? (
        <StepUsername
          username={username}
          onUsernameChange={setUsername}
          onChosen={() => setStep("password")}
          onBack={() => setStep("verify")}
        />
      ) : (
        <StepPassword
          email={email}
          username={username}
          onCreated={() => router.push("/onboarding")}
          onBack={() => setStep("username")}
        />
      )}
    </AuthShell>
  );
}

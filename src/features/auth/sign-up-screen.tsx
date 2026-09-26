"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, AuthSwitchLink } from "./shell";
import { StepProgress } from "./controls";
import { StepDetails } from "./step-details";
import { StepVerify } from "./step-verify";
import { CODE_LENGTH } from "./rules";
import { useStageFocus } from "./use-stage-focus";
import { useInvitationReturnPath } from "@/features/access/use-invitation-return";

const STEPS = ["details", "verify"] as const;
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
  const headingRef = useStageFocus<HTMLHeadingElement>(step);

  const copy: Record<Step, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Create your Antcolos account",
      description: "Start with your details and the email address you use for work.",
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
      ) : (
        <StepVerify
          email={email}
          onVerified={() =>
            router.push(
              invitationReturn
                ? `/onboarding/profile?next=${encodeURIComponent(invitationReturn)}`
                : "/onboarding/profile",
            )
          }
          onBack={() => setStep("details")}
        />
      )}
    </AuthShell>
  );
}

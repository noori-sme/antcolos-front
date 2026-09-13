"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { BackLink, SubmitButton } from "./controls";
import { CodeField } from "./code-field";
import { FormAlert } from "./form-alert";
import { mockSendVerificationCode, mockVerifyCode } from "./mock-backend";
import { CODE_LENGTH, CODE_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, isCodeComplete } from "./rules";
import { formatCountdown, useCountdown } from "./use-countdown";

type Outcome = "idle" | "invalid" | "expired" | "resent";

const EMPTY_CODE = Array.from({ length: CODE_LENGTH }, () => "");

/**
 * Sign up, step 2 — confirm the email address with a 6-digit code.
 *
 * The code's lifetime and the resend cooldown are two separate countdowns:
 * a code can still be valid while resending is on cooldown, and resending
 * restarts both. When the lifetime runs out the code is refused even if it was
 * the right one, which is exactly how a real backend behaves.
 */
export function StepVerify({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const statusId = `${uid}-status`;

  const [digits, setDigits] = useState<string[]>(EMPTY_CODE);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);

  const life = useCountdown(CODE_TTL_SECONDS);
  const cooldown = useCountdown(RESEND_COOLDOWN_SECONDS);

  const complete = isCodeComplete(digits);
  const showInvalid = outcome === "invalid";
  const showExpired = outcome === "expired" || life.expired;

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending || resending || !complete) return;

    setOutcome("idle");
    setPending(true);
    const result = await mockVerifyCode(digits.join(""), life.expired);
    setPending(false);

    if (result.status === "verified") {
      onVerified();
      return;
    }
    setOutcome(result.status);
    if (result.status === "invalid") setDigits(EMPTY_CODE);
  }

  async function handleResend() {
    if (resending || pending || !cooldown.expired) return;
    setResending(true);
    setOutcome("idle");
    await mockSendVerificationCode(email);
    setResending(false);
    setDigits(EMPTY_CODE);
    life.restart();
    cooldown.restart();
    setOutcome("resent");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {showExpired ? (
        <FormAlert tone="warning" title="That code has expired.">
          Codes are only good for {Math.round(CODE_TTL_SECONDS / 60)} minutes. Send a new one to carry on.
        </FormAlert>
      ) : showInvalid ? (
        <FormAlert tone="danger" title="That code is not correct.">
          Check the {CODE_LENGTH} digits in the email and enter them again.
        </FormAlert>
      ) : outcome === "resent" ? (
        <FormAlert tone="success" title="A new code is on its way.">
          Enter the most recent code — older ones no longer work.
        </FormAlert>
      ) : null}

      <div className="space-y-2">
        <CodeField
          idPrefix={`${uid}-code`}
          digits={digits}
          onChange={(next) => {
            setDigits(next);
            if (outcome === "invalid") setOutcome("idle");
          }}
          onSubmitRequested={handleSubmit}
          disabled={pending || resending}
          invalid={showInvalid}
          describedBy={statusId}
        />
        <p id={statusId} aria-live="polite" className="text-[0.75rem] text-fg-subtle">
          {showExpired
            ? "This code is no longer valid."
            : `This code expires in ${formatCountdown(life.remaining)}.`}
        </p>
      </div>

      <SubmitButton
        pending={pending}
        pendingLabel="Checking code…"
        disabled={!complete || showExpired || resending}
      >
        Verify email
      </SubmitButton>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
        <BackLink onClick={onBack} label="Use a different email" />
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={handleResend}
          disabled={!cooldown.expired || resending || pending}
          aria-busy={resending || undefined}
        >
          {resending
            ? "Sending…"
            : cooldown.expired
              ? "Resend code"
              : `Resend code in ${formatCountdown(cooldown.remaining)}`}
        </Button>
      </div>
    </form>
  );
}

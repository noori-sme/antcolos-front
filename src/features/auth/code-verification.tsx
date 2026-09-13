"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "./controls";
import { CodeField } from "./code-field";
import { FormAlert } from "./form-alert";
import type { VerifyCodeResult } from "./mock-backend";
import { CODE_LENGTH, RESEND_COOLDOWN_SECONDS } from "./rules";
import { formatCountdown, useCountdown } from "./use-countdown";

type Outcome = "idle" | "invalid" | "expired" | "resent";

const emptyCode = () => Array.from({ length: CODE_LENGTH }, () => "");

/**
 * The code-entry form, shared by every place a code is checked: the signup
 * email, a carrier's FMCSA address, and a dispatch organization's official
 * address.
 *
 * The code's lifetime and the resend cooldown are two separate countdowns: a
 * code can still be valid while resending is on cooldown, and resending
 * restarts both. When the lifetime runs out the code is refused even if it was
 * the right one, which is how a real backend behaves.
 *
 * Sharing one component is what keeps the three screens honest with each other
 * — a fix to the keyboard handling or the expiry wording lands everywhere at
 * once instead of drifting apart.
 */
export function CodeVerification({
  ttlSeconds,
  onVerify,
  onResend,
  onVerified,
  addressLine,
  submitLabel = "Verify",
  pendingLabel = "Checking code…",
  footerLeft,
}: {
  ttlSeconds: number;
  onVerify: (code: string, codeIsStale: boolean) => Promise<VerifyCodeResult>;
  onResend: () => Promise<unknown>;
  onVerified: () => void;
  /** Shown directly above the boxes — the address the code went to. */
  addressLine?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  footerLeft?: ReactNode;
}) {
  const uid = useId();
  const statusId = `${uid}-status`;

  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);

  const life = useCountdown(ttlSeconds);
  const cooldown = useCountdown(RESEND_COOLDOWN_SECONDS);

  const complete = digits.every((d) => /^[0-9]$/.test(d));
  const showInvalid = outcome === "invalid";
  const showExpired = outcome === "expired" || life.expired;
  const minutes = Math.round(ttlSeconds / 60);

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending || resending || !complete) return;

    setOutcome("idle");
    setPending(true);
    const result = await onVerify(digits.join(""), life.expired);
    setPending(false);

    if (result.status === "verified") {
      onVerified();
      return;
    }
    setOutcome(result.status);
    if (result.status === "invalid") setDigits(emptyCode());
  }

  async function handleResend() {
    if (resending || pending || !cooldown.expired) return;
    setResending(true);
    setOutcome("idle");
    await onResend();
    setResending(false);
    setDigits(emptyCode());
    life.restart();
    cooldown.restart();
    setOutcome("resent");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {showExpired ? (
        <FormAlert tone="warning" title="That code has expired.">
          Codes are only good for {minutes} minutes. Send a new one to carry on.
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

      {addressLine ? <div>{addressLine}</div> : null}

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
            : `This code is valid for ${minutes} minutes — it expires in ${formatCountdown(life.remaining)}.`}
        </p>
      </div>

      <SubmitButton
        pending={pending}
        pendingLabel={pendingLabel}
        disabled={!complete || showExpired || resending}
      >
        {submitLabel}
      </SubmitButton>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
        <div>{footerLeft}</div>
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

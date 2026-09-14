"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { AuthShell } from "./shell";
import { BackLink, StepProgress, SubmitButton } from "./controls";
import { CodeVerification } from "./code-verification";
import { mockCreateIndividualDispatcher, mockSendWorkEmailCode, mockVerifyWorkEmailCode } from "./mock-backend";
import { ORG_CODE_TTL_SECONDS, maskEmail, normalizeEmail, validateEmail } from "./rules";
import { useStageFocus } from "./use-stage-focus";
import { cn } from "@/lib/utils";

type Stage = "email" | "code";

const STAGE_NUMBER: Record<Stage, number> = { email: 1, code: 2 };

/**
 * Working as an individual dispatcher.
 *
 * Two steps and no third: give the work address, confirm it, and you are in
 * Antcolos. There is deliberately no "you're all set" screen at the end —
 * confirming the code IS the finish, and a page whose only job is to say so
 * would be one more click between somebody and the work they came to do.
 *
 * Only the work email is asked for. No company name, because there is no
 * company; the person's own name already identifies the workspace, and asking
 * a sole dispatcher to invent a business name is how you end up with a fleet of
 * organizations called "My Dispatch".
 */
export function IndividualDispatcherSetup({
  onEnterWorkspace,
  onBack,
}: {
  onEnterWorkspace: () => void;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<Stage>("email");
  // Entered by pressing a card that then disappears, so focus has to be picked
  // up here or a screen-reader user is dropped at the top of the document.
  const headingRef = useStageFocus<HTMLHeadingElement>(stage, true);
  const [workEmail, setWorkEmail] = useState("");

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    email: {
      title: "Work as an individual dispatcher",
      description:
        "You dispatch on your own rather than as part of a team. Give us the address carriers should reach you on, and you are set up.",
    },
    code: {
      title: "Confirm your work email",
      description:
        "We sent a 6-digit code to your work address. Confirming it proves the mailbox is yours before carriers start receiving mail from it.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      <StepProgress current={STAGE_NUMBER[stage]} total={2} />

      {stage === "email" ? (
        <WorkEmailForm
          workEmail={workEmail}
          onWorkEmailChange={setWorkEmail}
          onSent={() => setStage("code")}
          onBack={onBack}
        />
      ) : null}

      {stage === "code" ? (
        <CodeVerification
          ttlSeconds={ORG_CODE_TTL_SECONDS}
          onVerify={mockVerifyWorkEmailCode}
          onResend={() => mockSendWorkEmailCode(normalizeEmail(workEmail))}
          onVerified={async () => {
            await mockCreateIndividualDispatcher({ workEmail: normalizeEmail(workEmail) });
            // Straight into the product. Nothing is left to confirm.
            onEnterWorkspace();
          }}
          addressLine={
            <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
              <p className="text-[0.75rem] text-fg-muted">Code sent to your work email</p>
              <p className="mt-0.5 font-mono text-[0.875rem] font-medium text-fg break-all">
                {maskEmail(normalizeEmail(workEmail))}
              </p>
            </div>
          }
          submitLabel="Verify and start dispatching"
          pendingLabel="Verifying…"
          footerLeft={<BackLink onClick={() => setStage("email")} label="Change email" />}
        />
      ) : null}
    </AuthShell>
  );
}

function WorkEmailForm({
  workEmail,
  onWorkEmailChange,
  onSent,
  onBack,
}: {
  workEmail: string;
  onWorkEmailChange: (v: string) => void;
  onSent: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const emailId = `${uid}-work-email`;
  const noteId = `${uid}-work-email-note`;

  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  // Only the shape is checked. Using the same address as the personal Antcolos
  // account is allowed on purpose — for somebody dispatching alone it usually
  // is the same mailbox.
  const emailError = submitted ? validateEmail(workEmail) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSubmitted(true);
    if (validateEmail(workEmail)) return;

    setSending(true);
    await mockSendWorkEmailCode(normalizeEmail(workEmail));
    onSent();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={emailId} className="block text-[0.8125rem] font-medium text-fg">
          Work email address
        </label>
        <Input
          id={emailId}
          type="email"
          value={workEmail}
          onChange={(e) => onWorkEmailChange(e.target.value)}
          autoComplete="email"
          placeholder="you@yourdispatch.com"
          disabled={sending}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={noteId}
          className={cn(emailError && "border-st-danger focus-visible:border-st-danger")}
        />
        {emailError ? (
          <p role="alert" className="text-[0.75rem] text-st-danger">{emailError}</p>
        ) : null}
        <p id={noteId} className="text-[0.75rem] leading-relaxed text-fg-subtle">
          This is the address carriers will use to reach you about loads. It can be the same address
          you use for your personal Antcolos account.
        </p>
      </div>

      <SubmitButton pending={sending} pendingLabel="Sending code…">
        Send verification code
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

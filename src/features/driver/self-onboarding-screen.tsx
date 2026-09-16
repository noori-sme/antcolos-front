"use client";

import { ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { AuthShell } from "@/features/auth/shell";
import { BackLink, StepProgress, SubmitButton } from "@/features/auth/controls";
import { CodeVerification } from "@/features/auth/code-verification";
import { FormAlert } from "@/features/auth/form-alert";
import { mockSendWorkEmailCode, mockVerifyWorkEmailCode } from "@/features/auth/mock-backend";
import { ORG_CODE_TTL_SECONDS, maskEmail, normalizeEmail, validateEmail } from "@/features/auth/rules";
import { useStageFocus } from "@/features/auth/use-stage-focus";
import { useSession } from "@/lib/session/hooks";
import { type DriverIdentityDraft, driverIdentityErrors, emptyDriverIdentity } from "./identity";
import { DriverIdentityFields } from "./identity-fields";
import { completeDriverSelfOnboarding, driverNeedsIdentity } from "./self-onboarding";
import { cn } from "@/lib/utils";

type Stage = "email" | "code" | "identity";

const STAGE_NUMBER: Record<Stage, number> = { email: 1, code: 2, identity: 3 };

/**
 * Signing up as a driver without waiting for anybody.
 *
 * What used to be here told the driver to go and find a carrier's invitation
 * link, which is a dead end for the one person the product is supposed to serve
 * first: a driver who has heard of Antcolos and has nobody to ask. Now they
 * confirm a work address, get the profile that is theirs for good, and walk
 * into the driver portal to start on their paperwork.
 *
 * What this does NOT do is give them a carrier. No relationship, no membership,
 * no employer, no carrier's data — because a driver signing up is not a driver
 * being hired. A carrier appears the day one invites them and they accept it,
 * through the invitation flow that is untouched, and that invitation attaches
 * to this same profile rather than starting a second one.
 */
export function DriverSelfOnboarding({
  onBack,
  onEnterDriverPortal,
}: {
  onBack: () => void;
  onEnterDriverPortal: () => void;
}) {
  const { user } = useSession();
  const [stage, setStage] = useState<Stage>("email");
  // Entered by pressing a card that then disappears, so focus has to be picked
  // up here or a screen-reader user is dropped at the top of the document.
  const headingRef = useStageFocus<HTMLHeadingElement>(stage, true);

  // The account's own address, offered rather than imposed: most drivers will
  // keep it, and the ones who keep work mail separate can say so. It is still
  // sent a code — the account model records an address, not a proof that
  // somebody controls it, so nothing here may treat it as already verified.
  const [workEmail, setWorkEmail] = useState(user.email);
  const [identity, setIdentity] = useState<DriverIdentityDraft>(emptyDriverIdentity);
  const [identitySubmitted, setIdentitySubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    email: {
      title: "Set up your driver account",
      description:
        "You do not need a carrier to start. Confirm a work email and your Antcolos driver profile is yours — carriers come later, by invitation.",
    },
    code: {
      title: "Confirm your work email",
      description:
        "We sent a 6-digit code to that address. Confirming it proves the mailbox is yours before any carrier is given it.",
    },
    identity: {
      title: "Your licence",
      description:
        "Four things, once. This profile belongs to you: it stays with you between carriers, and you are never asked for it twice.",
    },
  };

  /** The one place the profile is created, and only ever after verification. */
  async function finish(emailVerified: boolean) {
    setSaving(true);
    setFailure(null);
    const result = await completeDriverSelfOnboarding({
      workEmail,
      emailVerified,
      identity,
    });
    setSaving(false);

    if (result.status === "ok") {
      onEnterDriverPortal();
      return;
    }
    if (result.status === "identity-incomplete") {
      setIdentitySubmitted(true);
      return;
    }
    // Neither of the remaining outcomes is reachable from this screen — the
    // address was validated before the code was sent, and the code was checked
    // before we got here — so say so plainly rather than inventing a recovery.
    setFailure("We could not finish setting up your profile. Check your email address and try again.");
    setStage("email");
  }

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      <StepProgress current={STAGE_NUMBER[stage]} total={3} />

      {failure ? (
        <div className="mb-4">
          <FormAlert tone="danger" title={failure} />
        </div>
      ) : null}

      {stage === "email" ? (
        <WorkEmailForm
          workEmail={workEmail}
          accountEmail={user.email}
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
            // A driver who already has a profile is resumed straight into the
            // portal; only a new one is asked for a licence.
            if (await driverNeedsIdentity()) {
              setStage("identity");
              return;
            }
            await finish(true);
          }}
          addressLine={
            <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
              <p className="text-[0.75rem] text-fg-muted">Code sent to your work email</p>
              <p className="mt-0.5 font-mono text-[0.875rem] font-medium text-fg break-all">
                {maskEmail(normalizeEmail(workEmail))}
              </p>
            </div>
          }
          submitLabel="Verify my email"
          pendingLabel="Verifying…"
          footerLeft={<BackLink onClick={() => setStage("email")} label="Change email" />}
        />
      ) : null}

      {stage === "code" ? (
        // Said out loud, on the screen, because the alternative is a product
        // that looks like it proved something it did not. Nothing is emailed
        // and no server checks this code: verification is mocked in the browser
        // until there is a backend to do it for real.
        <p className="mt-5 flex items-start gap-2.5 rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
          <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden />
          Preview build: no email is sent and no server checks this code. Email verification here is
          mocked in the browser.
        </p>
      ) : null}

      {stage === "identity" ? (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setIdentitySubmitted(true);
            void finish(true);
          }}
        >
          <DriverIdentityFields
            draft={identity}
            onChange={setIdentity}
            errors={
              identitySubmitted
                ? driverIdentityErrors(identity)
                : { legalName: null, cdlNumber: null, cdlState: null, cdlExpiresAt: null }
            }
            disabled={saving}
          />

          <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
            <ShieldCheck className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            <p className="text-[0.75rem] leading-relaxed text-fg-muted">
              This creates your driver profile and nothing else. No carrier is connected to you and
              none can see this until you accept an invitation from them.
            </p>
          </div>

          <SubmitButton pending={saving} pendingLabel="Creating your profile…">
            Create my driver profile
          </SubmitButton>
        </form>
      ) : null}
    </AuthShell>
  );
}

function WorkEmailForm({
  workEmail,
  accountEmail,
  onWorkEmailChange,
  onSent,
  onBack,
}: {
  workEmail: string;
  accountEmail: string;
  onWorkEmailChange: (v: string) => void;
  onSent: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const emailId = `${uid}-driver-work-email`;
  const noteId = `${uid}-driver-work-email-note`;

  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

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
          placeholder="you@example.com"
          disabled={sending}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={noteId}
          className={cn(emailError && "border-st-danger focus-visible:border-st-danger")}
        />
        {emailError ? (
          <p role="alert" className="text-[0.75rem] text-st-danger">{emailError}</p>
        ) : null}
        <p id={noteId} className="text-[0.75rem] leading-relaxed text-fg-subtle">
          {workEmail === accountEmail
            ? "This is the address on your Antcolos account. Keep it, or use a different one for work — either way we send a code to make sure you can read it."
            : "Carriers who invite you will use this address. We send a code to make sure you can read it."}
        </p>
      </div>

      <SubmitButton pending={sending} pendingLabel="Sending code…">
        Send verification code
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} label="Choose a different role" />
      </div>
    </form>
  );
}

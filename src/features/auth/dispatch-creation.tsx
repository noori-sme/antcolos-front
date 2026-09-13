"use client";

import { ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthShell } from "./shell";
import { BackLink, StepProgress, SubmitButton } from "./controls";
import { CodeVerification } from "./code-verification";
import {
  mockCreateDispatchOrganization,
  mockSendOrgCode,
  mockVerifyOrgCode,
} from "./mock-backend";
import {
  ORG_CODE_TTL_SECONDS,
  maskEmail,
  normalizeEmail,
  validateEmail,
  validateFullName,
  validateOrgName,
} from "./rules";
import { useStageFocus } from "./use-stage-focus";
import { cn } from "@/lib/utils";

type Stage = "details" | "code" | "done";

const STAGE_NUMBER: Record<Stage, number> = { details: 1, code: 2, done: 3 };

/**
 * Creating a dispatch organization.
 *
 * The organization's address is confirmed the same way a carrier's is, because
 * carriers will be asked to trust mail from it.
 *
 * There is no password step here, and there must never be one: the person set a
 * password for their personal Antcolos account during signup, and that is the
 * only password they have. An organization is something you own, not something
 * you log into.
 */
export function DispatchCreation({
  onEnterWorkspace,
  onBack,
}: {
  onEnterWorkspace: () => void;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<Stage>("details");
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);

  const [ownerName, setOwnerName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgEmail, setOrgEmail] = useState("");

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Create your dispatch organization",
      description: "This is the organization carriers and drivers will see when they work with you.",
    },
    code: {
      title: "Confirm your organization's email",
      description:
        "We sent a 6-digit code to your organization's official address. Confirming it proves the mailbox is yours before carriers start receiving mail from it.",
    },
    done: {
      title: "Your dispatch organization is ready",
      description:
        "You are its owner. You can invite dispatchers, connect the carriers you dispatch for, and set what each person is allowed to see.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      {stage !== "done" ? <StepProgress current={STAGE_NUMBER[stage]} total={3} /> : null}

      {stage === "details" ? (
        <DispatchDetailsForm
          ownerName={ownerName}
          orgName={orgName}
          orgEmail={orgEmail}
          onOwnerNameChange={setOwnerName}
          onOrgNameChange={setOrgName}
          onOrgEmailChange={setOrgEmail}
          onSent={() => setStage("code")}
          onBack={onBack}
        />
      ) : null}

      {stage === "code" ? (
        <CodeVerification
          ttlSeconds={ORG_CODE_TTL_SECONDS}
          onVerify={mockVerifyOrgCode}
          onResend={() => mockSendOrgCode(normalizeEmail(orgEmail))}
          onVerified={async () => {
            await mockCreateDispatchOrganization({
              ownerLegalName: ownerName.trim(),
              organizationName: orgName.trim(),
              organizationEmail: normalizeEmail(orgEmail),
            });
            setStage("done");
          }}
          addressLine={
            <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
              <p className="text-[0.75rem] text-fg-muted">
                Code sent to your organization&apos;s email
              </p>
              <p className="mt-0.5 font-mono text-[0.875rem] font-medium text-fg break-all">
                {maskEmail(normalizeEmail(orgEmail))}
              </p>
            </div>
          }
          submitLabel="Verify and create organization"
          pendingLabel="Verifying…"
          footerLeft={<BackLink onClick={() => setStage("details")} label="Change details" />}
        />
      ) : null}

      {stage === "done" ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <ShieldCheck className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">{orgName.trim()} is set up.</p>
              <p className="mt-0.5 text-fg-muted">
                You are the owner, and {maskEmail(normalizeEmail(orgEmail))} is confirmed as its
                official address.
              </p>
            </div>
          </div>
          <Button variant="primary" size="lg" className="w-full" onClick={onEnterWorkspace}>
            Enter dispatch workspace
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}

function DispatchDetailsForm({
  ownerName,
  orgName,
  orgEmail,
  onOwnerNameChange,
  onOrgNameChange,
  onOrgEmailChange,
  onSent,
  onBack,
}: {
  ownerName: string;
  orgName: string;
  orgEmail: string;
  onOwnerNameChange: (v: string) => void;
  onOrgNameChange: (v: string) => void;
  onOrgEmailChange: (v: string) => void;
  onSent: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const nameId = `${uid}-owner`;
  const orgId = `${uid}-org`;
  const emailId = `${uid}-email`;
  const emailNoteId = `${uid}-email-note`;

  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const nameError = submitted ? validateFullName(ownerName) : null;
  const orgError = submitted ? validateOrgName(orgName) : null;
  // Only the shape is checked. Reusing the owner's personal address is allowed
  // on purpose — for a one-person dispatch outfit it is the same mailbox.
  const emailError = submitted ? validateEmail(orgEmail) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSubmitted(true);
    if (validateFullName(ownerName) || validateOrgName(orgName) || validateEmail(orgEmail)) return;

    setSending(true);
    await mockSendOrgCode(normalizeEmail(orgEmail));
    onSent();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Owner's full legal name"
        htmlFor={nameId}
        hint={nameError ? undefined : "The person legally responsible for this organization."}
        error={nameError ?? undefined}
      >
        <Input
          id={nameId}
          type="text"
          value={ownerName}
          onChange={(e) => onOwnerNameChange(e.target.value)}
          autoComplete="name"
          placeholder="Sam Salem"
          maxLength={80}
          disabled={sending}
          aria-invalid={nameError ? true : undefined}
          className={cn(nameError && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <Field
        label="Dispatch organization name"
        htmlFor={orgId}
        hint={orgError ? undefined : "Carriers and drivers will see this name."}
        error={orgError ?? undefined}
      >
        <Input
          id={orgId}
          type="text"
          value={orgName}
          onChange={(e) => onOrgNameChange(e.target.value)}
          placeholder="Meridian Dispatch"
          maxLength={60}
          disabled={sending}
          aria-invalid={orgError ? true : undefined}
          className={cn(orgError && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <div className="space-y-1.5">
        <label htmlFor={emailId} className="block text-[0.8125rem] font-medium text-fg">
          Organization email address
        </label>
        <Input
          id={emailId}
          type="email"
          value={orgEmail}
          onChange={(e) => onOrgEmailChange(e.target.value)}
          autoComplete="email"
          placeholder="dispatch@meridian.com"
          disabled={sending}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailNoteId}
          className={cn(emailError && "border-st-danger focus-visible:border-st-danger")}
        />
        {emailError ? (
          <p role="alert" className="text-[0.75rem] text-st-danger">{emailError}</p>
        ) : null}
        <p id={emailNoteId} className="text-[0.75rem] leading-relaxed text-fg-subtle">
          This will be your organization&apos;s official email for communication with carriers. It
          can be the same address you use for your personal Antcolos account.
        </p>
      </div>

      <SubmitButton pending={sending} pendingLabel="Sending code…">
        Continue
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

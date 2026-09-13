"use client";

import { CircleCheck, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthShell } from "./shell";
import { BackLink, StepProgress, SubmitButton } from "./controls";
import { CarrierRecord } from "./carrier-record";
import { CodeVerification } from "./code-verification";
import { FormAlert } from "./form-alert";
import {
  type CarrierLookupResult,
  type FmcsaCarrier,
  mockCreateCarrierOrganization,
  mockLookUpCarrier,
  mockSendOrgCode,
  mockVerifyOrgCode,
} from "./mock-backend";
import {
  DOT_MAX_DIGITS,
  MC_MAX_DIGITS,
  ORG_CODE_TTL_SECONDS,
  maskEmail,
  normalizeDotNumber,
  normalizeMcNumber,
  validateCarrierIdentifiers,
  validateDotNumber,
  validateFullName,
  validateMcNumber,
} from "./rules";
import { useStageFocus } from "./use-stage-focus";
import { cn } from "@/lib/utils";

type Stage = "details" | "review" | "code" | "done";

const STAGE_NUMBER: Record<Stage, number> = { details: 1, review: 2, code: 3, done: 4 };

/**
 * Carrier owner onboarding — claiming a real motor carrier.
 *
 * Anyone can type someone else's MC number, so being the owner is not something
 * this flow takes the user's word for. The claim is proved by receiving a code
 * at the address the carrier itself published in the federal register, which is
 * why that address is shown masked and cannot be edited here: an address the
 * user could change would prove nothing at all.
 *
 * The organization is created only after that code checks out.
 */
export function CarrierVerification({
  onEnterWorkspace,
  onBack,
}: {
  onEnterWorkspace: () => void;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<Stage>("details");
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);

  const [ownerName, setOwnerName] = useState("");
  const [mc, setMc] = useState("");
  const [dot, setDot] = useState("");
  const [carrier, setCarrier] = useState<(FmcsaCarrier & { email: string }) | null>(null);

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Verify your carrier",
      description:
        "We check your authority against public FMCSA records before creating your workspace, so no one can claim a carrier that isn't theirs.",
    },
    review: {
      title: "We found your carrier",
      description: "Check this is the right company before we send a verification code.",
    },
    code: {
      title: "Enter the verification code",
      description: "We sent a 6-digit code to the address FMCSA lists for this carrier.",
    },
    done: {
      title: "Your carrier organization is ready",
      description:
        "You are its verified owner. You can invite dispatchers and drivers, add trucks and start booking loads.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      {stage !== "done" ? <StepProgress current={STAGE_NUMBER[stage]} total={4} /> : null}

      {stage === "details" ? (
        <CarrierDetailsForm
          ownerName={ownerName}
          mc={mc}
          dot={dot}
          onOwnerNameChange={setOwnerName}
          onMcChange={setMc}
          onDotChange={setDot}
          onFound={(found) => {
            setCarrier(found);
            setStage("review");
          }}
          onBack={onBack}
        />
      ) : null}

      {stage === "review" && carrier ? (
        <CarrierReview
          carrier={carrier}
          onCodeSent={() => setStage("code")}
          onBack={() => setStage("details")}
        />
      ) : null}

      {stage === "code" && carrier ? (
        <CodeVerification
          ttlSeconds={ORG_CODE_TTL_SECONDS}
          onVerify={mockVerifyOrgCode}
          onResend={() => mockSendOrgCode(carrier.email)}
          onVerified={async () => {
            await mockCreateCarrierOrganization({
              ownerLegalName: ownerName.trim(),
              mc: carrier.mc,
              dot: carrier.dot,
              legalName: carrier.legalName,
            });
            setStage("done");
          }}
          addressLine={<MaskedAddress email={carrier.email} />}
          submitLabel="Verify and create my carrier"
          pendingLabel="Verifying…"
          footerLeft={<BackLink onClick={() => setStage("review")} />}
        />
      ) : null}

      {stage === "done" && carrier ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <ShieldCheck className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">
                {carrier.legalName} is verified and yours.
              </p>
              <p className="mt-0.5 text-fg-muted">
                MC {carrier.mc} · DOT {carrier.dot} — ownership confirmed through the carrier&apos;s
                FMCSA address.
              </p>
            </div>
          </div>
          <Button variant="primary" size="lg" className="w-full" onClick={onEnterWorkspace}>
            Enter carrier workspace
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}

/** The masked address, shown wherever a code has been or will be sent. */
function MaskedAddress({ email }: { email: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
      <p className="text-[0.75rem] text-fg-muted">Code sent to the carrier&apos;s FMCSA address</p>
      <p className="mt-0.5 font-mono text-[0.875rem] font-medium text-fg break-all">
        {maskEmail(email)}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1 — carrier information                                                */
/* -------------------------------------------------------------------------- */

function CarrierDetailsForm({
  ownerName,
  mc,
  dot,
  onOwnerNameChange,
  onMcChange,
  onDotChange,
  onFound,
  onBack,
}: {
  ownerName: string;
  mc: string;
  dot: string;
  onOwnerNameChange: (v: string) => void;
  onMcChange: (v: string) => void;
  onDotChange: (v: string) => void;
  onFound: (carrier: FmcsaCarrier & { email: string }) => void;
  onBack: () => void;
}) {
  const uid = useId();
  const nameId = `${uid}-owner`;
  const mcId = `${uid}-mc`;
  const dotId = `${uid}-dot`;

  const [submitted, setSubmitted] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<CarrierLookupResult | null>(null);

  // Format problems are shown as soon as there is something wrong to say about
  // what has been typed; the "one of these is required" rule waits for submit,
  // because both boxes are empty to begin with and that is not an error yet.
  const nameError = submitted ? validateFullName(ownerName) : null;
  const mcError = validateMcNumber(mc);
  const dotError = validateDotNumber(dot);
  const missingError = submitted ? validateCarrierIdentifiers(mc, dot) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (searching) return;
    setSubmitted(true);
    setResult(null);

    if (validateFullName(ownerName) || mcError || dotError || validateCarrierIdentifiers(mc, dot)) {
      return;
    }

    setSearching(true);
    const lookup = await mockLookUpCarrier(normalizeMcNumber(mc), normalizeDotNumber(dot));
    setSearching(false);

    if (lookup.status === "found") {
      onFound(lookup.carrier);
      return;
    }
    setResult(lookup);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {result ? <LookupProblem result={result} /> : null}

      <Field
        label="Owner's full legal name"
        htmlFor={nameId}
        hint={nameError ? undefined : "As it appears on the carrier's authority."}
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
          disabled={searching}
          aria-invalid={nameError ? true : undefined}
          className={cn(nameError && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="MC number" htmlFor={mcId} error={mcError ?? undefined}>
          <Input
            id={mcId}
            type="text"
            inputMode="numeric"
            value={mc}
            onChange={(e) => onMcChange(e.target.value)}
            placeholder="123456"
            maxLength={MC_MAX_DIGITS + 3}
            disabled={searching}
            aria-invalid={mcError ? true : undefined}
            className={cn("tabular-nums", mcError && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>
        <Field label="DOT number" htmlFor={dotId} error={dotError ?? undefined}>
          <Input
            id={dotId}
            type="text"
            inputMode="numeric"
            value={dot}
            onChange={(e) => onDotChange(e.target.value)}
            placeholder="1234567"
            maxLength={DOT_MAX_DIGITS + 5}
            disabled={searching}
            aria-invalid={dotError ? true : undefined}
            className={cn("tabular-nums", dotError && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>
      </div>

      <p className={cn("text-[0.75rem]", missingError ? "text-st-danger" : "text-fg-subtle")} role={missingError ? "alert" : undefined}>
        {missingError ?? "Enter either number, or both. Both together is the strongest match."}
      </p>

      <SubmitButton pending={searching} pendingLabel="Searching FMCSA records…">
        Find my carrier
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

/** Everything the lookup can say other than "found". */
function LookupProblem({ result }: { result: CarrierLookupResult }) {
  if (result.status === "not-found") {
    return (
      <FormAlert tone="danger" title="No carrier matches those numbers.">
        Check the digits against your authority letter. Newly issued authorities can take a few
        weeks to appear in public FMCSA records.
      </FormAlert>
    );
  }
  if (result.status === "mismatch") {
    return (
      <FormAlert tone="danger" title="Those two numbers belong to different carriers.">
        The MC number is registered to {result.mcCarrier} and the DOT number to{" "}
        {result.dotCarrier}. Correct whichever is wrong, or leave one blank.
      </FormAlert>
    );
  }
  if (result.status === "already-claimed") {
    return (
      <FormAlert tone="warning" title="This carrier is already on Antcolos.">
        {result.carrier.legalName} has been claimed by another account. If that is your company,
        ask its owner to invite you instead of creating a second workspace.
      </FormAlert>
    );
  }
  return (
    <FormAlert tone="warning" title="FMCSA has no email address on file for this carrier.">
      We can only prove ownership by writing to the address {result.carrier.legalName} published in
      the federal register, and there is not one. Add an email to your FMCSA record, or contact us
      to verify another way.
    </FormAlert>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2 — confirm the record and send the code                               */
/* -------------------------------------------------------------------------- */

function CarrierReview({
  carrier,
  onCodeSent,
  onBack,
}: {
  carrier: FmcsaCarrier & { email: string };
  onCodeSent: () => void;
  onBack: () => void;
}) {
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (sending) return;
    setSending(true);
    await mockSendOrgCode(carrier.email);
    onCodeSent();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-md border border-st-success/35 bg-st-success-bg/50 px-3 py-2.5">
        <CircleCheck className="mt-px size-4 shrink-0 text-st-success" aria-hidden />
        <p className="text-[0.8125rem] font-medium text-fg">
          Matched in public FMCSA records.
        </p>
      </div>

      <CarrierRecord carrier={carrier} />

      <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-3">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          We&apos;ll send a verification code to the email address publicly listed for this carrier
          in FMCSA records.
        </p>
        <p className="mt-2 font-mono text-[0.875rem] font-medium text-fg break-all">
          {maskEmail(carrier.email)}
        </p>
        <p className="mt-2 text-[0.75rem] text-fg-subtle">
          This address cannot be changed here — receiving mail at the carrier&apos;s own registered
          address is what proves the carrier is yours.
        </p>
      </div>

      <SubmitButton
        type="button"
        pending={sending}
        pendingLabel="Sending code…"
        onClick={handleSend}
      >
        Send verification code
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} label="These numbers are wrong" />
      </div>
    </div>
  );
}

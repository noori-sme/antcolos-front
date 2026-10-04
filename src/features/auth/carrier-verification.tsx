"use client";

import { CircleCheck, ShieldCheck, Loader2 } from "lucide-react";
import { useId, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import Cookies from "js-cookie";
import { AuthShell } from "./shell";
import { BackLink, StepProgress, SubmitButton } from "./controls";
import { CarrierRecord } from "./carrier-record";
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

type Stage = "details" | "review" | "link" | "result";

const STAGE_NUMBER: Record<Stage, number> = { details: 1, review: 2, link: 3, result: 4 };

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
  initialStage = "details",
  onEnterWorkspace,
  onBack,
}: {
  initialStage?: "details" | "review" | "link" | "result";
  onEnterWorkspace: () => void;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);

  const [ownerName, setOwnerName] = useState("");
  const [mc, setMc] = useState("");
  const [dot, setDot] = useState("");
  const [carrier, setCarrier] = useState<(FmcsaCarrier & { email: string }) | null>(null);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (initialStage === "review" && !carrier) {
      try {
        const savedData = Cookies.get("antcolos_carrier_data");
        if (savedData) {
          const parsed = JSON.parse(savedData);
          setOwnerName(parsed.legalName || "");
          setMc(parsed.mc || "");
          setDot(parsed.dot || "");
          setCarrier({
            legalName: parsed.legalName || "Your Carrier",
            mc: parsed.mc || "",
            dot: parsed.dot || "",
            location: "",
            entityType: "Carrier",
            operatingStatus: "Active",
            email: parsed.email || "your registered FMCSA email"
          });
        } else {
          // No cookie found (e.g. user just logged in from a new session)
          setStage("details");
          toast.info("It seems like you haven't verified your details yet. Please enter your details and verify it.", { id: "verify-details-toast" });
        }
      } catch (e) {
        setStage("details");
        toast.info("It seems like you haven't verified your details yet. Please enter your details and verify it.", { id: "verify-details-toast" });
      }
    }
  }, [initialStage, carrier]);

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Verify your carrier",
      description:
        "We check your authority against public FMCSA records before creating your workspace, so no one can claim a carrier that isn't theirs.",
    },
    review: {
      title: "We found your carrier",
      description: "Check this is the right company before we send a verification link.",
    },
    link: {
      title: "Check your email",
      description: "We sent a verification link to the address FMCSA lists for this carrier.",
    },
    result: {
      title: isVerified ? "Your carrier organization is ready" : "Verification Failed",
      description: isVerified 
        ? "You are its verified owner. You can invite dispatchers and drivers, add trucks and start booking loads."
        : "We were unable to verify your carrier using the provided link.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      {stage !== "result" || !isVerified ? <StepProgress current={STAGE_NUMBER[stage]} total={4} /> : null}

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
          ownerName={ownerName}
          mc={mc}
          dot={dot}
          carrier={carrier}
          onCodeSent={() => setStage("link")}
          onBack={() => setStage("details")}
        />
      ) : null}

      {stage === "link" && carrier ? (
        <div className="space-y-4">
          <MaskedAddress email={carrier.email} />
          
          <div className="pt-2 flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              className="w-full border-dashed border-2 opacity-50 hover:opacity-100"
              onClick={async () => {
                await mockCreateCarrierOrganization({
                  ownerLegalName: ownerName.trim(),
                  mc: carrier.mc,
                  dot: carrier.dot,
                  legalName: carrier.legalName,
                });
                Cookies.remove("antcolos_carrier_data");
                setIsVerified(true);
                setStage("result");
              }}
            >
              Simulate: Verification Success
            </Button>
            
            <Button
              type="button"
              variant="danger"
              className="w-full border-dashed border-2 opacity-50 hover:opacity-100"
              onClick={() => {
                setIsVerified(false);
                setStage("result");
              }}
            >
              Simulate: Verification Failed
            </Button>
          </div>
          
          <div className="pt-1">
            <BackLink onClick={() => setStage("review")} />
          </div>
        </div>
      ) : null}

      {stage === "result" && carrier ? (
        <div className="space-y-5">
          {isVerified ? (
            <>
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
            </>
          ) : (
            <>
              <FormAlert tone="danger" title="Verification link invalid or expired.">
                The verification link you clicked is no longer valid. Please request a new verification link to your FMCSA email address.
              </FormAlert>
              <Button 
                variant="primary" 
                size="lg" 
                className="w-full mt-4" 
                onClick={() => {
                  mockSendOrgCode(carrier.email);
                  setStage("link");
                }}
              >
                Send verification link again
              </Button>
              <div className="pt-2 text-center">
                <Button variant="link" size="sm" onClick={() => setStage("review")}>
                  Go back to review
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </AuthShell>
  );
}

function MaskedAddress({ email }: { email: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
      <p className="text-[0.75rem] text-fg-muted">Link sent to the carrier&apos;s FMCSA address</p>
      <p className="mt-0.5 font-mono text-[0.875rem] font-medium text-fg break-all">
        {maskEmail(email)}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1 — carrier information                                                */
/* -------------------------------------------------------------------------- */

function getFriendlyErrorMessage(error: any): string {
  const msg = error?.message || "";
  
  if (error?.error === "carrier_verification_rate_limited" || msg.includes("Too many")) {
    return "You've requested too many verification links. Please wait a little while before trying again.";
  }

  if (!msg) return "Failed to submit. Please try again.";

  if (msg.includes("regular expression")) {
    if (msg.includes("dotNumber")) return "DOT number must contain only digits.";
    if (msg.includes("mcNumber")) return "MC number must contain only digits.";
    return "Please check the format of your input.";
  }

  if (msg.includes("legalOwnerName") && msg.includes("required")) {
    return "Owner's full legal name is required.";
  }

  if (msg.includes("validation failed") || msg.includes("ValidationError")) {
    return "Please ensure all fields are filled out correctly.";
  }

  return msg;
}

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
  const [result, setResult] = useState<CarrierLookupResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitCarrierMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post("/auth/carrier-onboarding", {
        legalOwnerName: ownerName,
        mcNumber: mc ? Number(mc) : undefined,
        dotNumber: dot ? Number(dot) : undefined
      });
      return data;
    },
    onSuccess: (data: any) => {
      const returnedEmail = data?.user?.carrierVerification?.email || "your registered FMCSA email";
      
      const payloadToSave = {
        legalName: ownerName,
        mc: mc,
        dot: dot,
        email: returnedEmail
      };
      
      Cookies.set("antcolos_carrier_data", JSON.stringify(payloadToSave), { expires: 1 });
      
      onFound({
        legalName: ownerName,
        mc: mc,
        dot: dot,
        location: "",
        entityType: "Carrier",
        operatingStatus: "Active",
        email: returnedEmail
      });
    },
    onError: (error: any) => {
      const msg = getFriendlyErrorMessage(error);
      toast.error(msg);
      setSubmitError(msg);
    }
  });

  // Format problems are shown as soon as there is something wrong to say about
  // what has been typed; the "one of these is required" rule waits for submit,
  // because both boxes are empty to begin with and that is not an error yet.
  const nameError = submitted ? validateFullName(ownerName) : null;
  const mcError = validateMcNumber(mc);
  const dotError = validateDotNumber(dot);
  const missingError = submitted ? validateCarrierIdentifiers(mc, dot) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitCarrierMutation.isPending) return;
    setSubmitted(true);
    setResult(null);
    setSubmitError(null);

    if (validateFullName(ownerName) || mcError || dotError || validateCarrierIdentifiers(mc, dot)) {
      return;
    }

    submitCarrierMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {result ? <LookupProblem result={result} /> : null}
      
      {submitError ? (
        <FormAlert tone="danger" title="Could not verify carrier">
          {submitError}
        </FormAlert>
      ) : null}

      <Field
        label="Owner's full legal name"
        htmlFor={nameId}
        required={true}
        hint={nameError ? undefined : "As it appears on the carrier's authority."}
        error={nameError ?? undefined}
      >
        <Input
          id={nameId}
          type="text"
          value={ownerName}
          onChange={(e) => onOwnerNameChange(e.target.value)}
          autoComplete="name"
          placeholder="Enter Your Full Legal Name"
          maxLength={80}
          disabled={submitCarrierMutation.isPending}
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
            placeholder="Enter MC number"
            maxLength={MC_MAX_DIGITS + 3}
            disabled={submitCarrierMutation.isPending}
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
            placeholder="Enter DOT number"
            maxLength={DOT_MAX_DIGITS + 5}
            disabled={submitCarrierMutation.isPending}
            aria-invalid={dotError ? true : undefined}
            className={cn("tabular-nums", dotError && "border-st-danger focus-visible:border-st-danger")}
          />
        </Field>
      </div>

      <p className={cn("text-[0.75rem]", missingError ? "text-st-danger" : "text-fg-subtle")} role={missingError ? "alert" : undefined}>
        {missingError ?? "At least one of MC or DOT number is required. Both together is the strongest match."}
      </p>

      <SubmitButton pending={submitCarrierMutation.isPending} pendingLabel="Submitting...">
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
function CarrierReview({
  ownerName,
  mc,
  dot,
  carrier,
  onCodeSent,
  onBack,
}: {
  ownerName: string;
  mc: string;
  dot: string;
  carrier: FmcsaCarrier & { email: string };
  onCodeSent: () => void;
  onBack: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { data: lookupData, isLoading } = useQuery({
    queryKey: ["carrierLookup", mc, dot],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (mc) params.append("mc", mc);
      else if (dot) params.append("dot", dot);
      
      const { data } = await apiClient.get(`/carriers/lookup?${params.toString()}`);
      return data;
    },
    enabled: !!(mc || dot)
  });

  const displayCarrier = {
    ...carrier,
    location: lookupData?.address 
      ? `${lookupData.address.city}, ${lookupData.address.state}, ${lookupData.address.country}`
      : carrier.location,
    dot: lookupData?.dotNumber || carrier.dot,
    mc: lookupData?.mcNumber?.replace('MC', '') || carrier.mc,
    operatingStatus: lookupData ? (lookupData.active ? "Active" : "Inactive") : carrier.operatingStatus,
    legalName: lookupData?.legalName || carrier.legalName,
    email: lookupData?.email || carrier.email,
    dbaName: lookupData?.dbaName || undefined
  };

  const submitCarrierMutation = useMutation({
    mutationFn: async () => {
      // Use data from cookies as requested
      const savedData = Cookies.get("antcolos_carrier_data");
      let payloadOwnerName = ownerName;
      let payloadMc = mc;
      let payloadDot = dot;

      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          payloadOwnerName = parsed.legalName || ownerName;
          payloadMc = parsed.mc || mc;
          payloadDot = parsed.dot || dot;
        } catch (e) {}
      }

      const { data } = await apiClient.post("/auth/carrier-onboarding", {
        legalOwnerName: payloadOwnerName,
        mcNumber: payloadMc ? Number(payloadMc) : undefined,
        dotNumber: payloadDot ? Number(payloadDot) : undefined
      });
      return data;
    },
    onSuccess: (data: any) => {
      const returnedEmail = data?.user?.carrierVerification?.email || "your registered FMCSA email";
      
      const payloadToSave = {
        legalName: ownerName,
        mc: mc,
        dot: dot,
        email: returnedEmail
      };
      
      Cookies.set("antcolos_carrier_data", JSON.stringify(payloadToSave), { expires: 1 });
      onCodeSent();
    },
    onError: (error: any) => {
      const msg = getFriendlyErrorMessage(error);
      toast.error(msg);
      setSendError(msg);
      setSending(false);
    }
  });

  async function handleSend() {
    if (sending) return;
    setSending(true);
    setSendError(null);
    submitCarrierMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-md border border-st-success/35 bg-st-success-bg/50 px-3 py-2.5">
        <CircleCheck className="mt-px size-4 shrink-0 text-st-success" aria-hidden />
        <p className="text-[0.8125rem] font-medium text-fg">
          Matched in public FMCSA records.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-[180px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface-sunken">
          <Loader2 className="size-5 animate-spin text-fg-muted" />
          <p className="text-[0.8125rem] text-fg-muted">Fetching carrier details…</p>
        </div>
      ) : (
        <CarrierRecord carrier={displayCarrier} />
      )}

      <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-3">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          We&apos;ll send a verification link to the email address publicly listed for this carrier
          in FMCSA records.
        </p>
        <p className="mt-2 font-mono text-[0.875rem] font-medium text-fg break-all">
          {maskEmail(displayCarrier.email)}
        </p>
        <p className="mt-2 text-[0.75rem] text-fg-subtle">
          This address cannot be changed here — receiving mail at the carrier&apos;s own registered
          address is what proves the carrier is yours.
        </p>
      </div>

      {sendError ? (
        <FormAlert tone="danger" title="Could not send link">
          {sendError}
        </FormAlert>
      ) : null}

      <SubmitButton
        type="button"
        pending={submitCarrierMutation.isPending}
        pendingLabel="Sending link…"
        onClick={handleSend}
      >
        Send verification link
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} label="These numbers are wrong" />
      </div>
    </div>
  );
}

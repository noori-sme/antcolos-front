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
  maskEmail,
  normalizeEmail,
  validateEmail,
  validateFullName,
  validateOrgName,
} from "./rules";
import { useStageFocus } from "./use-stage-focus";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";

type Stage = "details" | "address" | "done";

const STAGE_NUMBER: Record<Stage, number> = { details: 1, address: 2, done: 3 };

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
  const [handle, setHandle] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  
  // Address fields
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [country, setCountry] = useState("US");

  const [serverError, setServerError] = useState<string | null>(null);

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Create your dispatch organization",
      description: "This is the organization carriers and drivers will see when they work with you.",
    },
    address: {
      title: "Company Address",
      description: "Where is your dispatch organization located? You can skip this and add it later.",
    },
    done: {
      title: "Your dispatch organization is ready",
      description: "You are its owner. You can invite dispatchers, connect the carriers you dispatch for, and set what each person is allowed to see.",
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
          handle={handle}
          companyEmail={companyEmail}
          companyPhone={companyPhone}
          serverError={serverError}
          onOwnerNameChange={(v) => { setServerError(null); setOwnerName(v); }}
          onOrgNameChange={(v) => { setServerError(null); setOrgName(v); }}
          onHandleChange={(v) => { setServerError(null); setHandle(v); }}
          onCompanyEmailChange={(v) => { setServerError(null); setCompanyEmail(v); }}
          onCompanyPhoneChange={(v) => { setServerError(null); setCompanyPhone(v); }}
          onSent={() => {
            setServerError(null);
            setStage("address");
          }}
          onBack={onBack}
        />
      ) : null}

      {stage === "address" ? (
        <DispatchAddressForm
          addressLine1={addressLine1}
          addressLine2={addressLine2}
          postalCode={postalCode}
          city={city}
          addressState={addressState}
          country={country}
          onAddressLine1Change={setAddressLine1}
          onAddressLine2Change={setAddressLine2}
          onPostalCodeChange={setPostalCode}
          onCityChange={setCity}
          onAddressStateChange={setAddressState}
          onCountryChange={setCountry}
          onBack={() => setStage("details")}
          onComplete={async () => {
            try {
              await apiClient.post("/auth/company-details", {
                companyName: orgName.trim(),
                handle: handle.trim(),
                legalOwnerName: ownerName.trim(),
                companyEmail: companyEmail.trim(),
                companyPhone: companyPhone.trim(),
                companyAddress: {
                  addressLine1: addressLine1.trim(),
                  addressLine2: addressLine2.trim(),
                  postalCode: postalCode.trim(),
                  city: city.trim(),
                  state: addressState.trim(),
                  country: country.trim(),
                }
              });
              setStage("done");
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : "Failed to create dispatch organization";
              setServerError(errorMessage);
              setStage("details");
            }
          }}
        />
      ) : null}

      {stage === "done" ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <ShieldCheck className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">{orgName.trim()} is set up.</p>
              <p className="mt-0.5 text-fg-muted">
                You are the owner.
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
  handle,
  companyEmail,
  companyPhone,
  serverError,
  onOwnerNameChange,
  onOrgNameChange,
  onHandleChange,
  onCompanyEmailChange,
  onCompanyPhoneChange,
  onSent,
  onBack,
}: {
  ownerName: string;
  orgName: string;
  handle: string;
  companyEmail: string;
  companyPhone: string;
  serverError: string | null;
  onOwnerNameChange: (v: string) => void;
  onOrgNameChange: (v: string) => void;
  onHandleChange: (v: string) => void;
  onCompanyEmailChange: (v: string) => void;
  onCompanyPhoneChange: (v: string) => void;
  onSent: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const nameId = `${uid}-owner`;
  const orgId = `${uid}-org`;
  const handleId = `${uid}-handle`;
  const emailId = `${uid}-email`;
  const phoneId = `${uid}-phone`;

  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  // Parse serverError to see which field it belongs to
  const errText = serverError?.toLowerCase() || "";
  const sErrPhone = errText.includes("phone number") ? serverError : null;
  const sErrName = errText.includes("owner name") ? serverError : null;
  const sErrOrg = errText.includes("organization name") ? serverError : null;
  const sErrHandle = errText.includes("handle") ? serverError : null;
  const sErrEmail = errText.includes("email") ? serverError : null;

  const nameError = (submitted ? validateFullName(ownerName) : null) || sErrName;
  const orgError = (submitted ? validateOrgName(orgName) : null) || sErrOrg;
  const handleError = (submitted ? (handle.trim() ? null : "Enter an organization handle.") : null) || sErrHandle;
  const emailError = (submitted ? validateEmail(companyEmail) : null) || sErrEmail;
  const phoneError = sErrPhone;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSubmitted(true);
    if (validateFullName(ownerName) || validateOrgName(orgName) || !handle.trim() || validateEmail(companyEmail)) return;

    setSending(true);
    // Move to next step immediately
    onSent();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Owner's full legal name"
        htmlFor={nameId}
        hint={nameError ? undefined : "The person legally responsible for this organization."}
        error={nameError ?? undefined}
        required
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
        required
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

      <Field
        label="Organization Handle"
        htmlFor={handleId}
        error={handleError ?? undefined}
        required
      >
        <Input
          id={handleId}
          type="text"
          value={handle}
          onChange={(e) => onHandleChange(e.target.value)}
          placeholder="acmehaulage"
          disabled={sending}
          aria-invalid={handleError ? true : undefined}
          className={cn(handleError && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <Field
        label="Company Email"
        htmlFor={emailId}
        error={emailError ?? undefined}
        required
      >
        <Input
          id={emailId}
          type="email"
          value={companyEmail}
          onChange={(e) => onCompanyEmailChange(e.target.value)}
          placeholder="ops@acmehaulage.com"
          disabled={sending}
          aria-invalid={emailError ? true : undefined}
          className={cn(emailError && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <Field
        label="Company Phone"
        htmlFor={phoneId}
        error={phoneError ?? undefined}
      >
        <Input
          id={phoneId}
          type="tel"
          value={companyPhone}
          onChange={(e) => onCompanyPhoneChange(e.target.value)}
          placeholder="4155551000"
          disabled={sending}
          aria-invalid={phoneError ? true : undefined}
          className={cn(phoneError && "border-st-danger focus-visible:border-st-danger")}
        />
      </Field>

      <SubmitButton pending={sending} pendingLabel="Continuing…">
        Continue
      </SubmitButton>

    </form>
  );
}

function DispatchAddressForm({
  addressLine1,
  addressLine2,
  postalCode,
  city,
  addressState,
  country,
  onAddressLine1Change,
  onAddressLine2Change,
  onPostalCodeChange,
  onCityChange,
  onAddressStateChange,
  onCountryChange,
  onBack,
  onComplete,
}: {
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  addressState: string;
  country: string;
  onAddressLine1Change: (v: string) => void;
  onAddressLine2Change: (v: string) => void;
  onPostalCodeChange: (v: string) => void;
  onCityChange: (v: string) => void;
  onAddressStateChange: (v: string) => void;
  onCountryChange: (v: string) => void;
  onBack: () => void;
  onComplete: () => Promise<void>;
}) {
  const uid = useId();
  const line1Id = `${uid}-line1`;
  const line2Id = `${uid}-line2`;
  const zipId = `${uid}-zip`;
  const cityId = `${uid}-city`;
  const stateId = `${uid}-state`;
  const countryId = `${uid}-country`;

  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    await onComplete();
  }

  async function handleSkip() {
    if (saving) return;
    setSaving(true);
    await onComplete();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field label="Address Line 1" htmlFor={line1Id}>
        <Input
          id={line1Id}
          type="text"
          value={addressLine1}
          onChange={(e) => onAddressLine1Change(e.target.value)}
          placeholder="123 Market St"
          disabled={saving}
        />
      </Field>
      
      <Field label="Address Line 2" htmlFor={line2Id}>
        <Input
          id={line2Id}
          type="text"
          value={addressLine2}
          onChange={(e) => onAddressLine2Change(e.target.value)}
          placeholder="Suite 400"
          disabled={saving}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="City" htmlFor={cityId}>
          <Input
            id={cityId}
            type="text"
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="San Francisco"
            disabled={saving}
          />
        </Field>
        <Field label="State / Province" htmlFor={stateId}>
          <Input
            id={stateId}
            type="text"
            value={addressState}
            onChange={(e) => onAddressStateChange(e.target.value)}
            placeholder="CA"
            disabled={saving}
          />
        </Field>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <Field label="Postal Code" htmlFor={zipId}>
          <Input
            id={zipId}
            type="text"
            value={postalCode}
            onChange={(e) => onPostalCodeChange(e.target.value)}
            placeholder="94105"
            disabled={saving}
          />
        </Field>
        <Field label="Country" htmlFor={countryId}>
          <Input
            id={countryId}
            type="text"
            value="US"
            readOnly
            disabled
          />
        </Field>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <SubmitButton pending={saving} pendingLabel="Saving…">
          Save Address
        </SubmitButton>
        <Button 
          type="button" 
          variant="outline" 
          onClick={handleSkip} 
          disabled={saving}
          className="w-full"
        >
          Skip for now
        </Button>
      </div>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

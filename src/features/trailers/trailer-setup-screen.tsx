"use client";

import {
  CircleCheck, FileUp, Keyboard, Link2, LoaderCircle, Plug, ScanLine,
  TriangleAlert, Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { FormAlert } from "@/features/auth/form-alert";
import { useStageFocus } from "@/features/auth/use-stage-focus";
import { US_STATES, todayIsoDate, validateExpiryDate } from "@/features/driver/driver-rules";
import {
  CONFIG_CHOICES, CONFIG_LABEL, CONFIG_UNIT, TRAILER_SPEC_LABEL, TRAILER_SPEC_UNIT,
  TRAILER_TYPE_DESCRIPTION, TRAILER_TYPE_LABEL, TRAILER_TYPES,
  configFieldsFor, isBooleanConfig, isDateConfig, isTextConfig, trailerSpecFieldsFor,
  type ConfigField,
} from "@/lib/fleet/trailer-equipment";
import { checkDigitMatches, validateVin } from "@/lib/fleet/vin";
import {
  lookUpTrailerVin, openTrailerOwnershipClaim, registerOrConnectTrailer,
  type RegisterTrailerOutcome, type TrailerVinLookupResult,
} from "@/lib/api/mock/trailer-registry";
import type {
  CarrierRelationshipType, TrailerConfiguration, TrailerSpecs, TrailerType,
} from "@/types";
import {
  TRAILER_RELATIONSHIP_TYPE_LABEL, maskTrailerVin,
} from "./trailer-labels";
import { useTrailerContext } from "./use-trailer-context";
import { cn } from "@/lib/utils";

type Stage = "method" | "prototype" | "scan" | "vin" | "details" | "ownership" | "review" | "outcome";
type Method = "manual" | "scan" | "import" | "connect";

interface Draft {
  vin: string;
  unitNumber: string;
  trailerType: TrailerType;
  year: string;
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  plateState: string;
  registrationExpiresAt: string;
  registeredOwnerName: string;
  specs: Record<string, string>;
  config: Record<string, string>;
  city: string;
  state: string;
  notes: string;
  relationshipType: CarrierRelationshipType;
  ownerType: "person" | "organization";
  ownerName: string;
}

const EMPTY: Draft = {
  vin: "", unitNumber: "", trailerType: "dry_van", year: "", make: "", model: "", color: "",
  plateNumber: "", plateState: "", registrationExpiresAt: "", registeredOwnerName: "",
  specs: {}, config: {}, city: "", state: "", notes: "",
  relationshipType: "carrier_owned", ownerType: "organization", ownerName: "",
};

/**
 * Trailer setup.
 *
 * Four ways in, but only two of them do anything, and the screen says which.
 * Manual entry and document scanning both end at the same canonical
 * registration call; importing a file and connecting an outside system are
 * labelled as not built, because inventing trailers that do not exist would be
 * worse than an empty fleet.
 *
 * What is different from the truck wizard, rather than merely renamed: the type
 * step drives a second set of equipment questions, and a genuinely new trailer
 * cannot be created without somebody choosing an ownership document.
 */
export function TrailerSetupScreen() {
  const router = useRouter();
  const ctx = useTrailerContext();
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("method");
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);
  const [method, setMethod] = useState<Method>("manual");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const [lookup, setLookup] = useState<TrailerVinLookupResult | null>(null);
  const [outcome, setOutcome] = useState<RegisterTrailerOutcome | null>(null);
  const [scanFile, setScanFile] = useState<{ name: string; type: string; size: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [evidence, setEvidence] = useState<{ name: string; type: string; size: number } | null>(null);
  const [claimOpened, setClaimOpened] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const vinError = submitted || draft.vin ? validateVin(draft.vin) : null;
  const checkDigit = draft.vin && !vinError ? checkDigitMatches(draft.vin) : null;
  // A trailer that already exists is being connected, not created, so it needs
  // no new ownership document.
  const isNewTrailer = !lookup?.trailer;

  async function runLookup() {
    if (!ctx || busy) return;
    setSubmitted(true);
    if (validateVin(draft.vin)) return;
    setBusy(true);
    const result = await lookUpTrailerVin(draft.vin, ctx);
    setBusy(false);
    setLookup(result);
    if (result.trailer) {
      // Prefill from the permanent record — never overwrite it.
      setDraft((d) => ({
        ...d,
        trailerType: result.trailer!.trailerType,
        year: String(result.trailer!.year),
        make: result.trailer!.make,
        model: result.trailer!.model,
        registeredOwnerName: result.trailer!.registration.registeredOwnerName ?? "",
      }));
    }
    setSubmitted(false);
    setStage("details");
  }

  function detailsValid(): boolean {
    return Boolean(
      draft.unitNumber.trim() && draft.year.trim() && draft.make.trim() && draft.model.trim()
      && draft.plateNumber.trim() && draft.plateState
      && (!draft.registrationExpiresAt || !validateExpiryDate(draft.registrationExpiresAt)),
    );
  }

  function goFromDetails() {
    setSubmitted(true);
    if (!detailsValid()) return;
    setSubmitted(false);
    setStage(isNewTrailer ? "ownership" : "review");
  }

  function ownershipValid(): boolean {
    return Boolean(draft.ownerName.trim() && evidence);
  }

  function goFromOwnership() {
    setSubmitted(true);
    if (!ownershipValid()) return;
    setSubmitted(false);
    setStage("review");
  }

  async function submit() {
    if (!ctx || busy) return;
    setBusy(true);
    const result = await registerOrConnectTrailer(ctx, {
      vin: draft.vin,
      trailerType: draft.trailerType,
      unitNumber: draft.unitNumber,
      year: Number(draft.year),
      make: draft.make,
      model: draft.model,
      color: draft.color || undefined,
      registration: {
        plateNumber: draft.plateNumber.trim(),
        plateState: draft.plateState,
        expiresAt: draft.registrationExpiresAt || undefined,
        registeredOwnerName: draft.registeredOwnerName.trim() || undefined,
      },
      specs: numericSpecs(draft.specs),
      configuration: buildConfiguration(draft.trailerType, draft.config),
      status: "available",
      availability: { city: draft.city.trim() || undefined, state: draft.state || undefined },
      notes: draft.notes,
      relationshipType: draft.relationshipType,
      ownerType: draft.ownerType,
      ownerName: draft.ownerName.trim() || draft.registeredOwnerName.trim(),
      ownerRef: draft.ownerType === "organization" ? ctx.organizationId : undefined,
      evidence: evidence
        ? [{
            kind: "title" as const, label: "Title or ownership evidence",
            fileName: evidence.name, fileType: evidence.type, sizeBytes: evidence.size,
            capturedAt: new Date().toISOString(),
          }]
        : [],
    });
    setBusy(false);
    setOutcome(result);
    setStage("outcome");
  }

  const specFields = trailerSpecFieldsFor(draft.trailerType);
  const configFields = configFieldsFor(draft.trailerType);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Add a trailer"
        description="A trailer exists once in Antcolos. If it is already here, you connect to it rather than creating a second one."
      />

      {/* ------------------------------------------------------------ METHOD */}
      {stage === "method" ? (
        <section aria-labelledby={`${uid}-method`}>
          <h2 id={`${uid}-method`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            How would you like to add it?
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MethodCard
              icon={Keyboard} title="Enter manually"
              description="Type the VIN and the details. Takes a couple of minutes."
              working
              onClick={() => { setMethod("manual"); setStage("vin"); }}
            />
            <MethodCard
              icon={ScanLine} title="Scan documents"
              description="Choose a title or registration and check what it reads back."
              working
              onClick={() => { setMethod("scan"); setStage("scan"); }}
            />
            <MethodCard
              icon={FileUp} title="Import a file"
              description="Bring a spreadsheet of trailers across in one go."
              onClick={() => { setMethod("import"); setStage("prototype"); }}
            />
            <MethodCard
              icon={Plug} title="Connect an existing system"
              description="Pull your trailers from an ELD or TMS you already use."
              onClick={() => { setMethod("connect"); setStage("prototype"); }}
            />
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------------- PROTOTYPE */}
      {stage === "prototype" ? (
        <section aria-labelledby={`${uid}-prototype`} className="max-w-xl">
          <h2 id={`${uid}-prototype`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            {method === "import" ? "Import a file" : "Connect an existing system"}
          </h2>
          <div className="mt-3 rounded-lg border border-dashed border-border bg-surface-sunken p-5">
            <p className="flex items-center gap-2 text-[0.875rem] font-medium text-fg">
              <Link2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              Not built yet
            </p>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
              {method === "import"
                ? "There is no file parser behind this button. Nothing would be read from a spreadsheet and no trailer would be created, so the button does not pretend otherwise."
                : "There is no ELD or TMS integration behind this button. Nothing would be connected and no trailer would be discovered, so the button does not pretend otherwise."}
            </p>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
              Enter the trailer manually for now — it is the same record either way.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => { setMethod("manual"); setStage("vin"); }}>
                Enter it manually
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStage("method")}>Back</Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- SCAN */}
      {stage === "scan" ? (
        <section aria-labelledby={`${uid}-scan`} className="max-w-xl">
          <h2 id={`${uid}-scan`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            Scan a title or registration
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            Choose the document and Antcolos will show you what it thinks it says. You check every
            value before anything is created.
          </p>

          <div
            className="mt-4 rounded-lg border border-dashed border-border bg-surface-sunken p-5 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setScanFile({ name: f.name, type: f.type, size: f.size });
            }}
          >
            <Upload className="mx-auto size-6 text-fg-subtle" aria-hidden />
            <p className="mt-2 text-[0.8125rem] text-fg-muted">
              Drag a file here, or choose one.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setScanFile({ name: f.name, type: f.type, size: f.size });
              }}
            />
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
              Choose a file
            </Button>
            {scanFile ? (
              <p className="mt-3 break-all text-[0.75rem] text-fg-subtle">
                {scanFile.name} · {Math.round((scanFile.size ?? 0) / 1024)} KB
              </p>
            ) : null}
          </div>

          <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
            Nothing is uploaded, stored, opened or read. Your browser tells Antcolos the file name,
            type and size; the values on the next screen are made up for the preview and are not
            taken from your document.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!scanFile || scanning}
              onClick={() => {
                setScanning(true);
                // A stand-in for extraction. The values are invented, which is
                // exactly why the next screen makes you check every one.
                setTimeout(() => {
                  setScanning(false);
                  setDraft((d) => ({
                    ...d,
                    vin: "1JJV532W4SL118002",
                    trailerType: "dry_van",
                    year: "2024", make: "Wabash", model: "DuraPlate 53'",
                    plateNumber: "IL-TR1180", plateState: "IL",
                    registeredOwnerName: "Northline Freight LLC",
                  }));
                  setStage("vin");
                }, 1200);
              }}
            >
              {scanning ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {scanning ? "Reading…" : "Read the document"}
            </Button>
            <Button variant="ghost" onClick={() => setStage("method")}>Back</Button>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------------------- VIN */}
      {stage === "vin" ? (
        <section aria-labelledby={`${uid}-vin`} className="max-w-xl">
          <h2 id={`${uid}-vin`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            The trailer&apos;s VIN
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            The VIN is how Antcolos tells one trailer from another. If this one is already here, you
            will be connected to the existing record rather than making a second one.
          </p>
          {method === "scan" && scanFile ? (
            <p className="mt-3 rounded-md border border-st-warning/40 bg-st-warning-bg/60 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
              These values were invented for the preview, not read from {scanFile.name}. Check every
              one against the document in front of you.
            </p>
          ) : null}

          <div className="mt-4 space-y-4">
            <Field
              label="VIN"
              htmlFor={`${uid}-vin-input`}
              hint="17 characters. The letters I, O and Q never appear in a VIN."
              error={submitted ? vinError ?? undefined : undefined}
            >
              <Input
                id={`${uid}-vin-input`}
                value={draft.vin}
                onChange={(e) => set("vin", e.target.value.toUpperCase())}
                autoComplete="off"
                spellCheck={false}
                className="font-mono tracking-wide"
              />
            </Field>
            {checkDigit === false ? (
              <p className="text-[0.75rem] leading-relaxed text-st-warning">
                The check digit does not match. That usually means a typo, but some trailers do carry
                a VIN that fails this test, so it is a warning rather than a block.
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void runLookup()}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button variant="ghost" onClick={() => setStage(method === "scan" ? "scan" : "method")}>Back</Button>
          </div>
        </section>
      ) : null}

      {/* ----------------------------------------------------------- DETAILS */}
      {stage === "details" ? (
        <section aria-labelledby={`${uid}-details`} className="max-w-3xl">
          <h2 id={`${uid}-details`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            {lookup?.trailer ? "This trailer is already in Antcolos" : "Trailer details"}
          </h2>

          {lookup?.trailer ? (
            <ExistingTrailerNotice lookup={lookup} />
          ) : (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
              Nothing matched that VIN, so this will be a new permanent trailer record.
            </p>
          )}

          <div className="mt-5 space-y-6">
            <Section title="Identity">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Your unit number" htmlFor={`${uid}-unit`}
                  hint="Your own label for it. It belongs to your organization, not to the trailer."
                  error={submitted && !draft.unitNumber.trim() ? "Give the trailer a unit number." : undefined}
                >
                  <Input id={`${uid}-unit`} value={draft.unitNumber} onChange={(e) => set("unitNumber", e.target.value)} />
                </Field>

                <Field label="Trailer type" htmlFor={`${uid}-type`}>
                  <select
                    id={`${uid}-type`}
                    value={draft.trailerType}
                    disabled={Boolean(lookup?.trailer)}
                    onChange={(e) => set("trailerType", e.target.value as TrailerType)}
                    className={SELECT}
                  >
                    {TRAILER_TYPES.map((t) => (
                      <option key={t} value={t}>{TRAILER_TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                {TRAILER_TYPE_DESCRIPTION[draft.trailerType]}
                {lookup?.trailer ? " The type belongs to the permanent record and cannot be changed from here." : ""}
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                <Field
                  label="Year" htmlFor={`${uid}-year`}
                  error={submitted && !draft.year.trim() ? "Required." : undefined}
                >
                  <Input id={`${uid}-year`} inputMode="numeric" value={draft.year} onChange={(e) => set("year", e.target.value)} disabled={Boolean(lookup?.trailer)} />
                </Field>
                <Field label="Make" htmlFor={`${uid}-make`} error={submitted && !draft.make.trim() ? "Required." : undefined}>
                  <Input id={`${uid}-make`} value={draft.make} onChange={(e) => set("make", e.target.value)} disabled={Boolean(lookup?.trailer)} />
                </Field>
                <Field label="Model" htmlFor={`${uid}-model`} error={submitted && !draft.model.trim() ? "Required." : undefined}>
                  <Input id={`${uid}-model`} value={draft.model} onChange={(e) => set("model", e.target.value)} disabled={Boolean(lookup?.trailer)} />
                </Field>
                <Field label="Colour" htmlFor={`${uid}-color`}>
                  <Input id={`${uid}-color`} value={draft.color} onChange={(e) => set("color", e.target.value)} disabled={Boolean(lookup?.trailer)} />
                </Field>
              </div>
            </Section>

            <Section title="Registration">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Licence plate" htmlFor={`${uid}-plate`} error={submitted && !draft.plateNumber.trim() ? "Required." : undefined}>
                  <Input id={`${uid}-plate`} value={draft.plateNumber} onChange={(e) => set("plateNumber", e.target.value)} />
                </Field>
                <Field label="Plate state" htmlFor={`${uid}-plate-state`} error={submitted && !draft.plateState ? "Required." : undefined}>
                  <select id={`${uid}-plate-state`} value={draft.plateState} onChange={(e) => set("plateState", e.target.value)} className={SELECT}>
                    <option value="">Choose a state</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field
                  label="Registration expiration date" htmlFor={`${uid}-reg-exp`}
                  error={submitted && draft.registrationExpiresAt ? validateExpiryDate(draft.registrationExpiresAt) ?? undefined : undefined}
                >
                  <Input id={`${uid}-reg-exp`} type="date" min={todayIsoDate()} value={draft.registrationExpiresAt} onChange={(e) => set("registrationExpiresAt", e.target.value)} />
                </Field>
                <Field label="Registered owner name" htmlFor={`${uid}-reg-owner`} hint="As printed on the registration. Not proof of title.">
                  <Input id={`${uid}-reg-owner`} value={draft.registeredOwnerName} onChange={(e) => set("registeredOwnerName", e.target.value)} />
                </Field>
              </div>
            </Section>

            {!lookup?.trailer ? (
              <>
                <Section title="Measurements">
                  <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
                    All optional. Leave anything you have not measured blank — a guess here becomes a
                    number a dispatcher books freight against. Lengths in inches, weights in pounds.
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    {specFields.map((field) => (
                      <Field key={field} label={TRAILER_SPEC_LABEL[field]} htmlFor={`${uid}-spec-${field}`}>
                        {field === "suspension" ? (
                          <select
                            id={`${uid}-spec-${field}`}
                            value={draft.specs[field] ?? ""}
                            onChange={(e) => set("specs", { ...draft.specs, [field]: e.target.value })}
                            className={SELECT}
                          >
                            <option value="">Not recorded</option>
                            <option value="air_ride">Air ride</option>
                            <option value="spring">Spring</option>
                            <option value="torsion">Torsion</option>
                            <option value="walking_beam">Walking beam</option>
                          </select>
                        ) : (
                          <Input
                            id={`${uid}-spec-${field}`}
                            inputMode={TRAILER_SPEC_UNIT[field] ? "numeric" : "text"}
                            value={draft.specs[field] ?? ""}
                            onChange={(e) => set("specs", { ...draft.specs, [field]: e.target.value })}
                            placeholder={TRAILER_SPEC_UNIT[field] ?? ""}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                </Section>

                <Section title={`${TRAILER_TYPE_LABEL[draft.trailerType]} equipment`}>
                  <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
                    Only the questions that make sense for a {TRAILER_TYPE_LABEL[draft.trailerType].toLowerCase()}.
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    {configFields.map((field) => (
                      <ConfigInput
                        key={field}
                        field={field}
                        id={`${uid}-config-${field}`}
                        value={draft.config[field] ?? ""}
                        onChange={(v) => set("config", { ...draft.config, [field]: v })}
                      />
                    ))}
                  </div>
                </Section>
              </>
            ) : null}

            <Section title="Where it is">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="City" htmlFor={`${uid}-city`}>
                  <Input id={`${uid}-city`} value={draft.city} onChange={(e) => set("city", e.target.value)} />
                </Field>
                <Field label="State" htmlFor={`${uid}-state`}>
                  <select id={`${uid}-state`} value={draft.state} onChange={(e) => set("state", e.target.value)} className={SELECT}>
                    <option value="">Choose a state</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="How you run it" htmlFor={`${uid}-rel`}>
                  <select
                    id={`${uid}-rel`}
                    value={draft.relationshipType}
                    onChange={(e) => set("relationshipType", e.target.value as CarrierRelationshipType)}
                    className={SELECT}
                  >
                    <option value="carrier_owned">Carrier-owned</option>
                    <option value="leased_owner_operator">Leased Owner-Operator</option>
                  </select>
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Notes" htmlFor={`${uid}-notes`} hint="Optional.">
                  <Textarea id={`${uid}-notes`} rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
                </Field>
              </div>
            </Section>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={goFromDetails}>Continue</Button>
            <Button variant="ghost" onClick={() => setStage("vin")}>Back</Button>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------------- OWNERSHIP */}
      {stage === "ownership" ? (
        <section aria-labelledby={`${uid}-own`} className="max-w-xl">
          <h2 id={`${uid}-own`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            Who owns it
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            Owning a trailer and running it are different things, and Antcolos keeps them apart.
            This records the legal owner; your carrier relationship is recorded separately.
          </p>

          <div className="mt-4 space-y-4">
            <Field label="Owner type" htmlFor={`${uid}-owner-type`}>
              <select
                id={`${uid}-owner-type`}
                value={draft.ownerType}
                onChange={(e) => set("ownerType", e.target.value as "person" | "organization")}
                className={SELECT}
              >
                <option value="organization">An organization</option>
                <option value="person">A person</option>
              </select>
            </Field>
            <Field
              label="Owner name" htmlFor={`${uid}-owner-name`}
              error={submitted && !draft.ownerName.trim() ? "Say who owns the trailer." : undefined}
            >
              <Input id={`${uid}-owner-name`} value={draft.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
            </Field>

            <div>
              <p className="text-[0.8125rem] font-medium text-fg">Title or registration</p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                A new trailer needs one ownership document before it can be created.
              </p>
              <div
                className="mt-2 rounded-lg border border-dashed border-border bg-surface-sunken p-4 text-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) setEvidence({ name: f.name, type: f.type, size: f.size });
                }}
              >
                <input
                  ref={evidenceInput}
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setEvidence({ name: f.name, type: f.type, size: f.size });
                  }}
                />
                <Button variant="secondary" size="sm" onClick={() => evidenceInput.current?.click()}>
                  Choose a document
                </Button>
                {evidence ? (
                  <p className="mt-2 break-all text-[0.75rem] text-fg-subtle">
                    {evidence.name} · {Math.round((evidence.size ?? 0) / 1024)} KB
                  </p>
                ) : null}
              </div>
              {submitted && !evidence ? (
                <p className="mt-1.5 text-[0.75rem] text-st-danger">Choose a title or registration.</p>
              ) : null}
              <p className="mt-2 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                Antcolos reads the file name, type and size from your browser and nothing else. The
                file is not uploaded, stored, opened or checked against anything.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={goFromOwnership}>Continue</Button>
            <Button variant="ghost" onClick={() => setStage("details")}>Back</Button>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------ REVIEW */}
      {stage === "review" ? (
        <section aria-labelledby={`${uid}-review`} className="max-w-2xl">
          <h2 id={`${uid}-review`} ref={headingRef} tabIndex={-1} className="text-[1rem] font-semibold text-fg outline-none">
            Check this before it is saved
          </h2>
          <div className="mt-4 rounded-lg border border-border bg-surface p-4 shadow-e1">
            <dl className="divide-y divide-border">
              <Row label="VIN" value={draft.vin} mono />
              <Row label="Unit number" value={draft.unitNumber} />
              <Row label="Trailer type" value={TRAILER_TYPE_LABEL[draft.trailerType]} />
              <Row label="Trailer" value={`${draft.year} ${draft.make} ${draft.model}`} />
              <Row label="Licence plate" value={`${draft.plateNumber} (${draft.plateState})`} />
              <Row
                label="Registration expiration date"
                value={draft.registrationExpiresAt || "Not recorded"}
              />
              <Row label="How you run it" value={TRAILER_RELATIONSHIP_TYPE_LABEL[draft.relationshipType]} />
              {isNewTrailer ? <Row label="Legal owner" value={draft.ownerName} /> : null}
              {isNewTrailer && evidence ? <Row label="Ownership document" value={evidence.name} /> : null}
            </dl>
          </div>
          <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
            {isNewTrailer
              ? "This creates one permanent trailer record with its own id. Nothing is sent anywhere and no document is uploaded."
              : "This connects your organization to a trailer that already exists. The existing record is not changed in any way."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {busy ? "Saving…" : isNewTrailer ? "Create the trailer" : "Connect to this trailer"}
            </Button>
            <Button variant="ghost" onClick={() => setStage(isNewTrailer ? "ownership" : "details")}>Back</Button>
          </div>
        </section>
      ) : null}

      {/* ----------------------------------------------------------- OUTCOME */}
      {stage === "outcome" && outcome ? (
        <Outcome
          outcome={outcome}
          headingRef={headingRef}
          claimOpened={claimOpened}
          busy={busy}
          onOpenClaim={async () => {
            if (!ctx || outcome.status !== "ownership_claim_required" || busy) return;
            setBusy(true);
            await openTrailerOwnershipClaim(outcome.trailer.trailerId, ctx, {
              claimedOwnerType: draft.ownerType,
              claimedOwnerName: draft.ownerName.trim() || draft.registeredOwnerName.trim(),
              note: draft.notes.trim() || undefined,
              evidence: evidence
                ? [{
                    kind: "title" as const, label: "Title or ownership evidence",
                    fileName: evidence.name, fileType: evidence.type, sizeBytes: evidence.size,
                    capturedAt: new Date().toISOString(),
                  }]
                : [],
            }).catch(() => undefined);
            setBusy(false);
            setClaimOpened(true);
          }}
          onOpenTrailer={(id) => router.push(`/fleet/trailers/${id}`)}
          onStartOver={() => {
            setDraft(EMPTY); setLookup(null); setOutcome(null);
            setEvidence(null); setScanFile(null); setClaimOpened(false);
            setStage("method");
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ExistingTrailerNotice({ lookup }: { lookup: TrailerVinLookupResult }) {
  const trailer = lookup.trailer!;
  if (lookup.alreadyConnected) {
    return (
      <FormAlert tone="info" title="You already run this trailer">
        {TRAILER_TYPE_LABEL[trailer.trailerType]} · {maskTrailerVin(trailer.vin)}. Continuing takes
        you to the existing record rather than creating anything.
      </FormAlert>
    );
  }
  if (lookup.pendingForMe) {
    return (
      <FormAlert tone="info" title="Your request is already waiting">
        You have asked to operate this trailer and the request is still waiting for approval.
        Nothing new will be created.
      </FormAlert>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-st-info/35 bg-st-info-bg/40 p-4">
      <p className="text-[0.875rem] font-medium text-fg">
        {trailer.year} {trailer.make} {trailer.model} · {TRAILER_TYPE_LABEL[trailer.trailerType]}
      </p>
      <p className="mt-0.5 font-mono text-[0.75rem] break-all text-fg-subtle">
        {maskTrailerVin(trailer.vin)}
      </p>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
        {lookup.operatorName
          ? `${lookup.operatorName} is already onboarded on this trailer. You can ask to operate it too — several carriers can be approved on one trailer — but nothing about their relationship changes.`
          : lookup.ownerName
            ? `${lookup.ownerName} is recorded as the owner and nobody is onboarded on it. That makes this an ownership question rather than an operating one.`
            : "Nobody is onboarded on this trailer yet."}
      </p>
    </div>
  );
}

function Outcome({
  outcome, headingRef, claimOpened, busy, onOpenClaim, onOpenTrailer, onStartOver,
}: {
  outcome: RegisterTrailerOutcome;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  claimOpened: boolean;
  busy: boolean;
  onOpenClaim: () => void;
  onOpenTrailer: (trailerId: string) => void;
  onStartOver: () => void;
}) {
  const title =
    outcome.status === "created" ? "Trailer created"
      : outcome.status === "existing_connected" ? "Connected to the existing trailer"
        : outcome.status === "relationship_pending" ? "Request sent — waiting for approval"
          : outcome.status === "ownership_claim_required" ? "This needs an ownership claim"
            : outcome.status === "missing_evidence" ? "An ownership document is needed"
              : outcome.status === "invalid_vin" ? "That VIN cannot be used"
                : "You do not have permission to do that";

  const good = outcome.status === "created" || outcome.status === "existing_connected";

  return (
    <section className="max-w-xl">
      <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-[1rem] font-semibold text-fg outline-none">
        {good ? <CircleCheck className="size-5 shrink-0 text-st-success" aria-hidden />
          : <TriangleAlert className="size-5 shrink-0 text-st-warning" aria-hidden />}
        {title}
      </h2>

      <div className="mt-3 space-y-3 text-[0.8125rem] leading-relaxed text-fg-muted">
        {outcome.status === "created" ? (
          <>
            <p>
              One permanent trailer record now exists, with its own id. Its ownership and your
              carrier relationship were recorded alongside it as separate things.
            </p>
            <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] text-fg-subtle">
              Nothing was uploaded, stored, read or verified by anybody. The ownership document is a
              file name your browser reported.
            </p>
          </>
        ) : null}

        {outcome.status === "existing_connected" ? (
          <p>
            Your organization is now onboarded on the trailer that was already here. It kept its id,
            its VIN, its documents and every other carrier&apos;s history exactly as they were.
          </p>
        ) : null}

        {outcome.status === "relationship_pending" ? (
          <>
            <p>
              Your request is recorded and is waiting for approval. This is <strong>not</strong> a
              completed connection: the trailer is not part of your fleet and is not counted in your
              roster until somebody approves it.
            </p>
            {outcome.currentOperator ? (
              <p>{outcome.currentOperator} stays onboarded on it in the meantime.</p>
            ) : null}
          </>
        ) : null}

        {outcome.status === "ownership_claim_required" ? (
          claimOpened ? (
            <p>
              Your claim is recorded and is <strong>pending review</strong> by{" "}
              {outcome.currentOwnerName}. Nothing about the trailer has changed and nothing will
              until they decide.
            </p>
          ) : (
            <>
              <p>
                {outcome.currentOwnerName} is the recorded owner of this trailer and nobody is
                onboarded on it. Antcolos will not hand it over on your say-so, so this has to go
                through an ownership claim.
              </p>
              <Button variant="primary" size="sm" disabled={busy} onClick={onOpenClaim}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Open an ownership claim
              </Button>
            </>
          )
        ) : null}

        {outcome.status === "missing_evidence" ? <p>{outcome.message}</p> : null}
        {outcome.status === "invalid_vin" ? <p>{outcome.message}</p> : null}
        {outcome.status === "unauthorized" ? (
          <p>
            Adding a trailer needs both &ldquo;Add trailers&rdquo; and &ldquo;Manage trailer carrier
            relationships&rdquo;. Ask an owner to grant them.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {"trailer" in outcome && outcome.trailer ? (
          <Button variant="primary" onClick={() => onOpenTrailer(outcome.trailer.trailerId)}>
            Open the trailer
          </Button>
        ) : null}
        <Button variant="secondary" asChild>
          <Link href="/fleet/trailers">All trailers</Link>
        </Button>
        <Button variant="ghost" onClick={onStartOver}>Add another</Button>
      </div>
    </section>
  );
}

function ConfigInput({
  field, id, value, onChange,
}: {
  field: ConfigField;
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = CONFIG_LABEL[field];
  const choices = CONFIG_CHOICES[field];

  if (isBooleanConfig(field)) {
    return (
      <div className="flex items-start gap-2 pt-6">
        <input
          id={id}
          type="checkbox"
          checked={value === "yes"}
          onChange={(e) => onChange(e.target.checked ? "yes" : "")}
          className="mt-0.5 size-4 rounded border-border text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <label htmlFor={id} className="text-[0.8125rem] text-fg">{label}</label>
      </div>
    );
  }
  if (choices) {
    return (
      <Field label={label} htmlFor={id}>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
          <option value="">Not recorded</option>
          {choices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type={isDateConfig(field) ? "date" : "text"}
        inputMode={isTextConfig(field) || isDateConfig(field) ? "text" : "numeric"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={CONFIG_UNIT[field] ?? ""}
      />
    </Field>
  );
}

function MethodCard({
  icon: Icon, title, description, working, onClick,
}: {
  icon: typeof Keyboard;
  title: string;
  description: string;
  working?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-e1 transition-colors",
        "hover:border-border-strong hover:bg-surface-hover",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
          {title}
          {!working ? (
            <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
              Not built yet
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">{description}</span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[0.875rem] font-semibold text-fg">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className={cn("min-w-0 break-all text-right text-[0.8125rem] text-fg", mono && "font-mono")}>
        {value || "—"}
      </dd>
    </div>
  );
}

/** Empty strings never become zeroes: an unmeasured trailer stays unmeasured. */
function numericSpecs(raw: Record<string, string>): TrailerSpecs {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value.trim()) continue;
    if (key === "suspension" || key === "tireSize") out[key] = value;
    else {
      const n = Number(value);
      if (!Number.isNaN(n)) out[key] = n;
    }
  }
  return out as TrailerSpecs;
}

function buildConfiguration(type: TrailerType, raw: Record<string, string>): TrailerConfiguration {
  const out: Record<string, unknown> = {};
  for (const field of configFieldsFor(type)) {
    const value = raw[field];
    if (!value) continue;
    if (isBooleanConfig(field)) out[field] = value === "yes";
    else if (CONFIG_CHOICES[field] || isTextConfig(field) || isDateConfig(field)) out[field] = value;
    else {
      const n = Number(value);
      if (!Number.isNaN(n)) out[field] = n;
    }
  }
  return out as TrailerConfiguration;
}

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

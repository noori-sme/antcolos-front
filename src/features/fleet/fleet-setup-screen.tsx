"use client";

import {
  CircleCheck, FileUp, Hammer, Keyboard, Link2, LoaderCircle, Plug, ScanLine, TriangleAlert, Upload,
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
  EQUIPMENT_DESCRIPTION, EQUIPMENT_LABEL, EQUIPMENT_TYPES,
  SPEC_LABEL, SPEC_UNIT, isBooleanSpec, specFieldsFor,
} from "@/lib/fleet/equipment";
import { checkDigitMatches, maskVin, validateVin } from "@/lib/fleet/vin";
import {
  lookUpVin, openOwnershipClaim, registerOrConnectTruck,
  type RegisterTruckOutcome, type VinLookupResult,
} from "@/lib/api/mock/truck-registry";
import type { CarrierRelationshipType, TruckEquipmentType, TruckSpecs } from "@/types";
import { RELATIONSHIP_TYPE_DESCRIPTION, RELATIONSHIP_TYPE_LABEL } from "./fleet-labels";
import { useTruckContext } from "./use-truck-context";
import { cn } from "@/lib/utils";

type Stage = "method" | "prototype" | "scan" | "vin" | "details" | "review" | "outcome";
type Method = "manual" | "scan" | "import" | "connect";

interface Draft {
  vin: string;
  unitNumber: string;
  equipmentType: TruckEquipmentType;
  year: string;
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  plateState: string;
  registrationExpiresAt: string;
  registeredOwnerName: string;
  specs: Record<string, string>;
  status: "available" | "loaded" | "expected_available" | "unavailable" | "maintenance";
  city: string;
  state: string;
  homeTerminal: string;
  notes: string;
  relationshipType: CarrierRelationshipType;
  ownerType: "person" | "organization";
  ownerName: string;
}

const EMPTY: Draft = {
  vin: "", unitNumber: "", equipmentType: "cargo_van", year: "", make: "", model: "", color: "",
  plateNumber: "", plateState: "", registrationExpiresAt: "", registeredOwnerName: "",
  specs: {}, status: "available", city: "", state: "", homeTerminal: "", notes: "",
  relationshipType: "carrier_owned", ownerType: "organization", ownerName: "",
};

/**
 * Fleet Setup.
 *
 * Four ways in, but only two of them do anything, and the screen says which.
 * Manual entry and document scanning both end at the same canonical
 * registration call; importing a file and connecting an outside system are
 * honestly labelled as not built, because claiming to have imported trucks that
 * do not exist would be worse than an empty fleet.
 */
export function FleetSetupScreen() {
  const router = useRouter();
  const ctx = useTruckContext();
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("method");
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);
  const [method, setMethod] = useState<Method>("manual");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const [lookup, setLookup] = useState<VinLookupResult | null>(null);
  const [outcome, setOutcome] = useState<RegisterTruckOutcome | null>(null);
  const [scanFile, setScanFile] = useState<{ name: string; type: string; size: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [claimOpened, setClaimOpened] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const vinError = submitted || draft.vin ? validateVin(draft.vin) : null;
  const checkDigit = draft.vin && !vinError ? checkDigitMatches(draft.vin) : null;

  async function runLookup() {
    if (!ctx || busy) return;
    setSubmitted(true);
    if (validateVin(draft.vin)) return;
    setBusy(true);
    const result = await lookUpVin(draft.vin, ctx);
    setBusy(false);
    setLookup(result);
    if (result.truck) {
      // Prefill from the permanent record — never overwrite it.
      setDraft((d) => ({
        ...d,
        equipmentType: result.truck!.equipmentType,
        year: String(result.truck!.year),
        make: result.truck!.make,
        model: result.truck!.model,
        registeredOwnerName: result.truck!.registration.registeredOwnerName,
      }));
    }
    setSubmitted(false);
    setStage("details");
  }

  async function simulateScan(file: File) {
    setScanFile({ name: file.name, type: file.type, size: file.size });
    setScanning(true);
    await new Promise((r) => setTimeout(r, 1400));
    // Invented values. Nothing was read from the file — see the banner.
    setDraft((d) => ({
      ...d,
      vin: "1FTBW2CM8NKA51234",
      unitNumber: "",
      equipmentType: "cargo_van",
      year: "2022",
      make: "Ford",
      model: "Transit 250",
      plateNumber: "IL-4471X",
      plateState: "IL",
      registrationExpiresAt: "",
      registeredOwnerName: "Northline Freight LLC",
    }));
    setScanning(false);
    setStage("details");
  }

  const detailErrors = {
    unitNumber: submitted && !draft.unitNumber.trim() ? "Give this truck a unit number." : null,
    year: submitted && !/^\d{4}$/.test(draft.year) ? "Enter the model year, like 2022." : null,
    make: submitted && !draft.make.trim() ? "Enter the make." : null,
    model: submitted && !draft.model.trim() ? "Enter the model." : null,
    plateNumber: submitted && !draft.plateNumber.trim() ? "Enter the plate number." : null,
    plateState: submitted && !draft.plateState ? "Choose the plate state." : null,
    registrationExpiresAt: submitted
      ? validateExpiryDate(draft.registrationExpiresAt, "registration expiration date")
      : null,
    ownerName: submitted && !draft.ownerName.trim() ? "Enter who legally owns this truck." : null,
  };

  function continueToReview() {
    setSubmitted(true);
    if (validateVin(draft.vin)) return;
    if (Object.values(detailErrors).some(Boolean)) return;
    setStage("review");
  }

  function buildSpecs(): TruckSpecs {
    const specs: Record<string, unknown> = {};
    for (const field of specFieldsFor(draft.equipmentType)) {
      const raw = draft.specs[field];
      if (raw === undefined || raw === "") continue;
      specs[field] = isBooleanSpec(field) ? raw === "yes" : Number(raw);
    }
    return specs as TruckSpecs;
  }

  async function submit() {
    if (!ctx || busy) return;
    setBusy(true);
    const result = await registerOrConnectTruck(ctx, {
      vin: draft.vin,
      equipmentType: draft.equipmentType,
      unitNumber: draft.unitNumber,
      year: Number(draft.year),
      make: draft.make,
      model: draft.model,
      color: draft.color || undefined,
      registration: {
        plateNumber: draft.plateNumber.trim(),
        plateState: draft.plateState,
        expiresAt: new Date(`${draft.registrationExpiresAt}T00:00:00`).toISOString(),
        registeredOwnerName: draft.registeredOwnerName.trim() || draft.ownerName.trim(),
      },
      specs: buildSpecs(),
      status: draft.status,
      availability: {
        city: draft.city.trim() || undefined,
        state: draft.state || undefined,
        homeTerminal: draft.homeTerminal.trim() || undefined,
      },
      notes: draft.notes,
      relationshipType: draft.relationshipType,
      ownerType: draft.ownerType,
      ownerName: draft.ownerName,
      ownerRef: draft.ownerType === "organization" ? ctx.organizationId : undefined,
      evidence: scanFile
        ? [{ kind: "registration", label: "Registration", fileName: scanFile.name, fileType: scanFile.type, sizeBytes: scanFile.size, capturedAt: new Date().toISOString() }]
        : [],
    });
    setBusy(false);
    setOutcome(result);
    setStage("outcome");
  }

  async function claimOwnership() {
    if (!ctx || !outcome || outcome.status !== "ownership_claim_required" || busy) return;
    setBusy(true);
    await openOwnershipClaim(outcome.truck.truckId, ctx, {
      ownerType: draft.ownerType,
      ownerName: draft.ownerName,
      note: draft.notes || undefined,
      evidence: scanFile
        ? [{ kind: "title", label: "Title or ownership evidence", fileName: scanFile.name, capturedAt: new Date().toISOString() }]
        : [],
    });
    setBusy(false);
    setClaimOpened(true);
  }

  const heading: Record<Stage, { title: string; description: string }> = {
    method: { title: "Add a truck", description: "Four ways to get a truck into Antcolos. You can stop and come back at any point." },
    prototype: { title: "Not built yet", description: "This way in is still a prototype." },
    scan: { title: "Scan a document", description: "Pick a registration or title and we'll pull what we can off it." },
    vin: { title: "Start with the VIN", description: "The VIN tells us whether this truck is already in Antcolos." },
    details: { title: "Truck details", description: "Only what this kind of truck can actually answer." },
    review: { title: "Check before you add it", description: "Nothing is created until you confirm." },
    outcome: { title: "Result", description: "" },
  };

  return (
    <div className="space-y-section">
      <PageHeader title={heading[stage].title} description={heading[stage].description} />
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">{heading[stage].title}</h1>

      {stage === "method" ? (
        <div className="max-w-[42rem] space-y-2.5">
          <MethodCard
            icon={Keyboard} title="Enter manually" working
            description="Type the VIN and the details. The most reliable way, and it works right now."
            onSelect={() => { setMethod("manual"); setStage("vin"); }}
          />
          <MethodCard
            icon={ScanLine} title="Scan documents" working
            description="Pick a registration or title. We simulate reading it, then you check every field before anything is saved."
            onSelect={() => { setMethod("scan"); setStage("scan"); }}
          />
          <MethodCard
            icon={FileUp} title="Import a file"
            description="Bring a whole fleet in from a spreadsheet."
            onSelect={() => { setMethod("import"); setStage("prototype"); }}
          />
          <MethodCard
            icon={Plug} title="Connect an existing system"
            description="Pull trucks from an ELD or TMS you already use."
            onSelect={() => { setMethod("connect"); setStage("prototype"); }}
          />
        </div>
      ) : null}

      {stage === "prototype" ? (
        <div className="max-w-[42rem] space-y-4">
          <FormAlert
            tone="info"
            role="none"
            title={method === "import" ? "File import is not built yet." : "System connections are not built yet."}
          >
            {method === "import"
              ? "There is no import parser behind this yet, so nothing would actually be read from your file. Rather than create trucks that only look real, we have left it switched off."
              : "Antcolos is not connected to any ELD or TMS yet. Showing you a list of “discovered” trucks would be an invention, so this stays off until the integration exists."}
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Use <strong className="font-medium text-fg">Enter manually</strong> or{" "}
            <strong className="font-medium text-fg">Scan documents</strong> in the meantime — both
            create a real truck in your fleet.
          </p>
          <Button variant="secondary" onClick={() => setStage("method")}>Back to the other ways in</Button>
        </div>
      ) : null}

      {stage === "scan" ? (
        <div className="max-w-[42rem] space-y-4">
          <FormAlert tone="warning" role="none" title="The reading part is simulated.">
            Your file is never uploaded, stored or read. We show you a realistic set of values so
            the review step can be tested — check every field against the document before you
            confirm.
          </FormAlert>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void simulateScan(file);
            }}
            className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center"
          >
            <Upload className="mx-auto size-6 text-fg-subtle" aria-hidden />
            <p className="mt-2 text-[0.875rem] font-medium text-fg">
              Drop a registration or title here
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">or choose a file from your device</p>
            <input
              ref={fileInput}
              id={`${uid}-scan`}
              type="file"
              accept="image/*,application/pdf"
              tabIndex={-1}
              aria-label="Choose a registration or title document"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void simulateScan(file);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" className="mt-4" disabled={scanning} onClick={() => fileInput.current?.click()}>
              {scanning ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {scanning ? "Reading…" : "Select file"}
            </Button>
            {scanFile ? (
              <p className="mt-3 text-[0.75rem] text-fg-subtle">{scanFile.name}</p>
            ) : null}
          </div>
          <Button variant="ghost" onClick={() => setStage("method")}>Back</Button>
        </div>
      ) : null}

      {stage === "vin" ? (
        <div className="max-w-[34rem] space-y-4">
          <Field
            label="VIN"
            htmlFor={`${uid}-vin`}
            hint={vinError ? undefined : "17 characters, from the door jamb or the registration."}
            error={vinError ?? undefined}
          >
            <Input
              id={`${uid}-vin`}
              value={draft.vin}
              onChange={(e) => set("vin", e.target.value.toUpperCase())}
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={20}
              placeholder="1FTBW2CM8NKA51234"
              aria-invalid={vinError ? true : undefined}
              className={cn("font-mono", vinError && "border-st-danger")}
            />
          </Field>
          {checkDigit === false ? (
            <FormAlert tone="warning" role="none" title="That VIN's check digit doesn't add up.">
              Usually a typo. Imported vehicles sometimes fail it legitimately, so you can carry on
              — but it is worth a second look.
            </FormAlert>
          ) : null}
          <Button variant="primary" size="lg" className="w-full" onClick={runLookup} disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </Button>
          <Button variant="ghost" onClick={() => setStage("method")}>Back</Button>
        </div>
      ) : null}

      {stage === "details" ? (
        <div className="max-w-[46rem] space-y-5">
          {method === "scan" ? (
            <FormAlert tone="warning" role="none" title="These values were invented, not read.">
              Check every one against the document in front of you.
            </FormAlert>
          ) : null}

          {lookup?.truck ? (
            <FormAlert
              tone={lookup.alreadyConnected ? "success" : "info"}
              role="none"
              title={
                lookup.alreadyConnected
                  ? "This truck is already in your fleet."
                  : "This truck already exists in Antcolos."
              }
            >
              {lookup.alreadyConnected
                ? "Nothing will be created. You can open it from your roster."
                : `${maskVin(lookup.truck.vin)} — a ${lookup.truck.year} ${lookup.truck.make} ${lookup.truck.model}${lookup.operatorName ? `, currently operated by ${lookup.operatorName}` : ""}. We will connect you to that record rather than make a second one.`}
            </FormAlert>
          ) : null}

          <Section title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="VIN" htmlFor={`${uid}-d-vin`} error={validateVin(draft.vin) ?? undefined}>
                <Input id={`${uid}-d-vin`} value={draft.vin} readOnly className="font-mono" />
              </Field>
              <Field label="Unit number" htmlFor={`${uid}-unit`} hint={detailErrors.unitNumber ? undefined : "Your label for this truck." } error={detailErrors.unitNumber ?? undefined}>
                <Input id={`${uid}-unit`} value={draft.unitNumber} onChange={(e) => set("unitNumber", e.target.value)} maxLength={12} placeholder="104" className={cn(detailErrors.unitNumber && "border-st-danger")} />
              </Field>
            </div>
            <Field label="Vehicle type" htmlFor={`${uid}-equip`} hint="Decides which specifications we ask for.">
              <select
                id={`${uid}-equip`}
                value={draft.equipmentType}
                onChange={(e) => set("equipmentType", e.target.value as TruckEquipmentType)}
                className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              >
                {EQUIPMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>
                ))}
              </select>
            </Field>
            <p className="text-[0.75rem] text-fg-subtle">{EQUIPMENT_DESCRIPTION[draft.equipmentType]}</p>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Year" htmlFor={`${uid}-year`} error={detailErrors.year ?? undefined}>
                <Input id={`${uid}-year`} value={draft.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={4} placeholder="2022" className={cn("tabular-nums", detailErrors.year && "border-st-danger")} />
              </Field>
              <Field label="Make" htmlFor={`${uid}-make`} error={detailErrors.make ?? undefined}>
                <Input id={`${uid}-make`} value={draft.make} onChange={(e) => set("make", e.target.value)} placeholder="Ford" className={cn(detailErrors.make && "border-st-danger")} />
              </Field>
              <Field label="Model" htmlFor={`${uid}-model`} error={detailErrors.model ?? undefined}>
                <Input id={`${uid}-model`} value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="Transit 250" className={cn(detailErrors.model && "border-st-danger")} />
              </Field>
              <Field label="Color" htmlFor={`${uid}-color`}>
                <Input id={`${uid}-color`} value={draft.color} onChange={(e) => set("color", e.target.value)} placeholder="White" />
              </Field>
            </div>
          </Section>

          <Section title="Registration">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="License plate number" htmlFor={`${uid}-plate`} error={detailErrors.plateNumber ?? undefined}>
                <Input id={`${uid}-plate`} value={draft.plateNumber} onChange={(e) => set("plateNumber", e.target.value.toUpperCase())} maxLength={12} className={cn(detailErrors.plateNumber && "border-st-danger")} />
              </Field>
              <Field label="Plate state" htmlFor={`${uid}-plate-state`} error={detailErrors.plateState ?? undefined}>
                <select
                  id={`${uid}-plate-state`}
                  value={draft.plateState}
                  onChange={(e) => set("plateState", e.target.value)}
                  className={cn("h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35", detailErrors.plateState && "border-st-danger")}
                >
                  <option value="">Choose…</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Registration expiration date" htmlFor={`${uid}-reg-exp`} error={detailErrors.registrationExpiresAt ?? undefined}>
                <Input id={`${uid}-reg-exp`} type="date" min={todayIsoDate()} value={draft.registrationExpiresAt} onChange={(e) => set("registrationExpiresAt", e.target.value)} className={cn(detailErrors.registrationExpiresAt && "border-st-danger")} />
              </Field>
              <Field label="Registered owner name" htmlFor={`${uid}-reg-owner`} hint="As printed on the registration.">
                <Input id={`${uid}-reg-owner`} value={draft.registeredOwnerName} onChange={(e) => set("registeredOwnerName", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title={`Specifications — ${EQUIPMENT_LABEL[draft.equipmentType]}`}>
            <div className="grid gap-4 sm:grid-cols-3">
              {specFieldsFor(draft.equipmentType).map((field) => (
                <Field key={field} label={SPEC_LABEL[field] + (SPEC_UNIT[field] ? ` (${SPEC_UNIT[field]})` : "")} htmlFor={`${uid}-${field}`}>
                  {isBooleanSpec(field) ? (
                    <select
                      id={`${uid}-${field}`}
                      value={draft.specs[field] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, specs: { ...d.specs, [field]: e.target.value } }))}
                      className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                    >
                      <option value="">Not stated</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  ) : field === "fuelType" ? (
                    <select
                      id={`${uid}-${field}`}
                      value={draft.specs[field] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, specs: { ...d.specs, [field]: e.target.value } }))}
                      className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                    >
                      <option value="">Not stated</option>
                      <option value="diesel">Diesel</option>
                      <option value="gasoline">Gasoline</option>
                      <option value="electric">Electric</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  ) : (
                    <Input
                      id={`${uid}-${field}`}
                      inputMode="numeric"
                      value={draft.specs[field] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, specs: { ...d.specs, [field]: e.target.value.replace(/[^\d.]/g, "") } }))}
                      className="tabular-nums"
                    />
                  )}
                </Field>
              ))}
            </div>
            <p className="text-[0.75rem] text-fg-subtle">
              Leave anything you are unsure of blank. A blank is honest; a guess becomes a fact the
              moment somebody books against it.
            </p>
          </Section>

          <Section title="Operational">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Current status" htmlFor={`${uid}-status`}>
                <select
                  id={`${uid}-status`}
                  value={draft.status}
                  onChange={(e) => set("status", e.target.value as Draft["status"])}
                  className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                >
                  <option value="available">Available</option>
                  <option value="loaded">Loaded</option>
                  <option value="expected_available">Expected available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </Field>
              <Field label="Current city" htmlFor={`${uid}-city`}>
                <Input id={`${uid}-city`} value={draft.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="Current state" htmlFor={`${uid}-state`}>
                <select
                  id={`${uid}-state`}
                  value={draft.state}
                  onChange={(e) => set("state", e.target.value)}
                  className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                >
                  <option value="">—</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Home terminal" htmlFor={`${uid}-terminal`} hint="Optional.">
              <Input id={`${uid}-terminal`} value={draft.homeTerminal} onChange={(e) => set("homeTerminal", e.target.value)} />
            </Field>
            <Field label="Notes" htmlFor={`${uid}-notes`} hint="Optional. Anything a dispatcher should know.">
              <Textarea id={`${uid}-notes`} rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </Section>

          <Section title="Ownership and operating relationship">
            <Field label="How will you operate it?" htmlFor={`${uid}-rel`}>
              <select
                id={`${uid}-rel`}
                value={draft.relationshipType}
                onChange={(e) => set("relationshipType", e.target.value as CarrierRelationshipType)}
                className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              >
                <option value="carrier_owned">{RELATIONSHIP_TYPE_LABEL.carrier_owned}</option>
                <option value="leased_owner_operator">{RELATIONSHIP_TYPE_LABEL.leased_owner_operator}</option>
              </select>
            </Field>
            <p className="text-[0.75rem] text-fg-subtle">{RELATIONSHIP_TYPE_DESCRIPTION[draft.relationshipType]}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal owner type" htmlFor={`${uid}-owner-type`}>
                <select
                  id={`${uid}-owner-type`}
                  value={draft.ownerType}
                  onChange={(e) => set("ownerType", e.target.value as "person" | "organization")}
                  className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                >
                  <option value="organization">An organization</option>
                  <option value="person">A person</option>
                </select>
              </Field>
              <Field label="Legal owner name" htmlFor={`${uid}-owner`} error={detailErrors.ownerName ?? undefined}>
                <Input id={`${uid}-owner`} value={draft.ownerName} onChange={(e) => set("ownerName", e.target.value)} className={cn(detailErrors.ownerName && "border-st-danger")} />
              </Field>
            </div>
            <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
              Owning a truck and operating it are different things. A leased owner-operator keeps
              the title; you still run the truck.
            </p>
          </Section>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={continueToReview}>Review</Button>
            <Button variant="ghost" size="lg" onClick={() => setStage(method === "scan" ? "scan" : "vin")}>Back</Button>
          </div>
        </div>
      ) : null}

      {stage === "review" ? (
        <div className="max-w-[42rem] space-y-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <dl className="divide-y divide-border">
              <Row label="VIN" value={draft.vin} mono />
              <Row label="Unit number" value={draft.unitNumber} />
              <Row label="Vehicle type" value={EQUIPMENT_LABEL[draft.equipmentType]} />
              <Row label="Vehicle" value={`${draft.year} ${draft.make} ${draft.model}${draft.color ? ` · ${draft.color}` : ""}`} />
              <Row label="Plate" value={`${draft.plateNumber} (${draft.plateState})`} />
              <Row label="Registration expires" value={draft.registrationExpiresAt} />
              <Row label="Operating relationship" value={RELATIONSHIP_TYPE_LABEL[draft.relationshipType]} />
              <Row label="Legal owner" value={`${draft.ownerName} (${draft.ownerType === "person" ? "person" : "organization"})`} />
              <Row label="Status" value={draft.status.replace(/_/g, " ")} />
            </dl>
          </div>
          <FormAlert tone="info" role="none" title="What happens when you confirm">
            {lookup?.truck
              ? "This VIN already has a permanent record. We will connect you to it — or ask its owner — rather than create a second truck."
              : "A new permanent truck is created with its own immutable id, and your organization is recorded as operating it."}
          </FormAlert>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={submit} disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Working…" : "Confirm"}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStage("details")}>Back</Button>
          </div>
        </div>
      ) : null}

      {stage === "outcome" && outcome ? (
        <div className="max-w-[42rem] space-y-4">
          <Outcome
            outcome={outcome}
            claimOpened={claimOpened}
            busy={busy}
            onClaim={claimOwnership}
            onRetry={() => setStage("details")}
            onDone={() => router.push("/fleet/trucks")}
          />
        </div>
      ) : null}
    </div>
  );
}

function Outcome({
  outcome, claimOpened, busy, onClaim, onRetry, onDone,
}: {
  outcome: RegisterTruckOutcome;
  claimOpened: boolean;
  busy: boolean;
  onClaim: () => void;
  onRetry: () => void;
  onDone: () => void;
}) {
  if (outcome.status === "created") {
    return (
      <>
        <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
          <CircleCheck className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
          <div className="min-w-0 text-[0.8125rem]">
            <p className="font-medium text-fg">Truck added to your fleet.</p>
            <p className="mt-0.5 text-fg-muted">
              It has a permanent id that will stay with it for life, whoever owns or operates it
              later.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" asChild>
            <Link href={`/fleet/trucks/${outcome.truck.truckId}`}>Open truck profile</Link>
          </Button>
          <Button variant="secondary" onClick={onDone}>Back to trucks</Button>
        </div>
      </>
    );
  }

  if (outcome.status === "existing_connected") {
    return (
      <>
        <FormAlert tone="success" role="none" title="Connected to the existing truck.">
          This VIN was already in Antcolos. You are now operating that same permanent record — no
          second truck was created, and none of its history was touched.
        </FormAlert>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" asChild>
            <Link href={`/fleet/trucks/${outcome.truck.truckId}`}>Open truck profile</Link>
          </Button>
          <Button variant="secondary" onClick={onDone}>Back to trucks</Button>
        </div>
      </>
    );
  }

  if (outcome.status === "relationship_pending") {
    return (
      <>
        <div className="flex items-start gap-3 rounded-lg border border-st-info/35 bg-st-info-bg/50 px-4 py-3.5">
          <Link2 className="mt-px size-5 shrink-0 text-st-info" aria-hidden />
          <div className="min-w-0 text-[0.8125rem]">
            <p className="font-medium text-fg">Request sent. Nothing has changed yet.</p>
            <p className="mt-0.5 text-fg-muted">
              {outcome.currentOperator
                ? `${outcome.currentOperator} still operates this truck and keeps operating it until they accept. `
                : ""}
              You will see it in your roster under “waiting to be connected”, and it is not counted
              as part of your fleet.
            </p>
          </div>
        </div>
        <Button variant="primary" onClick={onDone}>Back to trucks</Button>
      </>
    );
  }

  if (outcome.status === "ownership_claim_required") {
    return (
      <>
        <FormAlert tone="warning" role="none" title={`${outcome.currentOwnerName} is recorded as the owner.`}>
          Nobody is operating this truck, so this is a question about who owns it — and that is not
          ours to decide. You can open a claim, and the recorded owner reviews it.
        </FormAlert>
        {claimOpened ? (
          <div className="flex items-start gap-3 rounded-lg border border-st-info/35 bg-st-info-bg/50 px-4 py-3.5">
            <Hammer className="mt-px size-5 shrink-0 text-st-info" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">Ownership claim opened — pending review.</p>
              <p className="mt-0.5 text-fg-muted">
                The truck, its owner and its history are unchanged while the claim is open.
              </p>
            </div>
          </div>
        ) : (
          <Button variant="primary" onClick={onClaim} disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Opening claim…" : "Claim ownership of this truck"}
          </Button>
        )}
        <Button variant="secondary" onClick={onDone}>Back to trucks</Button>
      </>
    );
  }

  if (outcome.status === "manual_review_required") {
    return (
      <>
        <FormAlert tone="warning" role="none" title="Sent for manual review.">
          The evidence needs a human look. Nothing has changed on the truck.
        </FormAlert>
        <Button variant="primary" onClick={onDone}>Back to trucks</Button>
      </>
    );
  }

  if (outcome.status === "invalid_vin") {
    return (
      <>
        <FormAlert tone="danger" title="That VIN was rejected.">{outcome.message}</FormAlert>
        <Button variant="primary" onClick={onRetry}>Go back and fix it</Button>
      </>
    );
  }

  return (
    <>
      <div role="alert" className="flex gap-2.5 rounded-md border border-st-danger/35 bg-st-danger-bg/50 px-3 py-2.5">
        <TriangleAlert className="mt-px size-4 shrink-0 text-st-danger" aria-hidden />
        <div className="min-w-0 text-[0.8125rem] leading-relaxed">
          <p className="font-medium text-fg">You do not have permission to add trucks here.</p>
          <p className="mt-0.5 text-fg-muted">
            Missing: {outcome.missing.join(", ")}. Ask an owner of this organization to grant it.
          </p>
        </div>
      </div>
      <Button variant="secondary" onClick={onDone}>Back to trucks</Button>
    </>
  );
}

function MethodCard({
  icon: Icon, title, description, working, onSelect,
}: {
  icon: typeof Keyboard;
  title: string;
  description: string;
  working?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-3.5 rounded-lg border border-border bg-surface p-4 text-left shadow-e1 transition-colors",
        "hover:border-border-strong hover:bg-surface-hover",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted group-hover:text-fg">
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[0.9375rem] font-semibold text-fg">{title}</span>
          {!working ? (
            <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
              Not built yet
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-fg-muted">{description}</span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="mb-3 text-[0.9375rem] font-semibold text-fg">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className={cn("text-[0.8125rem] font-medium break-all text-fg", mono && "font-mono")}>{value || "—"}</dd>
    </div>
  );
}

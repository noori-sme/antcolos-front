"use client";

import { ArrowLeft, Building2, Check, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { FormAlert } from "@/features/auth/form-alert";
import { lookUpCarriers, type CarrierLookupResult } from "@/lib/api/mock/organization-lookup";
import { isValidRecipientEmail } from "@/lib/api/mock/document-shares";
import type { DocumentSharePackage, SharePurpose, ShareRecipient } from "@/types";
import { SHARE_PURPOSE_LABEL } from "@/types";
import { createDriverShare, shareableDocuments, type ShareableDocument } from "./sharing";
import { documentLabelFor } from "./share-labels";
import { cn } from "@/lib/utils";

type Step = "documents" | "recipient" | "review" | "done";

/**
 * Sharing documents the driver already has. Nothing is uploaded here.
 *
 * Four questions and a confirmation: which documents, who gets them, why, and
 * for how long. The driver sees the exact versions before confirming, because
 * "I sent them my licence" has to mean a specific file on a specific day — and
 * because what a carrier reviewed must not change under them afterwards.
 */
export function ShareFlowScreen() {
  const router = useRouter();
  const uid = useId();
  const [step, setStep] = useState<Step>("documents");
  const [documents, setDocuments] = useState<ShareableDocument[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const [mode, setMode] = useState<"native" | "external">("native");
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState<CarrierLookupResult | null>(null);
  const [email, setEmail] = useState("");
  const [purpose, setPurpose] = useState<SharePurpose>("driver_qualification");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DocumentSharePackage | null>(null);
  const [delivery, setDelivery] = useState<"recorded" | "failed" | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    shareableDocuments().then((rows) => {
      if (!cancelled) setDocuments(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => (mode === "native" ? lookUpCarriers(query) : []), [mode, query]);
  const chosen = (documents ?? []).filter((d) => selected.includes(d.documentId));

  const recipient: ShareRecipient | null =
    mode === "native"
      ? carrier
        ? { kind: "organization", organizationId: carrier.organizationId, organizationName: carrier.displayName }
        : null
      : isValidRecipientEmail(email)
        ? { kind: "external", email: email.trim() }
        : null;

  function confirm() {
    if (submitting || !recipient || chosen.length === 0) return;
    setSubmitting(true);
    setError(null);
    const result = createDriverShare({
      documentIds: chosen.map((d) => d.documentId),
      recipient,
      purpose,
      note,
    });
    setSubmitting(false);

    if (result.status !== "ok") {
      setError(
        result.status === "invalid-email"
          ? "That email address does not look right. Check it and try again."
          : "We could not create that share. Choose at least one document and try again.",
      );
      return;
    }
    setCreated(result.pkg);
    setDelivery(result.delivery);
    setStep("done");
  }

  if (documents === null) return <LoadingSkeleton rows={4} />;

  if (documents.length === 0) {
    return (
      <div className="space-y-section">
        <PageHeader title="Share with a carrier" description="Documents you have already prepared." />
        <EmptyState
          icon={Mail}
          title="You have nothing to share yet"
          description="Add your licence and medical card in My documents first. Sharing never asks you to upload anything twice."
        />
        <Button asChild variant="secondary">
          <Link href="/driver/documents">Go to my documents</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Share with a carrier"
        description="Choose what to send, who gets it, and for how long. Nothing is uploaded again."
      />

      {error ? <FormAlert tone="danger" title={error} /> : null}

      {step === "documents" ? (
        <section className="space-y-3" aria-labelledby={`${uid}-docs`}>
          <h2 id={`${uid}-docs`} className="text-[0.9375rem] font-semibold text-fg">
            1. Choose documents
          </h2>
          <ul className="space-y-2.5">
            {documents.map((doc) => {
              const checked = selected.includes(doc.documentId);
              return (
                <li key={doc.documentId}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
                      checked ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-border-strong",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={checked}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, doc.documentId]
                            : prev.filter((id) => id !== doc.documentId),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-[0.875rem] font-medium text-fg">
                        {documentLabelFor(doc.requirementKey)}
                      </span>
                      <span className="mt-0.5 block font-mono text-[0.75rem] text-fg-muted">
                        {doc.fileName}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button
            variant="primary"
            size="lg"
            disabled={selected.length === 0}
            onClick={() => setStep("recipient")}
          >
            Continue with {selected.length} document{selected.length === 1 ? "" : "s"}
          </Button>
        </section>
      ) : null}

      {step === "recipient" ? (
        <section className="space-y-4" aria-labelledby={`${uid}-who`}>
          <h2 id={`${uid}-who`} className="text-[0.9375rem] font-semibold text-fg">
            2. Choose who receives them
          </h2>

          <div className="flex gap-2" role="group" aria-label="Recipient type">
            <Button
              variant={mode === "native" ? "primary" : "secondary"}
              aria-pressed={mode === "native"}
              onClick={() => setMode("native")}
            >
              <Building2 aria-hidden />
              Carrier on Antcolos
            </Button>
            <Button
              variant={mode === "external" ? "primary" : "secondary"}
              aria-pressed={mode === "external"}
              onClick={() => setMode("external")}
            >
              <Mail aria-hidden />
              External carrier by email
            </Button>
          </div>

          {mode === "native" ? (
            <div className="space-y-2.5">
              <Field
                label="Find the carrier"
                htmlFor={`${uid}-carrier`}
                hint="Search by company name, or by DOT or MC number. Only carriers on Antcolos appear."
              >
                <Input
                  id={`${uid}-carrier`}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCarrier(null);
                  }}
                  placeholder="Northline Freight, or 3487211"
                  autoComplete="off"
                />
              </Field>
              <ul className="space-y-2">
                {results.map((result) => (
                  <li key={result.organizationId}>
                    <button
                      type="button"
                      onClick={() => setCarrier(result)}
                      aria-pressed={carrier?.organizationId === result.organizationId}
                      className={cn(
                        "w-full rounded-lg border p-3.5 text-left transition-colors",
                        carrier?.organizationId === result.organizationId
                          ? "border-primary bg-primary/5"
                          : "border-border bg-surface hover:border-border-strong",
                      )}
                    >
                      <span className="flex items-center gap-2 text-[0.875rem] font-medium text-fg">
                        {result.displayName}
                        {carrier?.organizationId === result.organizationId ? (
                          <Check className="size-4 text-primary" aria-hidden />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[0.75rem] text-fg-muted">
                        {result.legalName}
                        {result.dotNumber ? ` · DOT ${result.dotNumber}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
                {query.trim().length >= 3 && results.length === 0 ? (
                  <li className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.8125rem] text-fg-muted">
                    No carrier on Antcolos matches that. If they are not here yet, share by email
                    instead.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <Field
              label="Their business email"
              htmlFor={`${uid}-email`}
              hint="They get a secure link — never the documents as attachments."
            >
              <Input
                id={`${uid}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="recruiting@carrier.com"
                autoComplete="off"
              />
            </Field>
          )}

          <Field label="Why are you sharing these?" htmlFor={`${uid}-purpose`}>
            <select
              id={`${uid}-purpose`}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as SharePurpose)}
              className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1"
            >
              {Object.entries(SHARE_PURPOSE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Note (optional)" htmlFor={`${uid}-note`}>
            <Input
              id={`${uid}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Applying for the Midwest lane"
              maxLength={120}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("documents")}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
            <Button variant="primary" disabled={!recipient} onClick={() => setStep("review")}>
              Review the share
            </Button>
          </div>
        </section>
      ) : null}

      {step === "review" && recipient ? (
        <section className="space-y-4" aria-labelledby={`${uid}-review`}>
          <h2 id={`${uid}-review`} className="text-[0.9375rem] font-semibold text-fg">
            3. Check this is right
          </h2>
          <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            <Row label="Recipient" value={recipient.kind === "organization" ? recipient.organizationName : recipient.email} />
            <Row label="Recipient type" value={recipient.kind === "organization" ? "Carrier on Antcolos" : "External carrier (secure link)"} />
            <Row label="Purpose" value={SHARE_PURPOSE_LABEL[purpose]} />
            <Row label="Documents" value={chosen.map((d) => documentLabelFor(d.requirementKey)).join(", ")} />
            <Row label="Access ends" value="14 days from now, unless you revoke it sooner" />
          </dl>
          <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
            Sharing gives this recipient a look at these exact versions. It does not make you their
            driver, does not create an application, and can be withdrawn at any time. If you replace
            a document later, they keep seeing the version you sent until you share again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("recipient")}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
            <Button variant="primary" size="lg" disabled={submitting} onClick={confirm}>
              {submitting ? "Sharing…" : "Confirm and share"}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "done" && created ? (
        <ShareResult pkg={created} delivery={delivery} onDone={() => router.push("/driver/shares")} />
      ) : null}
    </div>
  );
}

function ShareResult({
  pkg,
  delivery,
  onDone,
}: {
  pkg: DocumentSharePackage;
  delivery?: "recorded" | "failed";
  onDone: () => void;
}) {
  const link = pkg.token ? `/shared/${pkg.token}` : null;
  return (
    <section className="space-y-4">
      <FormAlert
        tone={delivery === "failed" ? "danger" : "success"}
        role="none"
        title={
          delivery === "failed"
            ? "The mock delivery failed."
            : pkg.recipient.kind === "organization"
              ? `Shared with ${pkg.recipient.organizationName}.`
              : "Secure link created."
        }
      >
        {delivery === "failed"
          ? "That address was rejected. Check it and share again — nothing was sent."
          : pkg.recipient.kind === "organization"
            ? "They can open these documents from their own Antcolos workspace. You can withdraw access at any time."
            : "Preview build: no email is actually sent. The link below is what a real email would carry."}
      </FormAlert>

      {link ? (
        <div className="rounded-lg border border-border bg-surface-sunken p-3.5">
          <p className="text-[0.75rem] text-fg-muted">Recipient link (mock delivery)</p>
          <p className="mt-1 font-mono text-[0.8125rem] break-all text-fg">{link}</p>
          <Button asChild variant="secondary" size="sm" className="mt-2.5">
            <Link href={link}>Open it as the recipient would</Link>
          </Button>
        </div>
      ) : null}

      <Button variant="primary" onClick={onDone}>See all my shares</Button>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="text-[0.8125rem] font-medium text-fg">{value}</dd>
    </div>
  );
}

"use client";

import { ArrowLeft, Building2, Check, Search, ShieldAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { services } from "@/lib/api";
import type {
  OrganizationLookupKind, OrganizationSearchResult, ReferralDisclosure,
} from "@/types";
import { cn } from "@/lib/utils";
import { useReferringIdentity } from "./identity";

/**
 * Refer someone.
 *
 * Three steps, and the middle one is the one that matters: the company is
 * RESOLVED to a single Antcolos organization before anything else is accepted,
 * and the form will not proceed on a guess. The confirmation step then shows
 * the person exactly what each side will receive — computed by the service from
 * the same values `submit` will act on, never written out here, because a
 * disclosure a screen composes by hand is one that drifts.
 */

type Stage = "details" | "confirm" | "sent";

const LOOKUP_LABEL: Record<OrganizationLookupKind, string> = {
  username: "Antcolos username",
  mc_number: "MC number",
  name_search: "Company name",
};

const LOOKUP_HINT: Record<OrganizationLookupKind, string> = {
  username: "Their exact handle, e.g. northline-freight. We never match part of one.",
  mc_number: "Digits are enough. We only match a whole MC number.",
  name_search: "Search, then pick the right company from the results.",
};

export function ReferForm() {
  const identity = useReferringIdentity();
  const baseId = useId();

  const [stage, setStage] = useState<Stage>("details");
  const [lookupKind, setLookupKind] = useState<OrganizationLookupKind>("name_search");
  const [lookupValue, setLookupValue] = useState("");
  const [picked, setPicked] = useState<OrganizationSearchResult | null>(null);
  const [results, setResults] = useState<OrganizationSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const [disclosure, setDisclosure] = useState<ReferralDisclosure | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentReference, setSentReference] = useState<string | null>(null);

  /**
   * What is sent: the text the person typed, AND the company they picked.
   *
   * Not one value doing both jobs. The typed text is provenance and is kept
   * exactly as typed; the picked id is the identity the referral is made
   * against. An earlier version sent the id back in the `value` field, which
   * made a username lookup ask the resolver to find a handle called
   * `org_northline` — a company that resolved perfectly well on screen and then
   * did not resolve at all on submit.
   */
  function draft() {
    return {
      candidateFullName: fullName,
      candidateEmail: email,
      candidatePhone: phone,
      proposedTitle: title,
      note: note.trim() || undefined,
      organizationLookup: {
        kind: lookupKind,
        value: lookupValue.trim(),
        organizationId: picked?.organizationId,
      },
    };
  }

  async function findCompany() {
    setSearching(true);
    setLookupMessage(null);
    setResults(null);
    setPicked(null);
    const resolution = await services.referrals.resolveOrganization(lookupKind, lookupValue);
    setSearching(false);

    if (resolution.status === "resolved") {
      setPicked({
        organizationId: resolution.organizationId,
        displayName: resolution.displayName,
        legalName: resolution.legalName,
        username: resolution.username,
        mcNumber: resolution.mcNumber,
      });
      return;
    }
    if (resolution.status === "ambiguous") {
      setResults(resolution.candidates);
      // Never resolved for them. Several matches is an answer, and the answer
      // is "you pick".
      setLookupMessage("More than one company matches. Pick the right one.");
      return;
    }
    if (resolution.status === "inactive") {
      setLookupMessage(
        `${resolution.displayName} is not currently taking referrals on Antcolos.`,
      );
      return;
    }
    // A name search that found several is worth offering; a name search that
    // found nothing is not turned into a best guess.
    if (lookupKind === "name_search") {
      const found = await services.referrals.searchOrganizations(lookupValue);
      if (found.length > 0) {
        setResults(found);
        setLookupMessage("Pick the company you mean.");
        return;
      }
    }
    setLookupMessage("We could not find that company on Antcolos.");
  }

  async function review() {
    setBusy(true);
    setRefusal(null);
    const computed = await services.referrals.disclose(identity, draft());
    setBusy(false);
    if (!computed) {
      // `picked` is required before this button enables, so the company has
      // already resolved: what is left is one of the person's own fields.
      setRefusal("Check the name, email address, phone number and proposed work "
        + "above — one of them is missing or is not something we can use.");
      return;
    }
    setDisclosure(computed);
    setStage("confirm");
  }

  async function send() {
    setBusy(true);
    setRefusal(null);
    const result = await services.referrals.submit(identity, draft());
    setBusy(false);
    if (result.status === "refused") {
      setRefusal(result.message);
      if (result.candidates) setResults(result.candidates);
      setStage("details");
      return;
    }
    setSentReference(result.view.reference);
    setStage("sent");
  }

  if (stage === "sent") {
    return (
      <div className="space-y-section">
        <PageHeader
          title="Introduction sent"
          description={`We have queued an email to ${fullName}.`}
        />
        <div className="rounded-lg border border-border bg-surface p-5">
          <Badge tone="success" className="mb-3">
            <Check className="size-3.5" aria-hidden />
            Reference {sentReference}
          </Badge>
          <p className="text-[0.875rem] text-fg">
            {picked?.displayName} will see the introduction in their referral inbox.
            They decide separately, and so does {fullName} — neither decision
            depends on the other.
          </p>
          <p className="mt-3 text-[0.8125rem] text-fg-muted">
            Nothing about this gives {picked?.displayName} access to
            {" "}{fullName}&apos;s Antcolos profile or documents, and it creates no
            membership, role or employment record.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <Link href="/account/referrals">See your referrals</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "confirm" && disclosure) {
    return (
      <div className="space-y-section">
        <PageHeader
          title="Before you send"
          description="Exactly what each side will receive."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <DisclosureCard
            title={`What ${disclosure.targetOrganizationName} will see`}
            rows={disclosure.sharedWithCompany}
          />
          <DisclosureCard
            title={`What ${fullName || "they"} will be emailed`}
            rows={disclosure.sharedWithCandidate}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface-sunken p-4">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
            <ShieldAlert className="size-4 text-fg-muted" aria-hidden />
            What this does not do
          </p>
          <ul className="mt-2 space-y-1.5 text-[0.8125rem] text-fg-muted">
            {disclosure.notShared.map((line) => <li key={line}>· {line}</li>)}
          </ul>
        </div>

        <p className="text-[0.75rem] text-fg-subtle">{disclosure.limitation}</p>

        {refusal ? (
          <p role="alert" className="text-[0.8125rem] text-st-danger">{refusal}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setStage("details")} disabled={busy}>
            <ArrowLeft aria-hidden />
            Change something
          </Button>
          <Button variant="primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send the introduction"}
          </Button>
        </div>
      </div>
    );
  }

  const canReview = Boolean(picked) && fullName.trim() && email.trim()
    && phone.trim() && title.trim();

  return (
    <div className="space-y-section">
      <PageHeader
        title="Refer someone"
        description="Introduce a person to a company on Antcolos. Anyone can do this — you do not need to work there."
      />

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-[0.9375rem] font-semibold text-fg">Which company</h2>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LOOKUP_LABEL) as OrganizationLookupKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setLookupKind(kind);
                setPicked(null);
                setResults(null);
                setLookupMessage(null);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[0.8125rem] transition-colors",
                kind === lookupKind
                  ? "border-primary bg-primary/10 text-fg"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong",
              )}
            >
              {LOOKUP_LABEL[kind]}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field
            label={LOOKUP_LABEL[lookupKind]}
            htmlFor={`${baseId}-lookup`}
            hint={LOOKUP_HINT[lookupKind]}
            className="flex-1"
          >
            <Input
              id={`${baseId}-lookup`}
              value={lookupValue}
              onChange={(e) => {
                setLookupValue(e.target.value);
                setPicked(null);
              }}
              placeholder={lookupKind === "mc_number" ? "MC-1142908" : "Northline"}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={findCompany}
            disabled={searching || lookupValue.trim().length < 2}
          >
            <Search aria-hidden />
            {searching ? "Looking…" : "Find"}
          </Button>
        </div>

        {lookupMessage ? (
          <p className="text-[0.8125rem] text-fg-muted">{lookupMessage}</p>
        ) : null}

        {results?.length ? (
          <ul className="space-y-1.5">
            {results.map((r) => (
              <li key={r.organizationId}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(r);
                    setResults(null);
                    setLookupMessage(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left hover:border-border-strong"
                >
                  <Building2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] text-fg">
                      {r.displayName}
                    </span>
                    <span className="block truncate text-[0.75rem] text-fg-subtle">
                      {r.legalName}
                      {r.mcNumber ? ` · ${r.mcNumber}` : ""}
                      {r.username ? ` · @${r.username}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked ? (
          <div className="flex items-center gap-2 rounded-md border border-st-success/35 bg-st-success-bg/40 px-3 py-2">
            <Check className="size-4 text-st-success" aria-hidden />
            <span className="text-[0.8125rem] text-fg">
              {picked.displayName}
              <span className="text-fg-subtle"> · {picked.legalName}</span>
            </span>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-[0.9375rem] font-semibold text-fg">Who you are referring</h2>
        <Field label="Full name" htmlFor={`${baseId}-name`}>
          <Input
            id={`${baseId}-name`}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Email address"
            htmlFor={`${baseId}-email`}
            hint="We email them a secure link. They decide what to do with it."
          >
            <Input
              id={`${baseId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Phone number" htmlFor={`${baseId}-phone`}>
            <Input
              id={`${baseId}-phone`}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>
        <Field
          label="Proposed work"
          htmlFor={`${baseId}-title`}
          hint="Your own words — Driver, Dispatcher, Safety, Accounting, anything. It is context for the company and never a role or a permission."
        >
          <Input
            id={`${baseId}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Driver"
          />
        </Field>
        <Field
          label="A note (optional)"
          htmlFor={`${baseId}-note`}
          hint="Shown to the company and to the person you are referring."
        >
          <Textarea
            id={`${baseId}-note`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </section>

      {refusal ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{refusal}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={review} disabled={!canReview || busy}>
          <UserPlus aria-hidden />
          {busy ? "Checking…" : "Review what will be sent"}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/account/referrals">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}

function DisclosureCard({
  title, rows,
}: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[0.8125rem] font-semibold text-fg">{title}</p>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-3 text-[0.8125rem]">
            <dt className="w-32 shrink-0 text-fg-subtle">{row.label}</dt>
            <dd className="min-w-0 break-words text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

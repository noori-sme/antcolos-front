"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  CarrierLookupError, formatAddress, formatPhone, parseCarrierIdentifier,
} from "@/lib/carriers/lookup";
import { cn } from "@/lib/utils";
import type { CarrierIdentifier, CarrierLookupErrorKind, CarrierLookupResult } from "@/types/carrier-lookup";
import { usePublicCarrierLookup } from "./hooks";

const ERROR_COPY: Record<CarrierLookupErrorKind, { title: string; body: string }> = {
  invalid_identifier: {
    title: "That number isn't valid",
    body: "An MC number is up to 8 digits, with or without “MC”. A DOT number is up to 8 digits.",
  },
  not_found: { title: "No carrier found", body: "FMCSA has no carrier with that number. Check it and try again." },
  rate_limited: { title: "Too many lookups", body: "Wait a minute, then search again." },
  not_configured: { title: "Lookup is unavailable", body: "Carrier lookup isn't set up on this server yet." },
  unavailable: { title: "FMCSA isn't answering", body: "The FMCSA service is unavailable right now. Try again in a few minutes." },
};

/** The query in the URL (`?mc=` or `?dot=`), so a result can be shared and Back works. */
function identifierFromUrl(params: URLSearchParams | null): CarrierIdentifier | null {
  const mc = params?.get("mc");
  if (mc) return parseCarrierIdentifier("mc", mc);
  const dot = params?.get("dot");
  return dot ? parseCarrierIdentifier("dot", dot) : null;
}

/**
 * Public FMCSA carrier lookup (plan 09). No account needed: the backend route
 * is public and rate-limited per IP. Shows the record as FMCSA returns it and
 * invents nothing.
 */
export function CarrierLookupScreen() {
  const params = useSearchParams();
  // Re-mount the form when the URL changes (Back/Forward), so the toggle and
  // the input always match the result shown.
  return <CarrierLookup key={params?.toString() ?? ""} params={params} />;
}

function CarrierLookup({ params }: { params: URLSearchParams | null }) {
  const router = useRouter();
  const current = identifierFromUrl(params);

  const [kind, setKind] = useState<"mc" | "dot">(current?.kind ?? (params?.get("dot") ? "dot" : "mc"));
  const [value, setValue] = useState(params?.get(kind) ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const lookup = usePublicCarrierLookup(current);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = parseCarrierIdentifier(kind, value);
    if (!id) {
      setFieldError(ERROR_COPY.invalid_identifier.body);
      return;
    }
    setFieldError(null);
    router.push(`/carriers/lookup?${id.kind}=${encodeURIComponent(id.value)}`);
  };

  const errorKind = lookup.error instanceof CarrierLookupError ? lookup.error.kind : "unavailable";
  const canRetry = errorKind === "unavailable" || errorKind === "rate_limited";

  return (
    <div className="w-full max-w-[40rem] space-y-6">
      <header className="space-y-4">
        <Link href="/" aria-label="Antcolos home" className="inline-flex"><Logo /></Link>
        <div>
          <h1 className="text-[1.5rem] font-semibold text-fg">Look up a carrier</h1>
          <p className="mt-1 text-[0.875rem] text-fg-muted">
            Check a carrier&apos;s FMCSA record by MC or DOT number. No account needed.
          </p>
        </div>
      </header>

      <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-e1">
        <div role="group" aria-label="Search by" className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5">
          {(["mc", "dot"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => { setKind(k); setFieldError(null); }}
              className={cn(
                "rounded px-3 py-1 text-[0.8125rem] font-medium transition-colors",
                kind === k ? "bg-surface text-fg shadow-e1" : "text-fg-muted hover:text-fg",
              )}
            >
              {k === "mc" ? "MC number" : "DOT number"}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Field
            className="flex-1"
            label={kind === "mc" ? "MC number" : "DOT number"}
            htmlFor="carrier-identifier"
            error={fieldError ?? undefined}
          >
            <Input
              id="carrier-identifier"
              inputMode={kind === "dot" ? "numeric" : "text"}
              autoComplete="off"
              placeholder={kind === "mc" ? "MC1515" : "44110"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={Boolean(fieldError)}
            />
          </Field>
          <Button type="submit" variant="primary" className="sm:mt-[1.625rem]" disabled={lookup.isFetching}>
            {lookup.isFetching ? <Loader2 aria-hidden className="animate-spin" /> : <Search aria-hidden />}
            Search
          </Button>
        </div>
      </form>

      {!current ? null : lookup.isPending ? (
        <div role="status" className="flex items-center gap-2 text-[0.875rem] text-fg-muted">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Looking up the carrier with FMCSA…
        </div>
      ) : lookup.isError ? (
        <div role="alert" className="rounded-lg border border-st-danger/30 bg-st-danger-bg/50 px-4 py-3.5">
          <p className="text-[0.9375rem] font-semibold text-fg">{ERROR_COPY[errorKind].title}</p>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">{ERROR_COPY[errorKind].body}</p>
          {canRetry ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void lookup.refetch()} disabled={lookup.isFetching}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
          ) : null}
        </div>
      ) : lookup.data ? (
        <CarrierCard carrier={lookup.data} />
      ) : null}
    </div>
  );
}

const NOT_ON_FILE = "Not on file";

function CarrierCard({ carrier }: { carrier: CarrierLookupResult }) {
  const rows: Array<[string, string]> = [
    ["DOT number", carrier.dotNumber],
    ["MC number", carrier.mcNumber ?? NOT_ON_FILE],
    ["Phone", formatPhone(carrier.phone) ?? NOT_ON_FILE],
    ["Physical address", formatAddress(carrier.address) ?? NOT_ON_FILE],
  ];
  if (!carrier.censusUnavailable) {
    rows.push(
      ["Email", carrier.email ?? NOT_ON_FILE],
      ["Mailing address", formatAddress(carrier.mailingAddress) ?? NOT_ON_FILE],
    );
  }

  return (
    <section aria-labelledby="carrier-name" className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <h2 id="carrier-name" className="text-[1.0625rem] font-semibold text-fg">
            {carrier.legalName ?? "Name not on file"}
          </h2>
          {carrier.dbaName ? (
            <p className="text-[0.8125rem] text-fg-muted">Doing business as {carrier.dbaName}</p>
          ) : null}
        </div>
        <Badge tone={carrier.active ? "success" : "danger"}>
          {carrier.active ? "Authorized to operate" : "Not authorized to operate"}
        </Badge>
      </div>
      <dl className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
            <dd className={cn("text-[0.875rem] tabular-nums sm:text-right", value === NOT_ON_FILE ? "text-fg-subtle" : "font-medium text-fg")}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2 border-t border-border bg-surface-sunken px-4 py-3 text-[0.75rem] text-fg-muted">
        {carrier.censusUnavailable ? (
          <p role="status">Email and mailing address are temporarily unavailable from FMCSA. Try again later.</p>
        ) : (
          <p>Name, status, phone and physical address are live from FMCSA. Email and mailing address come from the FMCSA census, which is about a day old.</p>
        )}
        <p>
          Is this your company?{" "}
          <Link href="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
            Create an Antcolos account
          </Link>
        </p>
      </div>
    </section>
  );
}

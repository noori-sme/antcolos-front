"use client";

import { ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { Logo } from "@/components/brand/logo";
import type { SharePackageRefusal } from "@/types";
import { SHARE_PURPOSE_LABEL, SHARE_REFUSAL_MESSAGE } from "@/types";
import { openSharedPackage } from "@/lib/api/mock/document-shares";
import { SharedDocumentCard } from "./shared-document-card";
import { formatDate } from "./driver-rules";

/**
 * What somebody outside Antcolos sees when a driver sends them documents.
 *
 * This page is the whole of their access. It is not an account, not a session
 * and not a way in: it shows the documents in ONE share package and nothing
 * else — not the driver's other paperwork, not the driver portal, not an
 * organization. A refused link says WHY it was refused, because "this link was
 * withdrawn" and "this link expired" are different facts to the person holding
 * it, and a blank page teaches them neither.
 */
export function ExternalShareScreen({ token }: { token: string }) {
  // Resolving IS the access event: opening the link is what gets recorded.
  const result = useMemo(() => openSharedPackage(token), [token]);

  if (result.status === "refused") return <Refused reason={result.reason} />;

  const { pkg, view } = result;

  return (
    <div className="w-full max-w-[46rem] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Logo size="md" />
        <p className="font-mono text-[0.75rem] text-fg-subtle">{view.reference}</p>
      </header>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-e1 sm:p-6">
        <h1 className="text-[1.1875rem] leading-7 font-semibold tracking-[-0.012em] text-fg sm:text-[1.3125rem]">
          {view.driverName} shared {view.items.length} document
          {view.items.length === 1 ? "" : "s"} with you
        </h1>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-2">
          <Row label="Purpose" value={SHARE_PURPOSE_LABEL[view.purpose]} />
          <Row label="Shared on" value={formatDate(view.createdAt)} />
          <Row label="Access ends" value={formatDate(view.expiresAt)} />
          <Row label="Reference" value={view.reference} mono />
        </dl>
        {view.note ? (
          <p className="mt-3 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-fg-muted">
            “{view.note}”
          </p>
        ) : null}
      </div>

      <section aria-labelledby="shared-documents" className="space-y-2.5">
        <h2 id="shared-documents" className="text-[0.9375rem] font-semibold text-fg">
          The documents
        </h2>
        <ul className="space-y-3">
          {view.items.map((item) => (
            <SharedDocumentCard key={item.documentId} item={item} pkg={pkg} />
          ))}
        </ul>
      </section>

      <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        These documents were supplied by the driver and have not been verified by Antcolos or by any
        background-check provider. This link shows only what the driver selected, expires on the
        date above, and can be withdrawn by them at any time. Preview build: no file is stored and
        no email was actually sent.
      </p>
    </div>
  );
}

function Refused({ reason }: { reason: SharePackageRefusal }) {
  return (
    <div className="w-full max-w-[28rem] space-y-5 text-center">
      <div className="flex justify-center">
        <Logo size="lg" />
      </div>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-e1">
        <ShieldAlert className="mx-auto size-6 text-fg-subtle" aria-hidden />
        <h1 className="mt-3 text-[1.0625rem] font-semibold text-fg">
          {SHARE_REFUSAL_MESSAGE[reason]}
        </h1>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
          Ask the driver to send a new link if you still need these documents. Nothing about them is
          shown here.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={mono ? "font-mono font-medium text-fg" : "font-medium text-fg"}>{value}</dd>
    </div>
  );
}

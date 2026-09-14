"use client";

import { FileBadge, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  CERTIFICATE_HOLDER_LABEL, COVERAGE_TYPE_LABEL, expiryLabel, insuranceDate,
} from "@/lib/insurance/labels";
import { CertificateStatusChip } from "./chips";
import { useCertificates } from "./hooks";

/**
 * Certificates of insurance, by how soon they lapse.
 *
 * A certificate is evidence somebody else is holding, so the question this
 * screen answers is not "what do we have" but "who is about to be holding a
 * piece of paper that has stopped being true".
 */
export function CertificatesScreen() {
  const [query, setQuery] = useState("");
  const { data, isPending, isError, refetch } = useCertificates();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((c) =>
      `${c.certificateNumber} ${c.holderName} ${c.insurerName} ${c.policyNumberSnapshot}`
        .toLowerCase().includes(q));
  }, [data, query]);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Certificates of insurance"
        description="Evidence of cover your brokers, shippers and facilities are holding — and when each piece of paper stops being true."
      />

      <p className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        Antcolos does not generate, sign or send a certificate. These are records of what
        your agent issued, kept so nothing lapses without anybody noticing.
      </p>

      <div className="relative min-w-0 sm:max-w-xs">
        <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Holder, certificate or policy number…"
          aria-label="Search certificates"
          className="pl-9"
        />
      </div>

      {isPending ? <LoadingSkeleton rows={4} /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}

      {data && data.length === 0 ? (
        <EmptyState
          icon={FileBadge}
          title="No certificates recorded"
          description="Record a certificate against a policy and Antcolos will track who holds it and when it runs out."
        />
      ) : null}

      {data && data.length > 0 && visible.length === 0 ? (
        <EmptyState icon={Search} title="No certificates match" description="Try a different search." />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((cert) => (
            <li
              key={cert.certificateId}
              className="rounded-lg border border-border bg-surface p-4 shadow-e1"
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-fg">{cert.holderName}</span>
                <CertificateStatusChip status={cert.status} />
                <Badge tone="outline">{CERTIFICATE_HOLDER_LABEL[cert.holderKind]}</Badge>
                {cert.additionalInsured ? <Badge tone="info">Additional insured</Badge> : null}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                <span>{cert.certificateNumber}</span>
                <Link
                  href={`/insurance/policies/${cert.policyId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {cert.policyNumberSnapshot}
                </Link>
                <span>{cert.insurerName}</span>
                <span>{cert.coverageTypes.map((t) => COVERAGE_TYPE_LABEL[t]).join(", ") || "—"}</span>
                <span className="tabular-nums">
                  {insuranceDate(cert.effectiveFrom)} – {insuranceDate(cert.expiresAt)} ·{" "}
                  {expiryLabel(cert.daysUntilExpiry)}
                </span>
                {cert.file ? <span>{cert.file.fileName}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

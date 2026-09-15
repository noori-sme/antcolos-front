"use client";

import { ArrowLeft, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import {
  AGREEMENT_TYPE_CATALOG, MOCK_CONTRACT_DISCLOSURE, agreementTypeMeta,
} from "@/lib/contracts";
import { PARTY_ROLE_LABEL } from "@/lib/contracts/labels";
import { documentTypeLabel } from "@/lib/documents/catalog";
import { cn } from "@/lib/utils";
import type { AgreementType } from "@/types";
import { Disclosure } from "./chips";
import { useCreateContract } from "./hooks";

/**
 * Writing a new agreement.
 *
 * Deliberately short. It collects identity — what kind of agreement, with whom,
 * called what — and the start date, and nothing else: the terms are written on
 * the draft afterwards, and a form that pre-filled a percentage would be
 * Antcolos deciding what somebody gets paid.
 *
 * What it DOES show up front is the checklist the chosen type will ask for and
 * which relationships it may reference, because both are consequences of the
 * type that a person should see before they pick one.
 */
export function NewContractScreen() {
  const router = useRouter();
  const create = useCreateContract();

  const [agreementType, setAgreementType] = useState<AgreementType>("carrier_driver");
  const [title, setTitle] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [summary, setSummary] = useState("");
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  const meta = useMemo(() => agreementTypeMeta(agreementType), [agreementType]);
  const counterpartyRole = meta.partyRoles[1];

  const ready = title.trim().length > 0 && counterpartyName.trim().length > 0;

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/contracts"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          All agreements
        </Link>
      </div>

      <PageHeader
        title="New agreement"
        description="Start a draft. Nothing is issued, sent or signed until you say so."
      />

      <Disclosure>
        <strong className="font-semibold text-fg">Mock agreements.</strong>{" "}
        {MOCK_CONTRACT_DISCLOSURE}
      </Disclosure>

      <Card>
        <CardHeader>
          <CardTitle>What kind of relationship is this?</CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            The type decides which relationships the agreement may reference and
            what it asks for. It is not a label: a carrier–driver agreement cannot
            be pointed at an Operating Authority lease, because an agreement that
            could would read as though signing it authorised a truck.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {AGREEMENT_TYPE_CATALOG.map((option) => (
            <button
              key={option.type}
              type="button"
              aria-pressed={agreementType === option.type}
              onClick={() => setAgreementType(option.type)}
              className={cn(
                "w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                agreementType === option.type
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <span className="text-[0.875rem] font-medium text-fg">{option.label}</span>
              <span className="mt-0.5 block text-[0.8125rem] text-fg-muted">
                {option.description}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-[0.8125rem] font-medium text-fg">
            Title
            <Input
              className="mt-1.5"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Company driver agreement — Nils Bergstrom"
            />
          </label>

          <label className="block text-[0.8125rem] font-medium text-fg">
            {PARTY_ROLE_LABEL[counterpartyRole]} — legal name
            <Input
              className="mt-1.5"
              value={counterpartyName}
              onChange={(e) => setCounterpartyName(e.target.value)}
              placeholder="As it should read on the agreement"
            />
            <span className="mt-1 block text-[0.75rem] font-normal text-fg-subtle">
              Snapshotted, so a later rename never rewrites a signed agreement.
            </span>
          </label>

          <label className="block text-[0.8125rem] font-medium text-fg">
            Start date
            <Input
              type="date"
              className="mt-1.5"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>

          <label className="block text-[0.8125rem] font-medium text-fg">
            Plain-language summary
            <Textarea
              className="mt-1.5"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What the two sides have agreed, as they would say it."
            />
            <span className="mt-1 block text-[0.75rem] font-normal text-fg-subtle">
              Required before the version can be issued for signature. You can
              write it now or later.
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this type will ask for</CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            Requirements, not documents. Each one is checked against the Document
            Center every time the agreement is read — this module keeps no files
            of its own.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {meta.documentTerms.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">
              Nothing is assumed for this type. Add what the agreement needs once
              it is a draft.
            </p>
          ) : null}
          {meta.documentTerms.map((term) => (
            <div
              key={`${term.documentTypeKey}-${term.owedByRole}`}
              className="rounded-md border border-border bg-surface-sunken px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.875rem] text-fg">
                  {documentTypeLabel(term.documentTypeKey)}
                </span>
                <Badge tone="neutral">{PARTY_ROLE_LABEL[term.owedByRole]}</Badge>
                {term.blocking ? <Badge tone="danger">Blocking</Badge> : null}
              </div>
              <p className="mt-1 text-[0.8125rem] text-fg-muted">{term.reason}</p>
            </div>
          ))}

          <div className="mt-3">
            <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">
              Relationships it may reference
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {meta.allowedRelationshipKinds.map((kind) => (
                <Badge key={kind} tone="outline">{kind.replace(/_/g, " ")}</Badge>
              ))}
            </div>
            <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
              A reference only. The relationship stays owned by the service that
              controls it, and this agreement can never create, alter or end one.
            </p>
          </div>
        </CardContent>
      </Card>

      {create.isError ? (
        <p className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-fg">
          {create.error instanceof Error ? create.error.message : "That did not work."}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          disabled={!ready || create.isPending}
          onClick={async () => {
            const view = await create.mutateAsync({
              agreementType,
              title: title.trim(),
              counterparty: {
                role: counterpartyRole,
                legalName: counterpartyName.trim(),
              },
              terms: {
                summary: summary.trim(),
                effective: { from: new Date(`${startDate}T00:00:00.000Z`).toISOString() },
              },
            });
            router.push(`/contracts/${view.contract.contractId}`);
          }}
        >
          <FilePlus2 aria-hidden />
          Create the draft
        </Button>
        <Button asChild variant="ghost">
          <Link href="/contracts">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}

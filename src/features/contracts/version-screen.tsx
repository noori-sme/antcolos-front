"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  MOCK_SIGNATURE_DISCLOSURE, compensationLabel, compensationWindowLabel,
  contractDate, contractDateTime, effectiveRangeLabel, renewalLabel,
} from "@/lib/contracts";
import {
  CONTRACT_TERM_GROUP_LABEL, RESPONSIBILITY_AREA_LABEL,
  TERMINATION_GROUND_LABEL,
} from "@/types";
import { Disclosure, MockChip, PartyRoleChip, VersionStatusChip } from "./chips";
import { useContract, useContractVersion } from "./hooks";

/**
 * One version, exactly as it stands.
 *
 * This is the screen that answers "what were we operating under in March": it
 * reads the version rather than the contract, so a signed version shows the terms
 * and the compensation rules that were agreed then, whatever the current version
 * says now. Nothing on this page is editable, ever.
 */
export function ContractVersionScreen({
  contractId, contractVersionId,
}: {
  contractId: string;
  contractVersionId: string;
}) {
  const contract = useContract(contractId);
  const version = useContractVersion(contractId, contractVersionId);

  if (version.isPending || contract.isPending) return <LoadingSkeleton rows={6} />;
  if (version.isError || !version.data) {
    return (
      <ErrorState
        title="That version is not available"
        description={
          version.error instanceof Error
            ? version.error.message
            : "It may belong to another organization, or you may not have permission to read it."
        }
        onRetry={() => version.refetch()}
      />
    );
  }

  const v = version.data;
  const view = contract.data;
  const signatures = (view?.signatures ?? []).filter(
    (s) => s.contractVersionId === contractVersionId,
  );

  return (
    <div className="space-y-section">
      <div>
        <Link
          href={`/contracts/${contractId}`}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back to the agreement
        </Link>
      </div>

      <PageHeader
        title={`Version ${v.versionNumber}`}
        description={
          view
            ? `${view.contract.reference} · ${view.contract.title}`
            : "One immutable statement of terms."
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <VersionStatusChip status={v.status} />
        <Badge tone="outline">{v.kind}</Badge>
        {v.frozen ? (
          <Badge tone="neutral">
            <Lock aria-hidden className="size-3" />
            Frozen
          </Badge>
        ) : null}
        <MockChip />
      </div>

      {v.frozen ? (
        <Disclosure>
          <strong className="font-semibold text-fg">This version can never change.</strong>{" "}
          Its terms, its signatures and its compensation rules are exactly what
          they were. Changing any of it means a new version — nothing here is
          overwritten, and nothing is deleted.
        </Disclosure>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>The terms, as of this version</CardTitle>
          {v.changeReason ? (
            <p className="mt-1 text-[0.8125rem] text-fg-muted">
              <span className="font-medium text-fg">Why it exists:</span> {v.changeReason}
              {v.changedTermGroups.length > 0 ? (
                <>
                  {" "}Changed:{" "}
                  {v.changedTermGroups
                    .map((g) => CONTRACT_TERM_GROUP_LABEL[g].toLowerCase()).join(", ")}.
                </>
              ) : null}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[0.875rem] text-fg">{v.terms.summary}</p>

          <Row label="Effective">{effectiveRangeLabel(v.terms)}</Row>
          <Row label="Renewal">{renewalLabel(v.terms.renewal)}</Row>
          <Row label="Termination grounds">
            {v.terms.termination.grounds
              .map((g) => TERMINATION_GROUND_LABEL[g].toLowerCase()).join(", ")}
          </Row>
          <Row label="Created">
            {contractDateTime(v.createdAt)} by {v.createdByName}
            {v.issuedAt ? ` · issued ${contractDate(v.issuedAt)}` : ""}
            {v.signedAt ? ` · fully signed ${contractDate(v.signedAt)}` : ""}
          </Row>

          <div>
            <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">
              Compensation as of this version
            </p>
            {v.terms.compensation.length === 0 ? (
              <p className="mt-1.5 text-[0.8125rem] text-fg-muted">
                No compensation rules on this version — either none were agreed,
                or they are not included in what you can see.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {v.terms.compensation.map((rule) => (
                  <li
                    key={rule.id}
                    className="rounded-md border border-border bg-surface-sunken px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.875rem] font-medium text-fg">{rule.label}</span>
                      <Badge tone="outline">{compensationLabel(rule)}</Badge>
                      <PartyRoleChip role={rule.payeeRole} />
                      {compensationWindowLabel(rule) ? (
                        <Badge tone="neutral">{compensationWindowLabel(rule)}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[0.8125rem] text-fg-muted">{rule.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {v.terms.responsibilities.length > 0 ? (
            <div>
              <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">
                Responsibilities
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {v.terms.responsibilities.map((duty) => (
                  <li key={duty.id} className="flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
                    <Badge tone="outline">{RESPONSIBILITY_AREA_LABEL[duty.area]}</Badge>
                    <PartyRoleChip role={duty.owedByRole} />
                    <span className="text-fg-muted">{duty.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signatures on this version</CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">{MOCK_SIGNATURE_DISCLOSURE}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {signatures.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">
              Nobody has signed this version.
            </p>
          ) : null}
          {signatures.map((signature) => {
            const party = view?.parties.find((p) => p.partyId === signature.partyId);
            return (
              <div
                key={signature.signatureId}
                className="rounded-md border border-border bg-surface-sunken px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium text-fg">
                    {party?.legalNameSnapshot ?? "A party"}
                  </span>
                  <MockChip label="Mock signature" />
                  <span className="text-[0.75rem] text-fg-subtle">
                    {contractDateTime(signature.signedAt)}
                  </span>
                </div>
                <p className="mt-1 text-[0.8125rem] text-fg">
                  Typed name:{" "}
                  <span className="font-medium">{signature.typedName}</span>
                  {signature.signerTitleSnapshot ? ` · ${signature.signerTitleSnapshot}` : ""}
                </p>
                <p className="mt-1 text-[0.75rem] text-fg-subtle">{signature.statement}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-[0.875rem] text-fg">{children}</p>
    </div>
  );
}

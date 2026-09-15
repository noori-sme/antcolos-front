"use client";

import { FlaskConical, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { agreementTypeLabel, statusLabel, statusTone } from "@/lib/contracts";
import {
  CONTRACT_REQUIREMENT_STATUS_LABEL, CONTRACT_TERMINATION_STATUS_LABEL,
  CONTRACT_VERSION_STATUS_LABEL,
  type AgreementType, type ContractPartyRole, type ContractRequirementStatus,
  type ContractStatus, type ContractTerminationStatus, type ContractVersionStatus,
} from "@/types";
import { PARTY_ROLE_LABEL } from "@/lib/contracts/labels";
import { cn } from "@/lib/utils";

/**
 * Status chips for Contracts.
 *
 * Tone comes from `statusTone` in the domain layer rather than from a lookup in
 * here, so "expiring" is amber on every screen and a terminated agreement never
 * reads as a failure — ending an agreement on its terms is a normal thing to
 * have done.
 */

export function ContractStatusChip({ status }: { status: ContractStatus }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function AgreementTypeChip({ type }: { type: AgreementType }) {
  return <Badge tone="outline">{agreementTypeLabel(type)}</Badge>;
}

export function PartyRoleChip({ role }: { role: ContractPartyRole }) {
  return <Badge tone="neutral">{PARTY_ROLE_LABEL[role]}</Badge>;
}

export function VersionStatusChip({ status }: { status: ContractVersionStatus }) {
  const tone = status === "signed"
    ? "success"
    : status === "issued"
      ? "info"
      : status === "void"
        ? "danger"
        : "neutral";
  return <Badge tone={tone}>{CONTRACT_VERSION_STATUS_LABEL[status]}</Badge>;
}

export function RequirementStatusChip({ status }: { status: ContractRequirementStatus }) {
  const tone = status === "met"
    ? "success"
    : status === "expired"
      ? "danger"
      : status === "waived"
        ? "info"
        : status === "not_applicable"
          ? "neutral"
          : "warning";
  return <Badge tone={tone}>{CONTRACT_REQUIREMENT_STATUS_LABEL[status]}</Badge>;
}

export function TerminationStatusChip({ status }: { status: ContractTerminationStatus }) {
  const tone = status === "completed"
    ? "success"
    : status === "withdrawn"
      ? "neutral"
      : "warning";
  return <Badge tone={tone}>{CONTRACT_TERMINATION_STATUS_LABEL[status]}</Badge>;
}

/**
 * The mock marker.
 *
 * On every contract and every signature, without exception. It is a component
 * rather than a sentence so it cannot go missing from one screen while being
 * present on four others.
 */
export function MockChip({ label = "Mock" }: { label?: string }) {
  return (
    <Badge tone="warning" className="uppercase tracking-wide">
      <FlaskConical aria-hidden className="size-3" />
      {label}
    </Badge>
  );
}

/** A plain, unmissable note about what this build does not do. */
export function Disclosure({
  children, className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md border border-st-warning/30 bg-st-warning-bg/50 px-3 py-2.5 text-[0.8125rem] text-fg-muted",
        className,
      )}
    >
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
      <span>{children}</span>
    </p>
  );
}

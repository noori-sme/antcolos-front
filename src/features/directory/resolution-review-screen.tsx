"use client";

import {
  ArrowLeft, Building2, Check, CircleAlert, FileText, MapPin, ScanLine, Sparkles,
  TriangleAlert, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  commitResolution, planResolution,
} from "@/lib/api/mock/party-registry";
import {
  MOCK_EXTRACTIONS, MOCK_EXTRACTION_LABELS,
} from "@/lib/api/mock/rate-con-extractions";
import { useSession, useActiveMembership } from "@/lib/session/hooks";
import type {
  CommitResult, ConfirmedResolution, PartyResolutionDecision, PartyRole,
  RateConfirmationExtraction, ResolutionPlan,
} from "@/types";
import { cn } from "@/lib/utils";
import { ConfidenceChip, PartyStatusChip, RoleChip } from "./directory-chips";
import {
  PARTY_ROLE_DESCRIPTION, PARTY_ROLE_LABEL, RECOMMENDATION_LABEL, formatAddress,
  formatCityState, formatDate, formatMcNumber, formatPhone,
} from "./directory-labels";
import { usePartyContext } from "./use-party-context";

/**
 * The dispatcher's confirmation step.
 *
 * This screen is the reason the resolver refuses to decide anything on its own.
 * It shows what was matched, what it was matched ON, and what will happen if
 * the dispatcher agrees — and then does nothing until they say so.
 *
 * The design rule throughout: never pre-select a guess. Where the resolver is
 * certain, the recommended option is selected and the reasoning is shown so it
 * can be overruled. Where two profiles fit, NOTHING is selected, and the
 * Confirm button stays disabled until a person picks — because a default here
 * is how a load quietly gets billed to the wrong broker.
 *
 * Extraction itself is not built. The rate confirmations offered below are
 * reviewed fixtures standing in for the OCR workflow's output, and the screen
 * says so rather than implying a scanner exists.
 */

export function ResolutionReviewScreen() {
  const ctx = usePartyContext();
  const { user } = useSession();
  const { membership } = useActiveMembership();

  const [selected, setSelected] = useState<RateConfirmationExtraction | null>(null);
  const [plan, setPlan] = useState<ResolutionPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [denied, setDenied] = useState(false);
  const [decisions, setDecisions] = useState<Record<PartyRole, PartyResolutionDecision>>(
    {} as Record<PartyRole, PartyResolutionDecision>,
  );
  const [result, setResult] = useState<CommitResult | null>(null);
  const [committing, setCommitting] = useState(false);

  const choose = useCallback(
    (extraction: RateConfirmationExtraction) => {
      if (!ctx) return;
      setSelected(extraction);
      setPlan(null);
      setResult(null);
      setDecisions({} as Record<PartyRole, PartyResolutionDecision>);
      setPlanning(true);
      setDenied(false);
      planResolution(ctx, extraction)
        .then((next) => {
          setPlan(next);
          // Seed the decisions with the recommendation ONLY where the resolver
          // was willing to make one. "choose_between" stays empty on purpose.
          const seeded: Record<string, PartyResolutionDecision> = {};
          for (const p of next.proposals) {
            if (p.recommendation === "link_existing" && p.recommendedPartyId) {
              seeded[p.role] = {
                role: p.role,
                choice: "link",
                partyId: p.recommendedPartyId,
                facilityId: p.facility?.recommendedFacilityId,
                contactIds: p.contacts
                  .map((c) => c.recommendedContactId)
                  .filter(Boolean) as string[],
                applyExtractedUpdates: true,
              };
            } else if (p.recommendation === "create_new" || p.recommendation === "create_provisional") {
              seeded[p.role] = { role: p.role, choice: "create", applyExtractedUpdates: true };
            }
          }
          setDecisions(seeded as Record<PartyRole, PartyResolutionDecision>);
        })
        .catch(() => setDenied(true))
        .finally(() => setPlanning(false));
    },
    [ctx],
  );

  const commit = async () => {
    if (!ctx || !plan || committing) return;
    setCommitting(true);
    try {
      const confirmation: ConfirmedResolution = {
        planId: plan.planId,
        documentId: plan.documentId,
        loadId: plan.loadId,
        decisions: Object.values(decisions),
        confirmedBy: {
          userId: user.id,
          membershipId: membership?.id ?? "",
          displayNameSnapshot: user.displayName,
          source: "web",
        },
        confirmedAt: new Date().toISOString(),
      };
      setResult(await commitResolution(ctx, plan, confirmation));
    } finally {
      setCommitting(false);
    }
  };

  if (denied) {
    return (
      <EmptyState
        icon={ScanLine}
        title="You cannot confirm customer matches"
        description="This needs the “Confirm customer matches” permission in this organization."
      />
    );
  }

  const undecided = plan
    ? plan.proposals.filter((p) => !decisions[p.role]).map((p) => p.role)
    : [];

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/directory"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Directory
        </Link>
      </div>

      <PageHeader
        title="Review a rate confirmation"
        description="Decide which permanent profiles the companies on this rate confirmation are. Nothing is created or linked until you confirm it."
      />

      <section className="rounded-lg border border-st-info/35 bg-st-info-bg/40 p-4">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
          <CircleAlert className="size-4 text-st-info" aria-hidden />
          Reading the document is not built yet
        </h2>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          The four below are reviewed extractions standing in for that workflow — as if a
          dispatcher had already read the PDF and corrected the fields. Everything after this
          point is real: the matching, the profiles it finds, and what confirming actually writes.
        </p>
      </section>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {MOCK_EXTRACTIONS.map((extraction) => {
          const label = MOCK_EXTRACTION_LABELS[extraction.documentId];
          const active = selected?.documentId === extraction.documentId;
          return (
            <button
              key={extraction.documentId}
              type="button"
              onClick={() => choose(extraction)}
              aria-pressed={active}
              className={cn(
                "rounded-lg border bg-surface p-4 text-left shadow-e1 transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active
                  ? "border-primary ring-2 ring-ring/25"
                  : "border-border hover:border-border-strong hover:bg-surface-hover",
              )}
            >
              <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
                <FileText className="size-4 text-fg-subtle" aria-hidden />
                {label?.title ?? extraction.documentId}
              </p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{label?.blurb}</p>
              <p className="mt-2 font-mono text-[0.6875rem] text-fg-subtle">
                {extraction.customerReference} · reviewed {formatDate(extraction.reviewedAt)}
              </p>
            </button>
          );
        })}
      </div>

      {planning ? <LoadingSkeleton rows={4} /> : null}

      {plan && !result ? (
        <>
          <div className="space-y-4">
            {plan.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.role}
                proposal={proposal}
                decision={decisions[proposal.role]}
                onDecide={(next) =>
                  setDecisions((current) => ({ ...current, [proposal.role]: next }))
                }
              />
            ))}
          </div>

          <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <h2 className="text-[0.9375rem] font-semibold text-fg">Confirm</h2>
            {undecided.length > 0 ? (
              <p className="mt-1 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-st-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Still to decide: {undecided.map((r) => PARTY_ROLE_LABEL[r].toLowerCase()).join(", ")}.
                  Anything you leave undecided is left alone — no profile is invented for it.
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                Every company on this rate confirmation has a decision. Confirming links or creates
                the profiles, records this document as the source, and freezes a copy of what it
                said against the load.
              </p>
            )}
            <Button
              variant="primary"
              className="mt-3"
              onClick={commit}
              disabled={committing || Object.keys(decisions).length === 0}
            >
              {committing ? "Confirming…" : "Confirm and link"}
            </Button>
          </section>
        </>
      ) : null}

      {result ? <CommitSummary result={result} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ProposalCard({
  proposal,
  decision,
  onDecide,
}: {
  proposal: ResolutionPlan["proposals"][number];
  decision?: PartyResolutionDecision;
  onDecide: (decision: PartyResolutionDecision) => void;
}) {
  const uid = useId();
  const extracted = proposal.extracted.party;

  const pickExisting = (partyId: string) =>
    onDecide({
      role: proposal.role,
      choice: "link",
      partyId,
      facilityId:
        partyId === proposal.recommendedPartyId ? proposal.facility?.recommendedFacilityId : undefined,
      contactIds:
        partyId === proposal.recommendedPartyId
          ? (proposal.contacts.map((c) => c.recommendedContactId).filter(Boolean) as string[])
          : [],
      applyExtractedUpdates: true,
    });

  const pickNew = () =>
    onDecide({ role: proposal.role, choice: "create", applyExtractedUpdates: true });

  return (
    <section className="rounded-lg border border-border bg-surface shadow-e1">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-fg">
            <RoleChip role={proposal.role} />
            {extracted.name}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {PARTY_ROLE_DESCRIPTION[proposal.role]}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[0.75rem] font-medium",
            proposal.recommendation === "link_existing"
              ? "bg-st-info-bg text-st-info"
              : proposal.recommendation === "choose_between"
                ? "bg-st-warning-bg text-st-warning"
                : proposal.recommendation === "create_provisional"
                  ? "bg-st-warning-bg text-st-warning"
                  : "bg-st-progress-bg text-st-progress",
          )}
        >
          {RECOMMENDATION_LABEL[proposal.recommendation]}
        </span>
      </header>

      <div className="px-5 py-4">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">{proposal.rationale}</p>

        <div className="mt-4 rounded-md bg-surface-sunken p-3">
          <p className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-fg-muted">
            <FileText className="size-3.5" aria-hidden />
            What the rate confirmation says
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Field label="Name" value={extracted.name} />
            <Field label="MC" value={extracted.mcNumber ?? "Not printed"} />
            <Field label="USDOT" value={extracted.dotNumber ?? "Not printed"} />
            <Field label="Phone" value={formatPhone(extracted.phone)} />
            {extracted.address ? (
              <Field label="Address" value={formatAddress(extracted.address)} />
            ) : null}
            {proposal.extracted.facility ? (
              <Field
                label="Location"
                value={[
                  proposal.extracted.facility.name,
                  formatAddress(proposal.extracted.facility.address),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ) : null}
            {proposal.extracted.contacts.map((c) => (
              <Field
                key={c.fullName}
                label="Contact"
                value={[c.fullName, formatPhone(c.phone, c.phoneExtension), c.email]
                  .filter((v) => v && v !== "—")
                  .join(" · ")}
              />
            ))}
          </dl>
        </div>

        <fieldset className="mt-4">
          <legend className="text-[0.8125rem] font-semibold text-fg">
            Which profile is this?
          </legend>

          <div className="mt-2.5 space-y-2">
            {proposal.candidates.map((candidate) => {
              const chosen = decision?.choice === "link" && decision.partyId === candidate.partyId;
              return (
                <label
                  key={candidate.partyId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    chosen
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border-strong hover:bg-surface-hover",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-${proposal.role}`}
                    checked={chosen}
                    onChange={() => pickExisting(candidate.partyId)}
                    className="mt-1 size-4 accent-[var(--color-primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.875rem] font-medium text-fg">
                        {candidate.legalName}
                      </span>
                      <ConfidenceChip confidence={candidate.confidence} />
                      <PartyStatusChip status={candidate.status} />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-muted">
                      {candidate.mcNumber ? (
                        <span className="font-mono">{formatMcNumber(candidate.mcNumber)}</span>
                      ) : (
                        <span>No MC number</span>
                      )}
                      <span>{formatCityState(candidate)}</span>
                      <span className="tabular-nums">
                        {candidate.loadCount === 0
                          ? "No loads with them"
                          : `${candidate.loadCount} ${candidate.loadCount === 1 ? "load" : "loads"} with them`}
                      </span>
                    </span>

                    {/* Why it matched. A match nobody can see the reasoning for
                        is a match nobody can sensibly confirm. */}
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {candidate.signals.map((s) => (
                        <span
                          key={s.code}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                            s.decisive
                              ? "bg-st-info-bg text-st-info"
                              : "bg-surface-sunken text-fg-muted",
                          )}
                        >
                          {s.label}
                        </span>
                      ))}
                      {candidate.conflicts.map((c) => (
                        <span
                          key={c.code}
                          className="rounded-full bg-st-danger-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-danger"
                        >
                          {c.label}
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
              );
            })}

            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                decision?.choice === "create"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border-strong hover:bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name={`${uid}-${proposal.role}`}
                checked={decision?.choice === "create"}
                onChange={pickNew}
                className="mt-1 size-4 accent-[var(--color-primary)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Sparkles className="size-3.5 text-fg-subtle" aria-hidden />
                  <span className="text-[0.875rem] font-medium text-fg">
                    None of these — create a new profile
                  </span>
                </span>
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">
                  {proposal.reviewReason
                    ? `It will be created and flagged for review: ${proposal.reviewReason.toLowerCase()}.`
                    : "A permanent profile with its own id, created from this rate confirmation."}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {proposal.facility ? (
          <div className="mt-4 rounded-md border border-border p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
              <MapPin className="size-3.5 text-fg-subtle" aria-hidden />
              The location
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {proposal.facility.rationale}
            </p>
            {proposal.facility.candidates.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {proposal.facility.candidates.map((c) => (
                  <li key={c.facilityId} className="flex flex-wrap items-center gap-2 text-[0.75rem]">
                    <span className="font-medium text-fg">{c.name}</span>
                    <span className="text-fg-muted">{formatCityState(c)}</span>
                    <ConfidenceChip confidence={c.confidence} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {proposal.contacts.length > 0 ? (
          <div className="mt-3 rounded-md border border-border p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
              <UserRound className="size-3.5 text-fg-subtle" aria-hidden />
              The people
            </p>
            <ul className="mt-2 space-y-1.5">
              {proposal.contacts.map((c) => (
                <li key={c.extracted.fullName} className="text-[0.75rem]">
                  <span className="font-medium text-fg">{c.extracted.fullName}</span>
                  <span className="ml-2 text-fg-muted">
                    {c.candidates.length === 0
                      ? "New — nobody on file resembles them"
                      : `Matches ${c.candidates[0].fullName}`}
                  </span>
                  {c.candidates.length > 0 ? (
                    <ConfidenceChip className="ml-2" confidence={c.candidates[0].confidence} />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CommitSummary({ result }: { result: CommitResult }) {
  return (
    <section className="rounded-lg border border-st-success/35 bg-st-success-bg/30 p-4">
      <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-fg">
        <Check className="size-4 text-st-success" aria-hidden />
        Done
      </h2>
      <ul className="mt-3 space-y-2">
        {result.outcomes.map((o) => (
          <li
            key={`${o.role}-${o.partyId}`}
            className="rounded-md border border-border bg-surface p-3"
          >
            <p className="flex flex-wrap items-center gap-2">
              <RoleChip role={o.role} />
              <Link
                href={`/directory/${o.partyId}`}
                className="text-[0.875rem] font-medium text-fg underline-offset-4 hover:underline"
              >
                {o.summary}
              </Link>
              <PartyStatusChip status={o.partyStatus} />
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-muted">
              {o.createdFacility ? <span>New location added</span> : null}
              {o.createdContactIds.length > 0 ? (
                <span>
                  {o.createdContactIds.length} new{" "}
                  {o.createdContactIds.length === 1 ? "contact" : "contacts"}
                </span>
              ) : null}
              {o.loadLinkId ? <span>Linked to the load with a frozen snapshot</span> : null}
            </p>
          </li>
        ))}
      </ul>

      {result.needsReview.length > 0 ? (
        <div className="mt-3 rounded-md border border-st-warning/35 bg-st-warning-bg/40 p-3">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
            <TriangleAlert className="size-3.5 text-st-warning" aria-hidden />
            Left for somebody to check
          </p>
          <ul className="mt-1.5 space-y-1">
            {result.needsReview.map((n, i) => (
              <li key={i} className="text-[0.75rem] leading-relaxed text-fg-muted">
                {n.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button variant="secondary" className="mt-4" asChild>
        <Link href="/directory">
          <Building2 aria-hidden />
          Back to the directory
        </Link>
      </Button>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-[0.75rem] text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-[0.75rem] text-fg">{value}</dd>
    </div>
  );
}

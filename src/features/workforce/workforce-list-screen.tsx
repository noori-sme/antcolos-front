"use client";

import { UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCan } from "@/lib/session/hooks";
import {
  RESPONSIBILITY_FUNCTION_LABEL, WORKFORCE_AVAILABILITY_LABEL,
  type WorkforceFilters,
} from "@/types";
import { ClassificationChip, EngagementStateChip } from "./chips";
import { CreateEngagementDialog } from "./create-engagement-dialog";
import { useCreateEngagement, useWorkforceList } from "./hooks";

export interface AmbiguousCandidate {
  engagementId: string;
  label: string;
  detail: string;
}

/**
 * The refusal-to-guess, recognised WITHOUT importing the mock's error class.
 *
 * A screen that did `instanceof` against `@/lib/api/mock` would work against
 * the browser adapter and silently stop working against the HTTP one, which
 * throws its own type over the wire. The service contract is the shape, so the
 * shape is what this reads.
 */
function ambiguousCandidatesOf(error: unknown): AmbiguousCandidate[] | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { name?: unknown; candidates?: unknown };
  if (candidate.name !== "AmbiguousPersonError") return undefined;
  if (!Array.isArray(candidate.candidates) || candidate.candidates.length === 0) return undefined;
  return candidate.candidates as AmbiguousCandidate[];
}

/**
 * One organization's workforce.
 *
 * Deliberately a LIST, not a dashboard. Home stays personal — an
 * organization-wide HR panel there would push somebody's own work below a
 * headcount they cannot act on — and this is the place a person goes when they
 * are actually thinking about the workforce.
 *
 * What it shows is the engagement and nothing else: on what basis, in what
 * capacity, from when, in what status. No permissions, no pay, no documents.
 * All four of those live one click away in the module that owns them.
 */
export function WorkforceListScreen() {
  const [search, setSearch] = useState("");
  const [includeEnded, setIncludeEnded] = useState(false);
  const [onLeaveOnly, setOnLeaveOnly] = useState(false);
  const filters: WorkforceFilters = {
    search: search.trim() || undefined,
    includeEnded,
    onLeaveOnly: onLeaveOnly || undefined,
  };
  const list = useWorkforceList(filters);

  const canManage = useCan("workforce:manage");
  const create = useCreateEngagement();
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [ambiguous, setAmbiguous] = useState<AmbiguousCandidate[] | undefined>();

  return (
    <div className="space-y-section">
      <PageHeader
        title="Workforce"
        description="Who works with this organization, on what basis and from when. Permissions live in Access; pay lives in Settlements and Accounting."
        actions={canManage ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            data-testid="record-engagement"
            onClick={() => {
              setCreateError(undefined);
              setCreateOpen(true);
            }}
          >
            Record somebody
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or position"
          aria-label="Search the workforce"
          className="max-w-xs"
        />
        <Button
          type="button"
          variant={includeEnded ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={includeEnded}
          onClick={() => setIncludeEnded((v) => !v)}
        >
          {includeEnded ? "Hiding nothing" : "Show ended engagements"}
        </Button>
        <Button
          type="button"
          variant={onLeaveOnly ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={onLeaveOnly}
          data-testid="filter-on-leave"
          onClick={() => setOnLeaveOnly((v) => !v)}
        >
          {onLeaveOnly ? "Showing only who is away" : "Who is away"}
        </Button>
      </div>

      {list.isPending ? <LoadingSkeleton /> : null}
      {list.isError ? (
        <ErrorState
          title="The workforce could not be loaded"
          description={list.error instanceof Error ? list.error.message : undefined}
          onRetry={() => void list.refetch()}
        />
      ) : null}

      {list.data && list.data.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Nobody is recorded here yet"
          description="An engagement says on what basis somebody works with this organization. It is separate from their account, their access and their driver record."
        />
      ) : null}

      {list.data && list.data.length > 0 ? (
        <ul className="space-y-3" data-testid="workforce-list">
          {list.data.map((row) => {
            const {
              engagement, hasActiveMembership, incompleteOffboarding,
              availability, openNeedsYouCount, nextAction,
            } = row;
            return (
              <li key={engagement.id}>
                <Link
                  href={`/workforce/${engagement.id}`}
                  data-engagement-id={engagement.id}
                  data-availability={availability.state}
                  data-needs-you={openNeedsYouCount}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-semibold text-fg">
                        {engagement.person.displayName}
                      </span>
                      <EngagementStateChip state={engagement.state} />
                      <ClassificationChip value={engagement.classification} />
                      {/* Availability is its own chip, never folded into the
                          state: "away until the 14th" and "we stood them down"
                          are different facts and must read differently. */}
                      {availability.state !== "working" && availability.state !== "not_engaged" ? (
                        <Badge tone={availability.availableForWork ? "info" : "warning"}>
                          {WORKFORCE_AVAILABILITY_LABEL[availability.state]}
                        </Badge>
                      ) : null}
                      {incompleteOffboarding.length > 0 ? (
                        <Badge tone="danger">Offboarding unfinished</Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                      {engagement.positionTitle}
                      {engagement.startDate ? ` · since ${engagement.startDate.slice(0, 10)}` : ""}
                      {engagement.managerName ? ` · reports to ${engagement.managerName}` : ""}
                    </p>
                    {engagement.functions.length > 0 ? (
                      <p className="mt-0.5 text-[0.75rem] text-fg-subtle" data-testid="row-functions">
                        {engagement.functions
                          .map((f) => RESPONSIBILITY_FUNCTION_LABEL[f.functionKey])
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-1 text-[0.75rem] text-fg-subtle sm:items-end">
                    {/* Said on the row, because it is the assumption people bring
                        to an HR list: that everybody in it can sign in. */}
                    <span>{hasActiveMembership ? "Has Antcolos access" : "No Antcolos access"}</span>
                    {/* A COUNT of what Needs You already holds, so a row can say
                        something is waiting without unfolding it here. */}
                    {openNeedsYouCount > 0 ? (
                      <Badge tone="warning">
                        {openNeedsYouCount} waiting
                      </Badge>
                    ) : null}
                    {nextAction ? (
                      <span className="max-w-[16rem] text-right text-fg-muted">
                        {nextAction.label}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <CreateEngagementDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) { setCreateError(undefined); setAmbiguous(undefined); }
        }}
        pending={create.isPending}
        error={createError}
        ambiguous={ambiguous}
        onSubmit={(input) => {
          setCreateError(undefined);
          setAmbiguous(undefined);
          create.mutate(input, {
            onSuccess: () => setCreateOpen(false),
            // Surfaced rather than swallowed. The two refusals say different
            // things and the dialog has to keep them apart: a duplicate is
            // Antcolos knowing, and an ambiguity is Antcolos refusing to guess
            // — which needs the candidates on screen, not a red sentence.
            onError: (e) => {
              const candidates = ambiguousCandidatesOf(e);
              if (candidates) {
                setAmbiguous(candidates);
                return;
              }
              setCreateError(e instanceof Error ? e.message : "That did not work.");
            },
          });
        }}
      />

      <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        An engagement is not access and not a driver record. Ending one here never deletes a
        person&rsquo;s profile, their documents, their loads, their settlements or their history —
        and never changes anybody&rsquo;s permissions, which are granted only through Access.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, GitBranch, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { AUDIT_MODULE_LABEL, auditActionLabel } from "@/lib/audit/actions";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import { useAuditEvent } from "./use-audit";
import { AppendOnlyMark, OutcomeBadge, SourceBadge } from "./chips";
import { AuditEventRow } from "./event-row";
import { changeValue, formatDateTime } from "./format";
import { CorrectionForm } from "./correction-form";

/**
 * One event, with everything that lets somebody answer for it: what moved, what
 * was withheld and why, where it came from, what else the same intent produced,
 * and every correction appended against it.
 */
export function AuditEventDetailScreen({ eventId }: { eventId: string }) {
  const detail = useAuditEvent(eventId);
  const { organization } = useActiveMembership();
  const canCorrect = useCan("audit:view");
  const [correcting, setCorrecting] = useState(false);
  const timeZone = organization?.timeZone ?? "UTC";

  if (detail.isLoading) return <LoadingSkeleton rows={6} />;
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        title="No such event here"
        description="It does not exist, or it belongs to another organization. Either way this organization has no record of it."
      />
    );
  }

  const { event, corrections, corrected, correlated } = detail.data;
  const changes = event.changes?.changes ?? [];

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/audit/events"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All audit events
        </Link>
      </div>

      <PageHeader
        title={event.summary}
        description={`${AUDIT_MODULE_LABEL[event.module]} · ${auditActionLabel(event.action)}`}
        actions={
          canCorrect ? (
            <Button variant="secondary" size="sm" onClick={() => setCorrecting((v) => !v)}>
              <GitBranch aria-hidden />
              {correcting ? "Cancel" : "Append a correction"}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={event.source} />
        <OutcomeBadge outcome={event.outcome} />
        <AppendOnlyMark />
      </div>

      {correcting ? (
        <CorrectionForm eventId={event.id} onDone={() => setCorrecting(false)} />
      ) : null}

      <section
        aria-labelledby="event-facts"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="event-facts" className="text-[0.875rem] font-semibold text-fg">
          The record
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label="Who">
            {event.actor.displayNameSnapshot}
            <span className="block text-[0.75rem] text-fg-subtle">
              Membership {event.membershipId}
            </span>
          </Fact>
          <Fact label="About">
            {event.entity.href ? (
              <Link href={event.entity.href} className="text-primary hover:underline">
                {event.entity.label}
              </Link>
            ) : (
              event.entity.label
            )}
            <span className="block text-[0.75rem] text-fg-subtle">{event.entity.id}</span>
          </Fact>
          <Fact label="When it happened">{formatDateTime(event.occurredAt, timeZone)}</Fact>
          <Fact label="When Antcolos recorded it">
            {formatDateTime(event.recordedAt, timeZone)}
          </Fact>
          <Fact label="Correlation id">
            <code className="text-[0.75rem]">{event.correlationId}</code>
          </Fact>
          <Fact label="Request id">
            <code className="text-[0.75rem]">{event.requestId}</code>
          </Fact>
          {event.projection ? (
            <Fact label="Projected from">
              {AUDIT_MODULE_LABEL[event.projection.module]}
              <span className="block text-[0.75rem] text-fg-subtle">
                That module&rsquo;s record {event.projection.recordId} — it stays the authority
                on what this says.
              </span>
            </Fact>
          ) : null}
          {event.permissionContext ? (
            <Fact label="Permissions">
              Needed: {event.permissionContext.required.join(", ")}
              {event.permissionContext.missing?.length ? (
                <span className="block text-[0.75rem] text-st-danger">
                  Missing: {event.permissionContext.missing.join(", ")}
                </span>
              ) : null}
            </Fact>
          ) : null}
        </dl>
      </section>

      <section
        aria-labelledby="event-changes"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="event-changes" className="text-[0.875rem] font-semibold text-fg">
            What changed
          </h2>
          {event.changes?.redactedCount ? (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              <Lock aria-hidden className="size-3" />
              {event.changes.redactedCount} withheld
            </span>
          ) : null}
        </div>
        {changes.length === 0 ? (
          <p className="mt-2 text-[0.8125rem] text-fg-muted">
            This event records that something happened, not that a field moved.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {changes.map((change) => (
              <li
                key={change.field}
                className={cn(
                  "rounded-md border px-3.5 py-2.5",
                  change.redacted
                    ? "border-dashed border-border-strong bg-surface-sunken"
                    : "border-border",
                )}
              >
                <p className="text-[0.8125rem] font-medium text-fg">{change.label}</p>
                {change.redacted ? (
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                    Withheld at the service boundary
                    {change.redactionReason === "sensitive_field"
                      ? " — this field is on the never-recorded list. The values were not stored, hashed or shortened; they were never written down."
                      : change.redactionReason === "too_long"
                        ? " — the value was too long for an audit summary to carry, so it was dropped rather than truncated."
                        : " — audit payloads carry plain values only, and this was not one."}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                    {changeValue(change.before)}
                    <ArrowRight aria-hidden className="mx-1.5 inline size-3.5 align-[-2px]" />
                    {changeValue(change.after)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {corrected ? (
        <RelatedList
          id="event-corrected"
          title="This event corrects"
          description="The original is untouched and stays on the record."
          items={[corrected]}
          timeZone={timeZone}
        />
      ) : null}

      {corrections.length ? (
        <RelatedList
          id="event-corrections"
          title="Corrections appended against this"
          description="A mistake is corrected by adding an event, never by editing this one."
          items={corrections}
          timeZone={timeZone}
        />
      ) : null}

      {correlated.length ? (
        <RelatedList
          id="event-correlated"
          title="Everything else the same action produced"
          description="Joined by the correlation id, so one intent reads back as one act across modules."
          items={correlated}
          timeZone={timeZone}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[0.8125rem] text-fg">{children}</dd>
    </div>
  );
}

function RelatedList({
  id, title, description, items, timeZone,
}: {
  id: string;
  title: string;
  description: string;
  items: readonly React.ComponentProps<typeof AuditEventRow>["event"][];
  timeZone: string;
}) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div>
        <h2 id={id} className="text-[0.875rem] font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p>
      </div>
      <ol className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <AuditEventRow
              event={item}
              timeZone={timeZone}
              href={`/audit/events/${item.id}`}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

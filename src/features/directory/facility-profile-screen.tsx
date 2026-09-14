"use client";

import { ArrowLeft, MapPin, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { addNote, getFacilityProfile } from "@/lib/api/mock/party-registry";
import { useCan } from "@/lib/session/hooks";
import type { FacilityProfileView, Load } from "@/types";
import { cn } from "@/lib/utils";
import { PartyStatusChip, RoleChip } from "./directory-chips";
import {
  CONTACT_KIND_LABEL, formatAddress, formatDate, formatPhone,
} from "./directory-labels";
import { HistoryList, LoadHistory, NoteList, Panel, Row } from "./party-profile-screen";
import { usePartyContext } from "./use-party-context";

/**
 * One dock.
 *
 * A location gets its own screen because it is where the operational knowledge
 * actually lives — which door, whose appointment, how long they hold a truck.
 * Putting that on the company would lose it: a grocery chain's Columbus DC and
 * its Joliet plant have nothing in common except an owner.
 */

const TABS = [
  ["overview", "Overview"],
  ["contacts", "Contacts"],
  ["loads", "Loads"],
  ["private", "Your notes"],
  ["history", "History"],
] as const;

type Tab = (typeof TABS)[number][0];

export function FacilityProfileScreen({ facilityId }: { facilityId: string }) {
  const ctx = usePartyContext();
  const serviceCtx = useServiceContext();
  const canManagePrivate = useCan("customers:private:manage");

  const [view, setView] = useState<FacilityProfileView | null | "denied">(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loads, setLoads] = useState<Record<string, Load>>({});

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    getFacilityProfile(ctx, facilityId)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch(() => {
        if (!cancelled) setView("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, facilityId]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!serviceCtx || view === null || view === "denied" || view.loadLinks.length === 0) return;
    let cancelled = false;
    services.loads
      .list(serviceCtx, {}, undefined, { limit: 200 })
      .then((page) => {
        if (!cancelled) setLoads(Object.fromEntries(page.items.map((l) => [l.id, l])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serviceCtx, view]);

  if (view === null) return <LoadingSkeleton rows={5} />;

  if (view === "denied") {
    return (
      <EmptyState
        icon={MapPin}
        title="Location not found"
        description="This location does not exist, or your organization has no relationship with the company that runs it."
        action={
          <Button variant="secondary" asChild>
            <Link href="/directory">Back to the directory</Link>
          </Button>
        }
      />
    );
  }

  const { facility, party, contacts, notes, loadLinks, history } = view;

  return (
    <div className="space-y-section">
      <div>
        <Link
          href={`/directory/${party.partyId}`}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {party.legalName}
        </Link>
      </div>

      <PageHeader title={facility.name} description={formatAddress(facility.address)} />

      <div className="flex flex-wrap items-center gap-2">
        {facility.functions.map((f) => (
          <span key={f} className={PILL}>
            {f === "pickup" ? "Pickup" : "Delivery"}
          </span>
        ))}
        <PartyStatusChip status={facility.status} />
        {party.roles.map((r) => (
          <RoleChip key={r} role={r} />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Location sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(TAB_BUTTON, tab === id ? TAB_ON : TAB_OFF)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="The place">
            <Row label="Antcolos id" value={facility.facilityId} mono />
            <Row label="Company" value={party.legalName} />
            <Row label="Address" value={formatAddress(facility.address)} />
            <Row label="Time zone" value={facility.timeZone ?? "Not recorded"} />
          </Panel>

          <Panel title="Getting in">
            <Row label="Hours" value={facility.hoursText ?? "Not recorded"} />
            <Row
              label="Appointment"
              value={
                facility.appointmentRequired === undefined
                  ? "Not recorded"
                  : facility.appointmentRequired
                    ? "Required"
                    : "Not required"
              }
            />
            {facility.instructions ? (
              <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg">
                {facility.instructions}
              </p>
            ) : null}
          </Panel>

          <Panel title="Where this came from">
            <Row
              label="Source"
              value={
                facility.provenance.kind === "rate_confirmation"
                  ? "A rate confirmation"
                  : facility.provenance.kind.replace(/_/g, " ")
              }
            />
            {facility.provenance.documentId ? (
              <Row label="Document" value={facility.provenance.documentId} mono />
            ) : null}
            <Row label="First recorded" value={formatDate(facility.createdAt)} />
            <Row label="Last changed" value={formatDate(facility.updatedAt)} />
          </Panel>
        </div>
      ) : null}

      {tab === "contacts" ? (
        contacts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="Nobody recorded here yet"
            description="Dock contacts are added as rate confirmations name them."
          />
        ) : (
          <ul className="space-y-2.5">
            {contacts.map((c) => (
              <li key={c.contactId}>
                <Link href={`/directory/contacts/${c.contactId}`} className={ROW}>
                  <span aria-hidden className={ROW_ICON}>
                    <UserRound className="size-[1.125rem]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-semibold text-fg">{c.fullName}</span>
                      <span className={PILL}>{CONTACT_KIND_LABEL[c.kind]}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                      {c.title ? <span>{c.title}</span> : null}
                      {c.phone ? (
                        <span className="tabular-nums">{formatPhone(c.phone, c.phoneExtension)}</span>
                      ) : null}
                      {c.email ? <span className="break-all">{c.email}</span> : null}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "loads" ? <LoadHistory links={loadLinks} loads={loads} /> : null}

      {tab === "private" ? (
        <NoteList
          notes={notes}
          onAdd={
            canManagePrivate && ctx
              ? async (body, pinned) => {
                  await addNote(ctx, { facilityId }, body, pinned);
                  load();
                }
              : undefined
          }
        />
      ) : null}

      {tab === "history" ? <HistoryList history={history} /> : null}
    </div>
  );
}

const TAB_BUTTON = cn(
  "rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);
const TAB_ON = "border-primary bg-primary/10 text-primary";
const TAB_OFF = "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg";

const ROW = cn(
  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
  "hover:border-border-strong hover:bg-surface-hover",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);

const ROW_ICON =
  "flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted";

const PILL =
  "rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted";

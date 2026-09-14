"use client";

import { ArrowLeft, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { addNote, getContactProfile } from "@/lib/api/mock/party-registry";
import { useCan } from "@/lib/session/hooks";
import type { ContactProfileView, Load } from "@/types";
import { cn } from "@/lib/utils";
import { PartyStatusChip, RoleChip } from "./directory-chips";
import { CONTACT_KIND_LABEL, formatDate, formatPhone } from "./directory-labels";
import { HistoryList, LoadHistory, NoteList, Panel, Row } from "./party-profile-screen";
import { usePartyContext } from "./use-party-context";

/**
 * One person.
 *
 * Contacts are their own records because people move. The agent who booked
 * three loads last quarter may be at a different brokerage next quarter, and a
 * contact stored as a field on the company would take that history with them
 * or lose it entirely. Here, the loads they were named on stay attached to the
 * person, and the company keeps its own.
 */

const TABS = [
  ["overview", "Overview"],
  ["loads", "Loads"],
  ["private", "Your notes"],
  ["history", "History"],
] as const;

type Tab = (typeof TABS)[number][0];

export function ContactProfileScreen({ contactId }: { contactId: string }) {
  const ctx = usePartyContext();
  const serviceCtx = useServiceContext();
  const canManagePrivate = useCan("customers:private:manage");

  const [view, setView] = useState<ContactProfileView | null | "denied">(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loads, setLoads] = useState<Record<string, Load>>({});

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    getContactProfile(ctx, contactId)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch(() => {
        if (!cancelled) setView("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, contactId]);

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
        icon={UserRound}
        title="Contact not found"
        description="This contact does not exist, or your organization has no relationship with the company they work for."
        action={
          <Button variant="secondary" asChild>
            <Link href="/directory">Back to the directory</Link>
          </Button>
        }
      />
    );
  }

  const { contact, party, facility, notes, loadLinks, history } = view;

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

      <PageHeader
        title={contact.fullName}
        description={[contact.title, party.legalName, facility?.name].filter(Boolean).join(" · ")}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className={PILL}>{CONTACT_KIND_LABEL[contact.kind]}</span>
        <PartyStatusChip status={contact.status} />
        {party.roles.map((r) => (
          <RoleChip key={r} role={r} />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Contact sections">
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
          <Panel title="Reaching them">
            <Row label="Phone" value={formatPhone(contact.phone, contact.phoneExtension)} />
            <Row label="Mobile" value={formatPhone(contact.mobile)} />
            <Row label="Email" value={contact.email ?? "—"} />
          </Panel>

          <Panel title="Where they work">
            <Row label="Antcolos id" value={contact.contactId} mono />
            <Row label="Company" value={party.legalName} />
            <Row label="Location" value={facility?.name ?? "Not tied to one location"} />
            <Row label="Role" value={CONTACT_KIND_LABEL[contact.kind]} />
          </Panel>

          <Panel title="Where this came from">
            <Row
              label="Source"
              value={
                contact.provenance.kind === "rate_confirmation"
                  ? "A rate confirmation"
                  : contact.provenance.kind.replace(/_/g, " ")
              }
            />
            {contact.provenance.documentId ? (
              <Row label="Document" value={contact.provenance.documentId} mono />
            ) : null}
            <Row label="First recorded" value={formatDate(contact.createdAt)} />
            <Row label="Last changed" value={formatDate(contact.updatedAt)} />
          </Panel>
        </div>
      ) : null}

      {tab === "loads" ? <LoadHistory links={loadLinks} loads={loads} /> : null}

      {tab === "private" ? (
        <NoteList
          notes={notes}
          onAdd={
            canManagePrivate && ctx
              ? async (body, pinned) => {
                  await addNote(ctx, { contactId }, body, pinned);
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

const PILL =
  "rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted";

"use client";

import {
  ArrowLeft, Building2, ChevronRight, FileText, MapPin, Package, Pin, ScrollText,
  Bot, TriangleAlert, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { getPartyProfile, addNote, setStanding, setRating } from "@/lib/api/mock/party-registry";
import { useCan } from "@/lib/session/hooks";
import type { Load, PartyProfileView, PartyStanding } from "@/types";
import { isAutoIndexedUnclaimed } from "@/types";
import { AUTO_INDEXED_EXPLANATION } from "@/lib/directory/auto-broker";
import { laneLabel } from "@/types";
import { cn } from "@/lib/utils";
import {
  AutoIndexedChip, ClaimChip, PartyStatusChip, RatingStars, RoleChip, StandingChip,
  VerificationChip,
} from "./directory-chips";
import {
  CONTACT_KIND_LABEL, PARTY_STATUS_DESCRIPTION, STANDING_DESCRIPTION, STANDING_LABEL,
  VERIFICATION_DESCRIPTION, formatAddress, formatCityState, formatDate,
  formatDateTime, formatMcNumber, formatPhone,
  PROVENANCE_LABEL,
} from "./directory-labels";
import { usePartyContext } from "./use-party-context";

/**
 * One company's permanent profile.
 *
 * Two things on this screen are load-bearing beyond looking nice.
 *
 * The Loads tab reads the link rows from the directory and then asks the LOADS
 * service for each load. The directory never stores a load, so what you see
 * here is the live load record — and a load deleted or corrected elsewhere is
 * corrected here too, because there is no second copy to go stale.
 *
 * The snapshot next to each load is the opposite: frozen at the moment the load
 * was linked. When it disagrees with the profile above it, that is not a bug to
 * reconcile — it is the profile having been corrected since, and the load
 * keeping the address the driver was actually sent to.
 */

const TABS = [
  ["overview", "Overview"],
  ["locations", "Locations"],
  ["contacts", "Contacts"],
  ["loads", "Loads"],
  ["private", "Your notes"],
  ["history", "History"],
] as const;

type Tab = (typeof TABS)[number][0];

export function PartyProfileScreen({ partyId }: { partyId: string }) {
  const ctx = usePartyContext();
  const serviceCtx = useServiceContext();
  const canManagePrivate = useCan("customers:private:manage");

  const [view, setView] = useState<PartyProfileView | null | "denied">(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loads, setLoads] = useState<Record<string, Load>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    getPartyProfile(ctx, partyId)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch(() => {
        if (!cancelled) setView("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, partyId]);

  useEffect(() => load(), [load]);

  // The loads themselves come from the loads service, never from the directory.
  useEffect(() => {
    if (!serviceCtx || view === null || view === "denied" || view.loadLinks.length === 0) return;
    let cancelled = false;
    services.loads
      .list(serviceCtx, {}, undefined, { limit: 200 })
      .then((page) => {
        if (cancelled) return;
        setLoads(Object.fromEntries(page.items.map((l) => [l.id, l])));
      })
      .catch(() => {
        // A membership without loads:view simply sees no lanes. The link rows
        // still render, because the directory relationship is not a load.
      });
    return () => {
      cancelled = true;
    };
  }, [serviceCtx, view]);

  if (view === null) return <LoadingSkeleton rows={6} />;

  if (view === "denied") {
    return (
      <EmptyState
        icon={Building2}
        title="Company not found"
        description="This company does not exist, or your organization has no relationship with it. Those look the same from here on purpose."
        action={
          <Button variant="secondary" asChild>
            <Link href="/directory">Back to the directory</Link>
          </Button>
        }
      />
    );
  }

  const { party, facilities, contacts, relationship, notes, loadLinks, history } = view;

  const onStanding = async (next: PartyStanding) => {
    if (!ctx || busy) return;
    setBusy(true);
    try {
      await setStanding(ctx, partyId, next);
      load();
    } finally {
      setBusy(false);
    }
  };

  const onRating = async (next: number) => {
    if (!ctx || busy) return;
    setBusy(true);
    try {
      await setRating(ctx, partyId, relationship.rating === next ? undefined : next);
      load();
    } finally {
      setBusy(false);
    }
  };

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
        title={party.legalName}
        description={
          party.dbaName && party.dbaName !== party.legalName
            ? `Trading as ${party.dbaName}`
            : formatCityState(party.primaryAddress)
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {party.roles.map((r) => (
          <RoleChip key={r} role={r} />
        ))}
        {isAutoIndexedUnclaimed(party)
          ? <AutoIndexedChip />
          : <PartyStatusChip status={party.status} />}
        <VerificationChip state={party.verification.state} />
        {/*
          Always shown here, even when unclaimed. On a profile — unlike a list
          row — "nobody from this company has an account" is exactly what
          somebody about to trust the page needs told.
        */}
        <ClaimChip state={party.claim.state} showUnclaimed />
        <StandingChip standing={relationship.standing} showStandard />
      </div>

      {/*
        An auto-indexed profile gets its own banner rather than the generic
        provisional one. "Waiting to be checked" is true of both, but it does
        not say the thing that actually matters here: no person has ever looked
        at this record, and the company it describes does not know it exists.
      */}
      {isAutoIndexedUnclaimed(party) ? (
        <section className="rounded-lg border border-st-warning/35 bg-st-warning-bg/40 p-4">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <Bot className="size-4 text-st-warning" aria-hidden />
            Antcolos built this profile from a rate confirmation
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            {AUTO_INDEXED_EXPLANATION}
          </p>
          <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            <li>
              <span className="font-medium text-fg">The MC number is what it was indexed on.</span>{" "}
              It came off the broker&apos;s own paperwork and has not been checked against FMCSA.
            </li>
            <li>
              <span className="font-medium text-fg">Everything else is unconfirmed.</span>{" "}
              The address, phone and email are whatever the document printed.
            </li>
            <li>
              <span className="font-medium text-fg">Nothing here is a recommendation.</span>{" "}
              Antcolos has indexed this brokerage&apos;s activity; it has not vouched for them.
            </li>
          </ul>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
            Confirming it in Directory → Review is what turns it into a checked profile.
          </p>
        </section>
      ) : party.status === "provisional" ? (
        <section className="rounded-lg border border-st-warning/35 bg-st-warning-bg/40 p-4">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <TriangleAlert className="size-4 text-st-warning" aria-hidden />
            This profile is waiting to be checked
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            {party.reviewReason ?? PARTY_STATUS_DESCRIPTION.provisional}
          </p>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
            {PARTY_STATUS_DESCRIPTION.provisional}
          </p>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Company sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              tab === id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {label}
            {id === "locations" && facilities.length > 0 ? (
              <span className="ml-1.5 tabular-nums opacity-70">{facilities.length}</span>
            ) : null}
            {id === "contacts" && contacts.length > 0 ? (
              <span className="ml-1.5 tabular-nums opacity-70">{contacts.length}</span>
            ) : null}
            {id === "loads" && loadLinks.length > 0 ? (
              <span className="ml-1.5 tabular-nums opacity-70">{loadLinks.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Identity">
            <Row label="Antcolos id" value={party.partyId} mono />
            <Row label="Legal name" value={party.legalName} />
            {party.dbaName ? <Row label="Trading as" value={party.dbaName} /> : null}
            <Row
              label="MC number"
              value={formatMcNumber(party.identifiers.mcNumber) ?? "Not on file"}
              mono={Boolean(party.identifiers.mcNumber)}
            />
            <Row
              label="USDOT"
              value={party.identifiers.dotNumber ?? "Not on file"}
              mono={Boolean(party.identifiers.dotNumber)}
            />
            {party.identifiers.asPrinted?.mcNumber ? (
              <Row label="As printed" value={party.identifiers.asPrinted.mcNumber} mono />
            ) : null}
          </Panel>

          <Panel title="Reaching them">
            <Row label="Address" value={formatAddress(party.primaryAddress)} />
            <Row label="Phone" value={formatPhone(party.phone)} />
            <Row label="Email" value={party.email ?? "—"} />
            <Row label="Website" value={party.website ?? "—"} />
          </Panel>

          <Panel title="Where this came from">
            <Row label="Source" value={PROVENANCE_LABEL[party.provenance.kind]} />
            {party.provenance.documentId ? (
              <Row label="Document" value={party.provenance.documentId} mono />
            ) : null}
            <Row label="First recorded" value={formatDate(party.createdAt)} />
            <Row label="Last changed" value={formatDate(party.updatedAt)} />
            <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-muted">
              {VERIFICATION_DESCRIPTION[party.verification.state]}
            </p>
          </Panel>

          <Panel title="Your history with them">
            <Row
              label="Loads"
              value={
                relationship.loadCount === 0
                  ? "None yet"
                  : `${relationship.loadCount} ${relationship.loadCount === 1 ? "load" : "loads"}`
              }
            />
            <Row label="First load" value={formatDate(relationship.firstLoadAt)} />
            <Row label="Last load" value={formatDate(relationship.lastLoadAt)} />
            {relationship.paymentExperience?.averageDaysToPay ? (
              <Row
                label="Average days to pay"
                value={`${relationship.paymentExperience.averageDaysToPay} days`}
              />
            ) : null}
            {relationship.paymentExperience?.termsDays ? (
              <Row label="Terms" value={`Net ${relationship.paymentExperience.termsDays}`} />
            ) : null}
          </Panel>
        </div>
      ) : null}

      {tab === "locations" ? (
        facilities.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No locations yet"
            description="Locations are added as rate confirmations name the docks this company ships from or receives at."
          />
        ) : (
          <ul className="space-y-2.5">
            {facilities.map((f) => (
              <li key={f.facilityId}>
                <Link href={`/directory/locations/${f.facilityId}`} className={ROW}>
                  <span aria-hidden className={ROW_ICON}>
                    <MapPin className="size-[1.125rem]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-semibold text-fg">{f.name}</span>
                      {f.functions.map((fn) => (
                        <span key={fn} className={PILL}>
                          {fn === "pickup" ? "Pickup" : "Delivery"}
                        </span>
                      ))}
                      <PartyStatusChip status={f.status} />
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                      <span>{formatAddress(f.address)}</span>
                      {f.hoursText ? <span>{f.hoursText}</span> : null}
                      {f.appointmentRequired ? <span>Appointment required</span> : null}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "contacts" ? (
        contacts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="No contacts yet"
            description="People are added as rate confirmations name them."
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
                      <PartyStatusChip status={c.status} />
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                      {c.title ? <span>{c.title}</span> : null}
                      {c.phone ? (
                        <span className="tabular-nums">{formatPhone(c.phone, c.phoneExtension)}</span>
                      ) : null}
                      {c.email ? <span className="break-all">{c.email}</span> : null}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "loads" ? <LoadHistory links={loadLinks} loads={loads} /> : null}

      {tab === "private" ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <h2 className="text-[0.9375rem] font-semibold text-fg">Yours alone</h2>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              Everything on this tab belongs to your organization. No other carrier that works with
              this company can read your notes, your rating, your standing or what they pay you —
              and you cannot read theirs.
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Standing">
              <div className="flex flex-wrap gap-1.5">
                {(["preferred", "standard", "watch", "blocked"] as PartyStanding[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!canManagePrivate || busy}
                    aria-pressed={relationship.standing === s}
                    onClick={() => onStanding(s)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors disabled:opacity-50",
                      relationship.standing === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {STANDING_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
                {STANDING_DESCRIPTION[relationship.standing]}
              </p>
              {relationship.standingReason ? (
                <p className="mt-2 text-[0.8125rem] text-fg">{relationship.standingReason}</p>
              ) : null}
            </Panel>

            <Panel title="Your rating">
              <div className="flex items-center gap-3">
                <RatingStars rating={relationship.rating} />
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={!canManagePrivate || busy}
                      onClick={() => onRating(n)}
                      aria-label={`Rate ${n} out of 5`}
                      className="rounded border border-border px-2 py-0.5 text-[0.75rem] text-fg-muted hover:border-border-strong hover:text-fg disabled:opacity-50"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
                Your own score, never averaged with anybody else&apos;s.
              </p>
            </Panel>

            {relationship.paymentExperience ? (
              <Panel title="Payment experience">
                <Row
                  label="Terms"
                  value={
                    relationship.paymentExperience.termsDays
                      ? `Net ${relationship.paymentExperience.termsDays}`
                      : "—"
                  }
                />
                <Row
                  label="Average days to pay"
                  value={
                    relationship.paymentExperience.averageDaysToPay
                      ? `${relationship.paymentExperience.averageDaysToPay} days`
                      : "—"
                  }
                />
                <Row label="Last paid" value={formatDate(relationship.paymentExperience.lastPaidAt)} />
                <Row
                  label="Open invoices"
                  value={String(relationship.paymentExperience.openInvoiceCount ?? 0)}
                />
                <Row
                  label="Disputes"
                  value={String(relationship.paymentExperience.disputeCount ?? 0)}
                />
                {relationship.paymentExperience.notes ? (
                  <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg">
                    {relationship.paymentExperience.notes}
                  </p>
                ) : null}
              </Panel>
            ) : null}
          </div>

          <NoteList
            notes={notes}
            onAdd={
              canManagePrivate && ctx
                ? async (body, pinned) => {
                    await addNote(ctx, { partyId }, body, pinned);
                    load();
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      {tab === "history" ? <HistoryList history={history} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A company's loads, each shown twice over: the live load on the left, and what
 * the rate confirmation said about this company on the right.
 */
export function LoadHistory({
  links,
  loads,
}: {
  links: PartyProfileView["loadLinks"];
  loads: Record<string, Load>;
}) {
  if (links.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No loads yet"
        description="Loads appear here once a rate confirmation naming this company is reviewed and confirmed."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
        These loads belong to the loads module, not to this profile — the directory keeps only the
        link and a copy of what the paperwork said at the time. Correcting this profile never
        rewrites a load that already ran.
      </p>
      <ul className="space-y-2.5">
        {links.map((link) => {
          const load = loads[link.loadId];
          return (
            <li
              key={link.id}
              className="rounded-lg border border-border bg-surface p-4 shadow-e1"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    {load ? (
                      <Link
                        href={`/loads/${load.id}`}
                        className="text-[0.9375rem] font-semibold text-fg underline-offset-4 hover:underline"
                      >
                        {load.reference}
                      </Link>
                    ) : (
                      <span className="text-[0.9375rem] font-semibold text-fg-muted">
                        Load {link.loadId}
                      </span>
                    )}
                    <RoleChip role={link.role} />
                    {load ? <span className={PILL}>{load.status.replace(/_/g, " ")}</span> : null}
                  </p>
                  <p className="mt-1 text-[0.75rem] text-fg-muted">
                    {load ? laneLabel(load) : "This load is outside what you can see."}
                  </p>
                </div>
                <p className="text-[0.75rem] text-fg-subtle">Linked {formatDate(link.linkedAt)}</p>
              </div>

              <div className="mt-3 rounded-md bg-surface-sunken p-3">
                <p className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-fg-muted">
                  <FileText className="size-3.5" aria-hidden />
                  What the rate confirmation said
                </p>
                <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <SnapshotRow label="Company" value={link.snapshot.legalName} />
                  <SnapshotRow
                    label="MC"
                    value={formatMcNumber(link.snapshot.mcNumber) ?? "Not printed"}
                  />
                  {link.snapshot.facilityName ? (
                    <SnapshotRow label="Location" value={link.snapshot.facilityName} />
                  ) : null}
                  {link.snapshot.facilityAddress ? (
                    <SnapshotRow
                      label="Address"
                      value={formatAddress(link.snapshot.facilityAddress)}
                    />
                  ) : null}
                  {link.snapshot.contactName ? (
                    <SnapshotRow label="Contact" value={link.snapshot.contactName} />
                  ) : null}
                  {link.snapshot.contactPhone ? (
                    <SnapshotRow label="Phone" value={formatPhone(link.snapshot.contactPhone)} />
                  ) : null}
                  {link.rateConfirmationDocumentId ? (
                    <SnapshotRow label="Document" value={link.rateConfirmationDocumentId} mono />
                  ) : null}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NoteList({
  notes,
  onAdd,
}: {
  notes: PartyProfileView["notes"];
  onAdd?: (body: string, pinned: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!onAdd || !draft.trim() || saving) return;
    setSaving(true);
    try {
      await onAdd(draft.trim(), pinned);
      setDraft("");
      setPinned(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.9375rem] font-semibold text-fg">Notes</h2>

      {onAdd ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="What should the next dispatcher know before they book this?"
            aria-label="Add a note"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-muted">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="size-4 rounded border-border accent-[var(--color-primary)]"
              />
              Pin to the top
            </label>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!draft.trim() || saving}
            >
              {saving ? "Saving…" : "Add note"}
            </Button>
          </div>
        </div>
      ) : null}

      {notes.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-fg-muted">Nothing written down yet.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-border bg-surface-sunken p-3">
              <p className="flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-subtle">
                {note.pinned ? (
                  <span className="inline-flex items-center gap-1 text-st-warning">
                    <Pin className="size-3" aria-hidden />
                    Pinned
                  </span>
                ) : null}
                <span>{note.author.displayNameSnapshot}</span>
                <span>{formatDateTime(note.createdAt)}</span>
              </p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HistoryList({ history }: { history: PartyProfileView["history"] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No history yet"
        description="Every change to this record is kept here, newest first."
      />
    );
  }

  return (
    <ol className="space-y-2.5">
      {history.map((e) => (
        <li key={e.id} className="rounded-lg border border-border bg-surface p-3.5 shadow-e1">
          <p className="flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-subtle">
            <span className="font-mono">{e.kind}</span>
            <span>{formatDateTime(e.occurredAt)}</span>
            <span>{e.actor.displayNameSnapshot}</span>
            {e.private ? <span className={PILL}>Yours alone</span> : null}
          </p>
          <p className="mt-1 text-[0.8125rem] text-fg">{e.summary}</p>
          {e.changes?.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {e.changes.map((c, i) => (
                <li key={i} className="text-[0.75rem] text-fg-muted">
                  {c.field}: {c.from ?? "—"} → {c.to ?? "—"}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.9375rem] font-semibold text-fg">{title}</h2>
      <dl className="mt-3 space-y-1.5">{children}</dl>
    </section>
  );
}

export function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-[0.8125rem] text-fg",
          mono && "font-mono text-[0.75rem] break-all",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SnapshotRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-[0.75rem] text-fg-subtle">{label}</dt>
      <dd className={cn("min-w-0 text-[0.75rem] text-fg", mono && "font-mono break-all")}>
        {value}
      </dd>
    </div>
  );
}

const ROW = cn(
  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
  "hover:border-border-strong hover:bg-surface-hover",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);

const ROW_ICON =
  "flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted";

const PILL =
  "rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted capitalize";

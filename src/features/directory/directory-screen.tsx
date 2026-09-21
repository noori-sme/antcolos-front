"use client";

import {
  Building2, ChevronRight, MapPin, Search, ScanLine, TriangleAlert, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  listContacts, listFacilities, listDirectory, type DirectoryFilters,
} from "@/lib/api/mock/party-registry";
import type {
  DirectoryListing, Facility, Party, PartyContact, PartyRole, PartyStanding,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  AuthorityChip, ClaimChip, IdentityChip, PartyStatusChip, RatingStars, RoleChip,
  StandingChip,
} from "./directory-chips";
import {
  CONTACT_KIND_LABEL, formatCityState, formatDate, formatMcNumber, formatPhone,
} from "./directory-labels";
import { usePartyContext } from "./use-party-context";

/**
 * The directory.
 *
 * Three tabs over the same three record kinds the rest of the module is built
 * from — companies, the places they ship from, and the people who work at them.
 * They are tabs rather than three screens because a dispatcher looking for
 * "that dock in Columbus" does not know in advance which of the three they are
 * looking for, and making them guess the right menu item first is how a
 * directory stops getting used.
 *
 * Every row here is a company this carrier has a relationship with. A broker
 * three other carriers know is not in this list and cannot be reached by URL —
 * which is a different question from whether the resolver can match against it,
 * and the registry keeps the two apart deliberately.
 */

type Tab = "companies" | "locations" | "people";

const TABS: [Tab, string][] = [
  ["companies", "Companies"],
  ["locations", "Locations"],
  ["people", "People"],
];

const ROLE_FILTERS: (PartyRole | "all")[] = ["all", "broker", "shipper", "receiver"];

export function DirectoryScreen() {
  const ctx = usePartyContext();
  const [tab, setTab] = useState<Tab>("companies");

  const [listings, setListings] = useState<DirectoryListing[] | null>(null);
  const [facilities, setFacilities] = useState<
    { facility: Facility; party: Party; loadCount: number }[] | null
  >(null);
  const [contacts, setContacts] = useState<
    { contact: PartyContact; party: Party; facility?: Facility }[] | null
  >(null);
  const [denied, setDenied] = useState(false);

  const [query, setQuery] = useState("");
  const [role, setRole] = useState<PartyRole | "all">("all");
  const [standing, setStanding] = useState<PartyStanding | "all">("all");
  const [status, setStatus] = useState<DirectoryFilters["status"]>("all");
  const [withLoadsOnly, setWithLoadsOnly] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    Promise.all([listDirectory(ctx), listFacilities(ctx), listContacts(ctx)])
      .then(([d, f, c]) => {
        if (cancelled) return;
        setDenied(false);
        setListings(d);
        setFacilities(f);
        setContacts(c);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const q = query.trim().toLowerCase();

  const visibleCompanies = useMemo(() => {
    return (listings ?? []).filter((l) => {
      if (role !== "all" && !l.roles.includes(role)) return false;
      if (standing !== "all" && l.standing !== standing) return false;
      if (status !== "all" && l.status !== status) return false;
      if (withLoadsOnly && l.loadCount === 0) return false;
      if (!q) return true;
      return [l.legalName, l.dbaName, l.mcNumber, l.dotNumber, l.city, l.state]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [listings, role, standing, status, withLoadsOnly, q]);

  const visibleFacilities = useMemo(() => {
    return (facilities ?? []).filter(({ facility, party }) => {
      if (role !== "all" && !party.roles.includes(role)) return false;
      if (!q) return true;
      return [
        facility.name, party.legalName, facility.address.city, facility.address.state,
        facility.address.line1, facility.address.postalCode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [facilities, role, q]);

  const visiblePeople = useMemo(() => {
    return (contacts ?? []).filter(({ contact, party, facility }) => {
      if (role !== "all" && !party.roles.includes(role)) return false;
      if (!q) return true;
      return [
        contact.fullName, contact.title, contact.email, contact.phone,
        party.legalName, facility?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, role, q]);

  const needsReview = (listings ?? []).filter((l) => l.status === "provisional");

  if (denied) {
    return (
      <EmptyState
        icon={Building2}
        title="You cannot see the directory"
        description="Viewing brokers, shippers and receivers needs the “View customers” permission in this organization."
      />
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Directory"
        description="The brokers, shippers and receivers you work with, the places they ship from, and the people who answer the phone."
        actions={
          <Can permission="customers:resolve">
            <Button variant="primary" asChild>
              <Link href="/directory/review">
                <ScanLine aria-hidden />
                Review a rate confirmation
              </Link>
            </Button>
          </Can>
        }
      />

      {needsReview.length > 0 ? (
        <section
          aria-labelledby="needs-review"
          className="rounded-lg border border-st-warning/35 bg-st-warning-bg/40 p-4"
        >
          <h2 id="needs-review" className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <TriangleAlert className="size-4 text-st-warning" aria-hidden />
            {needsReview.length === 1
              ? "One profile is waiting to be checked"
              : `${needsReview.length} profiles are waiting to be checked`}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            These came off rate confirmations that did not carry enough to match them with
            confidence. They work — you can book against them — but nothing will treat them as
            settled until somebody confirms or corrects them.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {needsReview.map((l) => (
              <li key={l.partyId}>
                <Link
                  href={`/directory/${l.partyId}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[0.8125rem] font-medium text-fg hover:border-border-strong"
                >
                  {l.legalName}
                  <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Directory sections">
        {TABS.map(([id, label]) => {
          const count =
            id === "companies"
              ? listings?.length ?? 0
              : id === "locations"
                ? facilities?.length ?? 0
                : contacts?.length ?? 0;
          return (
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
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "companies"
                ? "Name, MC, USDOT or city…"
                : tab === "locations"
                  ? "Location, company, street or city…"
                  : "Name, company, phone or email…"
            }
            aria-label="Search the directory"
            className="pl-9"
          />
        </div>

        <label className="sr-only" htmlFor="role-filter">Filter by role</label>
        <select
          id="role-filter"
          value={role}
          onChange={(e) => setRole(e.target.value as PartyRole | "all")}
          className={SELECT}
        >
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {r === "all" ? "Every role" : `${r[0].toUpperCase()}${r.slice(1)}s`}
            </option>
          ))}
        </select>

        {tab === "companies" ? (
          <>
            <label className="sr-only" htmlFor="standing-filter">Filter by your standing</label>
            <select
              id="standing-filter"
              value={standing}
              onChange={(e) => setStanding(e.target.value as PartyStanding | "all")}
              className={SELECT}
            >
              <option value="all">Any standing</option>
              <option value="preferred">Preferred</option>
              <option value="standard">Standard</option>
              <option value="watch">Watch</option>
              <option value="blocked">Blocked</option>
            </select>

            <label className="sr-only" htmlFor="status-filter">Filter by record status</label>
            <select
              id="status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value as DirectoryFilters["status"])}
              className={SELECT}
            >
              <option value="all">Confirmed and flagged</option>
              <option value="active">Confirmed only</option>
              <option value="provisional">Needs review only</option>
            </select>

            <label className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-muted">
              <input
                type="checkbox"
                checked={withLoadsOnly}
                onChange={(e) => setWithLoadsOnly(e.target.checked)}
                className="size-4 rounded border-border accent-[var(--color-primary)]"
              />
              Hauled for
            </label>
          </>
        ) : null}
      </div>

      {listings === null ? <LoadingSkeleton rows={5} /> : null}

      {tab === "companies" && listings !== null ? (
        <CompanyList listings={visibleCompanies} total={listings.length} />
      ) : null}

      {tab === "locations" && facilities !== null ? (
        <FacilityList rows={visibleFacilities} total={facilities.length} />
      ) : null}

      {tab === "people" && contacts !== null ? (
        <ContactList rows={visiblePeople} total={contacts.length} />
      ) : null}
    </div>
  );
}

function CompanyList({ listings, total }: { listings: DirectoryListing[]; total: number }) {
  if (total === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No companies yet"
        description="Brokers, shippers and receivers appear here once a rate confirmation is reviewed and you confirm who they are."
      />
    );
  }
  if (listings.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="Nothing matches"
        description="Try a different search, role, standing or record status."
      />
    );
  }

  return (
    <ul className="space-y-2.5">
      {listings.map((l) => (
        <li key={l.partyId}>
          <Link href={`/directory/${l.partyId}`} className={ROW}>
            <span aria-hidden className={ROW_ICON}>
              <Building2 className="size-[1.125rem]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-fg">{l.legalName}</span>
                {l.roles.map((r) => (
                  <RoleChip key={r} role={r} />
                ))}
                {/*
                  A broker carries its own identity chip, which already says
                  more than "Needs review" would. The generic status chip is
                  for everything else.
                */}
                {l.identityState
                  ? <IdentityChip state={l.identityState} />
                  : <PartyStatusChip status={l.status} />}
                {l.authorityStatus ? <AuthorityChip status={l.authorityStatus} /> : null}
                <ClaimChip state={l.claimState} />
                <StandingChip standing={l.standing} />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                {l.mcNumber ? (
                  <span className="font-mono">{formatMcNumber(l.mcNumber)}</span>
                ) : (
                  <span className="text-st-warning">No MC number</span>
                )}
                {l.city ? <span>{formatCityState({ city: l.city, state: l.state })}</span> : null}
                <span className="tabular-nums">
                  {l.loadCount === 0
                    ? "No loads yet"
                    : `${l.loadCount} ${l.loadCount === 1 ? "load" : "loads"}`}
                </span>
                {l.lastLoadAt ? <span>Last {formatDate(l.lastLoadAt)}</span> : null}
                <span>
                  {l.facilityCount} {l.facilityCount === 1 ? "location" : "locations"}
                </span>
                <span>
                  {l.contactCount} {l.contactCount === 1 ? "contact" : "contacts"}
                </span>
              </p>
            </div>
            <div className="hidden shrink-0 sm:block">
              <RatingStars rating={l.rating} />
            </div>
            <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FacilityList({
  rows,
  total,
}: {
  rows: { facility: Facility; party: Party; loadCount: number }[];
  total: number;
}) {
  if (total === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="No locations yet"
        description="A location is created the first time a rate confirmation names a dock you confirm."
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={Search} title="Nothing matches" description="Try a different search or role." />;
  }

  return (
    <ul className="space-y-2.5">
      {rows.map(({ facility, party, loadCount }) => (
        <li key={facility.facilityId}>
          <Link href={`/directory/locations/${facility.facilityId}`} className={ROW}>
            <span aria-hidden className={ROW_ICON}>
              <MapPin className="size-[1.125rem]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-fg">{facility.name}</span>
                {facility.functions.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted"
                  >
                    {f === "pickup" ? "Pickup" : "Delivery"}
                  </span>
                ))}
                <PartyStatusChip status={facility.status} />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                <span>{party.legalName}</span>
                <span>{formatCityState(facility.address)}</span>
                {facility.hoursText ? <span>{facility.hoursText}</span> : null}
                {facility.appointmentRequired ? <span>Appointment required</span> : null}
                <span className="tabular-nums">
                  {loadCount === 0 ? "No loads yet" : `${loadCount} ${loadCount === 1 ? "load" : "loads"}`}
                </span>
              </p>
            </div>
            <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ContactList({
  rows,
  total,
}: {
  rows: { contact: PartyContact; party: Party; facility?: Facility }[];
  total: number;
}) {
  if (total === 0) {
    return (
      <EmptyState
        icon={UserRound}
        title="No contacts yet"
        description="Broker agents and dock contacts are added as rate confirmations name them."
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={Search} title="Nothing matches" description="Try a different search or role." />;
  }

  return (
    <ul className="space-y-2.5">
      {rows.map(({ contact, party, facility }) => (
        <li key={contact.contactId}>
          <Link href={`/directory/contacts/${contact.contactId}`} className={ROW}>
            <span aria-hidden className={ROW_ICON}>
              <UserRound className="size-[1.125rem]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-fg">{contact.fullName}</span>
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
                  {CONTACT_KIND_LABEL[contact.kind]}
                </span>
                <PartyStatusChip status={contact.status} />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                {contact.title ? <span>{contact.title}</span> : null}
                <span>{party.legalName}</span>
                {facility ? <span>{facility.name}</span> : null}
                {contact.phone ? (
                  <span className="tabular-nums">
                    {formatPhone(contact.phone, contact.phoneExtension)}
                  </span>
                ) : null}
                {contact.email ? <span className="break-all">{contact.email}</span> : null}
              </p>
            </div>
            <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const ROW = cn(
  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
  "hover:border-border-strong hover:bg-surface-hover",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);

const ROW_ICON =
  "flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted";

const SELECT =
  "h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

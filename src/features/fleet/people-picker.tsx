"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OrgPeopleFamily, OrgPerson } from "@/types/org-people";
import { useAssignablePeople } from "./hooks";

const FAMILY_LABEL: Record<OrgPeopleFamily, string> = {
  drivers: "Driver",
  dispatchers: "Dispatcher",
  admins: "Admin",
};
const FAMILY_PLURAL: Record<OrgPeopleFamily, string> = {
  drivers: "drivers",
  dispatchers: "dispatchers",
  admins: "admins",
};
const PAGE_SIZE = 50;

/**
 * Pick one active member from up to three people lists (drivers,
 * dispatchers, admins). Each list needs its own permission: a list that fails
 * gets its own notice and the others still show. Search is debounced.
 */
export function PeoplePicker({
  families,
  value,
  onChange,
  excludeUserIds = [],
  disableBusyDrivers = false,
  labelId,
}: {
  families: readonly OrgPeopleFamily[];
  value: string | null;
  onChange: (person: OrgPerson) => void;
  excludeUserIds?: readonly string[];
  /** Drivers already driving another unit can't be assigned (contract §8). */
  disableBusyDrivers?: boolean;
  labelId: string;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const drivers = useAssignablePeople("drivers", q, families.includes("drivers"));
  const dispatchers = useAssignablePeople("dispatchers", q, families.includes("dispatchers"));
  const admins = useAssignablePeople("admins", q, families.includes("admins"));
  const results = [
    { family: "drivers" as const, query: drivers },
    { family: "dispatchers" as const, query: dispatchers },
    { family: "admins" as const, query: admins },
  ].filter((r) => families.includes(r.family));

  const failed = results.filter((r) => r.query.isError);
  const loading = results.some((r) => r.query.isPending);
  const truncated = results.some((r) => (r.query.data?.meta.totalItems ?? 0) > PAGE_SIZE);
  const seen = new Set<string>();
  const people = results.flatMap(({ family, query }) =>
    (query.data?.data ?? [])
      .filter((p) => !excludeUserIds.includes(p.userId))
      .filter((p) => (seen.has(p.userId) ? false : (seen.add(p.userId), true)))
      .map((person) => ({ person, family })),
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          aria-labelledby={labelId}
          placeholder="Search by name, username or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {failed.map(({ family, query }) => (
        <div
          key={family}
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[0.8125rem]"
        >
          <span className="text-fg-muted">
            Couldn&apos;t load {FAMILY_PLURAL[family]}: {query.error?.message}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ))}

      {loading && people.length === 0 ? (
        <LoadingSkeleton rows={2} />
      ) : people.length === 0 ? (
        failed.length === results.length ? null : (
          <p className="py-3 text-[0.8125rem] text-fg-muted" aria-live="polite">
            {q ? `No members match “${q}”.` : "No eligible members in this organization yet."}
          </p>
        )
      ) : (
        <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {people.map(({ person, family }) => {
            const selected = value === person.userId;
            const busy = disableBusyDrivers && Boolean(person.currentTruck?.unitNumber);
            return (
              <li key={person.userId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => onChange(person)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[0.8125rem] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                    selected && "bg-primary/10",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{person.name}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {FAMILY_LABEL[family]}
                      {person.currentTruck?.unitNumber
                        ? busy
                          ? ` · already drives unit ${person.currentTruck?.unitNumber}`
                          : ` · drives unit ${person.currentTruck?.unitNumber}`
                        : ""}
                      {person.email ? ` · ${person.email}` : ""}
                    </span>
                  </span>
                  {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {truncated && (
        <p className="text-xs text-fg-subtle">Showing the first {PAGE_SIZE}. Search to narrow it down.</p>
      )}
    </div>
  );
}

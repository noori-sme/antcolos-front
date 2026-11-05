"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/data/states";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OrgPeopleFamily, OrgPerson } from "@/types/org-people";
import { useAssignablePeople } from "./hooks";

const FAMILY_LABEL: Record<OrgPeopleFamily, string> = {
  drivers: "Driver",
  dispatchers: "Dispatcher",
  admins: "Admin",
};

/**
 * Pick one active member from up to three people lists (drivers,
 * dispatchers, admins). Search is debounced; the lists are requested only for
 * the families passed in.
 */
export function PeoplePicker({
  families,
  value,
  onChange,
  excludeUserIds = [],
  labelId,
}: {
  families: readonly OrgPeopleFamily[];
  value: string | null;
  onChange: (person: OrgPerson) => void;
  excludeUserIds?: readonly string[];
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

  const failed = results.find((r) => r.query.isError);
  const loading = results.some((r) => r.query.isPending);
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
      {failed ? (
        <ErrorState
          title="You can't see the member list"
          description={failed.query.error?.message ?? "Ask an admin to make this change."}
          onRetry={() => failed.query.refetch()}
        />
      ) : loading && people.length === 0 ? (
        <p className="py-3 text-[0.8125rem] text-fg-muted">Loading members…</p>
      ) : people.length === 0 ? (
        <p className="py-3 text-[0.8125rem] text-fg-muted">
          {q ? `No members match “${q}”.` : "No eligible members in this organization yet."}
        </p>
      ) : (
        <ul
          role="listbox"
          aria-labelledby={labelId}
          className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {people.map(({ person, family }) => {
            const selected = value === person.userId;
            return (
              <li key={person.userId} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => onChange(person)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[0.8125rem] hover:bg-surface-sunken",
                    selected && "bg-primary/10",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{person.name}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {FAMILY_LABEL[family]}
                      {person.currentTruckUnitNumber
                        ? ` · drives unit ${person.currentTruckUnitNumber}`
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
    </div>
  );
}

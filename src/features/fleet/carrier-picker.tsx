"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/data/states";
import { cn } from "@/lib/utils";
import type { DirectoryCarrier } from "@/types/carrier-authority";
import { useCarrierSearch } from "./hooks";

/**
 * Another carrier to hand a truck to, found by name, MC or DOT (plan 25,
 * membership-api-contract §6). Debounced; nothing is searched under 2 characters.
 */
export function CarrierPicker({
  value, onChange, labelId,
}: {
  value: string | null;
  onChange: (carrier: DirectoryCarrier) => void;
  labelId: string;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, isPending, isError, error, refetch, isFetching } = useCarrierSearch(q);
  const carriers = data ?? [];

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input
          aria-labelledby={labelId}
          placeholder="Search carriers by name, MC or DOT"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      {q.length < 2 ? (
        <p className="py-2 text-[0.8125rem] text-fg-muted">Type at least 2 characters.</p>
      ) : isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[0.8125rem]">
          <span className="text-fg-muted">Couldn&apos;t search carriers: {error?.message}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : isPending && isFetching ? (
        <LoadingSkeleton rows={2} />
      ) : carriers.length === 0 ? (
        <p className="py-2 text-[0.8125rem] text-fg-muted" aria-live="polite">No other carrier matches “{q}”.</p>
      ) : (
        <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {carriers.map((carrier) => {
            const selected = value === carrier.organizationId;
            return (
              <li key={carrier.organizationId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(carrier)}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-2 text-left text-[0.8125rem] hover:bg-surface-sunken",
                    selected && "bg-primary/10",
                  )}
                >
                  <span className="font-medium text-fg">{carrier.name}</span>
                  <span className="text-xs text-fg-muted">
                    {[carrier.mcNumber, carrier.dotNumber && `DOT ${carrier.dotNumber}`].filter(Boolean).join(" · ") || carrier.handle}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

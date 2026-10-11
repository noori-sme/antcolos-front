"use client";

import { ChevronRight, Search, X, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export type ApiPermissionMeta = {
  key: string;
  label: string;
  description: string;
  group: string;
  groupLabel: string;
};

export function ApiPermissionPicker({
  selected,
  onChange,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [catalog, setCatalog] = useState<ApiPermissionMeta[]>([]);
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    apiClient.get('/permissions/catalog').then((res) => {
      if (!mounted) return;
      const metas: ApiPermissionMeta[] = [];
      const labels: Record<string, string> = {};
      
      const modules = res.data?.modules || [];
      modules.forEach((m: any) => {
        labels[m.module] = m.label;
        m.resources?.forEach((r: any) => {
          r.actions?.forEach((a: any) => {
            metas.push({
              key: `${r.resource}.${a.action}`,
              label: a.label,
              description: "", // API doesn't provide this currently
              group: m.module,
              groupLabel: m.label,
            });
          });
        });
      });
      setCatalog(metas);
      setGroupLabels(labels);
      setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });
    
    return () => { mounted = false; };
  }, []);

  const [query, setQuery] = useState("");
  const [manuallyOpen, setManuallyOpen] = useState<Set<string>>(() => new Set());

  const search = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!search) return null;
    return new Set(
      catalog
        .filter(
          (p) =>
            p.label.toLowerCase().includes(search) ||
            p.groupLabel.toLowerCase().includes(search)
        )
        .map((p) => p.key)
    );
  }, [catalog, search]);

  const byGroup = useMemo(() => {
    const map = new Map<string, ApiPermissionMeta[]>();
    for (const group of Object.keys(groupLabels)) {
      const items = catalog.filter(
        (p) => p.group === group && (!matches || matches.has(p.key))
      );
      if (items.length) map.set(group, items);
    }
    return map;
  }, [catalog, matches, groupLabels]);

  const totalSelected = catalog.filter((p) => selected.has(p.key)).length;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function setGroup(items: ApiPermissionMeta[], on: boolean) {
    const next = new Set(selected);
    for (const item of items) {
      if (on) next.add(item.key);
      else next.delete(item.key);
    }
    onChange(next);
  }

  if (loading) {
    return <LoadingSkeleton rows={5} />;
  }

  return (
    <div className="space-y-3">
      {/* DEBUG TEMPORARY */}
      <div className="text-xs text-red-500 bg-red-100 p-2 rounded hidden">
        <div>Selected ({selected.size}): {Array.from(selected).slice(0, 5).join(", ")}</div>
        <div>Catalog ({catalog.length}): {catalog.slice(0, 5).map(c => c.key).join(", ")}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions…"
            aria-label="Search permissions"
            className="pl-9"
          />
        </div>
        <p aria-live="polite" className="text-[0.75rem] text-fg-muted tabular-nums">
          {totalSelected} of {catalog.length} selected
        </p>
        {totalSelected > 0 ? (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="rounded-sm text-[0.75rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          >
            Clear everything
          </button>
        ) : null}
      </div>

      {byGroup.size === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[0.8125rem] text-fg-muted">
          Nothing matches “{query}”.
        </p>
      ) : null}

      <div className="space-y-2">
        {[...byGroup.entries()].map(([group, items]) => {
          const chosen = items.filter((p) => selected.has(p.key)).length;
          const open = Boolean(search) || manuallyOpen.has(group);
          const panelId = `perm-group-${group}`;

          return (
            <div key={group} className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setManuallyOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-fg-subtle transition-transform",
                      open && "rotate-90"
                    )}
                  />
                  <span className="truncate text-[0.875rem] font-semibold text-fg">
                    {groupLabels[group]}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums",
                      chosen > 0 ? "bg-primary/12 text-primary" : "bg-surface-sunken text-fg-subtle"
                    )}
                  >
                    {chosen}/{items.length}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <GroupAction
                    label="Select All"
                    disabled={items.every((p) => selected.has(p.key))}
                    onClick={() => setGroup(items, true)}
                  />
                  <GroupAction
                    label="Remove All"
                    disabled={chosen === 0}
                    onClick={() => setGroup(items, false)}
                  />
                </div>
              </div>

              {open ? (
                <ul id={panelId} className="divide-y divide-border border-t border-border">
                  {items.map((meta) => {
                    const checked = selected.has(meta.key);
                    const inputId = `perm-${meta.key.replace(/[\.:]/g, "-")}`;
                    return (
                      <li key={meta.key}>
                        <label
                          htmlFor={inputId}
                          className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-hover"
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(meta.key)}
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[0.8125rem] font-medium text-fg">
                              {meta.label}
                            </span>
                            <span className="mt-0.5 block font-mono text-[0.6875rem] text-fg-subtle">
                              {meta.key}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupAction({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-sm px-1.5 py-1 text-[0.75rem] font-medium transition-colors",
        "text-fg-muted hover:bg-surface-hover hover:text-fg",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      {label}
    </button>
  );
}

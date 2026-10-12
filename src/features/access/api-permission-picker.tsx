"use client";

import { ChevronRight, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/data/states";
import { apiClient } from "@/lib/api/client";
import {
  migrateKey,
  normalizePermissionKey,
  safePermissionMeta,
} from "@/lib/permissions";
import { FinancialChip, SensitiveChip } from "./permission-chips";
import { cn } from "@/lib/utils";

export type ApiPermissionMeta = {
  key: string;
  label: string;
  description: string;
  group: string;
  groupLabel: string;
  sensitive?: boolean;
  financial?: boolean;
};

export interface ApiPermissionPickerProps {
  selected: ReadonlySet<string>;
  onChange: (next: Set<any>) => void;
  grantable?: ReadonlySet<string>;
  className?: string;
}

function matchesKey(itemKey: string, keyInSet: string): boolean {
  if (itemKey === keyInSet) return true;
  if (migrateKey(keyInSet) === itemKey || migrateKey(itemKey) === keyInSet) return true;
  const normA = normalizePermissionKey(itemKey);
  const normB = normalizePermissionKey(keyInSet);
  if (normA && normB && normA === normB) return true;
  return false;
}

function isSelected(itemKey: string, set: ReadonlySet<string>): boolean {
  if (set.has(itemKey)) return true;
  for (const k of set) {
    if (matchesKey(itemKey, k)) return true;
  }
  return false;
}

function isGrantable(itemKey: string, grantableSet?: ReadonlySet<string>): boolean {
  if (!grantableSet || grantableSet.size === 0) return true;
  if (grantableSet.has(itemKey)) return true;
  for (const k of grantableSet) {
    if (matchesKey(itemKey, k)) return true;
  }
  return false;
}

/**
 * Reusable dynamic permission picker connected to the backend API:
 * GET /permissions/catalog
 *
 * Used across both Role Creation/Editing and Invitation Sending ("What they can do").
 */
export function ApiPermissionPicker({
  selected,
  onChange,
  grantable,
  className,
}: ApiPermissionPickerProps) {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["permissions", "catalog"],
    queryFn: async () => {
      const res = await apiClient.get("/permissions/catalog");
      return res.data;
    },
    refetchOnMount: "always",
    staleTime: 0,
    gcTime: 0,
  });

  const { catalog, groupLabels, groupOrder } = useMemo(() => {
    const metas: ApiPermissionMeta[] = [];
    const labels: Record<string, string> = {};
    const order: string[] = [];

    const modules = data?.modules || data?.data?.modules || (Array.isArray(data) ? data : []);
    modules.forEach((m: any) => {
      const moduleKey = m.module || m.id || m.name;
      const moduleLabel = m.label || m.name || moduleKey;
      labels[moduleKey] = moduleLabel;
      order.push(moduleKey);

      m.resources?.forEach((r: any) => {
        r.actions?.forEach((a: any) => {
          const key = `${r.resource}.${a.action}`;
          const fallback = safePermissionMeta(key);
          metas.push({
            key,
            label: a.label || fallback.label,
            description: a.description || fallback.description || "",
            group: moduleKey,
            groupLabel: moduleLabel,
            sensitive: Boolean(a.sensitive ?? fallback.sensitive),
            financial: Boolean(a.financial ?? fallback.financial),
          });
        });
      });
    });

    return { catalog: metas, groupLabels: labels, groupOrder: order };
  }, [data]);

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
            p.description.toLowerCase().includes(search) ||
            p.groupLabel.toLowerCase().includes(search) ||
            p.key.toLowerCase().includes(search)
        )
        .map((p) => p.key)
    );
  }, [catalog, search]);

  const byGroup = useMemo(() => {
    const map = new Map<string, ApiPermissionMeta[]>();
    for (const group of groupOrder) {
      const items = catalog.filter(
        (p) => p.group === group && (!matches || matches.has(p.key))
      );
      if (items.length) map.set(group, items);
    }
    return map;
  }, [catalog, matches, groupOrder]);

  const totalSelected = useMemo(() => {
    return catalog.filter((p) => isSelected(p.key, selected)).length;
  }, [catalog, selected]);

  function toggle(itemKey: string) {
    if (!isGrantable(itemKey, grantable)) return;
    const next = new Set(selected);
    let found: string | null = null;
    if (next.has(itemKey)) {
      found = itemKey;
    } else {
      for (const s of next) {
        if (matchesKey(itemKey, s)) {
          found = s;
          break;
        }
      }
    }

    if (found) {
      next.delete(found);
      next.delete(itemKey);
    } else {
      next.add(itemKey);
    }
    onChange(next);
  }

  function setGroup(items: ApiPermissionMeta[], on: boolean) {
    const next = new Set(selected);
    for (const item of items) {
      if (!isGrantable(item.key, grantable)) continue;
      if (on) {
        next.add(item.key);
      } else {
        for (const s of Array.from(next)) {
          if (matchesKey(item.key, s)) {
            next.delete(s);
          }
        }
        next.delete(item.key);
      }
    }
    onChange(next);
  }

  if (isLoading || isFetching) {
    return (
      <div
        className={cn(
          "space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm",
          className
        )}
        aria-busy="true"
        aria-live="polite"
      >
        <div className="flex flex-col items-center justify-center py-3 text-center">
          <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
          <p className="mt-2.5 text-[0.875rem] font-medium text-fg">Loading permissions…</p>
          <p className="mt-0.5 text-[0.75rem] text-fg-muted">Fetching latest permission catalog from server</p>
        </div>
        <div className="border-t border-border pt-4">
          <LoadingSkeleton rows={5} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions…"
            aria-label="Search permissions"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          {isFetching ? (
            <span className="flex items-center gap-1.5 text-[0.75rem] font-medium text-primary">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              <span>Updating…</span>
            </span>
          ) : null}
          <p aria-live="polite" className="text-[0.75rem] text-fg-muted tabular-nums">
            {totalSelected} of {catalog.length} selected
          </p>
        </div>
        {totalSelected > 0 ? (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="rounded-sm text-[0.75rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:text-fg focus-visible:underline"
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
          const chosen = items.filter((p) => isSelected(p.key, selected)).length;
          const grantableItems = items.filter((p) => isGrantable(p.key, grantable));
          const open = Boolean(search) || manuallyOpen.has(group);
          const panelId = `perm-group-${group}`;

          return (
            <div
              key={group}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
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
                    {groupLabels[group] || group}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums",
                      chosen > 0
                        ? "bg-primary/12 text-primary"
                        : "bg-surface-sunken text-fg-subtle"
                    )}
                  >
                    {chosen}/{items.length}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <GroupAction
                    label="Select All"
                    srLabel={`Select all in ${groupLabels[group] || group}`}
                    disabled={
                      grantableItems.length === 0 ||
                      grantableItems.every((p) => isSelected(p.key, selected))
                    }
                    onClick={() => setGroup(items, true)}
                  />
                  <GroupAction
                    label="Remove All"
                    srLabel={`Clear all in ${groupLabels[group] || group}`}
                    disabled={chosen === 0}
                    onClick={() => setGroup(items, false)}
                  />
                </div>
              </div>

              {open ? (
                <ul id={panelId} className="divide-y divide-border border-t border-border">
                  {items.map((meta) => {
                    const allowed = isGrantable(meta.key, grantable);
                    const checked = isSelected(meta.key, selected);
                    const inputId = `perm-${meta.key.replace(/[\.:]/g, "-")}`;

                    return (
                      <li key={meta.key}>
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors",
                            allowed
                              ? "hover:bg-surface-hover"
                              : "cursor-not-allowed opacity-60"
                          )}
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={checked}
                            disabled={!allowed}
                            onChange={() => toggle(meta.key)}
                            aria-describedby={`${inputId}-desc`}
                            className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[0.8125rem] font-medium text-fg">
                                {meta.label}
                              </span>
                              {meta.financial ? <FinancialChip /> : null}
                              {meta.sensitive && !meta.financial ? <SensitiveChip /> : null}
                            </span>
                            <span
                              id={`${inputId}-desc`}
                              className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted"
                            >
                              {meta.description}
                              {!allowed ? (
                                <span className="block font-medium text-fg-subtle">
                                  You cannot grant this because you do not have it yourself.
                                </span>
                              ) : null}
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

function GroupAction({
  label,
  srLabel,
  disabled,
  onClick,
}: {
  label: string;
  srLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-sm px-1.5 py-1 text-[0.75rem] font-medium transition-colors",
        "text-fg-muted hover:bg-surface-hover hover:text-fg",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{srLabel}</span>
    </button>
  );
}

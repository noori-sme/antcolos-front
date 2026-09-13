"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER,
  availablePermissions,
} from "@/lib/permissions";
import type {
  OrganizationType,
  PermissionGroup,
  PermissionKey,
  PermissionMeta,
} from "@/types";
import { FinancialChip, SensitiveChip } from "./permission-chips";
import { cn } from "@/lib/utils";

/**
 * The permission editor, shared by the invitation flow and the role builder.
 *
 * Permissions are grouped by the product module they act on, because that is
 * how an owner thinks about them ("what can this person do with loads?"), and
 * collapsed by default so sixty checkboxes never land on someone at once. A
 * module opens if it has something selected, or if a search matches inside it.
 *
 * `grantable` is the hard limit: anything outside it renders disabled with the
 * reason, because nobody can hand out access they do not hold themselves.
 */
export function PermissionPicker({
  orgType,
  selected,
  onChange,
  grantable,
}: {
  orgType: OrganizationType;
  selected: ReadonlySet<PermissionKey>;
  onChange: (next: Set<PermissionKey>) => void;
  grantable: ReadonlySet<PermissionKey>;
}) {
  const [query, setQuery] = useState("");
  const [manuallyOpen, setManuallyOpen] = useState<Set<PermissionGroup>>(() => {
    const open = new Set<PermissionGroup>();
    for (const meta of availablePermissions(orgType)) {
      if (selected.has(meta.key)) open.add(meta.group);
    }
    return open;
  });

  const all = useMemo(() => availablePermissions(orgType), [orgType]);

  const search = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!search) return null;
    return new Set(
      all
        .filter(
          (p) =>
            p.label.toLowerCase().includes(search) ||
            p.description.toLowerCase().includes(search) ||
            PERMISSION_GROUP_LABELS[p.group].toLowerCase().includes(search),
        )
        .map((p) => p.key),
    );
  }, [all, search]);

  const byGroup = useMemo(() => {
    const map = new Map<PermissionGroup, PermissionMeta[]>();
    for (const group of PERMISSION_GROUP_ORDER) {
      const items = all.filter(
        (p) => p.group === group && (!matches || matches.has(p.key)),
      );
      if (items.length) map.set(group, items);
    }
    return map;
  }, [all, matches]);

  const totalSelected = all.filter((p) => selected.has(p.key)).length;

  function toggle(key: PermissionKey) {
    if (!grantable.has(key)) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function setGroup(items: PermissionMeta[], on: boolean) {
    const next = new Set(selected);
    for (const item of items) {
      if (!grantable.has(item.key)) continue;
      if (on) next.add(item.key);
      else next.delete(item.key);
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
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
        <p aria-live="polite" className="text-[0.75rem] text-fg-muted tabular-nums">
          {totalSelected} of {all.length} selected
        </p>
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
          const chosen = items.filter((p) => selected.has(p.key)).length;
          const grantableItems = items.filter((p) => grantable.has(p.key));
          // A search result is always open — hiding the match would be perverse.
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
                      open && "rotate-90",
                    )}
                  />
                  <span className="truncate text-[0.875rem] font-semibold text-fg">
                    {PERMISSION_GROUP_LABELS[group]}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums",
                      chosen > 0 ? "bg-primary/12 text-primary" : "bg-surface-sunken text-fg-subtle",
                    )}
                  >
                    {chosen}/{items.length}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <GroupAction
                    label="All"
                    srLabel={`Select all in ${PERMISSION_GROUP_LABELS[group]}`}
                    disabled={grantableItems.every((p) => selected.has(p.key))}
                    onClick={() => setGroup(items, true)}
                  />
                  <GroupAction
                    label="None"
                    srLabel={`Clear all in ${PERMISSION_GROUP_LABELS[group]}`}
                    disabled={chosen === 0}
                    onClick={() => setGroup(items, false)}
                  />
                </div>
              </div>

              {open ? (
                <ul id={panelId} className="divide-y divide-border border-t border-border">
                  {items.map((meta) => {
                    const allowed = grantable.has(meta.key);
                    const checked = selected.has(meta.key);
                    const inputId = `perm-${meta.key.replace(/[:]/g, "-")}`;
                    return (
                      <li key={meta.key}>
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors",
                            allowed ? "hover:bg-surface-hover" : "cursor-not-allowed opacity-60",
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
                          <span className="min-w-0">
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
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <span aria-hidden>{label}</span>
      <span className="sr-only">{srLabel}</span>
    </button>
  );
}

/** Small helper for the picker's own empty state elsewhere. */
export function ClearSearchButton({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" onClick={onClear} aria-label="Clear search">
      <X className="size-4" aria-hidden />
    </button>
  );
}

"use client";

import { Building2, ChevronRight, Link2, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER,
  availablePermissions,
  permissionMeta,
} from "@/lib/permissions";
import type {
  OrganizationType, PermissionGroup, PermissionKey, PermissionMeta,
} from "@/types";
import { cn } from "@/lib/utils";
import { FinancialChip, SensitiveChip } from "./permission-chips";

/**
 * The reference view: every permission this workspace can hand out, in plain
 * language, with what it reaches beyond the action itself.
 *
 * ★ WHY THIS IS NOT THE PICKER WITH THE CHECKBOXES HIDDEN ★
 * The picker answers "what am I giving this person". This answers "what is
 * there, and what does it mean" — which is the question somebody has before
 * they open a role at all, and the one a wall of sixty ticked boxes is worst at.
 * So this one is read-only, shows the PREREQUISITE and the SCOPE caveat that
 * the picker has no room for, and is honest about the keys that exist but are
 * not available here.
 *
 * ★ UNAVAILABLE IS SHOWN, NOT OFFERED ★
 * A dispatch organization owns no trucks, so `trucks:create` is not grantable
 * in one. It would be easy to leave those out entirely. They are listed instead,
 * in a separate section, marked as not available and impossible to select —
 * because an owner who cannot find "Add trucks" concludes the product has lost
 * it, and because the honest answer ("this belongs to a carrier workspace") is
 * more useful than silence. Nothing in this view can grant anything.
 */
export function PermissionCatalog({ orgType }: { orgType: OrganizationType }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<PermissionGroup>>(new Set());

  const available = useMemo(() => availablePermissions(orgType), [orgType]);
  const availableKeys = useMemo(
    () => new Set(available.map((p) => p.key)),
    [available],
  );
  const elsewhere = useMemo(
    () => PERMISSION_CATALOG.filter((p) => !availableKeys.has(p.key)),
    [availableKeys],
  );

  const search = query.trim().toLowerCase();
  const matches = (p: PermissionMeta) =>
    !search
    || p.label.toLowerCase().includes(search)
    || p.description.toLowerCase().includes(search)
    || (p.scopeNote ?? "").toLowerCase().includes(search)
    || PERMISSION_GROUP_LABELS[p.group].toLowerCase().includes(search)
    // The key itself is searchable and never the headline. Somebody who has
    // read a backend error wants to find it; nobody should have to read it.
    || p.key.toLowerCase().includes(search);

  const byGroup = useMemo(() => {
    const map = new Map<PermissionGroup, PermissionMeta[]>();
    for (const group of PERMISSION_GROUP_ORDER) {
      const items = available.filter((p) => p.group === group && matches(p));
      if (items.length) map.set(group, items);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, search]);

  const unavailableMatches = elsewhere.filter(matches);
  const shown = [...byGroup.values()].reduce((n, items) => n + items.length, 0);

  return (
    <div className="space-y-4">
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
            placeholder="Search by what it lets somebody do…"
            aria-label="Search permissions"
            className="pl-9"
          />
        </div>
        <p aria-live="polite" className="text-[0.75rem] text-fg-muted tabular-nums">
          {shown} of {available.length} shown
        </p>
      </div>


      {shown === 0 && unavailableMatches.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-[0.8125rem] text-fg-muted">
          Nothing matches “{query}”.
        </p>
      ) : null}

      <div className="space-y-2">
        {[...byGroup.entries()].map(([group, items]) => {
          const isOpen = Boolean(search) || open.has(group);
          const panelId = `catalog-${group}`;
          return (
            <section key={group} className="overflow-hidden rounded-lg border border-border bg-surface">
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-fg-subtle transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-fg">
                    {PERMISSION_GROUP_LABELS[group]}
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] font-medium text-fg-subtle tabular-nums">
                    {items.length}
                  </span>
                </button>
              </h3>
              {isOpen ? (
                <ul id={panelId} className="divide-y divide-border border-t border-border">
                  {items.map((meta) => (
                    <li key={meta.key} className="px-3 py-3">
                      <CatalogEntry meta={meta} orgType={orgType} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      {unavailableMatches.length > 0 ? (
        <section className="rounded-lg border border-dashed border-border bg-surface-sunken/60 p-3.5">
          <h3 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <Building2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            Not available in this workspace
          </h3>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            These exist in Antcolos but belong to a different kind of organization, so they
            cannot be added to a role here or given to anybody.
          </p>
          <ul className="mt-2.5 space-y-2">
            {unavailableMatches.map((meta) => (
              <li key={meta.key} className="text-[0.8125rem] leading-relaxed">
                <span className="font-medium text-fg-muted">{meta.label}</span>
                <span className="text-fg-subtle"> — {meta.description} </span>
                <span className="text-fg-subtle">
                  Only in{" "}
                  {(meta.orgTypes ?? []).map((t) => ORG_TYPE_LABEL[t]).join(" and ")}.
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const ORG_TYPE_LABEL: Record<OrganizationType, string> = {
  CARRIER: "a carrier workspace",
  DISPATCH_AGENCY: "a dispatch workspace",
};

function CatalogEntry({ meta, orgType }: { meta: PermissionMeta; orgType: OrganizationType }) {
  const availableKeys = new Set(availablePermissions(orgType).map((p) => p.key));
  const prerequisites = (meta.prerequisites ?? []).filter((k) => availableKeys.has(k));

  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.875rem] font-medium text-fg">{meta.label}</span>
        {meta.financial ? <FinancialChip /> : null}
        {meta.sensitive && !meta.financial ? <SensitiveChip /> : null}
        {meta.orgTypes ? (
          <span className="shrink-0 rounded-full bg-st-neutral-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
            {meta.orgTypes.length === 1 ? ORG_TYPE_LABEL[meta.orgTypes[0]] : "Both workspace types"}
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">{meta.description}</p>

      {meta.scopeNote ? (
        <p className="mt-1.5 flex gap-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{meta.scopeNote}</span>
        </p>
      ) : null}

      {prerequisites.length > 0 ? (
        <p className="mt-1 flex gap-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          <Link2 className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Needs{" "}
            <span className="font-medium text-fg-muted">
              {prerequisites.map((k) => permissionMeta(k).label).join(" and ")}
            </span>{" "}
            alongside it, or it does nothing on its own.
          </span>
        </p>
      ) : null}

      <p className="mt-1 font-mono text-[0.6875rem] text-fg-subtle">{meta.key}</p>
    </div>
  );
}

/** The catalog keys, for a screen that wants the count without rendering it. */
export function catalogSize(orgType: OrganizationType): number {
  return availablePermissions(orgType).length;
}

export type { PermissionKey };

"use client";

import { ArrowLeft, Check, ShieldAlert, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { FormAlert } from "@/features/auth/form-alert";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import type { RosterEntry } from "@/lib/api/contracts/access";
import type { AccessDiff } from "@/lib/permissions/applied";
import { permissionMeta } from "@/lib/permissions";
import type { PermissionTemplate } from "@/types";
import { AccessDiffView } from "./access-diff";
import { PermissionSummary } from "./permission-summary";

/**
 * Applying a role to people who are already here.
 *
 * ★ THIS SCREEN EXISTS BECAUSE EDITING A ROLE DOES NOTHING TO ANYBODY ★
 * That is the product's promise, and a promise like it needs somewhere for the
 * work to go afterwards: an owner who edits "Limited Dispatcher" still wants
 * the three dispatchers on it to end up with the new selection. So this is the
 * separate, deliberate, per-person act that does it — and it never fires
 * without the before and after having been on screen first.
 *
 * ★ ONE PERSON AT A TIME, AND NO "APPLY TO ALL" ★
 * There is deliberately no bulk button. Every seat has its own person-specific
 * grants and revocations, so "apply to all" means a different change for each
 * of them behind one click, and the only place those differences are visible is
 * the per-person preview. An owner with five people to move reads five previews
 * and presses five buttons, which is the point rather than the cost.
 */
export function ApplyTemplatePanel({
  template,
  onDone,
  onCancel,
}: {
  template: PermissionTemplate;
  onDone: (message?: string) => void;
  onCancel: () => void;
}) {
  const ctx = useServiceContext();
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [diff, setDiff] = useState<AccessDiff | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void services.access.roster(ctx).then((rows) => {
      if (!cancelled) setRoster(rows);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.organizationId, ctx?.membershipId]);

  const choose = useCallback(async (entry: RosterEntry) => {
    if (!ctx) return;
    setSelected(entry);
    setDiff(null);
    setRefusal(null);
    setLoadingPreview(true);
    const preview = await services.access.previewApplication(
      ctx, entry.membership.id, template.id,
    );
    setLoadingPreview(false);
    if (!preview) {
      setRefusal(
        "This role cannot be applied to that person. You may not have the authority to change "
        + "their access, or they may not be in this organization.",
      );
      return;
    }
    setDiff(preview);
  }, [ctx, template.id]);

  async function confirm() {
    if (!ctx || !selected) return;
    setApplying(true);
    setRefusal(null);
    const result = await services.access.applyToMembership(
      ctx, selected.membership.id, template.id,
    );
    setApplying(false);
    if (result.status === "refused") {
      setRefusal(result.message);
      return;
    }
    setApplied((prev) => [...prev, selected.membership.id]);
    setSelected(null);
    setDiff(null);
    // Refreshed from the store by the caller: the roster it shows is the one
    // this write just changed, so it is re-read rather than patched here.
    void services.access.roster(ctx).then(setRoster);
  }

  if (!ctx) return null;

  const eligible = (roster ?? []).filter(
    (e) => !e.membership.isOwner && e.membership.id !== ctx.membershipId,
  );
  const holders = eligible.filter((e) =>
    e.membership.appliedTemplates.some((a) => a.templateId === template.id));
  const behind = holders.filter((e) =>
    e.membership.appliedTemplates.some(
      (a) => a.templateId === template.id && a.version !== template.version,
    ));
  const others = eligible.filter((e) => !holders.includes(e));

  return (
    <div className="space-y-section">
      <PageHeader
        title={`Apply “${template.name}”`}
        description={`Version ${template.version} · ${template.permissions.length} permissions. Choose a person to see exactly what changes for them before anything happens.`}
        actions={
          <Button variant="ghost" onClick={onCancel}>
            <ArrowLeft aria-hidden />
            Back to roles
          </Button>
        }
      />

      {refusal ? (
        <FormAlert tone="danger" title="Nothing was changed.">{refusal}</FormAlert>
      ) : null}

      {applied.length > 0 ? (
        <FormAlert
          tone="success"
          title={`Applied to ${applied.length} ${applied.length === 1 ? "person" : "people"}.`}
        >
          <p>
            Their permissions changed straight away. Nobody was signed out, and anybody else
            holding this role is untouched.
          </p>
        </FormAlert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
          {roster === null ? <LoadingSkeleton rows={4} /> : null}

          {roster !== null && eligible.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title="Nobody to apply it to"
              description="This role can be attached to an invitation instead, so somebody joins with it already on."
            />
          ) : null}

          {behind.length > 0 ? (
            <PersonGroup
              title={`On an earlier version (${behind.length})`}
              hint={`They hold this role at an older version and keep that access until you move them to version ${template.version}.`}
              entries={behind}
              template={template}
              selectedId={selected?.membership.id ?? null}
              appliedIds={applied}
              onChoose={choose}
            />
          ) : null}

          {holders.length - behind.length > 0 ? (
            <PersonGroup
              title={`Already on version ${template.version} (${holders.length - behind.length})`}
              hint="Applying it again would change nothing for them."
              entries={holders.filter((e) => !behind.includes(e))}
              template={template}
              selectedId={selected?.membership.id ?? null}
              appliedIds={applied}
              onChoose={choose}
            />
          ) : null}

          {others.length > 0 ? (
            <PersonGroup
              title={`Does not have this role (${others.length})`}
              hint="Applying it adds its permissions on top of whatever they already have."
              entries={others}
              template={template}
              selectedId={selected?.membership.id ?? null}
              appliedIds={applied}
              onChoose={choose}
            />
          ) : null}

          <p className="flex gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
            <ShieldAlert className="mt-px size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span>
              Owners and your own seat are not listed. An owner already has everything, and
              nobody changes their own access from here.
            </span>
          </p>
        </div>

        <div className="min-w-0 space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-[0.875rem] font-medium text-fg">
                Pick somebody to see the before and after
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-relaxed text-fg-muted">
                Nothing is applied until you confirm it for that person, and each person is
                confirmed separately because each one starts from somewhere different.
              </p>
              <div className="mt-5 text-left">
                <h3 className="mb-2 text-[0.875rem] font-semibold text-fg">
                  What this role grants
                </h3>
                <PermissionSummary permissions={template.permissions} />
              </div>
            </div>
          ) : null}

          {selected && loadingPreview ? <LoadingSkeleton rows={4} /> : null}

          {selected && diff ? (
            <div className="space-y-4" data-testid="apply-preview">
              <h2 className="text-[0.9375rem] font-semibold text-fg">
                {selected.displayName}
                {selected.membership.title ? (
                  <span className="ml-2 text-[0.8125rem] font-normal text-fg-muted">
                    {selected.membership.title}
                  </span>
                ) : null}
              </h2>
              <AccessDiffView diff={diff} subjectName={selected.displayName} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary" size="lg" onClick={confirm}
                  disabled={applying} aria-busy={applying || undefined}
                  data-testid="confirm-apply"
                >
                  <Check aria-hidden />
                  {applying ? "Applying…" : `Apply to ${selected.displayName}`}
                </Button>
                <Button
                  variant="ghost" size="lg"
                  onClick={() => { setSelected(null); setDiff(null); }}
                  disabled={applying}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            onDone(
              applied.length > 0
                ? `Applied “${template.name}” to ${applied.length} ${applied.length === 1 ? "person" : "people"}.`
                : undefined,
            )}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function PersonGroup({
  title, hint, entries, template, selectedId, appliedIds, onChoose,
}: {
  title: string;
  hint: string;
  entries: RosterEntry[];
  template: PermissionTemplate;
  selectedId: string | null;
  appliedIds: string[];
  onChoose: (entry: RosterEntry) => void;
}) {
  return (
    <section>
      <h3 className="text-[0.8125rem] font-semibold text-fg">{title}</h3>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{hint}</p>
      <ul className="mt-2 space-y-1.5">
        {entries.map((entry) => {
          const { membership, permissions, displayName } = entry;
          const held = membership.appliedTemplates.find((a) => a.templateId === template.id);
          const isSelected = selectedId === membership.id;
          const justApplied = appliedIds.includes(membership.id);
          return (
            <li key={membership.id}>
              <button
                type="button"
                onClick={() => onChoose(entry)}
                aria-pressed={isSelected}
                data-testid="apply-candidate"
                data-membership-id={membership.id}
                className={[
                  "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  isSelected
                    ? "border-primary bg-primary/8"
                    : "border-border bg-surface hover:bg-surface-hover",
                ].join(" ")}
              >
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {displayName}
                  {justApplied ? (
                    <span className="rounded-full bg-st-success-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-success">
                      Applied
                    </span>
                  ) : null}
                  {held ? (
                    <span className="rounded-full bg-st-neutral-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-neutral tabular-nums">
                      v{held.version}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                  {membership.title ?? "Member"} · {permissions.length}{" "}
                  {permissions.length === 1 ? "permission" : "permissions"} now
                  {permissions.length > 0 ? (
                    <>
                      {" — "}
                      {permissions.slice(0, 4).map((k) => permissionMeta(k).label).join(" · ")}
                      {permissions.length > 4 ? ` · +${permissions.length - 4} more` : null}
                    </>
                  ) : null}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

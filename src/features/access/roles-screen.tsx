"use client";

import {
  Archive, ArchiveRestore, BookOpen, Copy, History, Lock, Pencil, Plus,
  ShieldCheck, Trash2, Users, Loader2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { FormAlert } from "@/features/auth/form-alert";
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  grantablePermissionKeys,
  isOwnerTemplate,
  missingPrerequisites,
  permissionMeta,
  validateRoleName,
} from "@/lib/permissions";
import { services } from "@/lib/api";
import { apiClient } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useServiceContext } from "@/lib/api/use-service-context";
import type { TemplateSummary } from "@/lib/api/contracts/access";
import { subscribeRoster } from "@/lib/session/membership-store";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import type { OrganizationType, PermissionKey, PermissionTemplate } from "@/types";
import { ApiPermissionPicker } from "./api-permission-picker";
import { PermissionCatalog } from "./permission-catalog";

import { ApplyTemplatePanel } from "./apply-template-panel";
import { cn } from "@/lib/utils";

type View =
  | { mode: "list" }
  | { mode: "edit"; template: PermissionTemplate | null }
  | { mode: "apply"; template: PermissionTemplate };

type Tab = "roles" | "catalog";

function getFriendlyErrorMessage(err: any): string {
  const msg = err?.response?.data?.message || err?.message || "An unexpected error occurred.";
  if (typeof msg === "string" && msg.includes("Invalid permission")) {
    const match = msg.match(/Invalid permission '([^']+)'/);
    const perm = match ? ` (${match[1]})` : "";
    return `This role contains outdated permissions${perm}. Please edit and save it first to automatically update them.`;
  }
  return msg;
}

function migrateKey(p: string) {
  if (typeof p !== "string" || !p.includes(":")) return p;
  let key = p.replace(/:/g, '.');
  key = key.replace(/^trucks\./, 'truck.');
  key = key.replace(/^loads\./, 'load.');
  key = key.replace(/^settlements\./, 'settlement.');
  key = key.replace(/^invoices\./, 'invoice.');
  key = key.replace(/^expenses\./, 'expense.');
  key = key.replace(/^documents\./, 'document.');
  key = key.replace(/^members\./, 'membership.');
  key = key.replace(/^invitations\./, 'invitation.');
  
  if (key === 'truck.view') return 'truck.read';
  if (key === 'load.view') return 'load.read';
  if (key === 'settlement.view') return 'settlement.read';
  if (key === 'invoice.view') return 'invoice.read';
  if (key === 'expense.view') return 'expense.read';
  if (key === 'document.view') return 'document.read';
  if (key === 'document.upload') return 'document.create';
  if (key === 'membership.view') return 'membership.list';
  if (key === 'invitation.view') return 'invitation.list';
  return key;
}

/**
 * Roles and permissions.
 *
 * ★ THE ONE SENTENCE THIS SCREEN HAS TO GET ACROSS ★
 * A role is a saved way of CHOOSING permissions. It is not where somebody's
 * access lives. Editing one changes the role and nobody's access; moving people
 * onto the new version is a separate act, one person at a time, with the
 * before and after shown first. Every label, count and confirmation here is
 * written to make that true rather than to explain it after the fact.
 *
 * Owner sits at the top and cannot be touched: it is the lockout guard, not a
 * role, so there is deliberately no edit, archive or delete on it.
 */
export function RolesScreen() {
  const { organization } = useActiveMembership();
  const myPermissions = usePermissions();
  const ctx = useServiceContext();

  const [tab, setTab] = useState<Tab>("roles");
  const [summaries, setSummaries] = useState<TemplateSummary[] | null>(null);
  const [view, setView] = useState<View>({ mode: "list" });
  const [busyState, setBusyState] = useState<{ id: string; action: string } | null>(null);


  const orgType: OrganizationType = organization?.type ?? "CARRIER";

  /*
   * Re-read rather than patch. Member counts and "how many are behind" are
   * derived from the live roster, so applying a role in one place has to move
   * the numbers in another — and a local patch would be a second, slowly wrong
   * copy of exactly the thing this screen is supposed to be honest about.
   */
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => subscribeRoster(refresh), [refresh]);
  
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    
    // Fetch from actual API instead of the mock services.access.templates
    apiClient.get('/organizations/roles').then((res) => {
      if (cancelled) return;
      const roles = res.data?.roles || [];
      const mappedSummaries: TemplateSummary[] = roles.map((r: any) => {
        return {
          template: {
            id: r.id,
            name: r.name,
            description: r.description || "",
            permissions: (r.permissions || []).map(migrateKey),
            version: 1, // API currently does not provide version
            seeded: false, // Wait for backend to provide a flag if some roles shouldn't be deletable
            archived: false,
            createdAt: r.createdAt || new Date().toISOString(),
            updatedAt: r.updatedAt || new Date().toISOString(),
          },
          memberCount: 0, // Need future API support for actual member count
          behindCount: 0,
        };
      });
      setSummaries(mappedSummaries);
    }).catch(() => {
      if (!cancelled) setSummaries([]);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.organizationId, ctx?.membershipId, tick]);

  const grantable = useMemo(
    () => new Set(grantablePermissionKeys(myPermissions, orgType)),
    [myPermissions, orgType],
  );

  const act = useCallback(
    async (id: string, action: string, run: () => Promise<void>) => {
      setBusyState({ id, action });

      await run();
      setBusyState(null);
      refresh();
    },
    [refresh],
  );

  if (!organization || !ctx) return null;

  if (view.mode === "edit") {
    return (
      <TemplateEditor
        template={view.template}
        summary={summaries?.find((s) => s.template.id === view.template?.id) ?? null}
        existingNames={(summaries ?? [])
          .filter((s) => s.template.id !== view.template?.id)
          .map((s) => s.template.name)}
        orgType={orgType}
        grantable={grantable}
        onCancel={() => setView({ mode: "list" })}
        onSaved={(saved, wasEdit, backendMsg) => {
          setView({ mode: "list" });
          if (wasEdit) {
            toast.success(backendMsg || `Saved "${saved.name}" successfully.`);
          } else {
            toast.success(backendMsg || `Created "${saved.name}" successfully.`);
          }
          refresh();
        }}
      />
    );
  }

  if (view.mode === "apply") {
    return (
      <ApplyTemplatePanel
        template={view.template}
        onDone={(message) => {
          setView({ mode: "list" });
          if (message) toast.success(message);
          refresh();
        }}
        onCancel={() => setView({ mode: "list" })}
      />
    );
  }

  const active = (summaries ?? []).filter((s) => !s.template.archived && !isOwnerTemplate(s.template));
  const archived = (summaries ?? []).filter((s) => s.template.archived);
  const behindTotal = active.reduce((n, s) => n + s.behindCount, 0);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Roles and permissions"
        description="A role is a saved set of permissions you can hand to several people at once. Editing one never changes what anybody can already do."
        actions={
          tab === "roles" ? (
            <Button variant="primary" onClick={() => setView({ mode: "edit", template: null })}>
              <Plus aria-hidden />
              New role
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="Roles and permissions" className="flex gap-1 border-b border-border">
        <TabButton
          id="roles" current={tab} onSelect={setTab}
          icon={ShieldCheck} label="Roles"
          count={active.length}
        />
        <TabButton
          id="catalog" current={tab} onSelect={setTab}
          icon={BookOpen} label="What each permission allows"
        />
      </div>

      {tab === "catalog" ? <PermissionCatalog orgType={orgType} /> : null}

      {tab === "roles" ? (
        <div className="space-y-section">


          {behindTotal > 0 ? (
            <FormAlert
              tone="info"
              title={`${behindTotal} ${behindTotal === 1 ? "person is" : "people are"} on an older version of a role`}
            >
              <p>
                That is the intended behaviour, not a problem to clear: a role was edited after
                they received it, and editing a role never changes what somebody can already do.
                Use “Apply to people” on the role to move them across, and you will see exactly
                what changes for each person before anything happens.
              </p>
            </FormAlert>
          ) : null}

          {summaries === null ? <LoadingSkeleton rows={3} /> : null}

          {summaries !== null && active.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No roles yet"
              description="Make one when you want to give the same set of permissions to more than one person — save it once, then apply it as often as you like."
              action={
                <Button variant="primary" onClick={() => setView({ mode: "edit", template: null })}>
                  Create a role
                </Button>
              }
            />
          ) : null}

          {active.length > 0 ? (
            <ul className="space-y-2.5">
              {active.map((summary) => (
                <TemplateRow
                  key={summary.template.id}
                  summary={summary}
                  busy={busyState?.id === summary.template.id}
                  busyAction={busyState?.id === summary.template.id ? busyState.action : undefined}
                  onEdit={() => setView({ mode: "edit", template: summary.template })}
                  onApply={() => setView({ mode: "apply", template: summary.template })}
                  onDuplicate={() =>
                    act(summary.template.id, "duplicate", async () => {
                      try {
                        const draft = {
                          name: summary.template.name + " Copy",
                          description: summary.template.description,
                          permissions: summary.template.permissions
                        };
                        await apiClient.post('/organizations/roles', draft);
                        toast.success(`Duplicated "${summary.template.name}".`);
                      } catch (err: any) {
                        toast.error("That role was not duplicated.", { description: getFriendlyErrorMessage(err) });
                      }
                    })}
                  onArchive={() =>
                    act(summary.template.id, "archive", async () => {
                      const result = await services.access.setTemplateArchived(ctx, summary.template.id, true);
                      if (result.status === "refused") {
                        toast.error("That role was not archived.", { description: result.message });
                      }
                    })}
                  onDelete={() =>
                    act(summary.template.id, "delete", async () => {
                      try {
                        await apiClient.delete(`/organizations/roles/${summary.template.id}`);
                        toast.success(`Role "${summary.template.name}" deleted.`);
                      } catch (err: any) {
                        toast.error(err.message || "That role was not deleted.");
                      }
                    })}
                />
              ))}
            </ul>
          ) : null}

          {archived.length > 0 ? (
            <section>
              <h2 className="mb-2.5 text-[0.875rem] font-semibold text-fg">Archived</h2>
              <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                Archived roles cannot be applied to anybody new or attached to an invitation.
                Anyone already holding one keeps their access — archiving takes nothing away.
              </p>
              <ul className="space-y-2.5">
                {archived.map((summary) => (
                  <TemplateRow
                    key={summary.template.id}
                    summary={summary}
                    busy={busyState?.id === summary.template.id}
                    busyAction={busyState?.id === summary.template.id ? busyState.action : undefined}
                    onEdit={() => setView({ mode: "edit", template: summary.template })}
                    onApply={null}
                    onDuplicate={() =>
                      act(summary.template.id, "duplicate", async () => {
                        await services.access.duplicateTemplate(ctx, summary.template.id);
                      })}
                    onArchive={() =>
                      act(summary.template.id, "archive", async () => {
                        await services.access.setTemplateArchived(ctx, summary.template.id, false);
                      })}
                    onDelete={() =>
                      act(summary.template.id, "delete", async () => {
                        try {
                          await apiClient.delete(`/organizations/roles/${summary.template.id}`);
                          toast.success(`Role "${summary.template.name}" deleted.`);
                        } catch (err: any) {
                          toast.error(err.message || "That role was not deleted.");
                        }
                      })}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  id, current, onSelect, icon: Icon, label, count,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  icon: typeof ShieldCheck;
  label: string;
  count?: number;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[0.875rem] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-primary text-fg"
          : "border-transparent text-fg-muted hover:text-fg",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
      {typeof count === "number" ? (
        <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-fg-subtle">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function TemplateRow({
  summary, busy, busyAction, onEdit, onApply, onDuplicate, onArchive, onDelete,
}: {
  summary: TemplateSummary;
  busy: boolean;
  busyAction?: string;
  onEdit: () => void;
  onApply: (() => void) | null;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { template, memberCount, behindCount } = summary;
  const inUse = memberCount > 0;

  return (
    <li className="rounded-lg border border-border bg-surface p-4 shadow-e1" data-testid="role-row">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-fg">
            {template.name}
            {template.seeded ? (
              <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
                Came with the workspace
              </span>
            ) : null}
            {template.archived ? (
              <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
                Archived
              </span>
            ) : null}
          </p>
          {template.description ? (
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              {template.description}
            </p>
          ) : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
            <span className="tabular-nums">
              {template.permissions.length} permissions
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden />
              {memberCount} {memberCount === 1 ? "person" : "people"}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <History className="size-3.5" aria-hidden />
              Version {template.version}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onApply ? (
            <Button variant="secondary" size="sm" onClick={onApply} disabled={busy}>
              <Users aria-hidden />
              Apply to people
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
            <Pencil aria-hidden />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={busy}>
            {busyAction === "duplicate" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Copy aria-hidden />
            )}
            Duplicate
          </Button>
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={busy}>
            {template.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {template.archived ? "Restore" : "Archive"}
          </Button>
          <ConfirmDialog
            title="Delete role"
            description={`Are you sure you want to delete the "${template.name}" role? This action cannot be undone.`}
            onConfirm={onDelete}
            destructive
            trigger={
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || inUse || template.seeded}
                className="text-st-danger hover:bg-st-danger/10 hover:text-st-danger"
                title={
                  template.seeded
                    ? "Roles that came with the workspace cannot be deleted"
                    : inUse
                      ? "Roles that people hold cannot be deleted"
                      : undefined
                }
                aria-label={`Delete ${template.name}`}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            }
          />
        </div>
      </div>

      {behindCount > 0 ? (
        <p
          className="mt-2.5 rounded-md border border-st-info/35 bg-st-info-bg/40 px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted"
          data-testid="behind-notice"
        >
          <span className="font-medium text-fg">
            {behindCount} of {memberCount} {behindCount === 1 ? "person is" : "people are"} on an
            earlier version.
          </span>{" "}
          They keep the access they were given until somebody applies version {template.version} to
          them. Nothing about their work changes in the meantime.
        </p>
      ) : null}
    </li>
  );
}

function TemplateEditor({
  template, summary, existingNames, orgType, grantable, onCancel, onSaved,
}: {
  template: PermissionTemplate | null;
  summary: TemplateSummary | null;
  existingNames: string[];
  orgType: OrganizationType;
  grantable: ReadonlySet<PermissionKey>;
  onCancel: () => void;
  onSaved: (saved: PermissionTemplate, wasEdit: boolean, backendMsg?: string) => void;
}) {
  const ctx = useServiceContext();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [permissions, setPermissions] = useState<Set<string>>(
    () => new Set(template?.permissions ?? []),
  );

  useEffect(() => {
    setPermissions(new Set(template?.permissions ?? []));
  }, [template?.id]);

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => [...permissions], [permissions]);
  const nameError = submitted ? validateRoleName(name, existingNames) : null;
  const memberCount = summary?.memberCount ?? 0;

  async function save() {
    if (!ctx) return;
    setSubmitted(true);
    if (validateRoleName(name, existingNames)) return;
    setSaving(true);
    const draft = { name, description, permissions: selected };
    
    try {
      if (template) {
        const res = await apiClient.patch(`/organizations/roles/${template.id}`, { ...draft, syncMembers: false });
        onSaved({ ...template, name, description, permissions: selected as PermissionKey[] }, true, res.data?.message);
      } else {
        const res = await apiClient.post('/organizations/roles', draft);
        onSaved({
          id: res.data?.id || "new",
          organizationId: ctx.organizationId,
          name,
          description,
          permissions: selected as PermissionKey[],
          version: 1,
          seeded: false,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, false, res.data?.message);
      }
    } catch (err: any) {
      toast.error("That role was not saved.", { description: getFriendlyErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title={template ? `Edit ${template.name}` : "New role"}
        description={
          template
            ? "Changing a role changes the role. Nobody's access moves until you apply it to them."
            : "Give the role a name, then choose exactly what anyone you apply it to can do."
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <Field
            label="Role name"
            htmlFor="role-name"
            hint={nameError ? undefined : "What your team will call this role."}
            error={nameError ?? undefined}
          >
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={ROLE_NAME_MAX_LENGTH}
              placeholder="Limited dispatcher"
              aria-invalid={nameError ? true : undefined}
              className={cn(nameError && "border-st-danger")}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="role-description"
            hint="Optional. A line to remind you who this is for."
          >
            <Textarea
              id="role-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={ROLE_DESCRIPTION_MAX_LENGTH}
              placeholder="Covers the overnight desk. Can move freight but never sees rates."
            />
          </Field>

          {template && memberCount > 0 ? (
            <div
              className="rounded-md border border-st-info/35 bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed"
              data-testid="edit-safety-notice"
            >
              <p className="font-medium text-fg">
                {memberCount} {memberCount === 1 ? "person holds" : "people hold"} this role.
              </p>
              <p className="mt-0.5 text-fg-muted">
                Saving does not change what any of them can do. They keep the permissions they were
                given, and stay on the version they were given, until you apply this one to them
                from the roles list — where you will see the before and after for each person
                first.
              </p>
            </div>
          ) : null}

        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-[0.9375rem] font-semibold text-fg">What this role can do</h2>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              Anyone you apply it to gets exactly this, minus anything you have taken away from
              them personally.
            </p>
          </div>

          <ApiPermissionPicker
            selected={permissions}
            onChange={setPermissions}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary" size="lg" onClick={save}
              disabled={saving} aria-busy={saving || undefined}
            >
              {saving ? (template ? "Saving…" : "Creating…") : template ? "Save changes" : "Create role"}
            </Button>
            <Button variant="ghost" size="lg" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}



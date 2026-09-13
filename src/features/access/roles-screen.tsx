"use client";

import {
  Archive, ArchiveRestore, Copy, Lock, Pencil, Plus, ShieldCheck, Trash2, Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  clampToGrantable,
  grantablePermissionKeys,
  validateRoleName,
} from "@/lib/permissions";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import type { CustomRole, PermissionKey } from "@/types";
import { PermissionPicker } from "./permission-picker";
import {
  NeverGrantableNotice,
  PermissionSummary,
  SensitiveAccessWarning,
} from "./permission-summary";
import {
  mockCreateRole,
  mockDeleteRole,
  mockDuplicateRole,
  mockListRoles,
  mockSetRoleArchived,
  mockUpdateRole,
} from "./mock-access";
import { cn } from "@/lib/utils";

type View = { mode: "list" } | { mode: "edit"; role: CustomRole | null };

/**
 * Roles and permissions.
 *
 * Owner sits at the top and cannot be touched: it is the lockout guard, not a
 * role, so there is deliberately no edit, archive or delete on it.
 */
export function RolesScreen() {
  const { organization } = useActiveMembership();
  const myPermissions = usePermissions();
  const [roles, setRoles] = useState<CustomRole[] | null>(null);
  const [view, setView] = useState<View>({ mode: "list" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ role: CustomRole; memberCount: number } | null>(null);

  const orgType = organization?.type ?? "CARRIER";

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    mockListRoles(organization.id).then((list) => {
      if (!cancelled) setRoles(list);
    });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  async function duplicate(role: CustomRole) {
    setBusyId(role.id);
    const copy = await mockDuplicateRole(role.id);
    setRoles((prev) => (prev ? [copy, ...prev] : [copy]));
    setBusyId(null);
  }

  async function setArchived(role: CustomRole, archived: boolean) {
    setBusyId(role.id);
    const updated = await mockSetRoleArchived(role.id, archived);
    setRoles((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
    setBusyId(null);
  }

  async function remove(role: CustomRole) {
    setBusyId(role.id);
    const result = await mockDeleteRole(role.id);
    if (result.status === "blocked") {
      setBlocked({ role, memberCount: result.memberCount });
    } else {
      setRoles((prev) => prev?.filter((r) => r.id !== role.id) ?? null);
    }
    setBusyId(null);
  }

  if (view.mode === "edit") {
    return (
      <RoleEditor
        role={view.role}
        existingNames={(roles ?? [])
          .filter((r) => r.id !== view.role?.id)
          .map((r) => r.name)}
        onCancel={() => setView({ mode: "list" })}
        onSaved={(saved) => {
          setRoles((prev) => {
            if (!prev) return [saved];
            return prev.some((r) => r.id === saved.id)
              ? prev.map((r) => (r.id === saved.id ? saved : r))
              : [saved, ...prev];
          });
          setView({ mode: "list" });
        }}
        grantable={new Set(grantablePermissionKeys(myPermissions, orgType))}
        orgType={orgType}
        organizationId={organization?.id ?? ""}
      />
    );
  }

  const active = (roles ?? []).filter((r) => !r.archived);
  const archived = (roles ?? []).filter((r) => r.archived);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Roles and permissions"
        description="A role is a saved set of permissions you can hand to several people at once."
        actions={
          <Button variant="primary" onClick={() => setView({ mode: "edit", role: null })}>
            <Plus aria-hidden />
            New role
          </Button>
        }
      />

      <OwnerRoleCard />

      {roles === null ? <LoadingSkeleton rows={3} /> : null}

      {blocked ? (
        <div role="alert" className="rounded-lg border border-st-warning/40 bg-st-warning-bg/60 p-4">
          <p className="text-[0.875rem] font-medium text-fg">
            “{blocked.role.name}” cannot be deleted — {blocked.memberCount}{" "}
            {blocked.memberCount === 1 ? "person holds" : "people hold"} it right now.
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            Deleting it would strip their access with no warning. Move those people to another role
            first, or archive this one — archiving keeps everyone working and only stops the role
            being handed out again.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void setArchived(blocked.role, true);
                setBlocked(null);
              }}
            >
              <Archive aria-hidden />
              Archive instead
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBlocked(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {roles !== null && active.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No custom roles yet"
          description="Presets cover most people. Make a role when you want the same custom set of permissions for several people."
          action={
            <Button variant="primary" onClick={() => setView({ mode: "edit", role: null })}>
              Create a role
            </Button>
          }
        />
      ) : null}

      {active.length > 0 ? (
        <ul className="space-y-2.5">
          {active.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              busy={busyId === role.id}
              onEdit={() => setView({ mode: "edit", role })}
              onDuplicate={() => duplicate(role)}
              onArchive={() => setArchived(role, true)}
              onDelete={() => remove(role)}
            />
          ))}
        </ul>
      ) : null}

      {archived.length > 0 ? (
        <section>
          <h2 className="mb-2.5 text-[0.875rem] font-semibold text-fg">Archived</h2>
          <p className="mb-2.5 text-[0.8125rem] text-fg-muted">
            Archived roles still work for anyone who holds them, but cannot be given to anyone new.
          </p>
          <ul className="space-y-2.5">
            {archived.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                busy={busyId === role.id}
                onEdit={() => setView({ mode: "edit", role })}
                onDuplicate={() => duplicate(role)}
                onArchive={() => setArchived(role, false)}
                onDelete={() => remove(role)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OwnerRoleCard() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-4">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted shadow-e1"
      >
        <Lock className="size-[1.125rem]" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-fg">
          Owner
          <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
            Permanent
          </span>
        </p>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          You. Full access to everything, always. Owner cannot be edited, restricted, archived,
          deleted, or handed out in an invitation — transferring ownership is a separate,
          deliberate act.
        </p>
      </div>
    </div>
  );
}

function RoleRow({
  role,
  busy,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  role: CustomRole;
  busy: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const inUse = role.memberCount > 0;
  return (
    <li className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-fg">
            {role.name}
            {role.archived ? (
              <span className="rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
                Archived
              </span>
            ) : null}
          </p>
          {role.description ? (
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              {role.description}
            </p>
          ) : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
            <span className="tabular-nums">{role.permissions.length} permissions</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden />
              {role.memberCount} {role.memberCount === 1 ? "member" : "members"}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
            <Pencil aria-hidden />
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={onDuplicate} disabled={busy}>
            <Copy aria-hidden />
            Duplicate
          </Button>
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={busy}>
            {role.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {role.archived ? "Restore" : "Archive"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={busy || inUse}
            title={inUse ? "Roles that people hold cannot be deleted" : undefined}
            aria-label={`Delete ${role.name}`}
          >
            <Trash2 aria-hidden />
            Delete
          </Button>
        </div>
      </div>
      {inUse ? (
        <p className="mt-2.5 text-[0.75rem] text-fg-subtle">
          Held by {role.memberCount} {role.memberCount === 1 ? "person" : "people"}, so it cannot be
          deleted. Archive it to stop it being handed out.
        </p>
      ) : null}
    </li>
  );
}

function RoleEditor({
  role,
  existingNames,
  organizationId,
  orgType,
  grantable,
  onCancel,
  onSaved,
}: {
  role: CustomRole | null;
  existingNames: string[];
  organizationId: string;
  orgType: "CARRIER" | "DISPATCH_AGENCY";
  grantable: Set<PermissionKey>;
  onCancel: () => void;
  onSaved: (role: CustomRole) => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<Set<PermissionKey>>(
    () => new Set(role?.permissions ?? []),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => [...permissions], [permissions]);
  const nameError = submitted ? validateRoleName(name, existingNames) : null;

  async function save() {
    setSubmitted(true);
    if (validateRoleName(name, existingNames)) return;
    setSaving(true);
    const draft = {
      name,
      description,
      // Never save more than this owner could grant, whatever the UI allowed.
      permissions: clampToGrantable(selected, grantable, orgType),
    };
    const saved = role
      ? await mockUpdateRole(role.id, draft)
      : await mockCreateRole(organizationId, draft);
    setSaving(false);
    onSaved(saved);
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title={role ? `Edit ${role.name}` : "New role"}
        description={
          role
            ? `Changing this role changes what its ${role.memberCount} ${
                role.memberCount === 1 ? "member" : "members"
              } can do, straight away.`
            : "Give the role a name, then choose exactly what anyone holding it can do."
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
              placeholder="Night dispatcher"
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

          {role && role.memberCount > 0 ? (
            <div className="rounded-md border border-st-info/35 bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed">
              <p className="font-medium text-fg">
                {role.memberCount} {role.memberCount === 1 ? "person holds" : "people hold"} this
                role.
              </p>
              <p className="mt-0.5 text-fg-muted">
                Saving changes what they can do immediately. Nobody is signed out.
              </p>
            </div>
          ) : null}

          <NeverGrantableNotice />
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-[0.9375rem] font-semibold text-fg">What this role can do</h2>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              Anyone holding it gets exactly this, and nothing else.
            </p>
          </div>

          <PermissionPicker
            orgType={orgType}
            selected={permissions}
            onChange={setPermissions}
            grantable={grantable}
          />

          <SensitiveAccessWarning permissions={selected} />

          {selected.length > 0 ? (
            <div>
              <h3 className="mb-2 text-[0.875rem] font-semibold text-fg">Summary</h3>
              <PermissionSummary permissions={selected} />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={save} disabled={saving} aria-busy={saving || undefined}>
              {saving ? "Saving…" : role ? "Save changes" : "Create role"}
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

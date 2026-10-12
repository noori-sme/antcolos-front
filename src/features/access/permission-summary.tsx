import { Lock, TriangleAlert } from "lucide-react";
import {
  NEVER_GRANTABLE,
  PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER,
  financialPermissions,
  permissionMeta,
  sensitivePermissions,
} from "@/lib/permissions";
import type { PermissionGroup, PermissionKey } from "@/types";

/** Every selected permission, grouped by module, for review before committing. */
export function PermissionSummary({ permissions }: { permissions: readonly (PermissionKey | string)[] }) {
  if (permissions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[0.8125rem] text-fg-muted">
        No permissions selected. This person will be able to sign in and see nothing else.
      </p>
    );
  }

  const grouped = new Map<PermissionGroup, string[]>();
  for (const key of permissions) {
    const { group } = permissionMeta(key);
    grouped.set(group, [...(grouped.get(group) ?? []), key]);
  }
  const ordered = Array.from(grouped.keys()).sort((a, b) => {
    const idxA = PERMISSION_GROUP_ORDER.indexOf(a);
    const idxB = PERMISSION_GROUP_ORDER.indexOf(b);
    return (idxA >= 0 ? idxA : 999) - (idxB >= 0 ? idxB : 999);
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <p className="border-b border-border bg-surface-sunken px-3.5 py-2 text-[0.75rem] font-medium text-fg-muted tabular-nums">
        {permissions.length} {permissions.length === 1 ? "permission" : "permissions"} across{" "}
        {ordered.length} {ordered.length === 1 ? "module" : "modules"}
      </p>
      <dl className="divide-y divide-border">
        {ordered.map((group) => (
          <div key={group} className="px-3.5 py-2.5">
            <dt className="text-[0.75rem] font-semibold text-fg">
              {PERMISSION_GROUP_LABELS[group] || group}
            </dt>
            <dd className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
              {grouped.get(group)!.map((k) => permissionMeta(k).label).join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The warning shown before anything is saved or sent.
 *
 * Money is called out separately and first: an owner skimming a long list will
 * forgive a wrongly granted "view trailers" and will not forgive "see what
 * every load pays".
 */
export function SensitiveAccessWarning({ permissions }: { permissions: readonly (PermissionKey | string)[] }) {
  const financial = financialPermissions(permissions);
  const sensitive = sensitivePermissions(permissions);
  if (financial.length === 0 && sensitive.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {financial.length > 0 ? (
        <div
          role="alert"
          className="flex gap-2.5 rounded-md border border-st-warning/40 bg-st-warning-bg/60 px-3 py-2.5"
        >
          <TriangleAlert className="mt-px size-4 shrink-0 text-st-warning" aria-hidden />
          <div className="min-w-0 text-[0.8125rem] leading-relaxed">
            <p className="font-medium text-fg">
              This grants access to money and financial information.
            </p>
            <p className="mt-0.5 text-fg-muted">
              {financial.map((k) => permissionMeta(k).label).join(", ")}. Only give this to people
              you would let see your books.
            </p>
          </div>
        </div>
      ) : null}

      {sensitive.length > 0 ? (
        <div
          role="alert"
          className="flex gap-2.5 rounded-md border border-st-danger/35 bg-st-danger-bg/50 px-3 py-2.5"
        >
          <TriangleAlert className="mt-px size-4 shrink-0 text-st-danger" aria-hidden />
          <div className="min-w-0 text-[0.8125rem] leading-relaxed">
            <p className="font-medium text-fg">This includes powerful permissions.</p>
            <p className="mt-0.5 text-fg-muted">
              {sensitive.map((k) => permissionMeta(k).label).join(", ")}. These can delete records
              or change who else has access.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shown wherever permissions are chosen, so an owner can see that certain
 * powers are simply not on the menu — for anyone, ever.
 */
export function NeverGrantableNotice() {
  return (
    <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
      <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
        <Lock className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        Never given to anyone
      </p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
        These belong to you as the permanent Owner. They cannot be added to a role, attached to an
        invitation, or delegated to anyone.
      </p>
      <ul className="mt-2 space-y-1">
        {NEVER_GRANTABLE.map((item) => (
          <li key={item.id} className="text-[0.75rem] leading-relaxed text-fg-subtle">
            <span className="font-medium text-fg-muted">{item.label}</span> — {item.description}
          </li>
        ))}
      </ul>
    </div>
  );
}

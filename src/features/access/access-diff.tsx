"use client";

import { ArrowRight, Minus, Plus, ShieldAlert, UserCog } from "lucide-react";
import type { AccessDiff } from "@/lib/permissions/applied";
import { permissionMeta } from "@/lib/permissions";
import type { PermissionKey } from "@/types";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/utils";

/**
 * Before and after, for a change to one person's access.
 *
 * ★ WHY THE TOTALS ARE SHOWN ALONGSIDE THE CHANGES ★
 * "+4 permissions" is the number somebody skims and it is the wrong one to
 * decide on: the question is what this person will be able to do afterwards,
 * not how far it moved. So the headline is `before → after` and the added and
 * removed lists sit under it — and "removed" is first when there is anything in
 * it, because taking access away is the outcome people fail to notice.
 */
export function AccessDiffView({
  diff,
  subjectName,
}: {
  diff: AccessDiff;
  subjectName: string;
}) {
  const unchanged = diff.added.length === 0 && diff.removed.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
        <Total label="Now" count={diff.before.length} />
        <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        <Total
          label="Afterwards"
          count={diff.after.length}
          emphasis={!unchanged}
        />
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-fg-muted">
          {unchanged
            ? `${subjectName} ends up with exactly what they have now.`
            : `What ${subjectName} will be able to do once this is applied.`}
        </p>
      </div>

      {unchanged ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[0.8125rem] text-fg-muted">
          Nothing changes. {subjectName} already has everything this would give them, and loses
          nothing.
        </p>
      ) : null}

      {diff.removed.length > 0 ? (
        <ChangeList
          tone="removed"
          title={`${diff.removed.length} ${diff.removed.length === 1 ? "permission" : "permissions"} taken away`}
          keys={diff.removed}
        />
      ) : null}

      {diff.added.length > 0 ? (
        <ChangeList
          tone="added"
          title={`${diff.added.length} ${diff.added.length === 1 ? "permission" : "permissions"} added`}
          keys={diff.added}
        />
      ) : null}

      {diff.withheld.length > 0 ? (
        <FormAlert
          tone="warning"
          title={`${diff.withheld.length} of this role's permissions will not be given`}
        >
          <p>
            {diff.withheld.map((k) => permissionMeta(k).label).join(", ")}. You do not hold{" "}
            {diff.withheld.length === 1 ? "it" : "them"} yourself, so{" "}
            {diff.withheld.length === 1 ? "it is" : "they are"} left out rather than handed on.
            Ask an owner to apply this role if the whole of it is needed.
          </p>
        </FormAlert>
      ) : null}

      <PersonSpecific diff={diff} subjectName={subjectName} />
    </div>
  );
}

/**
 * The adjustments that belong to this person and not to the role.
 *
 * ★ THE MOST CONFUSING THING ABOUT A PREVIEW THAT OMITS THIS ★
 * An owner applies a role listing twelve permissions and the result shows ten.
 * Without this panel the only available conclusion is that the product lost
 * two. With it, the reason is on screen: somebody took those two away from this
 * person specifically, and a revocation beats anything a role brings.
 */
function PersonSpecific({ diff, subjectName }: { diff: AccessDiff; subjectName: string }) {
  const { grants, revocations, revocationsHidingTemplate } = diff.adjustments;
  if (grants.length === 0 && revocations.length === 0) return null;

  return (
    <div className="rounded-lg border border-st-info/35 bg-st-info-bg/40 px-3.5 py-3">
      <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
        <UserCog className="size-4 shrink-0 text-st-info" aria-hidden />
        Set for {subjectName} specifically
      </p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
        These are theirs alone. They are not part of any role and applying one does not clear
        them.
      </p>
      <dl className="mt-2 space-y-1.5 text-[0.75rem] leading-relaxed">
        {grants.length > 0 ? (
          <div>
            <dt className="inline font-medium text-fg-muted">Added just for them: </dt>
            <dd className="inline text-fg-subtle">
              {grants.map((k) => permissionMeta(k).label).join(" · ")}
            </dd>
          </div>
        ) : null}
        {revocations.length > 0 ? (
          <div>
            <dt className="inline font-medium text-fg-muted">Taken away just for them: </dt>
            <dd className="inline text-fg-subtle">
              {revocations.map((k) => permissionMeta(k).label).join(" · ")}
            </dd>
          </div>
        ) : null}
      </dl>
      {revocationsHidingTemplate.length > 0 ? (
        <p className="mt-2 flex gap-1.5 text-[0.75rem] leading-relaxed text-fg-muted">
          <ShieldAlert className="mt-px size-3.5 shrink-0 text-st-info" aria-hidden />
          <span>
            {revocationsHidingTemplate.length === 1 ? "One permission" : `${revocationsHidingTemplate.length} permissions`}{" "}
            in this role{" "}
            {revocationsHidingTemplate.length === 1 ? "was" : "were"} taken away from{" "}
            {subjectName} before, so applying it will not give{" "}
            {revocationsHidingTemplate.length === 1 ? "it" : "them"} back:{" "}
            {revocationsHidingTemplate.map((k) => permissionMeta(k).label).join(", ")}.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Total({
  label, count, emphasis,
}: { label: string; count: number; emphasis?: boolean }) {
  return (
    <div className="shrink-0">
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
      <p
        className={cn(
          "text-[1.125rem] font-semibold tabular-nums",
          emphasis ? "text-primary" : "text-fg",
        )}
      >
        {count}
      </p>
    </div>
  );
}

function ChangeList({
  tone, title, keys,
}: { tone: "added" | "removed"; title: string; keys: readonly PermissionKey[] }) {
  const Icon = tone === "added" ? Plus : Minus;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border",
        tone === "added" ? "border-st-success/35" : "border-st-danger/35",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 border-b px-3.5 py-2 text-[0.8125rem] font-medium text-fg",
          tone === "added"
            ? "border-st-success/35 bg-st-success-bg/50"
            : "border-st-danger/35 bg-st-danger-bg/45",
        )}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            tone === "added" ? "text-st-success" : "text-st-danger",
          )}
          aria-hidden
        />
        {title}
      </p>
      <ul className="divide-y divide-border bg-surface">
        {keys.map((key) => {
          const meta = permissionMeta(key);
          return (
            <li key={key} className="px-3.5 py-2">
              <p className="text-[0.8125rem] font-medium text-fg">{meta.label}</p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                {meta.description}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

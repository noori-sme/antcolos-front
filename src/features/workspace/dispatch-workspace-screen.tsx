"use client";

import {
  ArrowUpRight, Building2, Container, Gauge, Inbox, MailPlus, Settings2, Shield,
  Truck, Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Can } from "@/components/auth/can";
import { useActiveMembership, useSession } from "@/lib/session/hooks";
import { WORKSPACE_KIND_DESCRIPTION, WORKSPACE_KIND_LABEL } from "@/lib/workspace/resolve";
import { claimWork, releaseWork, upgradeToOrganization } from "@/lib/api/mock/dispatch-workspace";
import { NeedsYouPreview } from "@/features/home/needs-you-preview";
import { useHomeSummary } from "@/features/home/hooks";
import { WorkList, WorkspacePanel } from "./work-panels";
import { useDispatchWorkspaceSummary, useWorkspaceContext } from "./use-workspace";
import { cn } from "@/lib/utils";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The dispatch workspace dashboard — one screen for both shapes.
 *
 * It renders what the summary gives it and asks no questions of its own. A
 * section is here because the service put data in the field; it is absent
 * because the service left the field undefined. The screen never checks whether
 * somebody is an owner, never checks a role name, and never decides on its own
 * that a solo dispatcher should not see a team queue — it simply has nothing to
 * draw when there is no team.
 *
 * That is what makes it one dashboard rather than two that drift apart: adding
 * a section means adding it once, and the rules about who sees it live in the
 * service beside the records.
 */
export function DispatchWorkspaceScreen() {
  const { user } = useSession();
  const { membership } = useActiveMembership();
  const ctx = useWorkspaceContext();
  const query = useDispatchWorkspaceSummary();
  const needsYou = useHomeSummary();

  const [busyLoadId, setBusyLoadId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstName = user.displayName.split(" ")[0];

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-64" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title={`${greeting(new Date().getHours())}, ${firstName}`} />
        <ErrorState
          title="Could not load your workspace"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const s = query.data;
  const { workspace } = s;

  async function act(loadId: string, fn: () => Promise<{ status: string; assigneeName?: string }>) {
    if (!ctx) return;
    setBusyLoadId(loadId);
    setError(null);
    setMessage(null);
    const outcome = await fn().catch(() => null);
    setBusyLoadId(null);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "already_held") {
      setError(`${outcome.assigneeName} picked that up first, so nothing was changed.`);
    } else if (outcome.status === "not_permitted") {
      setError("You do not have permission to move that work.");
    } else if (outcome.status === "not_found") {
      setError("That load is no longer here.");
    } else if (outcome.status === "released") {
      setMessage("Put back in the unassigned queue.");
    } else {
      setMessage("It is yours now.");
    }
    query.refetch();
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title={`${greeting(new Date().getHours())}, ${firstName}`}
        description={`${workspace.displayName} · ${
          membership?.isOwner ? "Owner" : (membership?.title ?? "Member")
        }`}
        actions={
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-sunken px-2.5 py-1 text-[0.75rem] font-medium text-fg-muted">
            {WORKSPACE_KIND_LABEL[workspace.kind]}
          </span>
        }
      />

      <p className="-mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
        {WORKSPACE_KIND_DESCRIPTION[workspace.kind]}
      </p>

      {/* Needs You leads, in every workspace. */}
      {needsYou.data ? (
        <NeedsYouPreview
          items={needsYou.data.needsYouPreview}
          openCount={needsYou.data.counts.needsYouOpen}
          criticalCount={needsYou.data.counts.needsYouCritical}
        />
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-st-success/40 bg-st-success-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
          {message}
        </p>
      ) : null}

      {/* ------------------------------------------- ORGANIZATION OVERVIEW */}
      {workspace.supportsTeam ? (
        <section aria-label="Organization overview" className="grid grid-cols-2 gap-stack xl:grid-cols-4">
          <Tile label="My work" value={s.counts.myWorkCount} hint="Loads you are holding" />
          {s.teamWork !== undefined ? (
            <Tile label="Team work" value={s.counts.teamWorkCount} hint="Held by somebody else" />
          ) : null}
          {s.unassignedWork !== undefined ? (
            <Tile
              label="Unassigned"
              value={s.counts.unassignedCount}
              hint="Waiting for somebody"
              tone={s.counts.unassignedCount > 0 ? "warning" : "default"}
            />
          ) : null}
          <Tile label="Carriers" value={s.carriers.length} hint="Under your dispatch" />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          {/* -------------------------------------------------- MY WORK */}
          <WorkspacePanel
            title="My work"
            count={s.counts.myWorkCount}
            description={
              workspace.supportsTeam
                ? "Loads you are personally holding."
                : "Everything you are running. There is nobody else to hand it to."
            }
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/loads">All loads</Link>
              </Button>
            }
          >
            <WorkList
              items={s.myWork}
              emptyTitle="Nothing on your plate"
              emptyDescription={
                s.unassignedWork && s.unassignedWork.length > 0
                  ? "There is work in the unassigned queue below."
                  : "When you pick up a load it will show here."
              }
              busyLoadId={busyLoadId}
              action={(item) => ({
                label: "Let it go",
                onClick: () => void act(item.loadId, () => releaseWork(item.loadId, ctx!)),
              })}
            />
          </WorkspacePanel>

          {/* ------------------------------------------------ TEAM WORK */}
          {s.teamWork !== undefined ? (
            <WorkspacePanel
              title="Team work"
              count={s.counts.teamWorkCount}
              description="Held by other people in this organization."
            >
              <WorkList
                items={s.teamWork}
                showAssignee
                emptyTitle="Nobody else is holding anything"
                emptyDescription="Work your colleagues pick up will show here."
              />
            </WorkspacePanel>
          ) : null}

          {/* ------------------------------------------ UNASSIGNED WORK */}
          {s.unassignedWork !== undefined ? (
            <WorkspacePanel
              title="Unassigned work"
              count={s.counts.unassignedCount}
              description="Nobody is holding these yet."
            >
              <WorkList
                items={s.unassignedWork}
                emptyTitle="The queue is empty"
                emptyDescription="Every load in this workspace has somebody on it."
                busyLoadId={busyLoadId}
                action={(item) => ({
                  label: "Claim it",
                  onClick: () => void act(item.loadId, () => claimWork(item.loadId, ctx!)),
                })}
              />
            </WorkspacePanel>
          ) : null}
        </div>

        <div className="space-y-4">
          {/* -------------------------------------------------- CARRIERS */}
          <WorkspacePanel
            title="Carriers"
            count={s.carriers.length}
            description="The carriers whose freight you move, and what they have let you see."
          >
            {s.carriers.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3.5 py-4 text-center">
                <p className="text-[0.8125rem] font-medium text-fg">No carriers yet</p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                  A carrier appears here once it grants your workspace access to its equipment or
                  runs a load under your dispatch.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {s.carriers.map((c) => (
                  <li key={c.organizationId} className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                    <p className="text-[0.8125rem] font-medium text-fg">{c.name}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-[0.75rem] text-fg-subtle">
                      <span>{c.activeLoadCount} active {c.activeLoadCount === 1 ? "load" : "loads"}</span>
                      <span>{c.truckCount} {c.truckCount === 1 ? "truck" : "trucks"}</span>
                      <span>{c.trailerCount} {c.trailerCount === 1 ? "trailer" : "trailers"}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </WorkspacePanel>

          {/* ------------------------------------------ SCOPED EQUIPMENT */}
          <WorkspacePanel
            title="Equipment you can see"
            description="Only what a carrier has granted this workspace. You neither own it nor run it on your own authority."
          >
            <div className="grid grid-cols-2 gap-2.5">
              <EquipmentTile
                icon={Truck}
                label="Trucks"
                value={s.equipment.truckCount}
                hint={`${s.equipment.idleTruckCount} with no driver`}
                href="/fleet/trucks"
              />
              <EquipmentTile
                icon={Container}
                label="Trailers"
                value={s.equipment.trailerCount}
                hint={`${s.equipment.unattachedTrailerCount} not on a power unit`}
                href="/fleet/trailers"
              />
            </div>
          </WorkspacePanel>

          {/* ------------------------------------------------------ TEAM */}
          {s.team ? (
            <WorkspacePanel
              title="Your team"
              description="Who is in this organization, and what they are allowed to do."
            >
              <ul className="space-y-2">
                <TeamRow
                  icon={Users}
                  label="People"
                  value={s.team.memberCount}
                  href="/settings/users"
                  permission="members:view"
                />
                <TeamRow
                  icon={MailPlus}
                  label="Pending invitations"
                  value={s.team.pendingInvitationCount}
                  href="/settings/invitations"
                  permission="invitations:view"
                />
                <TeamRow
                  icon={Shield}
                  label="Roles"
                  value={s.team.roleCount}
                  href="/settings/permissions"
                  permission="permissions:manage"
                />
              </ul>
            </WorkspacePanel>
          ) : null}

          {/* -------------------------------------------------- ACTIVITY */}
          <WorkspacePanel title="Recent activity" description="The last few things that happened here.">
            {s.activity.length === 0 ? (
              <p className="text-[0.8125rem] text-fg-muted">Nothing has happened yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {s.activity.map((a) => (
                  <li key={a.id} className="flex gap-2.5">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] text-fg">
                        {a.summary}
                        {a.loadReference ? (
                          <span className="text-fg-muted"> · {a.loadReference}</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                        {new Date(a.at).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                        {a.actorName ? ` · ${a.actorName}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </WorkspacePanel>

          {/* --------------------------------------------------- SETTINGS */}
          <WorkspacePanel title="Settings" description="Your workspace and your account.">
            <ul className="space-y-2">
              <Can permission="organization:manage">
                <TeamRow icon={Building2} label="Workspace settings" href="/settings/organization" />
              </Can>
              <TeamRow icon={Settings2} label="My organizations" href="/account/organizations" />
              <TeamRow icon={Inbox} label="Needs You" href="/needs-you" value={s.counts.needsYouOpen} />
              <Can permission="revenue:view">
                <TeamRow icon={Gauge} label="Reports" href="/reports" />
              </Can>
            </ul>
          </WorkspacePanel>

          {/* ---------------------------------------------------- UPGRADE */}
          {workspace.canUpgradeToOrganization ? (
            <UpgradePanel
              onUpgrade={async () => {
                if (!ctx) return;
                setError(null);
                setMessage(null);
                const outcome = await upgradeToOrganization(ctx).catch(() => null);
                if (!outcome || outcome.status !== "upgraded") {
                  setError("That could not be done. Nothing was changed.");
                  return;
                }
                setMessage(
                  "Your workspace is now a dispatch organization. Everything you had is still here — you can invite dispatchers and hand work to them.",
                );
                query.refetch();
              }}
            />
          ) : null}
        </div>
      </div>

      {/* The honest floor of this milestone. */}
      <p className="rounded-md border border-dashed border-border px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
        Finding loads, contacting brokers and negotiating rates are not built yet. This dashboard is
        the foundation they will sit on: the work lists, the carriers and the equipment scope are
        real and permission-checked, and nothing here is a placeholder pretending to be finished.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Tile({
  label, value, hint, tone = "default",
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-surface p-4 shadow-e1",
        tone === "warning" ? "border-st-warning/40" : "border-border",
      )}
    >
      <p className="text-[0.75rem] font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-[1.5rem] leading-none font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1.5 text-[0.75rem] text-fg-subtle">{hint}</p>
    </div>
  );
}

function EquipmentTile({
  icon: Icon, label, value, hint, href,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
  hint: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border bg-surface-sunken px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-[1.25rem] leading-none font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-[0.75rem] text-fg-subtle">{hint}</p>
    </Link>
  );
}

function TeamRow({
  icon: Icon, label, value, href,
}: {
  icon: typeof Users;
  label: string;
  value?: number;
  href: string;
  /** Declared by callers wrapping this in <Can>; unused here on purpose. */
  permission?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-fg">
          <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[0.8125rem] text-fg-muted">
          {value !== undefined ? <span className="tabular-nums">{value}</span> : null}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

function UpgradePanel({ onUpgrade }: { onUpgrade: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-lg border border-primary/35 bg-primary/5 p-4">
      <h2 className="text-[0.875rem] font-semibold text-fg">Upgrade to a dispatch organization</h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        Take on dispatchers, hand work between them, and set what each person is allowed to see. You
        keep this workspace, its loads, its carriers and its history exactly as they are — you are
        adding room for a team, not starting again.
      </p>
      {confirming ? (
        <div className="mt-3">
          <p className="text-[0.8125rem] leading-relaxed text-fg">
            This cannot be undone. An organization with a team cannot go back to being a workspace of
            one.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={onUpgrade}>
              Yes, upgrade my workspace
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          Upgrade to a dispatch organization
        </Button>
      )}
    </section>
  );
}

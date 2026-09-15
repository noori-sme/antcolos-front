"use client";

import {
  ArrowUpCircle, BellOff, BellRing, CheckCircle2, ExternalLink, Lock,
  RotateCcw, UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetCloseButton, SheetContent } from "@/components/ui/sheet";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import { canAll } from "@/lib/permissions/can";
import { dateTimeIn, relativeTime, useNow } from "@/lib/utils";
import { CATEGORY_LABEL, type NeedsYouItem } from "@/types";
import { EscalateDialog, ResolveDialog, SnoozeDialog } from "./action-dialogs";
import { DueLabel } from "./due-label";
import { SeverityBadge } from "./severity";
import type { NeedsYouMutation } from "./hooks";

const SOURCE_LABEL: Record<NeedsYouItem["source"], string> = {
  system: "Detected by Antcolos",
  telegram: "From Telegram",
  eld: "From ELD telematics",
  ocr: "From document extraction",
  manual: "Entered by a person",
};

export function NeedsYouDrawer({
  item, open, onOpenChange, action, members, memberName, onItemUpdated,
}: {
  item: NeedsYouItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: NeedsYouMutation;
  members: { membershipId: string; displayName: string; title?: string }[];
  memberName: (membershipId?: string) => string | undefined;
  /** Receives the updated record so the panel shows the result of the action. */
  onItemUpdated: (next: NeedsYouItem) => void;
}) {
  const permissions = usePermissions();
  const { organization } = useActiveMembership();
  const now = useNow();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  if (!item) return null;

  const tz = organization?.timeZone ?? "UTC";
  const mayAct = canAll(permissions, item.recommendedAction.requires);
  const pending = action.isPending;
  const errorMessage = action.isError ? action.error.message : null;

  const run = (a: Parameters<NeedsYouMutation["mutate"]>[0]["action"]) =>
    action.mutate(
      { id: item.id, action: a },
      {
        onSuccess: (next) => {
          onItemUpdated(next);
          setSnoozeOpen(false);
          setEscalateOpen(false);
          setResolveOpen(false);
        },
      },
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={item.title} description={item.reason}>
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={item.severity} />
              <Badge tone="outline">{CATEGORY_LABEL[item.category]}</Badge>
              {item.status === "snoozed" ? (
                <Badge tone="neutral"><BellOff aria-hidden className="size-3" />Snoozed</Badge>
              ) : null}
              {item.status === "escalated" ? (
                <Badge tone="danger"><ArrowUpCircle aria-hidden className="size-3" />Escalated</Badge>
              ) : null}
              {item.status === "resolved" ? (
                <Badge tone="success"><CheckCircle2 aria-hidden className="size-3" />Resolved</Badge>
              ) : null}
            </div>
            <h2 className="mt-2 text-[1.0625rem] leading-6 font-semibold text-fg">
              {item.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <DueLabel dueAt={item.dueAt} />
              <span className="text-[0.75rem] text-fg-subtle">{SOURCE_LABEL[item.source]}</span>
            </div>
          </div>
          <SheetCloseButton />
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              Why this is here
            </h3>
            <p className="mt-1.5 text-[0.875rem] leading-6 text-fg">{item.reason}</p>
            {item.detail ? (
              <p className="mt-2 text-[0.8125rem] leading-6 text-fg-muted">{item.detail}</p>
            ) : null}
          </section>

          <section>
            <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              Affects
            </h3>
            <ul className="mt-2 space-y-1.5">
              {[item.entity, ...(item.relatedEntities ?? [])].map((e) => (
                <li key={`${e.kind}-${e.id}`}>
                  {e.href ? (
                    <Link
                      href={e.href}
                      className="inline-flex items-center gap-1.5 text-[0.875rem] text-fg underline-offset-4 hover:text-primary hover:underline"
                    >
                      {e.label}
                      <ExternalLink aria-hidden className="size-3.5 text-fg-subtle" />
                    </Link>
                  ) : (
                    <span className="text-[0.875rem] text-fg">{e.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {item.status === "snoozed" && item.snoozedUntil ? (
            <section className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
              <p className="text-[0.8125rem] font-medium text-fg">
                Returns to the queue {now === null ? "shortly" : relativeTime(item.snoozedUntil, now)}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-fg-muted">{item.snoozeReason}</p>
            </section>
          ) : null}

          {item.status === "resolved" ? (
            <section className="rounded-lg border border-st-success/30 bg-st-success-bg/50 px-3.5 py-3">
              <p className="text-[0.8125rem] font-medium text-fg">
                Handled {item.resolvedAt && now !== null ? relativeTime(item.resolvedAt, now) : ""}
              </p>
              {item.resolutionNote ? (
                <p className="mt-0.5 text-[0.75rem] text-fg-muted">{item.resolutionNote}</p>
              ) : null}
            </section>
          ) : null}

          <section>
            <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              History
            </h3>
            <ol className="mt-2.5 space-y-3">
              {[...item.history].reverse().map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] text-fg">
                      <span className="font-medium capitalize">{h.action}</span>
                      {" · "}
                      <span className="text-fg-muted">{h.actor.displayNameSnapshot}</span>
                    </span>
                    {h.note ? (
                      <span className="mt-0.5 block text-[0.75rem] text-fg-muted">{h.note}</span>
                    ) : null}
                    <span className="mt-0.5 block text-[0.6875rem] text-fg-subtle">
                      {dateTimeIn(h.at, tz)}
                      {h.until ? ` · until ${dateTimeIn(h.until, tz)}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="space-y-2.5 border-t border-border px-5 py-4">
          {errorMessage ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{errorMessage}</p>
          ) : null}

          {!mayAct && !item.derived ? (
            <p className="flex items-start gap-2 rounded-md bg-st-warning-bg/60 px-3 py-2 text-[0.8125rem] text-fg-muted">
              <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-st-warning" />
              You can see this item but not act on it. It needs{" "}
              <code className="font-mono text-[0.75rem]">
                {item.recommendedAction.requires.join(", ")}
              </code>
              .
            </p>
          ) : null}

          {item.derived ? (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-[0.8125rem] leading-relaxed text-fg-muted">
              This one is worked out from the settlement itself, so there is
              nothing here to snooze or tick off. Open the settlement, sort out
              what it is asking for, and it clears on its own.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {/* Straight to where it is fixed. The action's own href wins over the
                entity's, because the entity points at the record and the action
                points at the resolution. */}
            {item.derived ? (
              (item.recommendedAction.href ?? item.entity.href) ? (
                <Button variant="primary" asChild>
                  <Link href={(item.recommendedAction.href ?? item.entity.href)!}>
                    <ExternalLink aria-hidden />
                    {item.recommendedAction.label}
                  </Link>
                </Button>
              ) : null
            ) : item.status === "resolved" ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run({ kind: "reopen" })}
              >
                <RotateCcw aria-hidden />
                Reopen
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={!mayAct || pending}
                  onClick={() => setResolveOpen(true)}
                  title={
                    item.recommendedAction.deferred
                      ? "The destination screen is a later milestone; marking it handled records the action now."
                      : undefined
                  }
                >
                  <CheckCircle2 aria-hidden />
                  {item.recommendedAction.label}
                </Button>

                {item.status === "snoozed" ? (
                  <Button variant="secondary" disabled={pending} onClick={() => run({ kind: "unsnooze" })}>
                    <BellRing aria-hidden />
                    Wake now
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={pending} onClick={() => setSnoozeOpen(true)}>
                    <BellOff aria-hidden />
                    Snooze
                  </Button>
                )}

                <Button variant="secondary" disabled={pending} onClick={() => setEscalateOpen(true)}>
                  <ArrowUpCircle aria-hidden />
                  Escalate
                </Button>
              </>
            )}

            {members.length > 0 && !item.derived ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" disabled={pending}>
                    <UserPlus aria-hidden />
                    {memberName(item.assigneeMembershipId) ?? "Assign"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                  {members.map((m) => (
                    <DropdownMenuItem
                      key={m.membershipId}
                      onSelect={() => run({ kind: "assign", membershipId: m.membershipId })}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{m.displayName}</span>
                        {m.title ? (
                          <span className="block truncate text-[0.75rem] text-fg-subtle">
                            {m.title}
                          </span>
                        ) : null}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {item.recommendedAction.deferred && item.status !== "resolved" && !item.derived ? (
            <p className="text-[0.75rem] text-fg-subtle">
              The {item.recommendedAction.label.toLowerCase()} screen is a later
              milestone. Marking it handled records the decision now.
            </p>
          ) : null}
        </footer>

        <SnoozeDialog
          item={item}
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          pending={pending}
          onConfirm={(hours, reason) => run({ kind: "snooze", input: { hours, reason } })}
        />
        <EscalateDialog
          open={escalateOpen}
          onOpenChange={setEscalateOpen}
          pending={pending}
          members={members}
          onConfirm={(note, toMembershipId) =>
            run({ kind: "escalate", input: { note, toMembershipId } })
          }
        />
        <ResolveDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          pending={pending}
          onConfirm={(note) => run({ kind: "resolve", note })}
        />
      </SheetContent>
    </Sheet>
  );
}

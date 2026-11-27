"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCan } from "@/lib/session/hooks";
import type { TelegramLinkCode, TelegramTruckChat } from "@/types/telegram";
import {
  useCreateTelegramLinkCode, useTelegramTruckChats, useTelegramTrucks, useUnlinkTelegramTruckChat,
} from "./hooks";
import { LinkCodePanel } from "./link-code-panel";

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

interface Row {
  truckId: string;
  unit: string;
  operated: boolean;
  chat: TelegramTruckChat | null;
}

/**
 * Settings → Integrations → Telegram (plan 29): each truck's group. The list needs `trucks:view`;
 * linking and unlinking need `trucks:edit`, which only carriers have (an agency sees it read-only).
 */
export function TelegramIntegrationsScreen() {
  const canView = useCan("trucks:view");
  const [requested, setCode] = useState<{ truckId: string; code: TelegramLinkCode } | null>(null);
  const trucks = useTelegramTrucks();
  const chats = useTelegramTruckChats(requested !== null);
  const create = useCreateTelegramLinkCode();
  const unlink = useUnlinkTelegramTruckChat();

  const link = (truckId: string) =>
    create.mutate({ purpose: "TRUCK_CHAT", truckId }, { onSuccess: (c) => setCode({ truckId, code: c }) });

  const chatOf = new Map((chats.data?.data ?? []).map((c) => [c.truckId, c]));
  const rows: Row[] = [
    ...(trucks.data?.data ?? []).map((t) => ({
      truckId: t.id,
      unit: t.unitNumber ? `Unit ${t.unitNumber}` : "Truck",
      operated: true,
      chat: chatOf.get(t.id) ?? null,
    })),
    // Groups whose truck this organization no longer operates: still listed, still unlinkable.
    ...(chats.data?.data ?? [])
      .filter((c) => !(trucks.data?.data ?? []).some((t) => t.id === c.truckId))
      .map((c) => ({
        truckId: c.truckId,
        unit: c.unitNumber ? `Unit ${c.unitNumber}` : "Truck no longer operated",
        operated: false,
        chat: c,
      })),
  ];
  // The code is done once the group shows as linked.
  const code = requested && !chatOf.has(requested.truckId) ? requested : null;

  return (
    <div className="space-y-section">
      <PageHeader title="Integrations" description="Tools connected to this organization." />
      <section aria-labelledby="tg-groups" className="space-y-3">
        <div className="flex items-center gap-2">
          <Send aria-hidden className="size-4 text-fg-muted" />
          <h2 id="tg-groups" className="text-[0.9375rem] font-semibold text-fg">
            Telegram truck groups
          </h2>
        </div>
        <p className="max-w-2xl text-[0.8125rem] text-fg-muted">
          Each truck can have one Telegram group with its driver and dispatcher. The bot posts the
          truck&rsquo;s loads there, with status buttons.
        </p>

        {!canView ? (
          <EmptyState
            title="Truck groups need the “View trucks” permission"
            description="Ask your company admin if you should see them."
          />
        ) : trucks.isPending || chats.isPending ? (
          <LoadingSkeleton rows={3} />
        ) : trucks.isError || chats.isError ? (
          <ErrorState
            title="Couldn't load truck groups"
            description={(trucks.error ?? chats.error)?.message}
            onRetry={() => {
              void trucks.refetch();
              void chats.refetch();
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No trucks yet"
            description="Truck groups are linked by the carrier that operates the truck."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.truckId}
                className="space-y-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.9375rem] font-medium text-fg">{row.unit}</p>
                    <p className="text-[0.8125rem] text-fg-muted">
                      {row.chat
                        ? `${row.chat.title ?? "Telegram group"} · linked ${WHEN.format(new Date(row.chat.linkedAt))} by ${row.chat.linkedBy.name ?? "a removed user"}`
                        : "No group linked"}
                    </p>
                  </div>
                  <Can permission="trucks:edit">
                    {row.chat ? (
                      <ConfirmDialog
                        title={`Unlink ${row.chat.title ?? "this group"}?`}
                        description={`The bot stops posting ${row.unit.toLowerCase()}'s loads to this group. It stays in the group until someone removes it.`}
                        confirmLabel="Unlink"
                        destructive
                        onConfirm={() => unlink.mutateAsync(row.truckId)}
                        trigger={
                          <Button variant="secondary" size="sm" disabled={unlink.isPending}>
                            Unlink
                          </Button>
                        }
                      />
                    ) : row.operated && code?.truckId !== row.truckId ? (
                      <Button size="sm" onClick={() => link(row.truckId)} disabled={create.isPending}>
                        Link group
                      </Button>
                    ) : null}
                  </Can>
                </div>
                {code?.truckId === row.truckId ? (
                  <LinkCodePanel
                    code={code.code}
                    onRenew={() => link(row.truckId)}
                    renewing={create.isPending}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {create.isError || unlink.isError ? (
          <p role="alert" className="text-[0.8125rem] text-st-danger">
            {(create.error ?? unlink.error)?.message}
          </p>
        ) : null}
        <Can permission="trucks:edit">
          <p className="text-[0.75rem] text-fg-subtle">
            Linking a group needs your own Telegram connected first (Account → Notifications).
          </p>
        </Can>
      </section>
    </div>
  );
}

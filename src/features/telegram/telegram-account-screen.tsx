"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCan } from "@/lib/session/hooks";
import type { TelegramLinkCode } from "@/types/telegram";
import { useCreateTelegramLinkCode, useTelegramAccount, useUnlinkTelegramAccount } from "./hooks";
import { LinkCodePanel } from "./link-code-panel";

const SINCE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Notifications → Telegram (plan 29): the person's own link. Status and Disconnect need no
 * permission; Connect needs `loads:respond`, the code endpoint's key.
 */
export function TelegramAccountScreen() {
  const [requested, setCode] = useState<TelegramLinkCode | null>(null);
  // Poll while a code is out; once they tap Start the status turns linked and the code is done.
  const account = useTelegramAccount(requested !== null);
  const create = useCreateTelegramLinkCode();
  const unlink = useUnlinkTelegramAccount();
  const canConnect = useCan("loads:respond");
  const linked = account.data?.linked === true;
  const code = linked ? null : requested;

  const connect = () => create.mutate({ purpose: "ACCOUNT" }, { onSuccess: setCode });

  return (
    <div className="space-y-section">
      <PageHeader title="Notifications" description="How Antcolos reaches you outside the app." />
      <section
        aria-labelledby="telegram-heading"
        className="max-w-xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-e1"
      >
        <div className="flex items-center gap-2">
          <Send aria-hidden className="size-4 text-fg-muted" />
          <h2 id="telegram-heading" className="text-[0.9375rem] font-semibold text-fg">
            Telegram
          </h2>
        </div>

        {account.isPending ? (
          <LoadingSkeleton rows={1} />
        ) : account.isError ? (
          <ErrorState
            title="Couldn't load your Telegram connection"
            description={account.error.message}
            onRetry={() => void account.refetch()}
          />
        ) : linked ? (
          <>
            <p className="text-[0.875rem] text-fg">
              Connected{account.data.username ? ` as @${account.data.username}` : ""}
              {account.data.linkedAt ? (
                <span className="text-fg-muted"> since {SINCE.format(new Date(account.data.linkedAt))}</span>
              ) : null}
              .
            </p>
            <p className="text-[0.8125rem] text-fg-muted">
              Loads, status buttons and reminders reach you in Telegram.
            </p>
            <ConfirmDialog
              title="Disconnect Telegram?"
              description="This disconnects Telegram for all your companies: the bot stops sending you loads and your buttons stop working. Truck groups you linked keep working. You can connect again any time."
              confirmLabel="Disconnect"
              destructive
              onConfirm={() => unlink.mutateAsync()}
              trigger={
                <Button variant="secondary" size="sm" disabled={unlink.isPending}>
                  {unlink.isPending ? "Disconnecting…" : "Disconnect"}
                </Button>
              }
            />
            {unlink.isError ? (
              <p role="alert" className="text-[0.8125rem] text-st-danger">
                {unlink.error.message}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[0.8125rem] text-fg-muted">
              Get your loads, status buttons and reminders in Telegram. It is one Telegram account per
              person, for all your companies.
            </p>
            {code ? (
              <LinkCodePanel code={code} onRenew={connect} renewing={create.isPending} />
            ) : (
              <div className="space-y-1.5">
                <Button size="sm" onClick={connect} disabled={!canConnect || create.isPending}>
                  {create.isPending ? "Getting a code…" : "Connect Telegram"}
                </Button>
                {!canConnect ? (
                  <p className="text-[0.75rem] text-fg-subtle">
                    Needs the &ldquo;Answer an assigned load&rdquo; permission. Ask your company admin.
                  </p>
                ) : null}
              </div>
            )}
            {create.isError ? (
              <p role="alert" className="text-[0.8125rem] text-st-danger">
                {create.error.message}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

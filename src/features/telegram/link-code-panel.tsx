"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TelegramLinkCode } from "@/types/telegram";

/** "12:04" from milliseconds; never negative. */
function remaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * A one-time Telegram code: the deep link (ACCOUNT), the command to send, and a countdown from
 * the server's `expiresAt`. Once it expires, the only action left is a new code.
 */
export function LinkCodePanel({
  code,
  onRenew,
  renewing,
}: {
  code: TelegramLinkCode;
  onRenew: () => void;
  renewing: boolean;
}) {
  const expiresAt = new Date(code.expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = expiresAt - now;
  const command = code.purpose === "ACCOUNT" ? `/start ${code.code}` : `/link ${code.code}`;

  if (left <= 0) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3">
        <p className="text-[0.8125rem] text-fg-muted">This code expired.</p>
        <Button size="sm" onClick={onRenew} disabled={renewing}>
          {renewing ? "Getting a code…" : "Get a new code"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-sunken p-3">
      {code.deepLink ? (
        <Button asChild variant="primary" size="sm">
          <a href={code.deepLink} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden className="size-4" />
            Open Telegram and tap Start
          </a>
        </Button>
      ) : null}
      <div>
        <p className="text-[0.8125rem] text-fg-muted">
          {code.purpose === "ACCOUNT"
            ? code.deepLink
              ? "Or send this to the bot in a private chat:"
              : "Send this to the bot in a private chat:"
            : "Add the bot to the truck's Telegram group, then send this in the group:"}
        </p>
        <p className="mt-1 select-all break-all font-mono text-[0.875rem] text-fg">{command}</p>
      </div>
      <p className="text-[0.75rem] text-fg-subtle" aria-live="off">
        Works once. Expires in {remaining(left)}.
      </p>
    </div>
  );
}

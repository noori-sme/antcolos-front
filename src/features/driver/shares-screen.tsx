"use client";

import { Link2, Plus, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/states";
import { FormAlert } from "@/features/auth/form-alert";
import type { DocumentSharePackage } from "@/types";
import { SHARE_PURPOSE_LABEL } from "@/types";
import { recipientLabel, shareReference } from "@/lib/api/mock/document-shares";
import { DriverAdoptionsPanel } from "@/features/workforce/driver-adoptions-panel";
import { useServiceContext } from "@/lib/api/use-service-context";
import { ShareStateChip } from "./share-badges";
import { driverShares, driverSharesNeedingRefresh, revokeDriverShare } from "./sharing";
import { formatDate } from "./driver-rules";

/**
 * Every share the driver has made, and what has become of it.
 *
 * This is the answer to "who has my licence?" — a question a driver cannot
 * currently ask anybody. Each row says who, what exactly, until when, and
 * whether it was opened; and every one of them can be withdrawn from here.
 */
export function DriverSharesScreen() {
  const ctx = useServiceContext();
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  void nonce;

  const shares = driverShares();
  const stale = new Set(driverSharesNeedingRefresh().map((p) => p.id));

  return (
    <div className="space-y-section">
      <PageHeader
        title="My shares"
        description="Who you have shown your documents to, and what they can still see."
      />

      <Button asChild variant="primary">
        <Link href="/driver/shares/new">
          <Plus aria-hidden />
          Share with a carrier
        </Link>
      </Button>

      {shares.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="You have not shared anything yet"
          description="When you apply to a carrier, share the documents you have already prepared instead of photographing them again."
        />
      ) : (
        <ul className="space-y-2.5">
          {shares.map((pkg) => (
            <ShareRow key={pkg.id} pkg={pkg} stale={stale.has(pkg.id)} onChange={reload} />
          ))}
        </ul>
      )}

      {/* Withdrawing a share is the loudest thing on this page, so what it does
          NOT undo belongs on the same page rather than in a help article. */}
      {ctx?.driverProfileId ? (
        <DriverAdoptionsPanel driverProfileId={ctx.driverProfileId} />
      ) : null}

      <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        Preview build: shares live in this browser session only, no email is sent, and no file is
        stored. Expiry and revocation are enforced here in the mock; a backend enforces them on the
        server.
      </p>
    </div>
  );
}

function ShareRow({
  pkg,
  stale,
  onChange,
}: {
  pkg: DocumentSharePackage;
  stale: boolean;
  onChange: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-share-id={pkg.id}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-semibold text-fg">{recipientLabel(pkg)}</span>
            <ShareStateChip pkg={pkg} />
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] text-fg-muted">
              {pkg.recipient.kind === "organization" ? "On Antcolos" : "External link"}
            </span>
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {SHARE_PURPOSE_LABEL[pkg.purpose]} · {pkg.items.length} document
            {pkg.items.length === 1 ? "" : "s"} · until {formatDate(pkg.expiresAt)}
          </p>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            {pkg.items.map((i) => i.label).join(", ")}
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] text-fg-subtle">{shareReference(pkg)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="text-[0.75rem] text-fg-subtle tabular-nums">
            {pkg.accessCount === 0 ? "Not opened yet" : `Opened ${pkg.accessCount}×`}
          </p>
          {pkg.token && !pkg.revokedAt ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/shared/${pkg.token}`}>
                <Link2 aria-hidden />
                Open link
              </Link>
            </Button>
          ) : null}
          {!pkg.revokedAt ? (
            confirming ? (
              <span className="flex gap-1.5">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    revokeDriverShare(pkg.id, "Withdrawn by the driver.");
                    setConfirming(false);
                    onChange();
                  }}
                >
                  Withdraw access
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                Revoke
              </Button>
            )
          ) : null}
        </div>
      </div>

      {pkg.deliveryFailureReason ? (
        <div className="mt-3">
          <FormAlert tone="danger" role="none" title="Mock delivery failed.">
            {pkg.deliveryFailureReason} Nothing was sent — check the address and share again.
          </FormAlert>
        </div>
      ) : null}

      {stale ? (
        <div className="mt-3">
          <FormAlert tone="warning" role="none" title="You have replaced a document since sharing.">
            They are still looking at the version you sent, which is deliberate — what they reviewed
            does not change behind them. Share again to send the new one.
          </FormAlert>
        </div>
      ) : null}
    </li>
  );
}

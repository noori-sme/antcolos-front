"use client";

import { FileText, ShieldCheck } from "lucide-react";
import type { DocumentSharePackage, SharePackageItem } from "@/types";
import { formatDate, formatFileSize } from "./driver-rules";
import { documentsForSubject } from "@/lib/api/mock/document-store";
import { watermarkFor } from "@/lib/documents/watermark";
import { cn } from "@/lib/utils";

/**
 * A document AS PRESENTED TO A RECIPIENT — the derivative, not the record.
 *
 * This component is the whole watermark boundary in this build: the mark is
 * rendered here, on the thing a recipient is shown, and never written to the
 * `DocumentRecord`, which is not touched by sharing at all. When a backend
 * renders real images and PDFs it applies the same four values (`watermarkFor`)
 * to those renderings; the driver's original file stays unmarked either way.
 *
 * The mark sits in a footer, deliberately: a licence number, an expiry date, a
 * signature or a barcode must stay legible, and a stamp across the middle of a
 * document is how a shared copy becomes useless to the person who asked for it.
 */
export function SharedDocumentCard({
  item,
  pkg,
  className,
}: {
  item: SharePackageItem;
  pkg: DocumentSharePackage;
  className?: string;
}) {
  const mark = watermarkFor(pkg);
  // Said plainly rather than by silently swapping the file: what was shared is
  // what is shown, and the recipient is told a newer version exists.
  const replaced = isReplaced(item, pkg);
  return (
    <li className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="p-4">
        <p className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="text-[0.875rem] font-semibold text-fg">{item.label}</span>
          {/* The document's own currency — NOT a verdict. "Approved" in the
              Document Center means a carrier accepted it; printing that word to
              a stranger would read as "Antcolos approved it", which nobody did. */}
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
            {currencyLabel(item.statusAtShare)}
          </span>
          {replaced ? (
            <span className="rounded-full bg-st-warning-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-warning">
              Driver has a newer version
            </span>
          ) : null}
        </p>

        {/* The file is not here. Saying so is the honest version of showing a
            preview that does not exist. */}
        <div className="mt-3 rounded-md border border-dashed border-border bg-surface-sunken px-3.5 py-6 text-center">
          <p className="font-mono text-[0.8125rem] text-fg">{item.fileName ?? "No file recorded"}</p>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            Preview build: no file is stored, so there is nothing to display. A backend renders the
            image or PDF here, watermarked.
          </p>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1 text-[0.75rem] sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Supplied by</dt>
            <dd className="font-medium text-fg">{pkg.driverName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Verification</dt>
            <dd className="font-medium text-fg">Self-provided, not source-verified</dd>
          </div>
          {item.expiresAt ? (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Expires</dt>
              <dd className="font-medium text-fg">{formatDate(item.expiresAt)}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* The watermark. Small, along the edge, and carrying nothing secret. */}
      <p
        data-watermark
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border bg-surface-sunken px-4 py-2 text-[0.6875rem] text-fg-subtle"
      >
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium text-fg-muted">{mark.brand}</span>
        <span aria-hidden>·</span>
        <span>Shared with {mark.recipient}</span>
        <span aria-hidden>·</span>
        <span>{mark.sharedOn}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{mark.reference}</span>
      </p>
    </li>
  );
}

export { formatFileSize };

/** What the document's state means to somebody who is not reviewing it yet. */
function currencyLabel(status: SharePackageItem["statusAtShare"]): string {
  switch (status) {
    case "expired": return "Expired";
    case "expiring_soon": return "Expiring soon";
    case "superseded": return "Replaced";
    default: return "Current when shared";
  }
}

/** True when the driver has uploaded a newer version of this lineage since. */
function isReplaced(item: SharePackageItem, pkg: DocumentSharePackage): boolean {
  const live = documentsForSubject("driver", pkg.driverProfileId).find(
    (r) => r.lineageId === item.lineageId,
  );
  return live !== undefined && live.documentId !== item.documentId;
}

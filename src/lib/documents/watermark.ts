import type { DocumentSharePackage } from "@/types";

/**
 * The mark every SHARED PRESENTATION of a document carries.
 *
 * The boundary this file draws matters more than the string it draws: a
 * watermark belongs to a DERIVATIVE — the rendering a recipient is shown or
 * handed — and never to the canonical `DocumentRecord`. The driver's document
 * is not edited, not re-versioned and not copied when it is shared; a
 * presentation of it is generated, marked, and thrown away when the page
 * closes.
 *
 * WHAT THIS BUILD ACTUALLY DOES. No file exists to stamp: the mock holds a file
 * NAME, type and size, so the watermark is applied to the rendered card a
 * recipient sees. That is the honest extent of it, and the shared view says so.
 * When a backend renders real images and PDFs, it applies the same four values
 * to the image preview, the PDF preview and any downloaded copy — which is why
 * they are computed here, once, rather than written into a component.
 *
 * WHAT MUST NEVER BE IN IT. No access token, no package id, no document id, no
 * driver profile id. A watermark is printed, photographed and forwarded; a
 * secret in one is a secret published. The reference below is a short derived
 * code, not a substring of any identifier.
 */

export const WATERMARK_BRAND = "Powered by Antcolos";

export interface SharePresentationWatermark {
  /** Always the brand line. The one thing every shared presentation carries. */
  brand: typeof WATERMARK_BRAND;
  /** Who it was shared with, as the driver addressed them. */
  recipient: string;
  /** The date it was shared. A date, not a timestamp: this is for a human. */
  sharedOn: string;
  /** A short traceable code. Derived, not an id, and useless as a credential. */
  reference: string;
}

/**
 * A short code derived from the package id.
 *
 * Deterministic so the same share always prints the same reference, and lossy
 * so the reference cannot be turned back into the id it came from. It is a
 * label for a conversation ("share SH-4K2P9X"), not a way in: presenting it
 * grants nothing, because nothing accepts it as input.
 */
export function shareReferenceCode(packageId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < packageId.length; i += 1) {
    hash ^= packageId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const code = (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `SH-${code}`;
}

export function watermarkFor(pkg: DocumentSharePackage): SharePresentationWatermark {
  const recipient =
    pkg.recipient.kind === "organization" ? pkg.recipient.organizationName : pkg.recipient.email;
  return {
    brand: WATERMARK_BRAND,
    recipient,
    sharedOn: new Date(pkg.createdAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    reference: shareReferenceCode(pkg.id),
  };
}

/**
 * The single line a renderer prints along the edge of a shared document.
 *
 * Kept short on purpose: it sits in a footer, not across the page, so it cannot
 * cover a licence number, an expiry date, a signature or a barcode.
 */
export function watermarkLine(mark: SharePresentationWatermark): string {
  return `${mark.brand} · Shared with ${mark.recipient} · ${mark.sharedOn} · ${mark.reference}`;
}

import type {
  Cents, DocumentBlock, DocumentRegion, RateConDocument, AppliedSignature,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The rate confirmation itself, drawn rather than received.
 *
 * There is no PDF and no broker. This builds a document that looks and reads
 * like a rate confirmation, laid out in positioned blocks, so that the rest of
 * the workflow can be real: the OCR reads text that is genuinely on a page, the
 * review highlights the exact box a value came from, and the signed copy is a
 * separate document rather than an edit of this one.
 *
 * Positions are percentages of the page box. That is what lets the highlight
 * land correctly on a 1400px desktop and a 390px phone showing the same page
 * scaled down, without the coordinates knowing anything about either.
 *
 * The deliberate discrepancies live here too. A rate confirmation that agrees
 * with the booking in every particular teaches a dispatcher nothing and tests
 * nothing: this one is light on the rate, an hour out on the pickup, and quiet
 * about layover — the three things that actually happen.
 */

const nowIso = () => new Date().toISOString();
let seq = 0;
const blockId = () => `blk_${(++seq).toString(36)}`;

export interface DocumentSeed {
  brokerName: string;
  brokerMc?: string;
  brokerContact?: string;
  brokerPhone?: string;
  brokerEmail?: string;
  brokerReference: string;

  carrierName: string;
  carrierMc?: string;
  carrierDot?: string;

  equipment: string;
  commodity?: string;
  weightLbs?: number;

  pickupFacility: string;
  pickupAddress: string;
  pickupAt: string;
  deliveryFacility: string;
  deliveryAddress: string;
  deliverBy: string;

  rateCents: Cents;
  loadedMiles: number;
  paymentTerms: string;
  detentionTerms: string;
  /** Deliberately absent on some documents — layover often is. */
  layoverTerms?: string;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A tiny layout helper.
 *
 * Blocks are placed by hand because the point is a document that looks like a
 * real one — two columns of stop details, a money box on the right, terms in
 * small print at the bottom — not a generic table.
 */
function block(
  text: string,
  style: DocumentBlock["style"],
  region: Omit<DocumentRegion, "page"> & { page?: number },
  alignRight = false,
): DocumentBlock {
  return {
    id: blockId(),
    text,
    style,
    region: { page: region.page ?? 1, xPct: region.xPct, yPct: region.yPct, wPct: region.wPct, hPct: region.hPct },
    alignRight,
  };
}

/** Named blocks, so the OCR can point at them by meaning rather than index. */
export interface BuiltDocument {
  document: RateConDocument;
  /** field name → block, for the extractor. */
  named: Record<string, DocumentBlock>;
}

export function buildRateConDocument(seed: DocumentSeed): BuiltDocument {
  const named: Record<string, DocumentBlock> = {};
  const blocks: DocumentBlock[] = [];
  const add = (name: string | null, b: DocumentBlock) => {
    blocks.push(b);
    if (name) named[name] = b;
    return b;
  };

  /* ---- Header ---- */
  add(null, block(seed.brokerName.toUpperCase(), "title", { xPct: 6, yPct: 4, wPct: 58, hPct: 5 }));
  add("broker_name", block(seed.brokerName, "value", { xPct: 6, yPct: 9.5, wPct: 40, hPct: 3.2 }));
  add("broker_mc", block(
    seed.brokerMc ? `MC ${seed.brokerMc.replace(/^MC-?/i, "")}` : "MC not shown",
    "small", { xPct: 6, yPct: 12.8, wPct: 24, hPct: 3 },
  ));
  add(null, block("RATE CONFIRMATION", "heading", { xPct: 62, yPct: 4.5, wPct: 32, hPct: 4.5 }, true));
  add("load_reference", block(seed.brokerReference, "value", { xPct: 62, yPct: 9.5, wPct: 32, hPct: 3.4 }, true));
  add(null, block("Load number", "label", { xPct: 62, yPct: 13, wPct: 32, hPct: 2.6 }, true));
  add(null, block("", "rule", { xPct: 6, yPct: 17.5, wPct: 88, hPct: 0.4 }));

  /* ---- Carrier ---- */
  add(null, block("CARRIER", "label", { xPct: 6, yPct: 19.5, wPct: 40, hPct: 2.6 }));
  add("carrier_name", block(seed.carrierName, "value", { xPct: 6, yPct: 22.2, wPct: 44, hPct: 3.2 }));
  add("carrier_mc", block(
    [seed.carrierMc ? `MC ${seed.carrierMc.replace(/^MC-?/i, "")}` : undefined,
      seed.carrierDot ? `DOT ${seed.carrierDot}` : undefined].filter(Boolean).join("   "),
    "small", { xPct: 6, yPct: 25.4, wPct: 44, hPct: 2.8 },
  ));

  add(null, block("BROKER CONTACT", "label", { xPct: 54, yPct: 19.5, wPct: 40, hPct: 2.6 }));
  add("broker_contact", block(
    [seed.brokerContact, seed.brokerPhone].filter(Boolean).join("  ·  ") || "Not shown",
    "value", { xPct: 54, yPct: 22.2, wPct: 40, hPct: 3.2 },
  ));
  add(null, block(seed.brokerEmail ?? "", "small", { xPct: 54, yPct: 25.4, wPct: 40, hPct: 2.8 }));

  /* ---- Equipment line ---- */
  add(null, block("", "rule", { xPct: 6, yPct: 30, wPct: 88, hPct: 0.4 }));
  add(null, block("EQUIPMENT", "label", { xPct: 6, yPct: 31.5, wPct: 26, hPct: 2.6 }));
  add("equipment", block(seed.equipment, "value", { xPct: 6, yPct: 34.2, wPct: 26, hPct: 3 }));
  add(null, block("COMMODITY", "label", { xPct: 36, yPct: 31.5, wPct: 30, hPct: 2.6 }));
  add("commodity", block(seed.commodity ?? "General freight", "value", { xPct: 36, yPct: 34.2, wPct: 30, hPct: 3 }));
  add(null, block("WEIGHT", "label", { xPct: 70, yPct: 31.5, wPct: 24, hPct: 2.6 }));
  add("weight", block(
    seed.weightLbs ? `${seed.weightLbs.toLocaleString()} lbs` : "Not shown",
    "value", { xPct: 70, yPct: 34.2, wPct: 24, hPct: 3 },
  ));

  /* ---- Stops ---- */
  add(null, block("", "rule", { xPct: 6, yPct: 39, wPct: 88, hPct: 0.4 }));
  add(null, block("PICK UP", "heading", { xPct: 6, yPct: 40.5, wPct: 40, hPct: 3 }));
  add("pickup_facility", block(seed.pickupFacility, "value", { xPct: 6, yPct: 44, wPct: 42, hPct: 3.2 }));
  add("pickup_address", block(seed.pickupAddress, "body", { xPct: 6, yPct: 47.4, wPct: 42, hPct: 3 }));
  add(null, block("Appointment", "label", { xPct: 6, yPct: 51, wPct: 42, hPct: 2.6 }));
  add("pickup_at", block(seed.pickupAt, "value", { xPct: 6, yPct: 53.6, wPct: 42, hPct: 3.2 }));

  add(null, block("DELIVER", "heading", { xPct: 54, yPct: 40.5, wPct: 40, hPct: 3 }));
  add("delivery_facility", block(seed.deliveryFacility, "value", { xPct: 54, yPct: 44, wPct: 40, hPct: 3.2 }));
  add("delivery_address", block(seed.deliveryAddress, "body", { xPct: 54, yPct: 47.4, wPct: 40, hPct: 3 }));
  add(null, block("Appointment", "label", { xPct: 54, yPct: 51, wPct: 40, hPct: 2.6 }));
  add("deliver_by", block(seed.deliverBy, "value", { xPct: 54, yPct: 53.6, wPct: 40, hPct: 3.2 }));

  /* ---- Money ---- */
  add(null, block("", "rule", { xPct: 6, yPct: 58.5, wPct: 88, hPct: 0.4 }));
  add(null, block("TOTAL RATE", "label", { xPct: 60, yPct: 60.5, wPct: 34, hPct: 2.8 }, true));
  add("rate_total", block(money(seed.rateCents), "title", { xPct: 60, yPct: 63.2, wPct: 34, hPct: 5 }, true));
  add(null, block(
    `${seed.loadedMiles.toLocaleString()} miles · all in, no fuel surcharge`,
    "small", { xPct: 60, yPct: 68.4, wPct: 34, hPct: 2.8 }, true,
  ));
  add(null, block("PAYMENT", "label", { xPct: 6, yPct: 60.5, wPct: 44, hPct: 2.8 }));
  add("payment_terms", block(seed.paymentTerms, "body", { xPct: 6, yPct: 63.2, wPct: 46, hPct: 4 }));

  /* ---- Terms ---- */
  add(null, block("", "rule", { xPct: 6, yPct: 73, wPct: 88, hPct: 0.4 }));
  add(null, block("ACCESSORIALS", "label", { xPct: 6, yPct: 74.5, wPct: 40, hPct: 2.6 }));
  add("detention_terms", block(seed.detentionTerms, "body", { xPct: 6, yPct: 77.2, wPct: 88, hPct: 3.4 }));
  add("layover_terms", block(
    seed.layoverTerms ?? "Layover: not stated on this confirmation.",
    "body", { xPct: 6, yPct: 80.8, wPct: 88, hPct: 3.4 },
  ));
  add(null, block(
    "Carrier must sign and return this confirmation before dispatch. Any accessorial not pre-approved in writing will not be paid.",
    "small", { xPct: 6, yPct: 85, wPct: 88, hPct: 4.5 },
  ));

  /* ---- Signature line, empty on the original ---- */
  add(null, block("", "rule", { xPct: 6, yPct: 90.5, wPct: 40, hPct: 0.4 }));
  add("signature_line", block("Carrier signature", "label", { xPct: 6, yPct: 91.2, wPct: 40, hPct: 2.6 }));
  add(null, block("", "rule", { xPct: 54, yPct: 90.5, wPct: 40, hPct: 0.4 }));
  add(null, block("Date", "label", { xPct: 54, yPct: 91.2, wPct: 40, hPct: 2.6 }));

  const document: RateConDocument = {
    documentId: `doc_${(++seq).toString(36)}${Date.now().toString(36)}`,
    kind: "original",
    fileName: `${seed.brokerReference.replace(/[^\w-]/g, "")}-rate-confirmation.pdf`,
    receivedFrom: seed.brokerEmail,
    pages: 1,
    blocks,
    createdAt: nowIso(),
    mockNotice: "Generated by Antcolos so this workflow can be used. No document was received from anybody.",
  };

  return { document, named };
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The signature, laid ON the broker's page.
 *
 * ★ WHAT THIS RETURNS IS AN OVERLAY ★
 * Only the blocks that were ADDED. The original is named in `overlay` and is
 * drawn underneath wherever this is shown, so the broker's page is literally
 * still their page — nothing of theirs is copied, re-keyed or re-laid-out, and
 * no change to how documents are built can reach backwards and alter what we
 * claim they sent.
 *
 * It used to copy every one of the original's blocks into a second record. That
 * rendered identically and was the wrong claim: two documents that both said
 * they were the broker's page, and only a comment promising they agreed.
 */
export function signDocument(
  original: RateConDocument,
  signature: AppliedSignature,
  corrections: { label: string; from: string; to: string }[],
): RateConDocument {
  const blocks: DocumentBlock[] = [];

  blocks.push(block(signature.signedName, "signature", { xPct: 6, yPct: 87.2, wPct: 40, hPct: 3.6 }));
  blocks.push(block(
    `${signature.carrierName}${signature.mcNumber ? ` · MC ${signature.mcNumber.replace(/^MC-?/i, "")}` : ""}`,
    "small", { xPct: 6, yPct: 93.8, wPct: 40, hPct: 2.6 },
  ));
  blocks.push(block(dateOnly(signature.signedAt), "signature", { xPct: 54, yPct: 87.2, wPct: 40, hPct: 3.6 }));
  blocks.push(block(
    `Authorised by ${signature.authorisedByName}`,
    "small", { xPct: 54, yPct: 93.8, wPct: 40, hPct: 2.6 },
  ));

  if (corrections.length > 0) {
    blocks.push(block("SIGNED SUBJECT TO THE FOLLOWING CORRECTIONS", "label", { xPct: 6, yPct: 96.6, wPct: 88, hPct: 2.4 }));
    corrections.slice(0, 3).forEach((c, i) => {
      blocks.push(block(
        `${c.label}: shown as "${c.from}" — corrected to "${c.to}"`,
        "small", { xPct: 6, yPct: 98.6 + i * 2.2, wPct: 88, hPct: 2.2 },
      ));
    });
  }

  return {
    documentId: `doc_${(++seq).toString(36)}${Date.now().toString(36)}`,
    kind: "signed",
    fileName: original.fileName.replace(/\.pdf$/, "") + "-signed.pdf",
    pages: original.pages,
    blocks,
    overlay: { baseDocumentId: original.documentId, baseFileName: original.fileName },
    createdAt: nowIso(),
    signature,
    mockNotice: "Their page with a drawn signature laid on it. The signature is not a credential and nothing was sent anywhere.",
  };
}

/**
 * The disputed lines, marked ON the broker's page.
 *
 * Same principle as signing, for the other direction: a rate confirmation going
 * back for correction goes back as THEIR document with our marks on it. Each
 * mark sits on the region of the block it disputes, so the broker opens the
 * page they produced and sees a ring round the number we are arguing about.
 */
export function annotateDocument(
  original: RateConDocument,
  marks: { blockId: string; label: string; agreed: string }[],
  byName: string,
): RateConDocument {
  const byId = new Map(original.blocks.map((b) => [b.id, b]));
  const blocks: DocumentBlock[] = [];

  for (const mark of marks) {
    const target = byId.get(mark.blockId);
    if (!target) continue;
    // The ring goes exactly where their value is. `dispute` is drawn as an
    // outline rather than a filled box so the value underneath stays readable —
    // a mark that hides the number it disputes is worse than no mark.
    blocks.push({
      id: `mk_${(++seq).toString(36)}`,
      text: "",
      style: "dispute",
      region: { ...target.region },
    });
    blocks.push(block(
      `We booked ${mark.agreed}`,
      "small",
      {
        page: target.region.page,
        xPct: Math.min(target.region.xPct + target.region.wPct + 1, 62),
        yPct: target.region.yPct,
        wPct: 36,
        hPct: Math.max(target.region.hPct, 2.4),
      },
    ));
  }

  blocks.push(block(
    `Returned unsigned by ${byName}. The ringed values do not match what was booked.`,
    "small", { xPct: 6, yPct: 90, wPct: 88, hPct: 2.6 },
  ));

  return {
    documentId: `doc_${(++seq).toString(36)}${Date.now().toString(36)}`,
    kind: "marked_up",
    fileName: original.fileName.replace(/\.pdf$/, "") + "-marked.pdf",
    pages: original.pages,
    blocks,
    overlay: { baseDocumentId: original.documentId, baseFileName: original.fileName },
    createdAt: nowIso(),
    mockNotice: "Their page with our marks laid on it. Nothing of theirs was changed.",
  };
}

/* -------------------------------------------------------------------------- */

function money(cents: Cents): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function dateOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

export function documentDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

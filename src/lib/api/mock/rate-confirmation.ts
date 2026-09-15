import type {
  AppliedSignature, BookingRecord, DistributionOutcome, ExtractedField,
  InboundRateConEmail, RateConAuditAction, RateConFieldKey, RateConMatchEvidence,
  RateConProgress, RateConWorkflow,
} from "@/types";
import { RATECON_FIELD_LABEL } from "@/types";
import { bookingById, bookingsForWorkspace } from "./booking";
import { carrierViewSync } from "./carrier-registry";
import { listingById } from "./listing-registry";
import { mtLoopById } from "./mt-loop";
import type { MtLoopContext } from "./mt-loop";
import { negotiationsForCycle } from "./negotiation";
import { prepareMessageSync, recordAutoSend, messageById } from "./communications";
import { buildRateConDocument, documentDate, signDocument } from "./ratecon-document";
import { truckContextFrom } from "./truck-registry";
import { commitRateConfirmation } from "./rate-confirmation-record";
import { mockLoadsService } from "./loads";
import { propagationBus } from "@/lib/propagation";
import { newCorrelationId, withCorrelation } from "@/lib/audit/correlation";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Reading a broker's rate confirmation, correcting it, signing it, sending it
 * back, and handing what it says to the rest of Antcolos.
 *
 * Nothing is received and nothing is sent. The email is generated, the document
 * is drawn by `ratecon-document`, the OCR is a lookup over blocks whose text we
 * already know, and the signature is a name on a line rather than a credential.
 * Every screen says all of that.
 *
 * What is NOT a mock is the shape of the thing, and the shape is the point:
 *
 *   • The original document is never altered. Signing produces a separate
 *     document. Both are kept for ever.
 *   • Every extracted value knows the exact box on the page it came from, and
 *     carries what the booking says instead, so the review is a comparison
 *     rather than a transcription.
 *   • Every required field must be looked at by a person. Not clicked through
 *     in bulk — looked at, one at a time.
 *   • The carrier's signature is applied at exactly one moment: a person's
 *     final confirmation, naming them, on that document. There is no other
 *     code path that can apply it.
 *   • What the document says is then distributed, and everything that has
 *     nowhere to go yet is listed as waiting rather than quietly dropped.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 320;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const byOrg = new Map<string, RateConWorkflow[]>();

function bucket(organizationId: string): RateConWorkflow[] {
  let rows = byOrg.get(organizationId);
  if (!rows) {
    rows = [];
    byOrg.set(organizationId, rows);
  }
  return rows;
}

export function resetRateConfirmations() {
  byOrg.clear();
  seq = 0;
}

function mayRead(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

/**
 * Who may put the carrier's name on a document.
 *
 * Deliberately the same permission as creating a load rather than merely
 * viewing one: signing a rate confirmation commits the carrier to a price and
 * a delivery, and somebody who may only read loads is not entitled to do that.
 */
function maySign(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:create") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export function rateConById(rateConId: string, ctx: MtLoopContext): RateConWorkflow | undefined {
  if (!mayRead(ctx)) return undefined;
  return bucket(ctx.organizationId).find((w) => w.rateConId === rateConId);
}

export function rateConForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): RateConWorkflow | undefined {
  if (!mayRead(ctx)) return undefined;
  return bucket(ctx.organizationId).find((w) => w.dispatchCycleId === dispatchCycleId);
}

export function rateConsFor(ctx: MtLoopContext): RateConWorkflow[] {
  if (!mayRead(ctx)) return [];
  return [...bucket(ctx.organizationId)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Matching an arriving email to a booking                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which booking is this rate confirmation about?
 *
 * Matched on facts that are all on the document — the broker, the lane, the
 * money — rather than on a reference number, because a broker's own load number
 * is exactly the thing Antcolos has never seen before. Every fact that agreed
 * and every fact that did not is kept and shown: attaching a rate confirmation
 * to the wrong load survives all the way to the invoice.
 */
export function matchEmailToBooking(
  input: { brokerName: string; rateCents?: number; originCity?: string; destinationCity?: string },
  ctx: MtLoopContext,
): RateConMatchEvidence {
  const bookings = bookingsForWorkspace(ctx).filter((b) => !hasRateCon(b.bookingId, ctx));
  if (bookings.length === 0) {
    return {
      confidence: "uncertain", agreedOn: [], disagreedOn: [],
      unmatchedReason: "Nothing is booked that is still waiting for a rate confirmation.",
    };
  }

  let best: { booking: BookingRecord; agreed: string[]; disagreed: string[] } | undefined;
  for (const booking of bookings) {
    const agreed: string[] = [];
    const disagreed: string[] = [];

    if (normalize(booking.brokerName) === normalize(input.brokerName)) {
      agreed.push(`the broker is ${booking.brokerName}`);
    } else {
      disagreed.push(`the booking is with ${booking.brokerName}`);
    }
    if (input.rateCents !== undefined) {
      if (input.rateCents === booking.agreedRateCents) agreed.push("the rate is the one agreed");
      else disagreed.push(`the rate on the document is not the ${money(booking.agreedRateCents)} agreed`);
    }
    const listing = listingOf(booking, ctx);
    if (listing && input.originCity) {
      if (normalize(listing.origin.city) === normalize(input.originCity)) agreed.push(`it picks up in ${listing.origin.city}`);
      else disagreed.push(`the booking picks up in ${listing.origin.city}`);
    }
    if (listing && input.destinationCity) {
      if (normalize(listing.destination.city) === normalize(input.destinationCity)) agreed.push(`it delivers to ${listing.destination.city}`);
      else disagreed.push(`the booking delivers to ${listing.destination.city}`);
    }

    if (!best || agreed.length > best.agreed.length) best = { booking, agreed, disagreed };
  }

  if (!best || best.agreed.length === 0) {
    return {
      confidence: "uncertain", agreedOn: [], disagreedOn: best?.disagreed ?? [],
      unmatchedReason: "Nothing booked here looks like this document.",
    };
  }

  // The broker alone is not enough: one broker can have two loads on with the
  // same carrier in a week, and picking the wrong one is silent.
  const confidence = best.agreed.length >= 3
    ? "certain"
    : best.agreed.length === 2 ? "likely" : "uncertain";

  return {
    confidence,
    bookingId: best.booking.bookingId,
    dispatchCycleId: best.booking.dispatchCycleId,
    loadReference: best.booking.loadReference,
    agreedOn: best.agreed,
    disagreedOn: best.disagreed,
  };
}

function hasRateCon(bookingId: string, ctx: MtLoopContext): boolean {
  return bucket(ctx.organizationId).some((w) => w.bookingId === bookingId && w.status !== "rejected");
}

function listingOf(booking: BookingRecord, ctx: MtLoopContext) {
  return listingById(ctx.organizationId, booking.listingId);
}

/* -------------------------------------------------------------------------- */
/* Arrival                                                                     */
/* -------------------------------------------------------------------------- */

export type RateConOutcome =
  | { status: "ok"; workflow: RateConWorkflow }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "already_open"; workflow: RateConWorkflow }
  | { status: "needs_confirmation"; evidence: RateConMatchEvidence }
  | { status: "blocked"; reason: string };

/**
 * A rate confirmation arrives for a booked load.
 *
 * In a real system this is a mailbox rule. Here a person asks for it, and the
 * screen says plainly that the email is a sample. Everything after this point —
 * the matching, the extraction, the review, the signature — behaves exactly as
 * it would for a real one, which is the only reason generating it is worth
 * anything.
 */
export async function receiveRateConfirmation(
  bookingId: string,
  ctx: MtLoopContext,
): Promise<RateConOutcome> {
  await sleep(LATENCY_MS);
  if (!mayRead(ctx)) return { status: "not_permitted" };

  const booking = bookingById(bookingId, ctx);
  if (!booking) return { status: "not_found" };

  const existing = bucket(ctx.organizationId).find(
    (w) => w.bookingId === bookingId && w.status !== "rejected",
  );
  if (existing) return { status: "already_open", workflow: existing };

  const loop = mtLoopById(booking.dispatchCycleId, ctx);
  const listing = listingOf(booking, ctx);
  const carrier = carrierViewSync(booking.carrierOrganizationId, truckContextFrom(ctx));
  if (!loop || !listing || !carrier) return { status: "not_found" };

  const negotiation = negotiationsForCycle(booking.dispatchCycleId, ctx)
    .find((n) => n.negotiationId === booking.negotiationId);

  /* ---- What the broker's document says ---------------------------------- */

  // Three deliberate differences from what was booked. Each one is a thing that
  // genuinely happens, and each one is worth a dispatcher's eye:
  //   the rate is $50 light, the pickup is an hour earlier, layover is silent.
  const documentRateCents = booking.agreedRateCents - 5000;
  const documentPickup = new Date(Date.parse(listing.pickupAt) - 3_600_000).toISOString();

  const seed = {
    brokerName: booking.brokerName,
    brokerMc: listing.broker.mcNumber,
    brokerContact: listing.broker.contactName,
    brokerPhone: listing.broker.phone,
    brokerEmail: listing.broker.email,
    brokerReference: listing.sourceReference ?? `${initials(booking.brokerName)}-${booking.loadReference.split("-").pop()}`,

    carrierName: carrier.legalName,
    carrierMc: carrier.mcNumber,
    carrierDot: carrier.dotNumber,

    equipment: listing.equipment.replace(/_/g, " "),
    commodity: listing.commodity,
    weightLbs: listing.weightLbs,

    pickupFacility: `${listing.origin.city} Distribution Center`,
    pickupAddress: `${1200 + (listing.loadedMiles % 700)} Industrial Way, ${listing.origin.city}, ${listing.origin.state}`,
    pickupAt: documentDate(documentPickup),
    deliveryFacility: `${listing.destination.city} Receiving`,
    deliveryAddress: `${400 + (listing.loadedMiles % 300)} Commerce Dr, ${listing.destination.city}, ${listing.destination.state}`,
    deliverBy: documentDate(listing.deliverBy ?? new Date(Date.parse(listing.pickupAt) + 86_400_000).toISOString()),

    rateCents: documentRateCents,
    loadedMiles: listing.loadedMiles,
    paymentTerms: "Net 30 from receipt of signed POD and invoice.",
    detentionTerms: "Detention: $45/hour after 2 hours free at each stop, documented arrival and departure required.",
    layoverTerms: undefined,
  };

  const { document, named } = buildRateConDocument(seed);

  const email: InboundRateConEmail = {
    emailId: rowId("eml"),
    fromName: listing.broker.contactName ?? booking.brokerName,
    fromEmail: listing.broker.email ?? "dispatch@broker.example",
    subject: `Rate confirmation — ${seed.brokerReference} — ${listing.origin.city}, ${listing.origin.state} to ${listing.destination.city}, ${listing.destination.state}`,
    receivedAt: nowIso(),
    attachmentName: document.fileName,
    bodyPreview: `Please sign and return the attached for ${seed.brokerReference}. Truck must be on time; detention per the confirmation.`,
    isSample: true,
  };

  const evidence = matchEmailToBooking({
    brokerName: booking.brokerName,
    rateCents: documentRateCents,
    originCity: listing.origin.city,
    destinationCity: listing.destination.city,
  }, ctx);

  const workflow: RateConWorkflow = {
    rateConId: rowId("rc"),
    organizationId: ctx.organizationId,
    carrierOrganizationId: booking.carrierOrganizationId,
    carrierName: carrier.displayName,
    bookingId: booking.bookingId,
    dispatchCycleId: booking.dispatchCycleId,
    loadId: booking.loadId,
    loadReference: booking.loadReference,
    brokerName: booking.brokerName,
    email,
    evidence,
    original: document,
    fields: [],
    status: "reviewing",
    distribution: [],
    audit: [],
    createdAt: nowIso(),
  };

  record(workflow, "received", "Antcolos", `Sample rate confirmation for ${booking.loadReference} from ${email.fromName}. No mailbox is connected.`);
  record(workflow, "matched", "Antcolos", matchSentence(evidence));

  /* ---- The mock OCR ------------------------------------------------------ */
  workflow.fields = extract(workflow, named, {
    booking,
    agreedRateCents: booking.agreedRateCents,
    expectedPickupAt: listing.pickupAt,
    carrierLegalName: carrier.legalName,
    carrierMc: carrier.mcNumber,
    carrierDot: carrier.dotNumber,
    brokerMc: listing.broker.mcNumber,
    brokerContact: listing.broker.contactName,
    equipment: listing.equipment.replace(/_/g, " "),
    negotiationAgreed: negotiation?.agreedRateCents,
  });
  record(
    workflow, "extracted", "Antcolos",
    `${workflow.fields.length} fields read off the page. ${workflow.fields.filter((f) => f.disagrees).length} do not match the booking.`,
  );

  bucket(ctx.organizationId).push(workflow);
  return { status: "ok", workflow };
}

function matchSentence(evidence: RateConMatchEvidence): string {
  if (!evidence.bookingId) return evidence.unmatchedReason ?? "Nothing matched.";
  const head = evidence.confidence === "certain"
    ? `Matched to ${evidence.loadReference}`
    : `Probably ${evidence.loadReference} — a person should confirm`;
  return `${head}: ${evidence.agreedOn.join(", ")}.`;
}

/* -------------------------------------------------------------------------- */
/* The mock OCR                                                                */
/* -------------------------------------------------------------------------- */

interface ExpectedValues {
  booking: BookingRecord;
  agreedRateCents: number;
  expectedPickupAt: string;
  carrierLegalName: string;
  carrierMc?: string;
  carrierDot?: string;
  brokerMc?: string;
  brokerContact?: string;
  equipment: string;
  negotiationAgreed?: number;
}

/**
 * Read the document.
 *
 * A lookup rather than an OCR — the text is ours, so "reading" it is cheating.
 * What it does honestly is the part that matters downstream: every field comes
 * back tied to the block it was read from, so the review can point at the page,
 * and with the booking's own value beside it so disagreement is computed rather
 * than left to a dispatcher's memory.
 *
 * Confidence is lower on the fields a real OCR genuinely struggles with —
 * handwriting-adjacent things like appointment times and free-text terms — so
 * the screen draws the eye to the same places a real one would.
 */
function extract(
  workflow: RateConWorkflow,
  named: Record<string, { id: string; text: string; region: ExtractedField["region"] }>,
  expected: ExpectedValues,
): ExtractedField[] {
  const out: ExtractedField[] = [];

  const push = (
    key: RateConFieldKey,
    blockName: string,
    opts: { required: boolean; confidence: number; expected?: string },
  ) => {
    const block = named[blockName];
    if (!block) return;
    const rawText = block.text;
    const expectedValue = opts.expected;
    out.push({
      key,
      label: RATECON_FIELD_LABEL[key],
      rawText,
      value: rawText,
      confidence: opts.confidence,
      region: block.region,
      blockId: block.id,
      required: opts.required,
      expected: expectedValue,
      disagrees: expectedValue !== undefined && !sameish(rawText, expectedValue),
      status: "unreviewed",
    });
  };

  push("broker_name", "broker_name", { required: true, confidence: 0.97, expected: workflow.brokerName });
  push("broker_mc", "broker_mc", {
    required: false, confidence: 0.93,
    expected: expected.brokerMc ? `MC ${expected.brokerMc.replace(/^MC-?/i, "")}` : undefined,
  });
  push("broker_contact", "broker_contact", { required: false, confidence: 0.88 });
  push("load_reference", "load_reference", { required: true, confidence: 0.95 });
  push("carrier_name", "carrier_name", { required: true, confidence: 0.96, expected: expected.carrierLegalName });
  // The document prints MC and DOT on one line, so the expected value is built
  // the same way. Comparing "MC 877240 DOT 2884103" against "MC 877240" would
  // raise a disagreement no human would agree with, and a screen that cries
  // wolf on a matching field trains people to click past the real ones.
  push("carrier_mc", "carrier_mc", {
    required: true, confidence: 0.92,
    expected: [
      expected.carrierMc ? `MC ${expected.carrierMc.replace(/^MC-?/i, "")}` : undefined,
      expected.carrierDot ? `DOT ${expected.carrierDot}` : undefined,
    ].filter(Boolean).join("   ") || undefined,
  });
  push("equipment", "equipment", { required: true, confidence: 0.94, expected: expected.equipment });
  push("commodity", "commodity", { required: false, confidence: 0.9 });
  push("weight", "weight", { required: false, confidence: 0.86 });
  push("pickup_facility", "pickup_facility", { required: true, confidence: 0.91 });
  push("pickup_address", "pickup_address", { required: true, confidence: 0.84 });
  push("pickup_at", "pickup_at", {
    required: true, confidence: 0.72, expected: documentDate(expected.expectedPickupAt),
  });
  push("delivery_facility", "delivery_facility", { required: true, confidence: 0.9 });
  push("delivery_address", "delivery_address", { required: true, confidence: 0.83 });
  push("deliver_by", "deliver_by", { required: true, confidence: 0.74 });
  push("rate_total", "rate_total", {
    required: true, confidence: 0.98, expected: money(expected.agreedRateCents),
  });
  push("payment_terms", "payment_terms", { required: false, confidence: 0.79 });
  push("detention_terms", "detention_terms", { required: true, confidence: 0.68 });
  // Layover is its own field even when the document says nothing about it.
  // Folding it into detention is the mistake this separation exists to stop:
  // they are different money, on different clocks, and a confirmation silent
  // on layover is a fact a dispatcher needs rather than an empty row to skip.
  push("layover_terms", "layover_terms", { required: true, confidence: 0.61 });

  return out;
}

/** Loose comparison: case, spacing and trailing punctuation do not matter. */
function sameish(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}
const normalize = (s: string) => s.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");

/* -------------------------------------------------------------------------- */
/* Review                                                                      */
/* -------------------------------------------------------------------------- */

export type FieldOutcome =
  | { status: "ok"; workflow: RateConWorkflow; field: ExtractedField }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "needs_reason" }
  | { status: "closed" };

/** This one is right as the broker wrote it. */
export async function verifyField(
  rateConId: string,
  key: RateConFieldKey,
  ctx: MtLoopContext,
): Promise<FieldOutcome> {
  await sleep(160);
  const workflow = rateConById(rateConId, ctx);
  if (!workflow) return mayRead(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (workflow.status === "returned" || workflow.status === "rejected") return { status: "closed" };
  const field = workflow.fields.find((f) => f.key === key);
  if (!field) return { status: "not_found" };

  field.status = "verified";
  field.correctedValue = undefined;
  field.value = field.rawText;
  field.reviewedByName = ctx.actor.displayNameSnapshot;
  field.reviewedAt = nowIso();
  record(workflow, "field_verified", ctx.actor.displayNameSnapshot, `${field.label}: confirmed as "${field.rawText}".`, ctx.membershipId);
  refreshStatus(workflow);
  return { status: "ok", workflow, field };
}

/**
 * This one is wrong, and here is what it should say.
 *
 * The raw text is left exactly as it was. A correction is a second value beside
 * the first, not an overwrite — which is what lets the signed copy carry "shown
 * as X, corrected to Y" and lets anybody afterwards see what the broker
 * actually sent.
 */
export async function correctField(
  rateConId: string,
  key: RateConFieldKey,
  correctedValue: string,
  ctx: MtLoopContext,
  note?: string,
): Promise<FieldOutcome> {
  await sleep(160);
  const workflow = rateConById(rateConId, ctx);
  if (!workflow) return mayRead(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (workflow.status === "returned" || workflow.status === "rejected") return { status: "closed" };
  const field = workflow.fields.find((f) => f.key === key);
  if (!field) return { status: "not_found" };
  if (!correctedValue.trim()) return { status: "needs_reason" };

  field.status = "corrected";
  field.correctedValue = correctedValue.trim();
  field.value = correctedValue.trim();
  field.correctionNote = note?.trim() || undefined;
  field.reviewedByName = ctx.actor.displayNameSnapshot;
  field.reviewedAt = nowIso();
  record(
    workflow, "field_corrected", ctx.actor.displayNameSnapshot,
    `${field.label}: document said "${field.rawText}", corrected to "${field.correctedValue}".${note?.trim() ? ` ${note.trim()}` : ""}`,
    ctx.membershipId,
  );
  refreshStatus(workflow);
  return { status: "ok", workflow, field };
}

export function progressOf(workflow: RateConWorkflow): RateConProgress {
  const required = workflow.fields.filter((f) => f.required);
  const reviewedRequired = required.filter((f) => f.status !== "unreviewed");
  const next = required.find((f) => f.status === "unreviewed");
  const blocked: string[] = [];
  if (next) {
    blocked.push(`${required.length - reviewedRequired.length} field${required.length - reviewedRequired.length === 1 ? "" : "s"} still to check.`);
  }
  if (workflow.status === "returned") blocked.push("This one is already signed and returned.");
  if (workflow.status === "rejected") blocked.push("This one was stopped.");
  return {
    total: workflow.fields.length,
    required: required.length,
    reviewed: reviewedRequired.length,
    corrected: workflow.fields.filter((f) => f.status === "corrected").length,
    disagreements: workflow.fields.filter((f) => f.disagrees).length,
    nextFieldKey: next?.key,
    canConfirm: blocked.length === 0,
    blockedReasons: blocked,
  };
}

function refreshStatus(workflow: RateConWorkflow) {
  if (workflow.status === "returned" || workflow.status === "rejected") return;
  workflow.status = progressOf(workflow).canConfirm ? "ready_to_confirm" : "reviewing";
}

/* -------------------------------------------------------------------------- */
/* Confirmation and signature                                                  */
/* -------------------------------------------------------------------------- */

export type ConfirmOutcome =
  | { status: "ok"; workflow: RateConWorkflow }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "not_ready"; blockedReasons: string[] }
  | { status: "blocked"; reason: string };

/**
 * The one moment the carrier's signature is applied.
 *
 * Everything this function does is downstream of a single human confirmation:
 * the signature, the signed copy, the message back to the broker, and the
 * distribution of what the document says. There is no other path to any of it,
 * and the person who confirmed is named on all of it.
 */
export async function confirmAndSign(
  rateConId: string,
  ctx: MtLoopContext,
): Promise<ConfirmOutcome> {
  await sleep(LATENCY_MS);
  if (!maySign(ctx)) return { status: "not_permitted" };

  const workflow = rateConById(rateConId, ctx);
  if (!workflow) return { status: "not_found" };
  if (workflow.status === "returned") return { status: "blocked", reason: "It is already signed and returned." };
  if (workflow.status === "rejected") return { status: "blocked", reason: "This one was stopped." };

  const progress = progressOf(workflow);
  if (!progress.canConfirm) return { status: "not_ready", blockedReasons: progress.blockedReasons };

  const carrier = carrierViewSync(workflow.carrierOrganizationId, truckContextFrom(ctx));
  if (!carrier) return { status: "not_found" };
  if (!carrier.canHaul) {
    return {
      status: "blocked",
      reason: `${carrier.displayName} cannot legally haul right now. Their signature must not go on a rate confirmation.`,
    };
  }

  /* --- from here, nothing awaits ----------------------------------------- */

  const at = nowIso();
  const corrections = workflow.fields
    .filter((f) => f.status === "corrected")
    .map((f) => ({ label: f.label, from: f.rawText, to: f.correctedValue ?? f.value }));

  const primary = carrier.contacts.find((c) => c.isPrimary) ?? carrier.contacts[0];
  const signature: AppliedSignature = {
    carrierOrganizationId: carrier.organizationId,
    carrierName: carrier.displayName,
    signedName: primary?.name ?? carrier.legalName,
    title: primary?.role ? titleCase(primary.role) : undefined,
    mcNumber: carrier.mcNumber,
    signedAt: at,
    authorisedByName: ctx.actor.displayNameSnapshot,
    authorisedByMembershipId: ctx.membershipId,
    statement: corrections.length > 0
      ? `Checked field by field against ${workflow.loadReference} and signed with ${corrections.length} correction${corrections.length === 1 ? "" : "s"}.`
      : `Checked field by field against ${workflow.loadReference} and signed as written.`,
  };

  // The original is untouched. This is a new document.
  workflow.signed = signDocument(workflow.original, signature, corrections);
  workflow.status = "returned";
  workflow.confirmedAt = at;
  workflow.confirmedByName = ctx.actor.displayNameSnapshot;
  workflow.confirmedByMembershipId = ctx.membershipId;

  record(workflow, "confirmed", ctx.actor.displayNameSnapshot, signature.statement, ctx.membershipId);
  record(
    workflow, "signed", ctx.actor.displayNameSnapshot,
    `${carrier.displayName}'s signature applied to a new document, ${workflow.signed.fileName}. The original is unchanged.`,
    ctx.membershipId,
  );

  /* ---- Back to the broker ---- */
  const prepared = prepareMessageSync(workflow.dispatchCycleId, "signed_rate_confirmation", ctx, {
    preparedBecause: "The rate confirmation was checked, corrected and signed.",
    extras: {
      signedDocumentName: workflow.signed.fileName,
      correctionsMade: corrections.map((c) => `${c.label}: shown as "${c.from}", corrected to "${c.to}"`),
    },
    attachments: [{
      documentId: workflow.signed.documentId,
      fileName: workflow.signed.fileName,
      label: "Signed rate confirmation",
    }],
  });
  if (prepared.status === "ok") {
    recordAutoSend(prepared.message, ctx.actor.displayNameSnapshot);
    workflow.returnMessageId = prepared.message.messageId;
    record(
      workflow, "returned", ctx.actor.displayNameSnapshot,
      `Signed copy recorded as returned to ${workflow.brokerName}. Antcolos has no mailbox; nothing left this machine.`,
      ctx.membershipId,
    );
  }

  /* ---- And out to the rest of Antcolos ---------------------------------- */

  /*
   * One intent, one correlation id, one canonical commit, one event.
   *
   * Everything below happens under a single correlation id, so the committed
   * rate confirmation, the load's three timeline entries, the audit lines and
   * every projection read back as one act a week later.
   *
   * The sequence matters and is the answer to "finalize the canonical Load once":
   *   1. FREEZE the workflow into the immutable canonical record. Nothing
   *      downstream may read a workflow somebody is still editing.
   *   2. Hand that record to the Loads module's own command, which writes the
   *      fields the Load owns and publishes ONE versioned `load.finalized`.
   *   3. Read back what every projection did, and show it.
   *
   * Retrying any of it is safe: the commit is keyed on the signed document, the
   * finalization is keyed on the committed record, and the event id is derived
   * from the same key, so a second attempt writes nothing and re-runs nothing.
   */
  const correlationId = newCorrelationId();
  const commit = withCorrelation(correlationId, () => commitRateConfirmation({
    workflow,
    actor: ctx.actor,
    membershipId: ctx.membershipId,
    channel: "email",
    correlationId,
  }));

  record(
    workflow, "distributed", "Antcolos",
    `Committed as rate confirmation ${commit.record.rateConfirmationId} v${commit.record.version}. That record is immutable: an amendment would commit a new version beside it, never edit this one.`,
  );

  const loop = mtLoopById(workflow.dispatchCycleId, ctx);
  const booking = bookingById(workflow.bookingId, ctx);

  const finalized = await mockLoadsService.applyRateConfirmation(ctx, {
    idempotencyKey: `ratecon-finalize:${commit.record.rateConfirmationId}`,
    loadId: workflow.loadId,
    record: commit.record,
    mtLoopId: loop?.loopId,
    dispatchCycleId: workflow.dispatchCycleId,
    bookingId: workflow.bookingId,
    assignmentLabels: {
      driverName: booking?.driverName ?? loop?.driverName,
      truckUnit: booking?.truckUnit ?? loop?.truckUnit,
      trailerUnit: booking?.trailerUnit ?? loop?.trailerUnit,
    },
  });

  workflow.distribution = distributionFrom(finalized.eventId);
  const counts = summarizeDistribution(workflow.distribution);
  record(
    workflow, "distributed", "Antcolos",
    `${workflow.loadReference} finalized once and one load.finalized event published. ${counts}`,
  );

  return { status: "ok", workflow };
}

/**
 * What the published event's subscribers actually did, for the screen.
 *
 * Read back rather than predicted. A projection that failed says so here, with
 * its reason, instead of the screen claiming a module was updated because the
 * code meant to update it.
 */
export function distributionFrom(eventId: string): DistributionOutcome[] {
  return propagationBus.projectionsFor(eventId).map((p) => ({
    key: p.subscriberId,
    label: p.subscriberLabel,
    state: p.state,
    targetModule: p.targetModule,
    detail: p.detail,
    reason: p.reason,
    retryable: p.retryable,
    mock: p.mock,
    attempts: p.attempts,
  }));
}

function summarizeDistribution(rows: DistributionOutcome[]): string {
  const by = (state: DistributionOutcome["state"]) =>
    rows.filter((r) => r.state === state).length;
  const parts = [
    `${by("processed")} processed`,
    `${by("pending")} pending`,
    `${by("needs_review")} needing a person`,
    `${by("failed")} failed`,
  ];
  return `${parts.join(", ")}. A failure in one projection never stops the others.`;
}

/**
 * Run one projection again, for a screen offering a retry.
 *
 * Only ever a re-run: the event is a statement about the past and is untouched.
 * Returns the refreshed distribution so the caller re-renders from the record
 * rather than from an optimistic guess.
 */
export async function retryDistribution(
  workflow: RateConWorkflow,
  eventId: string,
  subscriberId: string,
): Promise<DistributionOutcome[]> {
  await propagationBus.retry(eventId, subscriberId);
  workflow.distribution = distributionFrom(eventId);
  return workflow.distribution;
}

export async function rejectRateConfirmation(
  rateConId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<ConfirmOutcome> {
  await sleep(LATENCY_MS);
  if (!maySign(ctx)) return { status: "not_permitted" };
  const workflow = rateConById(rateConId, ctx);
  if (!workflow) return { status: "not_found" };
  if (workflow.status === "returned") return { status: "blocked", reason: "It is already signed and returned." };
  if (!reason.trim()) return { status: "blocked", reason: "Say why, so the broker can be told." };

  workflow.status = "rejected";
  workflow.rejectedReason = reason.trim();
  record(workflow, "rejected", ctx.actor.displayNameSnapshot, reason.trim(), ctx.membershipId);
  return { status: "ok", workflow };
}

/* -------------------------------------------------------------------------- */
/* Distribution — see `distributionFrom` above                                 */
/* -------------------------------------------------------------------------- */

/*
 * `distribute()` and `applyToLoad()` used to live here.
 *
 * `applyToLoad` reached into the mock store and wrote the canonical Load in
 * place — the customer reference, both facilities, both addresses, the rate, the
 * satisfied requirement and the status — without appending a single LoadEvent,
 * even though `types/event.ts` says the timeline is the record and the status is
 * derived from it. That is now `loads.applyRateConfirmation`, which takes the
 * immutable committed record, appends the three timeline entries and publishes
 * one `load.finalized`.
 *
 * `distribute` returned nine hand-written rows: one "written" and eight "queued"
 * with prose naming a milestone that would one day receive them. Four of those
 * eight modules were already merged. The rows are now read back off the event's
 * real projection records by `distributionFrom`, so the screen shows what
 * actually happened per module rather than what the code intended.
 */


/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

function record(
  workflow: RateConWorkflow,
  action: RateConAuditAction,
  actorName: string,
  detail: string,
  actorMembershipId?: string,
) {
  workflow.audit.push({
    id: rowId("aud"),
    at: nowIso(),
    action,
    actorName,
    actorMembershipId,
    detail,
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The message that carried the signed copy, for a screen that wants to show it. */
export function returnMessageFor(workflow: RateConWorkflow, ctx: MtLoopContext) {
  return workflow.returnMessageId ? messageById(workflow.returnMessageId, ctx)?.message : undefined;
}

/** Test seam only. */
export function rateConsForTests(organizationId: string): RateConWorkflow[] {
  return bucket(organizationId);
}

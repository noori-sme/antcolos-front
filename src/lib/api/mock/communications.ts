import type {
  CarrierView, CommunicationThread, MessageAttachment, MessageContext,
  MessageExtras, MessageStatus, MessageTemplateKey, OutreachMessage, SendMethod,
  ThreadSummary,
} from "@/types";
import { carrierViewSync } from "./carrier-registry";
import { listingById } from "./listing-registry";
import { mtLoopById } from "./mt-loop";
import type { MtLoopContext } from "./mt-loop";
import { negotiationsForCycle } from "./negotiation";
import { bookingForCycle } from "./booking";
import { renderTemplate, TEMPLATES, writerFor } from "./message-templates";
import { truckContextFrom } from "./truck-registry";
import { reachableLoadById } from "./dispatch-delegation";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Every message about one piece of work, in one place.
 *
 * NOTHING IS SENT FROM HERE. Antcolos has no mailbox, no outbound server and
 * no address book it can reach. "Sent" means a person sent it themselves and
 * marked it, except for the single case the roadmap makes automatic — a signed
 * rate confirmation going back the moment somebody confirms it — which is
 * recorded as sent by Antcolos and labelled as a mock everywhere it appears.
 *
 * A thread is keyed to the DISPATCH CYCLE, the carrier and the broker. Not to
 * the load: the first message goes out before any load exists, and a thread
 * that split in two the moment a booking happened would lose the half where
 * the price was agreed. When the cycle gets a load, the thread picks up its
 * reference and carries on.
 *
 * Auto-drafting is deliberately narrow. Antcolos prepares a message only where
 * there is a real, checkable trigger — a load reached the best few, a broker
 * has not answered in four hours, the truck went elsewhere. Everything else is
 * a template a person picks, and the screen says which is which, because a
 * dispatcher who believes delay notices go out by themselves will not send one.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 240;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const byOrg = new Map<string, CommunicationThread[]>();

function bucket(organizationId: string): CommunicationThread[] {
  let rows = byOrg.get(organizationId);
  if (!rows) {
    rows = [];
    byOrg.set(organizationId, rows);
  }
  return rows;
}

export function resetCommunications() {
  byOrg.clear();
  seq = 0;
}

function mayRead(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export function threadsForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): CommunicationThread[] {
  if (!mayRead(ctx)) return [];
  return bucket(ctx.organizationId)
    .filter((t) => t.dispatchCycleId === dispatchCycleId)
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
}

export function threadsFor(ctx: MtLoopContext): CommunicationThread[] {
  if (!mayRead(ctx)) return [];
  return [...bucket(ctx.organizationId)]
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
}

export function threadById(threadId: string, ctx: MtLoopContext): CommunicationThread | undefined {
  if (!mayRead(ctx)) return undefined;
  return bucket(ctx.organizationId).find((t) => t.threadId === threadId);
}

export function summarize(thread: CommunicationThread): ThreadSummary {
  return {
    thread,
    waitingForYou: thread.messages.filter((m) => m.status === "draft").length,
    sent: thread.messages.filter((m) => m.status === "sent").length,
    lastActivityAt: lastActivity(thread),
  };
}

export function summarizeThreads(threads: CommunicationThread[]): ThreadSummary[] {
  return threads.map(summarize);
}

function lastActivity(thread: CommunicationThread): string {
  return thread.messages.reduce(
    (latest, m) => (m.sentAt ?? m.reviewedAt ?? m.createdAt) > latest
      ? (m.sentAt ?? m.reviewedAt ?? m.createdAt)
      : latest,
    thread.createdAt,
  );
}

export function messageById(
  messageId: string,
  ctx: MtLoopContext,
): { thread: CommunicationThread; message: OutreachMessage } | undefined {
  if (!mayRead(ctx)) return undefined;
  for (const thread of bucket(ctx.organizationId)) {
    const message = thread.messages.find((m) => m.messageId === messageId);
    if (message) return { thread, message };
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Building the context                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything a template is allowed to know, assembled from records.
 *
 * Nothing here is typed into a message by hand. A broker's name comes from the
 * listing, the MC number from the carrier's record, the rate from what was
 * actually agreed — so a message cannot say something the system does not
 * believe, and correcting a record corrects every future message at once.
 */
export function contextForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
  extras?: MessageExtras,
  /**
   * Write about THIS listing, whether or not a conversation is open on it.
   *
   * ★ WHY THIS EXISTS ★
   * The broker used to be reachable only through a negotiation, so a draft
   * could not be prepared until one had been opened — and the first message a
   * dispatcher sends IS how a conversation opens. Asking to see the message
   * first is not the same as having started one, so the listing can be named
   * directly and the negotiation stays un-opened until somebody sends.
   */
  aboutListingId?: string,
): MessageContext | undefined {
  const loop = mtLoopById(dispatchCycleId, ctx);
  if (!loop) return undefined;
  // A message written on a carrier's behalf needs a carrier. A cycle whose
  // carrier the records never established has none, and the workspace holding
  // the cycle is not a substitute for one.
  if (!loop.carrierOrganizationId) return undefined;
  const carrier = carrierViewSync(loop.carrierOrganizationId, truckContextFrom(ctx));
  if (!carrier) return undefined;

  const booking = bookingForCycle(dispatchCycleId, ctx);
  const negotiations = negotiationsForCycle(dispatchCycleId, ctx);
  // The conversation that got the load, or the newest one still live.
  const negotiation = negotiations.find((n) => n.status === "booked")
    ?? negotiations.find((n) => n.status === "agreed")
    ?? negotiations[0];
  const listing = (aboutListingId ? listingById(ctx.organizationId, aboutListingId) : undefined)
    ?? (negotiation ? listingById(ctx.organizationId, negotiation.listingId) : undefined);

  // Same rule: the booking is the carrier's, so its load is reached, not owned.
  const load = booking ? reachableLoadById(ctx, booking.loadId) : undefined;

  const origin = listing?.origin ?? {
    city: loop.expectedEmptyCity ?? "", state: loop.expectedEmptyState ?? "",
  };
  const destination = listing?.destination ?? { city: "", state: "" };

  return {
    writer: writerFor(carrier),
    broker: {
      // The named listing wins: it is the load being written about.
      name: (aboutListingId ? listing?.broker.name : undefined)
        ?? negotiation?.brokerName ?? listing?.broker.name ?? load?.customer.name ?? "",
      contactName: (aboutListingId ? listing?.broker.contactName : undefined)
        ?? negotiation?.brokerContactName ?? listing?.broker.contactName,
      email: (aboutListingId ? listing?.broker.email : undefined)
        ?? negotiation?.brokerEmail ?? listing?.broker.email,
      phone: listing?.broker.phone,
      mcNumber: listing?.broker.mcNumber,
    },
    subject: {
      lane: origin.city && destination.city
        ? `${origin.city}, ${origin.state} → ${destination.city}, ${destination.state}`
        : "",
      originCity: origin.city,
      originState: origin.state,
      destinationCity: destination.city,
      destinationState: destination.state,
      pickupAt: listing?.pickupAt,
      deliverBy: listing?.deliverBy,
      equipmentLabel: (listing?.equipment ?? loop.equipment)?.replace(/_/g, " "),
      sourceReference: listing?.sourceReference,
      loadReference: booking?.loadReference,
      rateCents: booking?.agreedRateCents ?? negotiation?.agreedRateCents ?? listing?.offeredRateCents,
      truckUnits: [loop.truckUnit],
      deadheadMilesByUnit: undefined,
      driverName: loop.driverName,
    },
    extras,
  };
}

/* -------------------------------------------------------------------------- */
/* Threads                                                                     */
/* -------------------------------------------------------------------------- */

function findOrCreateThread(
  ctx: MtLoopContext,
  input: {
    dispatchCycleId: string;
    carrier: CarrierView;
    brokerName: string;
    brokerEmail?: string;
    lane: string;
    listingId?: string;
  },
): CommunicationThread {
  const rows = bucket(ctx.organizationId);
  const existing = rows.find(
    (t) => t.dispatchCycleId === input.dispatchCycleId
      && t.carrierOrganizationId === input.carrier.organizationId
      && normalize(t.brokerName) === normalize(input.brokerName),
  );
  if (existing) {
    // A thread that started before the booking picks the load up when there is
    // one, rather than a second thread appearing beside it.
    const booking = bookingForCycle(input.dispatchCycleId, ctx);
    if (booking && !existing.loadId) {
      existing.loadId = booking.loadId;
      existing.loadReference = booking.loadReference;
    }
    return existing;
  }

  const booking = bookingForCycle(input.dispatchCycleId, ctx);
  const thread: CommunicationThread = {
    threadId: rowId("th"),
    organizationId: ctx.organizationId,
    carrierOrganizationId: input.carrier.organizationId,
    carrierName: input.carrier.displayName,
    dispatchCycleId: input.dispatchCycleId,
    loadId: booking?.loadId,
    loadReference: booking?.loadReference,
    listingId: input.listingId,
    brokerName: input.brokerName,
    brokerEmail: input.brokerEmail,
    lane: input.lane,
    createdAt: nowIso(),
    messages: [],
  };
  rows.push(thread);
  return thread;
}

const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/* -------------------------------------------------------------------------- */
/* Writing a message                                                           */
/* -------------------------------------------------------------------------- */

export type MessageOutcome =
  | { status: "ok"; message: OutreachMessage; thread: CommunicationThread }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "incomplete"; missing: string[] }
  | { status: "blocked"; reason: string };

/**
 * Prepare one message on one cycle, from one template.
 *
 * Always lands as a DRAFT. Nothing in this module produces something already
 * approved: approval means a person read it, and no code path may claim that
 * on their behalf.
 */
export interface PrepareOptions {
  extras?: MessageExtras;
  preparedBecause?: string;
  attachments?: MessageAttachment[];
  /** Write about one listing, even before a conversation is open on it. */
  aboutListingId?: string;
}

export async function prepareMessage(
  dispatchCycleId: string,
  templateKey: MessageTemplateKey,
  ctx: MtLoopContext,
  options: PrepareOptions = {},
): Promise<MessageOutcome> {
  await sleep(LATENCY_MS);
  return prepareMessageSync(dispatchCycleId, templateKey, ctx, options);
}

export function prepareMessageSync(
  dispatchCycleId: string,
  templateKey: MessageTemplateKey,
  ctx: MtLoopContext,
  options: PrepareOptions = {},
): MessageOutcome {
  if (!mayRead(ctx)) return { status: "not_permitted" };
  const loop = mtLoopById(dispatchCycleId, ctx);
  if (!loop) return { status: "not_found" };
  if (!loop.carrierOrganizationId) return { status: "not_found" };
  const carrier = carrierViewSync(loop.carrierOrganizationId, truckContextFrom(ctx));
  if (!carrier) return { status: "not_found" };

  const context = contextForCycle(dispatchCycleId, ctx, options.extras, options.aboutListingId);
  if (!context) return { status: "not_found" };
  if (!context.broker.name) {
    return { status: "incomplete", missing: ["there is no broker on this cycle to write to"] };
  }

  const rendered = renderTemplate(templateKey, context);
  const thread = findOrCreateThread(ctx, {
    dispatchCycleId,
    carrier,
    brokerName: context.broker.name,
    brokerEmail: context.broker.email,
    lane: context.subject.lane,
    listingId: negotiationsForCycle(dispatchCycleId, ctx)[0]?.listingId,
  });

  const message: OutreachMessage = {
    messageId: rowId("msg"),
    threadId: thread.threadId,
    organizationId: ctx.organizationId,
    carrierOrganizationId: carrier.organizationId,
    templateKey,
    fromName: context.writer.displayName,
    fromEmail: context.writer.email,
    toName: context.broker.contactName,
    toEmail: context.broker.email,
    subject: rendered.subject,
    body: rendered.body,
    attachments: options.attachments ?? [],
    status: "draft",
    blockedReason: blockedReason(context, carrier),
    preparedBecause: options.preparedBecause,
    missing: rendered.missing,
    createdAt: nowIso(),
  };
  thread.messages.push(message);
  return { status: "ok", message, thread };
}

/** Why this could not go out even once somebody approves it. */
function blockedReason(context: MessageContext, carrier: CarrierView): string | undefined {
  if (!carrier.canHaul) {
    return `${carrier.displayName} cannot legally haul right now, so nothing should go to a broker under their name.`;
  }
  if (!context.writer.email) {
    return `${carrier.displayName} has no email address recorded, so there is nothing to send this from.`;
  }
  if (!context.broker.email) {
    return "The broker's email address is not recorded. A phone call is the only way in.";
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Review, and the honest kind of sending                                      */
/* -------------------------------------------------------------------------- */

export async function approveMessage(messageId: string, ctx: MtLoopContext): Promise<MessageOutcome> {
  await sleep(LATENCY_MS);
  const found = messageById(messageId, ctx);
  if (!found) return mayRead(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  const { message, thread } = found;
  if (message.status !== "draft") return { status: "not_found" };
  if (message.blockedReason) return { status: "blocked", reason: message.blockedReason };
  if (message.missing.length > 0) return { status: "incomplete", missing: message.missing };

  message.status = "approved";
  message.reviewedAt = nowIso();
  message.reviewedByName = ctx.actor.displayNameSnapshot;
  return { status: "ok", message, thread };
}

/**
 * Record that a message actually went.
 *
 * Antcolos did not send it. A person copied it out and sent it from their own
 * mail, and this is them saying so — which is why it takes a real person's name
 * and why the label everywhere reads "marked as sent" rather than "sent".
 */
export async function markMessageSent(
  messageId: string,
  ctx: MtLoopContext,
): Promise<MessageOutcome> {
  await sleep(LATENCY_MS);
  const found = messageById(messageId, ctx);
  if (!found) return mayRead(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  const { message, thread } = found;
  if (message.status !== "approved") {
    return { status: "blocked", reason: "Read it first. Nothing is marked as sent before somebody has approved it." };
  }
  recordSent(message, ctx.actor.displayNameSnapshot, "recorded_by_hand");
  return { status: "ok", message, thread };
}

/**
 * The one automatic case: a signed rate confirmation going back.
 *
 * Called by the rate confirmation workflow, and only after a person has given
 * the final confirmation that applies the carrier's signature — so the review
 * that every other message waits for has already happened, on the document
 * itself. It still sends nothing; it records that this is the moment it would
 * have gone.
 */
export function recordAutoSend(
  message: OutreachMessage,
  actorName: string,
): OutreachMessage {
  message.status = "approved";
  message.reviewedAt = nowIso();
  message.reviewedByName = actorName;
  recordSent(message, actorName, "auto_on_confirmation");
  return message;
}

function recordSent(message: OutreachMessage, actorName: string, method: SendMethod) {
  message.status = "sent";
  message.sentAt = nowIso();
  message.sentByName = actorName;
  message.sendMethod = method;
}

export async function cancelMessage(messageId: string, ctx: MtLoopContext): Promise<MessageOutcome> {
  await sleep(LATENCY_MS);
  const found = messageById(messageId, ctx);
  if (!found) return mayRead(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  const { message, thread } = found;
  if (message.status === "sent") {
    return { status: "blocked", reason: "That one has already gone out." };
  }
  message.status = "cancelled";
  message.reviewedAt = nowIso();
  message.reviewedByName = ctx.actor.displayNameSnapshot;
  return { status: "ok", message, thread };
}

export async function editMessage(
  messageId: string,
  changes: { subject?: string; body?: string },
  ctx: MtLoopContext,
): Promise<MessageOutcome> {
  await sleep(LATENCY_MS);
  const found = messageById(messageId, ctx);
  if (!found) return mayRead(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  const { message, thread } = found;
  if (message.status !== "draft") {
    return { status: "blocked", reason: "Only a draft nobody has approved can be edited." };
  }
  if (changes.subject !== undefined) message.subject = changes.subject;
  if (changes.body !== undefined) message.body = changes.body;
  return { status: "ok", message, thread };
}

/**
 * An approved outreach draft, landed in the conversation it starts.
 *
 * The opening inquiry is grouped by the outreach drafts service — ONE message
 * per listing per carrier, covering every one of that carrier's trucks that
 * suits the load — and that grouping is the whole reason a carrier does not
 * email a broker three times about one load. So the message lands in ONE
 * thread: the first truck's, which is the closest one and the one the draft
 * leads with. The body already names the others.
 *
 * Duplicating it into a thread per truck would recreate exactly the problem the
 * grouping exists to prevent, one screen further down.
 */
export function recordInquiryFromDraft(
  draft: {
    draftId: string;
    dispatchCycleIds: string[];
    carrierOrganizationId: string;
    carrierName: string;
    listingId: string;
    fromName: string;
    fromEmail?: string;
    toName?: string;
    toEmail?: string;
    subject: string;
    body: string;
    reviewedByName?: string;
    blockedReason?: string;
  },
  ctx: MtLoopContext,
): OutreachMessage | undefined {
  if (!mayRead(ctx)) return undefined;
  const dispatchCycleId = draft.dispatchCycleIds[0];
  if (!dispatchCycleId) return undefined;
  const loop = mtLoopById(dispatchCycleId, ctx);
  if (!loop) return undefined;
  const carrier = carrierViewSync(draft.carrierOrganizationId, truckContextFrom(ctx));
  if (!carrier) return undefined;
  const listing = listingById(ctx.organizationId, draft.listingId);

  const thread = findOrCreateThread(ctx, {
    dispatchCycleId,
    carrier,
    brokerName: listing?.broker.name ?? draft.toName ?? "The broker",
    brokerEmail: draft.toEmail,
    lane: listing
      ? `${listing.origin.city}, ${listing.origin.state} → ${listing.destination.city}, ${listing.destination.state}`
      : "",
    listingId: draft.listingId,
  });

  const already = thread.messages.find(
    (m) => m.templateKey === "load_inquiry" && m.subject === draft.subject,
  );
  if (already) return already;

  // Approved means a person read it, which is exactly what this records — the
  // text is the one they read, not a re-render that might differ from it.
  const message: OutreachMessage = {
    messageId: rowId("msg"),
    threadId: thread.threadId,
    organizationId: ctx.organizationId,
    carrierOrganizationId: carrier.organizationId,
    templateKey: "load_inquiry",
    fromName: draft.fromName,
    fromEmail: draft.fromEmail,
    toName: draft.toName,
    toEmail: draft.toEmail,
    subject: draft.subject,
    body: draft.body,
    attachments: [],
    status: "approved",
    blockedReason: draft.blockedReason,
    missing: [],
    createdAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedByName: draft.reviewedByName ?? ctx.actor.displayNameSnapshot,
  };
  thread.messages.push(message);
  return message;
}

/* -------------------------------------------------------------------------- */
/* Auto-drafting                                                               */
/* -------------------------------------------------------------------------- */

/** How long a broker may sit on a conversation before we chase it. */
const FOLLOW_UP_AFTER_HOURS = 4;

/**
 * Prepare the messages that have a real reason to exist, and retire the ones
 * whose reason has gone.
 *
 * Run on every read of the communications picture, like every other
 * reconciliation in this app. Three triggers, and each of them is a fact that
 * can be checked rather than a guess:
 *
 *   follow_up       a conversation has been waiting on the broker too long
 *   truck_covered   the cycle booked something else, and this broker was
 *                   offered that truck
 *   (the opening inquiry stays where it is — the outreach drafts service owns
 *   the grouping rule that stops two trucks of one carrier writing twice.)
 */
export function reconcileMessages(ctx: MtLoopContext): number {
  if (!mayRead(ctx)) return 0;
  let created = 0;

  for (const thread of bucket(ctx.organizationId)) {
    const booking = bookingForCycle(thread.dispatchCycleId, ctx);
    if (booking && !thread.loadId) {
      thread.loadId = booking.loadId;
      thread.loadReference = booking.loadReference;
    }

    const negotiations = negotiationsForCycle(thread.dispatchCycleId, ctx)
      .filter((n) => normalize(n.brokerName) === normalize(thread.brokerName));
    const live = negotiations.find(
      (n) => n.status === "waiting_on_broker" || n.status === "waiting_on_you" || n.status === "agreed",
    );

    /* ---- They have not answered ---- */
    if (live?.status === "waiting_on_broker" && !hasOpen(thread, "follow_up")) {
      const waitingSince = live.rounds[live.rounds.length - 1]?.at ?? live.openedAt;
      const hours = (Date.now() - Date.parse(waitingSince)) / 3_600_000;
      if (hours >= FOLLOW_UP_AFTER_HOURS) {
        const outcome = prepareMessageSync(thread.dispatchCycleId, "follow_up", ctx, {
          preparedBecause: `${Math.floor(hours)} hours with no answer, and the load is still open.`,
        });
        if (outcome.status === "ok") created += 1;
      }
    }

    /* ---- We went elsewhere ---- */
    const lostToUs = negotiations.some((n) => n.status === "lost" || n.status === "withdrawn");
    if (booking && lostToUs && !negotiations.some((n) => n.status === "booked")
      && !hasAny(thread, "truck_covered")) {
      const outcome = prepareMessageSync(thread.dispatchCycleId, "truck_covered", ctx, {
        preparedBecause: `${booking.loadReference} was booked on unit ${booking.truckUnit}, so this broker is waiting on a truck that is gone.`,
        extras: { whatHappened: `we booked ${booking.truckUnit ? `unit ${booking.truckUnit}` : "that truck"} on another load` },
      });
      if (outcome.status === "ok") created += 1;
    }

    /* ---- Retire what there is no longer any point saying ---- */
    for (const message of thread.messages) {
      if (message.status !== "draft") continue;
      if (message.templateKey === "follow_up" && live?.status !== "waiting_on_broker") {
        message.status = "superseded";
        message.supersededReason = "They answered, or the conversation ended.";
      }
    }
  }
  return created;
}

function hasOpen(thread: CommunicationThread, key: MessageTemplateKey): boolean {
  return thread.messages.some(
    (m) => m.templateKey === key && (m.status === "draft" || m.status === "approved"),
  );
}
function hasAny(thread: CommunicationThread, key: MessageTemplateKey): boolean {
  return thread.messages.some((m) => m.templateKey === key && m.status !== "cancelled");
}

/* -------------------------------------------------------------------------- */
/* What a screen asks for                                                      */
/* -------------------------------------------------------------------------- */

export interface CycleCommunications {
  threads: ThreadSummary[];
  /** Templates that can be picked right now, with what each would be missing. */
  available: {
    key: MessageTemplateKey;
    label: string;
    purpose: string;
    autoDraftsWhen?: string;
    missing: string[];
  }[];
  counts: { waitingForYou: number; sent: number };
}

export function cycleCommunicationsSync(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): CycleCommunications {
  reconcileMessages(ctx);
  const threads = summarizeThreads(threadsForCycle(dispatchCycleId, ctx));
  const context = contextForCycle(dispatchCycleId, ctx);

  const available = Object.values(TEMPLATES).map((t) => ({
    key: t.key,
    label: t.label,
    purpose: t.purpose,
    autoDraftsWhen: t.autoDraftsWhen,
    missing: context
      ? renderTemplate(t.key, context).missing.map(describeMissing)
      : ["there is nothing on this cycle to write about yet"],
  }));

  return {
    threads,
    available,
    counts: {
      waitingForYou: threads.reduce((n, t) => n + t.waitingForYou, 0),
      sent: threads.reduce((n, t) => n + t.sent, 0),
    },
  };
}

/** The gap, in the operator's words rather than the type's. */
function describeMissing(requirement: string): string {
  switch (requirement) {
    case "listing": return "no load has been found for this truck yet";
    case "load": return "nothing is booked on this truck yet";
    case "truck": return "no truck is on this cycle";
    case "driver": return "no driver is on the truck";
    case "rate": return "no rate has been agreed";
    case "signed_document": return "there is no signed rate confirmation yet";
    case "discrepancies": return "nothing on the rate confirmation disagrees with the booking";
    case "delay_reason": return "say what the delay or detention is first";
    case "eta": return "there is no ETA recorded";
    default: return requirement;
  }
}

/** Every message across the workspace, for the inbox. */
export function allMessages(ctx: MtLoopContext): OutreachMessage[] {
  if (!mayRead(ctx)) return [];
  return bucket(ctx.organizationId).flatMap((t) => t.messages);
}

export function messagesWaiting(ctx: MtLoopContext, status: MessageStatus = "draft"): OutreachMessage[] {
  return allMessages(ctx).filter((m) => m.status === status);
}

/** Test seam only. */
export function threadsForTests(organizationId: string): CommunicationThread[] {
  return bucket(organizationId);
}

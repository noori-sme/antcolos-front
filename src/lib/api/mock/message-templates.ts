import type {
  MessageContext, MessageTemplate, MessageTemplateKey, RenderedMessage,
  TemplateRequirement, WriterIdentity,
} from "@/types";
import { TEMPLATE_LABEL } from "@/types";
import type { CarrierView } from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * What Antcolos says to a broker, and who it says it as.
 *
 * Every template writes in the CARRIER's name. A dispatch agency working six
 * carriers writes six different signatures, under six MC numbers, from six
 * addresses — because that is what is true, and because a broker who receives
 * "Meridian Dispatch" about Cascade Haul's truck has no idea who is insured to
 * move their freight.
 *
 * Templates are pure: context in, subject and body out, no reading of state and
 * no writing of any. That is what makes a draft reviewable — the same facts
 * produce the same message every time, so a dispatcher reading one is checking
 * the facts rather than the wording.
 *
 * A template that cannot be filled says so instead of guessing. `missing` comes
 * back with the requirements the context could not meet, and a message with
 * anything in `missing` is never treated as ready.
 */

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

export const TEMPLATES: Record<MessageTemplateKey, MessageTemplate> = {
  load_inquiry: {
    key: "load_inquiry",
    label: TEMPLATE_LABEL.load_inquiry,
    purpose: "Offer a truck for a load the broker has posted, and ask what they are paying.",
    requires: ["listing", "truck"],
    autoDraftsWhen: "A load reaches the best few for a truck you are responsible for.",
  },
  follow_up: {
    key: "follow_up",
    label: TEMPLATE_LABEL.follow_up,
    purpose: "Ask again about a load nobody has answered on, while it is still open.",
    requires: ["listing", "truck"],
    autoDraftsWhen: "A conversation has been waiting on the broker for more than four hours.",
  },
  truck_covered: {
    key: "truck_covered",
    label: TEMPLATE_LABEL.truck_covered,
    purpose: "Tell a broker the truck is gone, or that you did not get their load, before they chase you.",
    requires: ["listing"],
    autoDraftsWhen: "Another load is booked on the truck you had offered them.",
  },
  in_transit_update: {
    key: "in_transit_update",
    label: TEMPLATE_LABEL.in_transit_update,
    purpose: "Where the truck is and when it will be there.",
    requires: ["load", "truck"],
  },
  delay_or_detention: {
    key: "delay_or_detention",
    label: TEMPLATE_LABEL.delay_or_detention,
    purpose: "Put a delay, or time the truck has been sitting, in writing while it is happening.",
    requires: ["load", "delay_reason"],
  },
  delivery_update: {
    key: "delivery_update",
    label: TEMPLATE_LABEL.delivery_update,
    purpose: "Confirm the load is off, and flag anything short or damaged.",
    requires: ["load"],
  },
  thank_you: {
    key: "thank_you",
    label: TEMPLATE_LABEL.thank_you,
    purpose: "Close the load out, and ask to be kept in mind for the lane.",
    requires: ["load"],
  },
  signed_rate_confirmation: {
    key: "signed_rate_confirmation",
    label: TEMPLATE_LABEL.signed_rate_confirmation,
    purpose: "Return the rate confirmation, checked and signed, with any corrections named.",
    requires: ["load", "signed_document"],
    autoDraftsWhen: "A rate confirmation is confirmed and signed. This one is recorded as sent at that moment.",
  },
  ratecon_discrepancy: {
    key: "ratecon_discrepancy",
    label: TEMPLATE_LABEL.ratecon_discrepancy,
    purpose: "Send the rate confirmation back unsigned, quoting each line that disagrees with what was booked.",
    requires: ["load", "discrepancies"],
    autoDraftsWhen: "A dispatcher chooses to return a rate confirmation whose fields disagree with the booking.",
  },
};

export function templateList(): MessageTemplate[] {
  return Object.values(TEMPLATES);
}

/* -------------------------------------------------------------------------- */
/* The writer                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The carrier, as a writer of messages.
 *
 * The signature block is built here rather than typed anywhere, so every
 * message from one carrier closes identically and a change to their record
 * changes every future message at once.
 */
export function writerFor(carrier: CarrierView): WriterIdentity {
  const primary = carrier.contacts.find((c) => c.isPrimary && c.email)
    ?? carrier.contacts.find((c) => c.email)
    ?? carrier.contacts.find((c) => c.isPrimary)
    ?? carrier.contacts[0];

  const signatureBlock = [
    primary?.name ?? carrier.displayName,
    carrier.displayName,
    [
      carrier.mcNumber ? `MC ${carrier.mcNumber.replace(/^MC-?/i, "")}` : undefined,
      carrier.dotNumber ? `DOT ${carrier.dotNumber}` : undefined,
    ].filter(Boolean).join(" · "),
    [primary?.phone, primary?.email].filter(Boolean).join(" · "),
  ].filter((line) => line && line.length > 0) as string[];

  return {
    carrierOrganizationId: carrier.organizationId,
    legalName: carrier.legalName,
    displayName: carrier.displayName,
    mcNumber: carrier.mcNumber,
    dotNumber: carrier.dotNumber,
    contactName: primary?.name,
    email: primary?.email,
    phone: primary?.phone,
    signatureBlock,
    canHaul: carrier.canHaul,
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

export function renderTemplate(
  key: MessageTemplateKey,
  ctx: MessageContext,
): RenderedMessage {
  const missing = missingFor(key, ctx);
  const body = bodyFor(key, ctx);
  return {
    subject: subjectFor(key, ctx),
    body: join([...body, "", ...ctx.writer.signatureBlock]),
    missing,
  };
}

/** What the context could not supply for this template. */
export function missingFor(key: MessageTemplateKey, ctx: MessageContext): TemplateRequirement[] {
  const s = ctx.subject;
  const e = ctx.extras ?? {};
  const out: TemplateRequirement[] = [];
  for (const need of TEMPLATES[key].requires) {
    switch (need) {
      case "listing":
        if (!s.lane) out.push(need);
        break;
      case "load":
        if (!s.loadReference) out.push(need);
        break;
      case "truck":
        if (s.truckUnits.length === 0) out.push(need);
        break;
      case "driver":
        if (!s.driverName) out.push(need);
        break;
      case "rate":
        if (s.rateCents === undefined) out.push(need);
        break;
      case "signed_document":
        if (!e.signedDocumentName) out.push(need);
        break;
      case "discrepancies":
        if (!e.discrepancies || e.discrepancies.length === 0) out.push(need);
        break;
      case "delay_reason":
        if (!e.delayReason && e.detentionHours === undefined) out.push(need);
        break;
      case "eta":
        if (!e.etaAt) out.push(need);
        break;
    }
  }
  return out;
}

function subjectFor(key: MessageTemplateKey, ctx: MessageContext): string {
  const { writer, subject: s } = ctx;
  const ref = s.loadReference ?? s.sourceReference;
  const tail = ref ? ` — ${ref}` : "";
  switch (key) {
    case "load_inquiry":
      return s.truckUnits.length > 1
        ? `${writer.displayName} — ${s.truckUnits.length} trucks available for ${s.lane}`
        : `${writer.displayName} — truck available for ${s.lane}`;
    case "follow_up":
      return `Following up — ${s.lane}${tail}`;
    case "truck_covered":
      return `${s.lane}${tail} — we are covered`;
    case "in_transit_update":
      return `In transit — ${s.lane}${tail}`;
    case "delay_or_detention":
      return ctx.extras?.detentionHours !== undefined
        ? `Detention — ${s.lane}${tail}`
        : `Delay — ${s.lane}${tail}`;
    case "delivery_update":
      return `Delivered — ${s.lane}${tail}`;
    case "thank_you":
      return `Thank you — ${s.lane}${tail}`;
    case "signed_rate_confirmation":
      return `Signed rate confirmation${tail ? ` —${tail.slice(2)}` : ""} — ${writer.displayName}`;
    case "ratecon_discrepancy":
      return `Rate confirmation does not match${tail} — ${writer.displayName}`;
  }
}

function bodyFor(key: MessageTemplateKey, ctx: MessageContext): string[] {
  const { writer, broker, subject: s } = ctx;
  const e = ctx.extras ?? {};
  const hello = broker.contactName ? `Hi ${broker.contactName},` : "Hello,";
  const us = `${writer.displayName}${writer.mcNumber ? ` (${writer.mcNumber})` : ""}`;
  const ref = s.sourceReference ? ` (ref ${s.sourceReference})` : "";
  const load = s.loadReference ? ` on ${s.loadReference}` : "";

  switch (key) {
    case "load_inquiry": {
      const only = s.truckUnits.length === 1;
      const trucks = s.truckUnits.map((unit) => {
        const dh = s.deadheadMilesByUnit?.[unit];
        const where = dh === undefined ? "" : dh > 0 ? ` — ${dh} miles out` : " — right there";
        return `  • Unit ${unit}${where}`;
      });
      return [
        hello,
        "",
        `This is ${us} — we have ${only ? "a truck" : `${s.truckUnits.length} trucks`} empty near ${s.originCity} and I would like to cover your ${s.lane} load${ref}.`,
        "",
        timing(s),
        "",
        only ? "The truck:" : "The trucks:",
        ...trucks,
        "",
        s.rateCents !== undefined
          ? `You have it posted at ${money(s.rateCents)}. Is that still where it is, and is the load still available?`
          : "Is the load still available, and what are you paying on it?",
        "",
        "Happy to send over our packet and insurance whenever you need it.",
        "",
        "Thanks,",
      ];
    }

    case "follow_up":
      return [
        hello,
        "",
        `Following up on your ${s.lane} load${ref} — I wrote earlier about ${s.truckUnits.length === 1 ? `unit ${s.truckUnits[0]}` : `${s.truckUnits.length} of our trucks`} and have not heard back.`,
        "",
        `${s.truckUnits.length === 1 ? "The truck is" : "They are"} still empty and still close${s.pickupAt ? `, and your pickup is ${when(s.pickupAt)}` : ""}.`,
        "",
        s.rateCents !== undefined
          ? `Is it still open at ${money(s.rateCents)}, or has it moved?`
          : "Is it still open, and what are you paying?",
        "",
        "If it is gone, no problem at all — just let me know and I will stop chasing it.",
        "",
        "Thanks,",
      ];

    case "truck_covered":
      return [
        hello,
        "",
        `About your ${s.lane} load${ref} — ${e.whatHappened ?? `we have covered ${s.truckUnits.length === 1 ? "that truck" : "those trucks"} elsewhere`}, so please take us off it.`,
        "",
        "Telling you now rather than leaving you waiting on us.",
        "",
        `We run this lane regularly${s.equipmentLabel ? ` with ${s.equipmentLabel}s` : ""} — please keep us in mind for the next one.`,
        "",
        "Thanks,",
      ];

    case "in_transit_update":
      return [
        hello,
        "",
        `Update${load} — ${s.lane}.`,
        "",
        ...[
          e.currentLocation ? `Currently: ${e.currentLocation}.` : undefined,
          s.driverName ? `Driver: ${s.driverName}${s.truckUnits[0] ? `, unit ${s.truckUnits[0]}` : ""}.` : undefined,
          e.etaAt ? `ETA to the receiver: ${when(e.etaAt)}.` : undefined,
          s.deliverBy ? `Your appointment is ${when(s.deliverBy)}.` : undefined,
        ].filter(Boolean) as string[],
        "",
        "I will let you know if anything changes.",
        "",
        "Thanks,",
      ];

    case "delay_or_detention": {
      const detention = e.detentionHours !== undefined;
      return [
        hello,
        "",
        detention
          ? `We are sitting${load} at ${e.currentLocation ?? "the facility"} — ${e.detentionHours} hour${e.detentionHours === 1 ? "" : "s"} so far${e.detentionStartedAt ? `, since ${when(e.detentionStartedAt)}` : ""}.`
          : `There is a delay${load} on ${s.lane}.`,
        "",
        ...[
          e.delayReason ? `What happened: ${e.delayReason}` : undefined,
          e.etaAt ? `Revised ETA: ${when(e.etaAt)}.` : undefined,
        ].filter(Boolean) as string[],
        "",
        detention
          ? "Flagging it now so it is on the record before it becomes a conversation about the invoice. Let me know how you would like to handle it."
          : "Putting it in writing straight away rather than after the fact. Let me know if you need anything from our side.",
        "",
        "Thanks,",
      ];
    }

    case "delivery_update":
      return [
        hello,
        "",
        e.deliveredAt
          ? `Delivered${load} — ${s.lane}, unloaded ${when(e.deliveredAt)}${e.receiverName ? ` at ${e.receiverName}` : ""}.`
          : `Update${load} — ${s.lane}, at the receiver now.`,
        "",
        ...(e.shortOrDamaged
          ? ["Worth flagging:", `  • ${e.shortOrDamaged}`, ""]
          : []),
        "Paperwork will follow as soon as the driver sends it through.",
        "",
        "Thanks,",
      ];

    case "thank_you":
      return [
        hello,
        "",
        `Thank you for the ${s.lane} load${load ? ` (${s.loadReference})` : ""} — it went off cleanly.`,
        "",
        `We run this lane regularly${s.equipmentLabel ? ` with ${s.equipmentLabel}s` : ""}. If you have anything coming up, we would be glad to take a look.`,
        "",
        "Thanks again,",
      ];

    case "ratecon_discrepancy": {
      const rows = e.discrepancies ?? [];
      return [
        hello,
        "",
        `We have your rate confirmation${load} and cannot sign it as written — ${rows.length === 1 ? "one line does" : `${rows.length} lines do`} not match what we booked.`,
        "",
        // Quoted, not described: the broker has to be able to see the two
        // numbers side by side without going back to their own system.
        ...rows.map((r) => `  • ${r.label} — agreed ${r.agreed}, the confirmation says ${r.onDocument}`),
        "",
        "The original is attached with those lines marked. Send a corrected copy and we will sign it straight back; the truck is holding for it.",
        "",
      ];
    }

    case "signed_rate_confirmation":
      return [
        hello,
        "",
        `Attached is your rate confirmation${load}, signed by ${writer.displayName}.`,
        "",
        ...(e.correctionsMade && e.correctionsMade.length > 0
          ? [
            "We read it against our booking and corrected the following before signing:",
            ...e.correctionsMade.map((c) => `  • ${c}`),
            "",
            "If any of those are wrong, tell me and we will sort it before the truck loads.",
            "",
          ]
          : [
            "We read it against our booking and everything matches.",
            "",
          ]),
        ...[
          s.rateCents !== undefined ? `Agreed rate: ${money(s.rateCents)}.` : undefined,
          s.truckUnits[0] ? `Unit ${s.truckUnits[0]}${s.driverName ? `, ${s.driverName}` : ""}.` : undefined,
          s.pickupAt ? `Picking up ${when(s.pickupAt)}.` : undefined,
        ].filter(Boolean) as string[],
        "",
        "Thanks,",
      ];
  }
}

/* -------------------------------------------------------------------------- */
/* Small shared pieces                                                         */
/* -------------------------------------------------------------------------- */

function timing(s: MessageContext["subject"]): string {
  if (!s.pickupAt) return "Let me know your pickup and delivery times.";
  return `Picking up ${when(s.pickupAt)}${s.deliverBy ? `, delivering by ${when(s.deliverBy)}` : ""}.`;
}

/** Collapses the blank lines a conditional block leaves behind. */
function join(lines: string[]): string {
  return lines
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();
}

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })}`;
}

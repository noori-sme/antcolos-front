import type {
  IsoDateTime, LoadStatus, PublicTrackingRefusal, TrackingLink, TrackingLinkState,
} from "@/types";

/**
 * Minting, expiring and revoking tracking links.
 *
 * A tracking link is the only thing in Antcolos that grants access to somebody
 * who has not signed in, so every property of it is deliberate:
 *
 *  - It ALWAYS expires. `expiresAt` is required by the type; there is no way to
 *    construct an open-ended one.
 *  - It is revocable, and revocation is immediate and permanent. A revoked
 *    link is never un-revoked — a new one is minted, which is a different
 *    token with its own audit line.
 *  - It names ONE recipient on ONE load. It is not a session and confers
 *    nothing beyond that single view.
 *  - It closes by itself on delivery, on cancellation, and when the carrier
 *    relationship behind it ends. None of those needs anybody to remember.
 */

/** Default life of a newly minted link. A working week, and not more. */
export const DEFAULT_LINK_TIMEOUT_HOURS = 120;
/** How long a link keeps working after the load delivers. */
export const DEFAULT_POST_DELIVERY_GRACE_HOURS = 24;
/** Nothing may be minted for longer than this, whatever is asked for. */
export const MAX_LINK_TIMEOUT_HOURS = 720;

const HOUR_MS = 3_600_000;

/**
 * Generate an opaque token.
 *
 * Opaque means opaque: nothing about the load, the recipient or the
 * organization is recoverable from it, so a token that leaks tells the finder
 * nothing until it is resolved — and resolving it is where every rule is
 * applied. `crypto.randomUUID` where the runtime has it, and a clearly-labelled
 * fallback where it does not, because a mock that quietly used `Math.random`
 * for something access-bearing would be the wrong kind of shortcut.
 */
export function mintToken(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID().replace(/-/g, "");
  if (cryptoRef?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Development fallback only. Never reached in a browser or in modern Node.
  return `devtoken${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function issueLink(opts: {
  timeoutHours?: number;
  now?: Date;
}): TrackingLink {
  const now = opts.now ?? new Date();
  const hours = Math.min(
    MAX_LINK_TIMEOUT_HOURS,
    Math.max(1, opts.timeoutHours ?? DEFAULT_LINK_TIMEOUT_HOURS),
  );
  return {
    token: mintToken(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + hours * HOUR_MS).toISOString(),
    accessCount: 0,
  };
}

/**
 * Everything that can close a link, evaluated together.
 *
 * One function, because the four reasons are checked in every place a link is
 * read and a service that checked three of them somewhere would be a service
 * that leaked a cancelled load for a week.
 */
export interface LinkContext {
  /** The load's current status. */
  loadStatus: LoadStatus;
  /** When the load delivered, when it has. */
  deliveredAt?: IsoDateTime;
  /** Hours after delivery before the link closes. */
  postDeliveryGraceHours: number;
  /** False once the carrier relationship behind this session has ended. */
  relationshipActive: boolean;
  /** False once the dispatcher closed the session outright. */
  sessionActive: boolean;
  now?: Date;
}

export function linkStateOf(link: TrackingLink, ctx: LinkContext): TrackingLinkState {
  const now = ctx.now ?? new Date();

  // Revocation is the strongest word available and is checked first: a link
  // somebody deliberately withdrew never reads as merely expired.
  if (link.revokedAt) return "revoked";
  if (!ctx.relationshipActive) return "relationship_ended";
  if (ctx.loadStatus === "cancelled") return "cancelled";

  if (ctx.deliveredAt) {
    const closesAt = Date.parse(ctx.deliveredAt) + ctx.postDeliveryGraceHours * HOUR_MS;
    if (now.getTime() >= closesAt) return "completed";
  }
  if (!ctx.sessionActive) return "completed";

  if (now.getTime() >= Date.parse(link.expiresAt)) return "expired";
  return "active";
}

/** The refusal a closed link produces for the public screen. */
export function refusalFor(state: TrackingLinkState): PublicTrackingRefusal | undefined {
  switch (state) {
    case "active": return undefined;
    case "revoked": return "revoked";
    case "expired": return "expired";
    case "completed": return "completed";
    case "cancelled": return "cancelled";
    case "relationship_ended": return "relationship_ended";
    default: return "expired";
  }
}

/** When a link will close, accounting for delivery as well as its own timeout. */
export function effectiveExpiry(link: TrackingLink, ctx: LinkContext): IsoDateTime {
  const byTimeout = Date.parse(link.expiresAt);
  if (!ctx.deliveredAt) return new Date(byTimeout).toISOString();
  const byDelivery = Date.parse(ctx.deliveredAt) + ctx.postDeliveryGraceHours * HOUR_MS;
  return new Date(Math.min(byTimeout, byDelivery)).toISOString();
}

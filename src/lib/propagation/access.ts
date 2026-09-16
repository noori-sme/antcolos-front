import type {
  DomainEvent, DomainEventKind, PermissionKey, ProjectionRecord, ProjectionState,
} from "@/types";
import type { ServiceContext } from "@/lib/api/contracts/context";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import { propagationBus } from "./bus";

/**
 * ★ THE AUTHORIZED WAY INTO THE EVENT LOG ★
 *
 * The bus itself takes an organization id as a string, because internally that
 * is all it is: a field on a stored event to compare against. Every method on
 * it is reachable by anybody who can type an id, and two of them — reading one
 * event's projections, and RE-RUNNING one — used to be reachable by anybody who
 * had seen an event id in a URL, an audit line or a screenshot.
 *
 * An id is not a capability, and a string is not an authentication. This module
 * is the only door application code uses: it takes the authenticated
 * `ServiceContext`, reads the organization off it, and never lets a caller name
 * one. A caller that wants somebody else's events has nowhere to put the
 * request.
 *
 * ── WHAT IT DELIBERATELY DOES NOT ADD ─────────────────────────────────────
 * No blanket permission on READING. The propagation queue surfaces through
 * Needs You, and each item there already carries the permission that item
 * needs — `maintenance:view` for a meter projection, `customers:resolve` for a
 * duplicate party, and `audit:view` when nothing more specific applies.
 * Requiring `audit:view` to see any of them would take the maintenance
 * template's own item away from it, which is a real regression dressed as
 * tightening. Authentication and organization scope here; per-item permission
 * where the item is built.
 *
 * RE-RUNNING one is different, and is gated below: it writes.
 *
 * ███ FRONTEND ONLY ███
 * `ServiceContext` is assembled in the browser from fixtures. This is the shape
 * of the boundary, not the enforcement of it — a backend has to run the same
 * check against a session it issued.
 */

/** Every event this context's organization may see, newest first. */
export function readableEvents(ctx: ServiceContext): DomainEvent[] {
  return propagationBus.events(ctx.organizationId);
}

/** One event, or nothing. An id from another organization reads as unknown. */
export function readableEvent(
  ctx: ServiceContext,
  eventId: string,
): DomainEvent | undefined {
  return propagationBus.event(ctx.organizationId, eventId);
}

/** Every projection record for this context's organization, newest event first. */
export function readableProjections(
  ctx: ServiceContext,
  filter: { state?: ProjectionState[]; eventKind?: DomainEventKind[] } = {},
): ProjectionRecord[] {
  return propagationBus.projections(ctx.organizationId, filter);
}

/** What every subscriber did with one event, for a screen that may see it. */
export function readableProjectionsFor(
  ctx: ServiceContext,
  eventId: string,
): ProjectionRecord[] {
  return propagationBus.projectionsFor(ctx.organizationId, eventId);
}

/**
 * Run one projection again.
 *
 * A retry is a WRITE: the subscriber does its work over, into whatever module
 * it owns. So it needs the permission that acting on that projection needs, and
 * the caller supplies it — the surface that offers the retry is the surface
 * that knows what the projection touches, and Needs You already carries exactly
 * this list per subscriber.
 *
 * The event must be this organization's. Everything else answers `undefined`,
 * the same as an id that was never published, and nothing is re-run.
 */
export async function retryProjection(
  ctx: ServiceContext,
  eventId: string,
  subscriberId: string,
  requires: PermissionKey[],
): Promise<ProjectionRecord | undefined> {
  const missing = requires.filter((key) => !ctx.permissions.has(key));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
  return propagationBus.retry(ctx.organizationId, eventId, subscriberId);
}

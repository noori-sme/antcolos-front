import type {
  ActorRef, IsoDateTime, Load, PermissionKey, TruckDispatchAccess,
} from "@/types";
import { PermissionDeniedError, NotFoundError, type ServiceContext } from "../contracts/context";
import {
  liveDispatchGrantFor, operatingContextAt, truckContextFrom,
} from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * ★ THE ONE PLACE A DELEGATED READ OR WRITE IS AUTHORIZED ★
 *
 * A carrier may let a dispatch organization work its freight. When it does,
 * FOUR separate questions have to be answered, and answering three of them is
 * how a delegation feature becomes a hole:
 *
 *   1. WHO IS ACTING?          The session's membership. Never an input field.
 *   2. MAY THIS PERSON?        Their own Membership permissions, in their own
 *                              organization. A grant does not grant a
 *                              permission and a permission does not grant reach.
 *   3. MAY THIS ORGANIZATION,  A live `TruckDispatchAccess` for THIS truck,
 *      FOR THIS TRUCK?         re-read at the moment of the call.
 *   4. WHOSE RECORD IS IT?     The operating carrier, proved by A6's
 *                              `operatingContextAt` AT THE RELEVANT INSTANT.
 *
 * ── WHAT IS DELIBERATELY NOT AN INPUT ──────────────────────────────────────
 * No caller-supplied `organizationId` and no field on `ActorRef` takes part in
 * any of the four. `ActorRef.actingOrganizationId` is WRITTEN from what this
 * module proved; forging it changes the label on a refusal and nothing else.
 * Equipment ownership takes part in none of them either: owning a truck is not
 * operating it, and `operatingContextAt` uses ownership only to identify a
 * `carrier_owned` relationship, never as authority on its own.
 *
 * ── WHY THE INSTANT MATTERS ────────────────────────────────────────────────
 * The owning carrier is derived ONCE, at booking, and pinned to the load. A
 * truck that later moves to another carrier does not move, rewrite or
 * re-authorize the loads that ran under the first one. So every later command
 * asks two questions that are never collapsed: the load's PINNED owner (a fact
 * about the past) and the actor's CURRENT authority to perform that action (a
 * fact about now).
 */

/* -------------------------------------------------------------------------- */
/* Failure                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The operating carrier could not be established from the canonical records.
 *
 * Carries A6's own refusal code and reason rather than a sentence of its own,
 * because the records are the thing a person has to go and fix.
 */
export class OperatingCarrierUnresolvedError extends Error {
  constructor(readonly code: string, reason: string, readonly records: readonly string[]) {
    super(reason);
    this.name = "OperatingCarrierUnresolvedError";
  }
}

/* -------------------------------------------------------------------------- */
/* The basis on which somebody is acting                                       */
/* -------------------------------------------------------------------------- */

export type LoadAuthorityBasis =
  /** The carrier is working its own freight. */
  | "own_carrier"
  /** A dispatch organization is acting under a live grant from the carrier. */
  | "dispatch_delegation";

export interface LoadWriteAuthority {
  basis: LoadAuthorityBasis;
  /** The organization the record belongs to. What a command must write to. */
  owningOrganizationId: string;
  /** The carrier proved at the instant. Pinned onto whatever is created. */
  pinnedCarrierOrganizationId: string;
  /** The lease that proved it, when one did. */
  operatingLeaseId?: string;
  /** The organization the person was working in. Attribution only. */
  actingOrganizationId: string;
  /** The grant relied on, when the basis is delegation. */
  grant?: TruckDispatchAccess;
}

/* -------------------------------------------------------------------------- */
/* Deriving the operating carrier                                              */
/* -------------------------------------------------------------------------- */

/**
 * Who was operating this truck at this instant — or a refusal.
 *
 * Fails closed. There is no fallback to the caller's organization, to the
 * grant's carrier, or to whoever owns the equipment: an unresolved answer means
 * the canonical records genuinely do not say, and inventing one would put a
 * load under an authority that never agreed to carry it.
 */
export function pinnedCarrierAt(
  truckId: string,
  instant: IsoDateTime,
): { organizationId: string; leaseId?: string } {
  const context = operatingContextAt(truckId, instant);
  if (!context.resolved) {
    throw new OperatingCarrierUnresolvedError(
      context.code,
      context.reason,
      context.records ?? [],
    );
  }
  return {
    organizationId: context.operatingCarrierOrganizationId,
    leaseId: context.basis === "operating_lease" ? context.lease?.id : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The guard                                                                   */
/* -------------------------------------------------------------------------- */

export interface LoadWriteRequest {
  /** The truck the work is about. Taken from the loop or the load, never input. */
  truckId: string;
  /** When the work happened. Booking uses now; a correction uses the original. */
  instant: IsoDateTime;
  /** What the membership must hold to perform this action. */
  requires: readonly PermissionKey[];
  /**
   * The load's already-pinned owner, for every command after the first.
   *
   * Supplied for a load that exists; absent only at booking, where the owner is
   * being established for the first time. When supplied, the derived carrier is
   * NOT consulted for ownership — the pin is the answer, and re-deriving it is
   * precisely the bug this field exists to prevent.
   */
  pinnedOwnerOrganizationId?: string;
}

/**
 * May this actor perform this action on this carrier's load, right now?
 *
 * Returns what a command needs to write, or throws. Every refusal is
 * `NotFoundError` where a record could be probed, and `PermissionDeniedError`
 * only where the caller's own permissions are the problem — a missing
 * permission is not a secret, but somebody else's load is.
 */
export function requireLoadWriteAuthority(
  ctx: ServiceContext,
  request: LoadWriteRequest,
): LoadWriteAuthority {
  /* 1. Who is acting — from the context alone. */
  if (!ctx.membershipId) throw new NotFoundError("Load");

  /* 2. May this person, in their own organization? */
  const missing = request.requires.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);

  /* 3. May this organization, for this exact truck, right now? */
  const grant = liveDispatchGrantFor(request.truckId, ctx.organizationId);

  /* 4. Whose record is it? */
  const derived = pinnedCarrierAt(request.truckId, request.instant);
  const owner = request.pinnedOwnerOrganizationId ?? derived.organizationId;

  if (owner === ctx.organizationId) {
    // The carrier working its own freight. A grant is neither needed nor read.
    return {
      basis: "own_carrier",
      owningOrganizationId: owner,
      pinnedCarrierOrganizationId: request.pinnedOwnerOrganizationId ?? derived.organizationId,
      operatingLeaseId: derived.leaseId,
      actingOrganizationId: ctx.organizationId,
    };
  }

  // Everything below is somebody acting on another organization's record.
  if (!grant) throw new NotFoundError("Load");

  /*
   * The grant must come from the carrier that owns the record.
   *
   * ★ THIS IS THE LINE THAT STOPS A TRUCK CHANGING HANDS FROM HANDING OVER
   *   THE PREVIOUS CARRIER'S HISTORY ★
   * Carrier B grants its provider access to a truck. The truck used to run for
   * carrier A, and A's loads are still A's. B's grant names B, the load is
   * pinned to A, and the two do not match — so the provider is refused, without
   * anybody having to remember to write that rule per command.
   */
  if (grant.grantedByCarrierOrganizationId !== owner) throw new NotFoundError("Load");

  return {
    basis: "dispatch_delegation",
    owningOrganizationId: owner,
    pinnedCarrierOrganizationId: request.pinnedOwnerOrganizationId ?? derived.organizationId,
    operatingLeaseId: derived.leaseId,
    actingOrganizationId: ctx.organizationId,
    grant,
  };
}

/**
 * The same four questions, for a READ of a load that already exists.
 *
 * Returns null rather than throwing, so callers can turn it into the
 * not-found every other module produces. Uses the load's PINNED owner, never a
 * fresh derivation, for the reason above.
 */
export function loadReachFor(
  ctx: ServiceContext,
  load: Pick<Load, "organizationId" | "pinnedCarrierOrganizationId" | "assignment">,
): LoadAuthorityBasis | null {
  if (load.organizationId === ctx.organizationId) return "own_carrier";

  const truckId = load.assignment?.truckId;
  if (!truckId) return null;

  const grant = liveDispatchGrantFor(truckId, ctx.organizationId);
  if (!grant) return null;
  if (grant.grantedByCarrierOrganizationId !== load.organizationId) return null;
  return "dispatch_delegation";
}

/** Convenience for the many call sites that only need a yes or no. */
export function mayReachLoad(
  ctx: ServiceContext,
  load: Pick<Load, "organizationId" | "pinnedCarrierOrganizationId" | "assignment">,
): boolean {
  return loadReachFor(ctx, load) !== null;
}

/* -------------------------------------------------------------------------- */
/* Attribution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Stamps who acted, and for whom, onto an actor snapshot.
 *
 * Written from what the guard proved. Nothing reads these fields back to make
 * a decision — see the header.
 */
export function attributedActor(
  actor: ActorRef,
  authority: LoadWriteAuthority,
  actingOrganizationName: string,
): ActorRef {
  if (authority.basis === "own_carrier") return actor;
  return {
    ...actor,
    actingOrganizationId: authority.actingOrganizationId,
    actingOrganizationName,
  };
}

/** True when a truck context can be built for this service context. */
export function truckContextFor(ctx: ServiceContext) {
  return truckContextFrom(ctx);
}

import type { ActorRef, OrganizationType, PermissionKey } from "@/types";

/**
 * Every service call carries the organization it acts in and the permissions of
 * the membership making it. There is no method that takes a User — a request is
 * always made *as a membership, inside an organization*.
 */
export interface ServiceContext {
  organizationId: string;
  /**
   * The kind of workspace the call is made in. A carrier and a dispatch agency
   * are different products behind the same seam; a service may not guess which
   * one it is serving, and a screen may not tell it.
   */
  organizationType: OrganizationType;
  /** Display name of the workspace, for anything a person reads or exports. */
  organizationName: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  actor: ActorRef;
  /** Record scope from the membership; the adapter narrows results with it. */
  scope: { loads: "all" | "assigned"; financials: "all" | "own" };
  /** Set when this membership is a driver, so "assigned" can be resolved. */
  driverProfileId?: string;
}

export class PermissionDeniedError extends Error {
  constructor(readonly required: PermissionKey[]) {
    super(`Missing permission: ${required.join(", ")}`);
    this.name = "PermissionDeniedError";
  }
}

export class OrganizationScopeError extends Error {
  constructor(readonly requested: string, readonly active: string) {
    super(`Record belongs to ${requested}, not the active organization ${active}`);
    this.name = "OrganizationScopeError";
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

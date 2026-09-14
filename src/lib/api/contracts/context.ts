import type { ActorRef, PermissionKey, WorkspaceKind } from "@/types";

/**
 * Every service call carries the organization it acts in and the permissions of
 * the membership making it. There is no method that takes a User — a request is
 * always made *as a membership, inside an organization*.
 */
export interface ServiceContext {
  organizationId: string;
  /** Display name, snapshotted onto records the membership creates. */
  organizationName: string;
  /**
   * What kind of workspace this is.
   *
   * Derived from the active organization, never supplied by a screen, because
   * it decides which document requirements exist. A dispatch organization that
   * could ask for the carrier checklist would be a dispatch organization that
   * could be shown carrier-only requirements.
   */
  workspaceKind: WorkspaceKind;
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

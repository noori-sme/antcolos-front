import {
  RELATIONSHIP_OWNER_SERVICE, TRANSITION_KIND_LABEL,
  type AgreementType, type ContractRelationshipRef, type IsoDateTime,
  type RelationshipRefKind, type RelationshipTransitionKind,
  type RelationshipTransitionRequest,
} from "@/types";
import { relationshipKindAllowed } from "./catalog";

/**
 * The boundary between a contract and the relationship it papers.
 *
 * Antcolos already decides access in four places, and none of them is here:
 *
 *   Invitation                  proposes access
 *   Membership                  controls a user's access in an organization
 *   CarrierRelationship         controls a driver's business scope with a carrier
 *   Truck/TrailerCarrier-       controls which carrier may operate an asset
 *     Relationship
 *   Truck/TrailerOperatingLease controls which authority it legally runs under
 *   TruckDispatchAccess         controls a dispatch organization's access
 *
 * A contract may hold a REFERENCE to any of those its type allows, and may ASK
 * for a transition. It may not perform one. This module is where that is made
 * structural rather than aspirational: there is no function here that takes a
 * membership or a lease and returns a changed one, and
 * {@link buildTransitionRequest} produces a record whose `applied` field is the
 * literal `false` — so a later milestone that wants to wire this up has to
 * change the TYPE, in a review, rather than flip a boolean.
 */

export class RelationshipBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipBoundaryError";
  }
}

/**
 * Refuses a reference this kind of agreement may not hold.
 *
 * Checked before any reference is attached. A carrier–driver agreement that
 * could reference an Operating Authority lease would, on a screen, look as
 * though it governed one — and the first person to read that screen would
 * reasonably believe that signing it authorised a truck.
 */
export function assertRelationshipAllowed(
  agreementType: AgreementType,
  kind: RelationshipRefKind,
): void {
  if (!relationshipKindAllowed(agreementType, kind)) {
    throw new RelationshipBoundaryError(
      `A ${agreementType.replace(/_/g, " ")} agreement cannot reference a ${kind.replace(/_/g, " ")}. Reference only the relationships this kind of agreement is actually about.`,
    );
  }
}

/** Which transitions make sense to ask about, per relationship kind. */
const TRANSITIONS_BY_KIND: Record<RelationshipRefKind, readonly RelationshipTransitionKind[]> = {
  invitation: ["review_invitation"],
  membership: ["activate_membership", "revoke_membership"],
  driver_carrier_relationship: ["start_driver_relationship", "end_driver_relationship"],
  truck_carrier_relationship: ["approve_asset_relationship", "end_asset_relationship"],
  trailer_carrier_relationship: ["approve_asset_relationship", "end_asset_relationship"],
  truck_dispatch_access: ["grant_dispatch_access", "end_dispatch_access"],
  truck_operating_lease: ["release_operating_authority"],
  trailer_operating_lease: ["release_operating_authority"],
};

export function transitionsAvailableFor(
  kind: RelationshipRefKind,
): readonly RelationshipTransitionKind[] {
  return TRANSITIONS_BY_KIND[kind];
}

export function assertTransitionApplies(
  kind: RelationshipRefKind,
  transition: RelationshipTransitionKind,
): void {
  if (!TRANSITIONS_BY_KIND[kind].includes(transition)) {
    throw new RelationshipBoundaryError(
      `"${TRANSITION_KIND_LABEL[transition]}" is not something a ${kind.replace(/_/g, " ")} can be asked for.`,
    );
  }
}

/**
 * What the person on the other end actually has to do, per transition.
 *
 * Written out rather than generated, because "ask the owning service" is not an
 * instruction anybody can follow. Each one names the screen where the canonical
 * change is really made.
 */
const NEXT_STEP: Record<RelationshipTransitionKind, string> = {
  review_invitation:
    "Open Settings → Invitations and decide what happens to the invitation. Nothing about it has changed.",
  activate_membership:
    "Open Settings → Users. A membership becomes active when the person accepts their invitation and an owner confirms their access — signing a contract does not do it.",
  revoke_membership:
    "Open Settings → Users and suspend or end the membership there. Access is unchanged until you do.",
  start_driver_relationship:
    "Open the driver's record and start the carrier relationship there. The driver's business scope is unchanged until you do.",
  end_driver_relationship:
    "Open the driver's record and end the carrier relationship there. The driver keeps their profile, their documents and every completed load.",
  approve_asset_relationship:
    "Open the truck or trailer and approve the carrier relationship there. The equipment's permanent record and UUID are untouched either way.",
  end_asset_relationship:
    "Open the truck or trailer and end the carrier relationship there. The permanent equipment record, its ownership history and its documents all survive.",
  grant_dispatch_access:
    "Open the truck and grant dispatch access there. The dispatch organization sees nothing new until you do.",
  end_dispatch_access:
    "Open the truck and end dispatch access there. What the dispatcher already held stays in their records as a snapshot.",
  release_operating_authority:
    "Open the truck or trailer and release the Operating Authority lease through its termination checklist. The asset stays locked to the current authority until every step is done.",
};

let seq = 0;
const requestId = () => `ctr_req_${(++seq).toString(36)}${Date.now().toString(36)}`;

/**
 * Records that a contract has ASKED for an access change.
 *
 * `applied: false` is not a default — it is the literal type of the field, so
 * nothing in this module or any caller can set it to true. The request is a note
 * to a human, with the owning service named and the screen to go to, and the
 * contract's own state moves whether or not anybody acts on it.
 */
export function buildTransitionRequest(input: {
  contractId: string;
  contractVersionId?: string;
  agreementType: AgreementType;
  kind: RelationshipTransitionKind;
  target: { kind: RelationshipRefKind; externalId?: string; labelSnapshot: string };
  reason: string;
  requestedByMembershipId: string;
  requestedByName: string;
  now: IsoDateTime;
}): RelationshipTransitionRequest {
  assertRelationshipAllowed(input.agreementType, input.target.kind);
  assertTransitionApplies(input.target.kind, input.kind);

  return {
    id: requestId(),
    contractId: input.contractId,
    contractVersionId: input.contractVersionId,
    kind: input.kind,
    target: { ...input.target },
    ownerService: RELATIONSHIP_OWNER_SERVICE[input.target.kind],
    reason: input.reason,
    requestedAt: input.now,
    requestedByMembershipId: input.requestedByMembershipId,
    requestedByName: input.requestedByName,
    applied: false,
    nextStep: NEXT_STEP[input.kind],
  };
}

/**
 * The transitions a signing event should ask for, given what the contract
 * references.
 *
 * Note what this returns: a list of REQUESTS to build, never a list of changes
 * to make. A fully-signed carrier–driver agreement asks that the driver
 * relationship be started; it does not start one, and the driver's scope is
 * identical before and after.
 */
export function transitionsOnActivation(
  refs: readonly ContractRelationshipRef[],
): Array<{ kind: RelationshipTransitionKind; ref: ContractRelationshipRef }> {
  const wanted: Partial<Record<RelationshipRefKind, RelationshipTransitionKind>> = {
    invitation: "review_invitation",
    membership: "activate_membership",
    driver_carrier_relationship: "start_driver_relationship",
    truck_carrier_relationship: "approve_asset_relationship",
    trailer_carrier_relationship: "approve_asset_relationship",
    truck_dispatch_access: "grant_dispatch_access",
    // Activating a contract never asks for an authority lease. An authority
    // lease is reserved and activated per movement by the truck registry, and a
    // contract asking for one would be a contract asking to put a truck on the
    // road.
  };
  return refs
    .filter((r) => !r.detachedAt)
    .flatMap((ref) => {
      const kind = wanted[ref.kind];
      return kind ? [{ kind, ref }] : [];
    });
}

/** The transitions a termination should ask for. */
export function transitionsOnTermination(
  refs: readonly ContractRelationshipRef[],
): Array<{ kind: RelationshipTransitionKind; ref: ContractRelationshipRef }> {
  const wanted: Partial<Record<RelationshipRefKind, RelationshipTransitionKind>> = {
    membership: "revoke_membership",
    driver_carrier_relationship: "end_driver_relationship",
    truck_carrier_relationship: "end_asset_relationship",
    trailer_carrier_relationship: "end_asset_relationship",
    truck_dispatch_access: "end_dispatch_access",
    truck_operating_lease: "release_operating_authority",
    trailer_operating_lease: "release_operating_authority",
  };
  return refs
    .filter((r) => !r.detachedAt)
    .flatMap((ref) => {
      const kind = wanted[ref.kind];
      return kind ? [{ kind, ref }] : [];
    });
}

/**
 * What ending a relationship must NOT do, written down where the code can read
 * it.
 *
 * Surfaced on the termination screen so the promise is data rather than a
 * sentence in a component somebody later edits. Every item is a thing the
 * canonical services already guarantee; the contract module's job is to not be
 * the exception.
 */
export const TERMINATION_PRESERVES: readonly string[] = [
  "The person's Antcolos account and their permanent profile.",
  "Every organization involved, and its own records.",
  "The permanent truck and trailer records, their UUIDs and their ownership history.",
  "This contract, every version of it, every signature and the whole audit timeline.",
  "Documents, their versions and their review history, with a snapshot of what each party held.",
  "Completed loads, invoices, settlements and their frozen financial snapshots.",
  "Compliance, maintenance, insurance, fuel and assignment history.",
] as const;

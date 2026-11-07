import type { FleetTruck } from "@/types/fleet-truck";

export interface TruckActionPermissions {
  /** `trucks:edit` (backend `truck.update`). */
  edit: boolean;
  /** `trucks:delete` (backend `truck.delete`). */
  delete: boolean;
}

export interface TruckActionAvailability {
  status: boolean;
  edit: boolean;
  handOff: boolean;
  leave: boolean;
  archive: boolean;
  /** Why archive is shown disabled, when it is. */
  archiveBlockedReason: string | null;
}

/**
 * True when this organization is the truck's current legal owner. `operating`
 * is always this organization's own row (fleet contract §Operating snapshot),
 * so its `organizationId` is the real backend id; the session's organization
 * id is not (plan 02, Findings).
 *
 * A truck handed to a member (`ownerType: "USER"`) reads as not owned by this
 * organization; the member's own actions are not offered yet (plan 02, Known
 * limits).
 */
export function isOwnedByThisOrganization(truck: FleetTruck): boolean {
  const ours = truck.operating?.organizationId;
  return (
    truck.legalOwner?.ownerType === "ORGANIZATION" &&
    Boolean(ours) &&
    truck.legalOwner.ownerOrganizationId === ours
  );
}

/**
 * Which truck actions to offer (fleet contract §4–§6, §11, §12). The server
 * decides; this only avoids offering what it will refuse for permission or
 * relationship reasons.
 */
export function truckActionsFor(
  truck: FleetTruck,
  can: TruckActionPermissions,
): TruckActionAvailability {
  const none: TruckActionAvailability = {
    status: false, edit: false, handOff: false, leave: false, archive: false,
    archiveBlockedReason: null,
  };
  if (truck.archivedAt) return none;
  const operating = Boolean(truck.operating?.operatingId);
  const owner = isOwnedByThisOrganization(truck);
  const status = truck.operating?.operationalStatus ?? truck.operationalStatus;
  const archive = owner && can.delete;
  return {
    status: operating && can.edit,
    edit: operating && can.edit,
    handOff: owner && can.edit,
    leave: operating && can.edit,
    archive,
    archiveBlockedReason:
      archive && status === "AVAILABLE" ? "Mark the truck unavailable first" : null,
  };
}

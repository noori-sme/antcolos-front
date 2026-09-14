import { notFound } from "next/navigation";
import { EquipmentMaintenanceScreen } from "@/features/maintenance/equipment-maintenance-screen";
import type { MaintenanceEquipmentKind } from "@/types";

export const metadata = { title: "Equipment maintenance" };

/**
 * Trucks and trailers are separate registries, so the kind is part of the
 * route rather than something guessed from the id. Anything that is not one of
 * the two is a 404 before the screen ever runs.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ equipmentKind: string; equipmentId: string }>;
}) {
  const { equipmentKind, equipmentId } = await params;
  if (equipmentKind !== "truck" && equipmentKind !== "trailer") notFound();

  return (
    <EquipmentMaintenanceScreen
      equipmentKind={equipmentKind as MaintenanceEquipmentKind}
      equipmentId={decodeURIComponent(equipmentId)}
    />
  );
}

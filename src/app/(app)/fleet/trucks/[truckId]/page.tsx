import { TruckProfileScreen } from "@/features/fleet/truck-profile-screen";

export const metadata = { title: "Truck" };

export default async function Page({ params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params;
  return <TruckProfileScreen truckId={decodeURIComponent(truckId)} />;
}

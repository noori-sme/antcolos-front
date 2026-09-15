import { TruckDispatchScreen } from "@/features/mt-loop/truck-dispatch-screen";

export const metadata = { title: "Truck dispatch" };

export default async function Page({ params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params;
  return <TruckDispatchScreen truckId={decodeURIComponent(truckId)} />;
}

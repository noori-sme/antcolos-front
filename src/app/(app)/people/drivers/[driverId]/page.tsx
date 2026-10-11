import { CarrierDriverDetail } from "@/features/driver/carrier-driver-detail";

export const metadata = { title: "Driver" };

export default async function Page({ params }: { params: Promise<{ driverId: string }> }) {
  const { driverId } = await params;
  return <CarrierDriverDetail userId={driverId} relationshipId={driverId} />;
}

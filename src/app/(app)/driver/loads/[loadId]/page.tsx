import { TripScreen } from "@/features/driver-workflow/trip-screen";

export const metadata = { title: "Trip" };

export default async function Page({ params }: { params: Promise<{ loadId: string }> }) {
  const { loadId } = await params;
  return <TripScreen loadId={decodeURIComponent(loadId)} />;
}

import { TrackingDetailScreen } from "@/features/tracking/tracking-detail-screen";

export const metadata = { title: "Load tracking" };

export default async function Page({ params }: { params: Promise<{ loadId: string }> }) {
  const { loadId } = await params;
  return <TrackingDetailScreen loadId={decodeURIComponent(loadId)} />;
}

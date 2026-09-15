import { PublicTrackingScreen } from "@/features/tracking/public-tracking-screen";

export const metadata = {
  title: "Shipment tracking",
  // A tracking link is private to whoever was given it, and it is not a page
  // that belongs in a search index.
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicTrackingScreen token={decodeURIComponent(token)} />;
}

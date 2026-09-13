import { TrailerProfileScreen } from "@/features/trailers/trailer-profile-screen";

export const metadata = { title: "Trailer" };

export default async function Page({ params }: { params: Promise<{ trailerId: string }> }) {
  const { trailerId } = await params;
  return <TrailerProfileScreen trailerId={decodeURIComponent(trailerId)} />;
}

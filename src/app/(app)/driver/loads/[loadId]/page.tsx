import { DriverLoadRoute } from "@/features/driver-workflow/trips-route";

export const metadata = { title: "Load" };

export default async function Page({ params }: { params: Promise<{ loadId: string }> }) {
  const { loadId } = await params;
  return <DriverLoadRoute loadId={decodeURIComponent(loadId)} />;
}

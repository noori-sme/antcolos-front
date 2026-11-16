import { LoadRoute } from "@/features/loads/loads-route";

export const metadata = { title: "Load" };

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ loadId: string }>;
}) {
  const { loadId } = await params;
  return <LoadRoute loadId={loadId} />;
}

import { LoadDetail } from "@/features/loads/load-detail";

export const metadata = { title: "Load" };

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ loadId: string }>;
}) {
  const { loadId } = await params;
  return <LoadDetail loadId={loadId} />;
}

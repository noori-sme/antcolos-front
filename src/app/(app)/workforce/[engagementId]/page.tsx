import { EngagementDetailScreen } from "@/features/workforce/engagement-detail-screen";

export const metadata = { title: "Engagement" };

export default async function Page({
  params,
}: {
  params: Promise<{ engagementId: string }>;
}) {
  const { engagementId } = await params;
  return <EngagementDetailScreen engagementId={engagementId} />;
}

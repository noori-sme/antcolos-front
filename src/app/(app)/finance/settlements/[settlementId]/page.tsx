import { SettlementDetailScreen } from "@/features/settlements/settlement-detail";

export const metadata = { title: "Settlement" };

export default async function Page({
  params,
}: {
  params: Promise<{ settlementId: string }>;
}) {
  const { settlementId } = await params;
  return <SettlementDetailScreen settlementId={decodeURIComponent(settlementId)} />;
}

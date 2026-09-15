import { FuelTransactionDetail } from "@/features/fuel/transaction-detail";

export const metadata = { title: "Fuel purchase" };

export default async function Page({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;
  return <FuelTransactionDetail transactionId={decodeURIComponent(transactionId)} />;
}

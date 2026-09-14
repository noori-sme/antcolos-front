import { PayeeStatementScreen } from "@/features/settlements/payee-statement";

export const metadata = { title: "Settlement statement" };

export default async function Page({
  params,
}: {
  params: Promise<{ settlementId: string }>;
}) {
  const { settlementId } = await params;
  return <PayeeStatementScreen settlementId={decodeURIComponent(settlementId)} />;
}

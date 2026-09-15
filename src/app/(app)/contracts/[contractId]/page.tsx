import { ContractDetailScreen } from "@/features/contracts/contract-detail-screen";

export const metadata = { title: "Agreement" };

export default async function Page({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params;
  return <ContractDetailScreen contractId={decodeURIComponent(contractId)} />;
}

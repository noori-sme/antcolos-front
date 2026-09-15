import { ContractVersionScreen } from "@/features/contracts/version-screen";

export const metadata = { title: "Agreement version" };

export default async function Page({
  params,
}: {
  params: Promise<{ contractId: string; versionId: string }>;
}) {
  const { contractId, versionId } = await params;
  return (
    <ContractVersionScreen
      contractId={decodeURIComponent(contractId)}
      contractVersionId={decodeURIComponent(versionId)}
    />
  );
}

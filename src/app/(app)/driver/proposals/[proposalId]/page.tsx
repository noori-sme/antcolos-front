import { ProposalDetail } from "@/features/driver-workflow/proposal-detail";

export const metadata = { title: "Load proposal" };

export default async function Page({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  return <ProposalDetail proposalId={decodeURIComponent(proposalId)} />;
}

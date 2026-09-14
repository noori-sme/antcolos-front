import { ClaimProfileScreen } from "@/features/insurance/claim-profile-screen";

export const metadata = { title: "Claim" };

export default async function Page({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  return <ClaimProfileScreen claimId={decodeURIComponent(claimId)} />;
}

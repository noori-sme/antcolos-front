import { PolicyProfileScreen } from "@/features/insurance/policy-profile-screen";

export const metadata = { title: "Policy" };

export default async function Page({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  return <PolicyProfileScreen policyId={decodeURIComponent(policyId)} />;
}

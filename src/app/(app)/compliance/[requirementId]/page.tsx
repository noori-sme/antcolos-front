import { ComplianceRequirementScreen } from "@/features/compliance/requirement-screen";

export const metadata = { title: "Compliance requirement" };

export default async function Page({
  params,
}: {
  params: Promise<{ requirementId: string }>;
}) {
  const { requirementId } = await params;
  return <ComplianceRequirementScreen requirementId={decodeURIComponent(requirementId)} />;
}

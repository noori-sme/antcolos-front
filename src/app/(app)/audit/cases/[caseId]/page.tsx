import { RiskCaseScreen } from "@/features/audit/case-screen";

export const metadata = { title: "Risk case" };

export default async function Page({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return <RiskCaseScreen caseId={caseId} />;
}

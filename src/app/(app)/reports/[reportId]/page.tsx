import { ReportScreen } from "@/features/reports/report-screen";

export const metadata = { title: "Report" };

export default async function Page({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <ReportScreen reportId={decodeURIComponent(reportId)} />;
}

import { IftaPeriodDetail } from "@/features/fuel/ifta-period-detail";

export const metadata = { title: "IFTA quarter" };

export default async function Page({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  return <IftaPeriodDetail periodId={decodeURIComponent(periodId)} />;
}

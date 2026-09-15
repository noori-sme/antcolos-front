import { RiskSignalsScreen } from "@/features/audit/signals-screen";
import type { RiskSeverity } from "@/types";

export const metadata = { title: "Risk signals" };

const SEVERITIES: RiskSeverity[] = ["critical", "high", "medium", "low", "informational"];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string }>;
}) {
  const { severity } = await searchParams;
  const initial = SEVERITIES.find((s) => s === severity);
  return <RiskSignalsScreen initialSeverity={initial} />;
}

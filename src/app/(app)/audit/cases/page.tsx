import { RiskCasesScreen } from "@/features/audit/cases-screen";
import type { RiskCaseState } from "@/types";

export const metadata = { title: "Risk cases" };

const STATES: RiskCaseState[] = [
  "open", "investigating", "action_required", "escalated",
  "resolved", "accepted_risk", "dismissed",
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; owner?: string }>;
}) {
  const { state, owner } = await searchParams;
  return (
    <RiskCasesScreen
      initialState={STATES.find((s) => s === state)}
      initialOwner={owner === "me" ? "me" : undefined}
    />
  );
}

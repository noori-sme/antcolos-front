import { Suspense } from "react";
import { ReferralClaimScreen } from "@/features/referrals/claim-screen";

export const metadata = { title: "Introduction" };

/**
 * Outside the product shell, like the invitation acceptance screen.
 *
 * The person opening this may belong to nothing and may have no account at all,
 * so there is no sidebar to render, no organization to switch and no permission
 * to check. The token is all that resolves it, and it resolves it to a view
 * that says nothing about the company's decision.
 */
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ report?: string }>;
}) {
  const { token } = await params;
  const { report } = await searchParams;
  return (
    <Suspense fallback={null}>
      <ReferralClaimScreen
        token={decodeURIComponent(token)}
        reportFirst={report === "1"}
      />
    </Suspense>
  );
}

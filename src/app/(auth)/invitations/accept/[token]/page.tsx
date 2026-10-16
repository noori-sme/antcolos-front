import { Suspense } from "react";
import { InvitationAcceptanceScreen } from "@/features/access/acceptance-screen";

export const metadata = { title: "Invitation Acceptance" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense fallback={null}>
      <InvitationAcceptanceScreen token={decodeURIComponent(token)} />
    </Suspense>
  );
}

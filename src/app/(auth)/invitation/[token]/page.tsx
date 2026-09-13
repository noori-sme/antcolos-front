import { Suspense } from "react";
import { InvitationAcceptanceScreen } from "@/features/access/acceptance-screen";

export const metadata = { title: "Invitation" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    // The screen reads ?signedin= to know the person came back through Sign Up.
    <Suspense fallback={null}>
      <InvitationAcceptanceScreen token={decodeURIComponent(token)} />
    </Suspense>
  );
}

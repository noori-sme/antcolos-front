import { InvitationScreen } from "@/features/auth/invitation-screen";

export const metadata = { title: "Invitation" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <InvitationScreen code={decodeURIComponent(code)} />;
}

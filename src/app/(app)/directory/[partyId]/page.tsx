import { PartyProfileScreen } from "@/features/directory/party-profile-screen";

export const metadata = { title: "Company" };

export default async function Page({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params;
  return <PartyProfileScreen partyId={decodeURIComponent(partyId)} />;
}

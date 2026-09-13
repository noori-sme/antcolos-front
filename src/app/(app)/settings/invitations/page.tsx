import { InvitationsScreen } from "@/features/access/invitations-screen";
import { OwnerOnly } from "@/features/access/owner-guard";

export const metadata = { title: "Invitations" };

export default function Page() {
  return (
    <OwnerOnly>
      <InvitationsScreen />
    </OwnerOnly>
  );
}

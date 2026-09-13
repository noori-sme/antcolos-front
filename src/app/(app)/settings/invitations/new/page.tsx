import { InviteFlow } from "@/features/access/invite-flow";
import { OwnerOnly } from "@/features/access/owner-guard";

export const metadata = { title: "Invite" };

export default function Page() {
  return (
    <OwnerOnly>
      <InviteFlow />
    </OwnerOnly>
  );
}

import { InviteFlow } from "@/features/access/invite-flow";
import { RequiresPermission } from "@/features/access/owner-guard";

export const metadata = { title: "Invite" };

export default function Page() {
  return (
    <RequiresPermission permission="invitations:create" title="Only the owner can invite people">
      <InviteFlow />
    </RequiresPermission>
  );
}

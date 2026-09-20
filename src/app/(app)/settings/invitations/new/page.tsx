import { Suspense } from "react";
import { InviteFlow } from "@/features/access/invite-flow";
import { RequiresPermission } from "@/features/access/owner-guard";

export const metadata = { title: "Invite" };

/**
 * Wrapped in Suspense because the flow reads `?referral=` — the handoff a
 * company follows after recording interest in an introduction. The invitation
 * itself is unchanged: the same command, the same permission check, the same
 * decisions made here by somebody holding `invitations:create`.
 */
export default function Page() {
  return (
    <RequiresPermission permission="invitations:create" title="Only the owner can invite people">
      <Suspense fallback={null}>
        <InviteFlow />
      </Suspense>
    </RequiresPermission>
  );
}

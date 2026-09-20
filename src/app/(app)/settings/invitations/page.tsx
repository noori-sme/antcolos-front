import { InvitationsScreen } from "@/features/access/invitations-screen";
import { RequiresPermission } from "@/features/access/owner-guard";

export const metadata = { title: "Invitations" };

/**
 * Inviting people is the Owner's, or somebody the Owner has explicitly given
 * `invitations:create` to. An active owner holds every permission, so this one
 * check covers both — see `RequiresPermission`.
 *
 * The whole area is gated on the CREATE key rather than the weaker view key,
 * because the Invite action lives on this screen. Gating the page at
 * `invitations:view` and the button at `invitations:create` would put somebody
 * in front of a list whose only purpose is an action they cannot take.
 */
export default function Page() {
  return (
    <RequiresPermission permission="invitations:create" title="Only the owner can invite people">
      <InvitationsScreen />
    </RequiresPermission>
  );
}

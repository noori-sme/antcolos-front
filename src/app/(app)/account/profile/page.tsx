import { PageHeader } from "@/components/layout/page-header";
import { API_MODE } from "@/lib/api/mode";
import { OwnProfileScreen } from "@/features/profile/own-profile-screen";
import { SelfProfileScreen } from "@/features/self-profile/self-profile-screen";

export const metadata = { title: "Profile" };

/**
 * http mode (plan 11): your own record from `/users/me`. Mock mode keeps the
 * public-profile screen, which has no backend yet.
 */
const ProfileScreen = API_MODE === "http" ? SelfProfileScreen : OwnProfileScreen;

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your permanent Antcolos record. It stays the same in every organization, and it outlives all of them."
      />
      <ProfileScreen />
    </div>
  );
}

import { PageHeader } from "@/components/layout/page-header";
import { OwnProfileScreen } from "@/features/profile/own-profile-screen";

export const metadata = { title: "Profile" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your permanent Antcolos record. It stays the same in every organization, and it outlives all of them."
      />
      <OwnProfileScreen />
    </div>
  );
}

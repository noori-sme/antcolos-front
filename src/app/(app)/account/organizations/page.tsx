import { API_MODE } from "@/lib/api/mode";
import { MyOrganizationsScreen } from "@/features/account/my-organizations-screen";
import { ModulePlaceholder } from "../../placeholder";

export const metadata = { title: "My organizations" };

// http mode lists the real memberships (plan 25); the mock fixtures have no leave.
export default function Page() {
  return API_MODE === "http" ? (
    <MyOrganizationsScreen />
  ) : (
    <ModulePlaceholder title="My organizations" description="Join, switch and leave. Leaving never deletes your Antcolos account." />
  );
}

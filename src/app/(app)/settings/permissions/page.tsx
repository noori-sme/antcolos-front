import { RolesScreen } from "@/features/access/roles-screen";
import { OwnerOnly } from "@/features/access/owner-guard";

export const metadata = { title: "Roles and permissions" };

export default function Page() {
  return (
    <OwnerOnly>
      <RolesScreen />
    </OwnerOnly>
  );
}

import { Construction } from "lucide-react";
import { EmptyState } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { BrokerPolicySettings } from "@/features/directory/broker-policy-settings";

export const metadata = { title: "Organization" };

/**
 * Organization settings.
 *
 * The legal-name, registration and billing half is still a placeholder — that
 * module lands on its own. Broker policy AUTHORITY is here because it is
 * genuinely configuration: who may ask, who may approve, how long a hold runs.
 *
 * The policies themselves are deliberately NOT here. They are daily operating
 * decisions and they live in Directory → Brokers → Broker policies, where
 * somebody wondering why a load did not come up will actually look.
 */
export default function Page() {
  return (
    <div className="space-y-section">
      <PageHeader
        title="Organization"
        description="Legal name, DOT and MC numbers, addresses, billing, and who decides what."
      />

      <BrokerPolicySettings />

      <EmptyState
        icon={Construction}
        title="The rest of this module is not built yet"
        description="Legal name, registration numbers, addresses and billing land with the Organization module. It will be designed with you before it is built."
      />
    </div>
  );
}

import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { BrokerPoliciesScreen } from "@/features/directory/broker-policies-screen";

export const metadata = { title: "Broker policies" };

/**
 * The screen reads `?policy=<id>` so that a Needs You item, a Load Search
 * result, an Opportunity and the MT Loop blocker all open the SAME canonical
 * record. Reading the query string makes the tree below this point render on
 * the client, so it sits behind its own Suspense boundary and the shell around
 * it still prerenders.
 */
export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={6} />}>
      <BrokerPoliciesScreen />
    </Suspense>
  );
}

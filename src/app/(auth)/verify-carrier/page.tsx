import { Suspense } from "react";
import { VerifyCarrierScreen } from "@/features/auth/verify-carrier-screen";

export const metadata = { title: "Verify Carrier" };

export default function VerifyCarrierPage() {
  return (
    <Suspense fallback={null}>
      <VerifyCarrierScreen />
    </Suspense>
  );
}

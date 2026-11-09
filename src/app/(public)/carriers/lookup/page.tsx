import { Suspense } from "react";
import { CarrierLookupScreen } from "@/features/carrier-lookup/carrier-lookup-screen";

export const metadata = {
  title: "Carrier lookup",
  description: "Look up a carrier's FMCSA record by MC or DOT number.",
};

export default function CarrierLookupPage() {
  return (
    <Suspense fallback={null}>
      <CarrierLookupScreen />
    </Suspense>
  );
}

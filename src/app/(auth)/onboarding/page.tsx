import { Suspense } from "react";
import { OnboardingScreen } from "@/features/auth/onboarding-screen";

export const metadata = { title: "Set up your workspace" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <OnboardingScreen />
    </Suspense>
  );
}

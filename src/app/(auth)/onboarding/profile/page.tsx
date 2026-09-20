import { Suspense } from "react";
import { ProfileSetupScreen } from "@/features/profile/setup-screen";

export const metadata = { title: "Set up your profile" };

export default function Page() {
  // The screen reads ?next= so an invitation survives the profile step.
  return (
    <Suspense fallback={null}>
      <ProfileSetupScreen />
    </Suspense>
  );
}

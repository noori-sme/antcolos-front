import { Suspense } from "react";
import { SignUpScreen } from "@/features/auth/sign-up-screen";

export const metadata = { title: "Create your account" };

export default function Page() {
  // The screen reads ?invitation= so an invitation survives the detour.
  return (
    <Suspense fallback={null}>
      <SignUpScreen />
    </Suspense>
  );
}

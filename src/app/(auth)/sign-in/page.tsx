import { Suspense } from "react";
import { SignInScreen } from "@/features/auth/sign-in-screen";

export const metadata = { title: "Sign in" };

export default function Page() {
  // The screen reads ?invitation= so an invitation survives the detour.
  return (
    <Suspense fallback={null}>
      <SignInScreen />
    </Suspense>
  );
}

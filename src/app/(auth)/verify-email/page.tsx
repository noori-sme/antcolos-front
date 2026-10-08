import { Suspense } from "react";
import { VerifyEmailScreen } from "@/features/auth/verify-email-screen";

export const metadata = { title: "Verify Email" };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailScreen />
    </Suspense>
  );
}

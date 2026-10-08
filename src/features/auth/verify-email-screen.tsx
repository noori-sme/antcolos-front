"use client";

import { useSearchParams } from "next/navigation";
import { AuthShell } from "./shell";
import { VerifyEmailModal } from "./modals/verify-email-modal";

export function VerifyEmailScreen() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || null;

  return (
    <>
      <AuthShell
        title="Email Verification"
        description="Verifying your secure link..."
      >
        <div className="py-12 text-center text-[0.875rem] text-fg-muted">
          Your verification will begin momentarily.
        </div>
      </AuthShell>

      <VerifyEmailModal 
        token={token} 
        onClose={() => {}} 
      />
    </>
  );
}

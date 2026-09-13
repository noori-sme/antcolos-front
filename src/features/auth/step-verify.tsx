"use client";

import { BackLink } from "./controls";
import { CodeVerification } from "./code-verification";
import { mockSendVerificationCode, mockVerifyCode } from "./mock-backend";
import { CODE_TTL_SECONDS } from "./rules";

/**
 * Sign up, step 2 — confirm the email address the person typed a moment ago.
 *
 * The address is already in the card's description, so no address line is
 * repeated above the boxes here.
 */
export function StepVerify({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  return (
    <CodeVerification
      ttlSeconds={CODE_TTL_SECONDS}
      onVerify={mockVerifyCode}
      onResend={() => mockSendVerificationCode(email)}
      onVerified={onVerified}
      submitLabel="Verify email"
      footerLeft={<BackLink onClick={onBack} label="Use a different email" />}
    />
  );
}

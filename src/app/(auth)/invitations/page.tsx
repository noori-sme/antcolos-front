"use client";

import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import { InvitationAcceptanceScreen } from "@/features/access/acceptance-screen";
import { AuthShell } from "@/features/auth/shell";
import { FormAlert } from "@/features/auth/form-alert";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";

export default function InvitationsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const savedToken = Cookies.get("antcolos_invitation_token");
    if (savedToken) {
      setToken(savedToken);
    }
    setChecked(true);
  }, []);

  if (!checked) {
    return (
      <AuthShell width="medium" title="Loading invitation" description="Retrieving your invitation details...">
        <div className="flex items-center gap-2.5 text-[0.875rem] text-fg-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
          Loading…
        </div>
      </AuthShell>
    );
  }

  if (!token) {
    return (
      <AuthShell width="medium" title="No Invitation Link Found">
        <div className="space-y-4">
          <FormAlert tone="info" title="No active invitation found">
            Please use the complete link provided in your invitation email to view or accept your invitation.
          </FormAlert>
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link href="/sign-in">Go to Sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return <InvitationAcceptanceScreen token={token} />;
}

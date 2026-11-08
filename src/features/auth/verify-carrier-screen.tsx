"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAndStoreUserPermissions } from "@/lib/session/permissions-sync";
import { AuthShell } from "./shell";
import { FormAlert } from "./form-alert";
import { useVerifyCarrier } from "./hooks";

const ONBOARDING = "/onboarding?step=verify-carrier";

/**
 * Landing page for the link emailed to the carrier's FMCSA-registered address
 * (`/verify-carrier?token=…`, plan 07). Opening it creates the carrier
 * organization and signs the owner in as its admin.
 *
 * The token is posted once on load. On any failure the backend leaves the
 * token unused, so the person can simply open the link again.
 */
export function VerifyCarrierScreen() {
  const token = useSearchParams()?.get("token") || null;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mutate, isSuccess, isError, error } = useVerifyCarrier();

  // One request per page load, even when React runs the effect twice.
  const sent = useRef(false);
  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true;
      mutate(token);
    }
  }, [token, mutate]);

  const enterWorkspace = () => {
    fetchAndStoreUserPermissions(queryClient);
    router.push("/home");
  };

  if (!token) {
    return (
      <AuthShell title="Verify your carrier">
        <FormAlert tone="danger" title="This link is incomplete">
          Open the link from the verification email again. If it still fails, send a new one from onboarding.
        </FormAlert>
        <NextSteps />
      </AuthShell>
    );
  }

  if (isSuccess) {
    return (
      <AuthShell title="Carrier verified">
        <FormAlert tone="success" title="Your carrier account is ready">
          We confirmed the company with FMCSA and set you up as its admin.
        </FormAlert>
        <Button variant="primary" className="mt-5 w-full" onClick={enterWorkspace}>
          Go to your workspace
        </Button>
      </AuthShell>
    );
  }

  if (isError) {
    return (
      <AuthShell title="Verify your carrier">
        <FormAlert tone="danger" title="We couldn't verify your carrier">
          {error?.message || "Carrier verification token is invalid or expired."}
        </FormAlert>
        <p className="mt-3 text-[0.8125rem] text-fg-muted">
          Links expire after 24 hours and stop working when a newer one is sent.
        </p>
        <NextSteps />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Verify your carrier">
      <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
        <p className="text-[0.875rem] text-fg-muted">Confirming your carrier with FMCSA…</p>
      </div>
    </AuthShell>
  );
}

function NextSteps() {
  return (
    <div className="mt-5 flex flex-col gap-2">
      <Button asChild variant="primary" className="w-full">
        <Link href={ONBOARDING}>Back to onboarding</Link>
      </Button>
      <Button asChild variant="ghost" className="w-full">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    </div>
  );
}

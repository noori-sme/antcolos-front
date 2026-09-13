"use client";

import { Ban, Building2, CircleCheck, Clock, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/shell";
import { FormAlert } from "@/features/auth/form-alert";
import { PermissionSummary, SensitiveAccessWarning } from "./permission-summary";
import {
  type InvitationLookup,
  mockAcceptTeamInvitation,
  mockLookUpTeamInvitation,
} from "./mock-access";

/**
 * The screen an invitation link opens.
 *
 * Whoever follows the link is shown exactly what they are being given before
 * they accept it — the same permission summary the sender confirmed. Somebody
 * without an account is sent through Sign Up carrying the invitation, so they
 * land back here afterwards instead of on a generic welcome screen.
 */
export function InvitationAcceptanceScreen({ token }: { token: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const returningFromAuth = params.get("signedin") === "1";

  const [state, setState] = useState<InvitationLookup | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mockLookUpTeamInvitation(token, { returningFromAuth }).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [token, returningFromAuth]);

  async function accept() {
    if (!state || state.status !== "valid" || accepting) return;
    setAccepting(true);
    await mockAcceptTeamInvitation(state.invitation.id);
    setAccepting(false);
    setAccepted(true);
  }

  if (state === null) {
    return (
      <AuthShell title="Checking your invitation" description="One moment while we open the link.">
        <div className="flex items-center gap-2.5 text-[0.875rem] text-fg-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Checking invitation…
        </div>
      </AuthShell>
    );
  }

  if (state.status === "not-found") {
    return (
      <AuthShell
        title="This invitation link doesn't work"
        footer={<SignInLink />}
      >
        <FormAlert tone="danger" title="We don't recognise this link.">
          It may have been mistyped, or copied incompletely. Ask whoever invited you to send it
          again.
        </FormAlert>
      </AuthShell>
    );
  }

  const invitation = state.invitation;
  const isOrgInvite = invitation.kind === "dispatch_org";

  if (accepted) {
    return (
      <AuthShell
        title={`You've joined ${invitation.organizationName}`}
        description={
          isOrgInvite
            ? "Your organization is now connected. You can choose which of your people work with this carrier."
            : "Your access is active. Everything listed on the invitation is available to you now."
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <CircleCheck className="size-5 shrink-0 text-st-success" aria-hidden />
            <p className="text-[0.8125rem] font-medium text-fg">
              Invitation accepted as {invitation.roleName}.
            </p>
          </div>
          <Button variant="primary" size="lg" className="w-full" onClick={() => router.push("/home")}>
            Go to Antcolos
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (state.status === "expired" || state.status === "revoked" || state.status === "used") {
    const copy = {
      expired: {
        title: "This invitation has expired",
        alert: "The link is past its expiry date.",
        body: `Ask ${invitation.organizationName} to send you a new one — it only takes them a moment.`,
        tone: "warning" as const,
        icon: Clock,
      },
      revoked: {
        title: "This invitation was withdrawn",
        alert: `${invitation.organizationName} cancelled this invitation.`,
        body: "If you think that was a mistake, contact them directly and ask for a new link.",
        tone: "danger" as const,
        icon: Ban,
      },
      used: {
        title: "This invitation has already been used",
        alert: "Somebody has already accepted this invitation.",
        body: "If that was you, sign in with the account you created. If it was not, contact the organization straight away.",
        tone: "warning" as const,
        icon: CircleCheck,
      },
    }[state.status];

    return (
      <AuthShell title={copy.title} footer={<SignInLink />}>
        <FormAlert tone={copy.tone} title={copy.alert}>
          {copy.body}
        </FormAlert>
      </AuthShell>
    );
  }

  if (state.status === "wrong-recipient") {
    return (
      <AuthShell title="This invitation isn't for this account" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="danger" title="You are signed in as somebody else.">
            This invitation was sent to <strong className="font-medium text-fg">{invitation.recipientEmail}</strong>,
            but you are signed in as <strong className="font-medium text-fg">{state.signedInAs}</strong>. For
            everyone&apos;s safety we will not attach it to the wrong account.
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Sign out and sign back in as {invitation.recipientEmail}, or ask{" "}
            {invitation.organizationName} to send a fresh invitation to the address you actually
            use.
          </p>
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <Link href={`/sign-in?invitation=${encodeURIComponent(token)}`}>
              Sign in as someone else
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Valid, and either signed in as the recipient or not signed in at all.
  const needsAccount = state.status === "needs-account";

  return (
    <AuthShell
      title={
        isOrgInvite
          ? `${invitation.organizationName} wants to work with you`
          : `You've been invited to ${invitation.organizationName}`
      }
      description={
        isOrgInvite
          ? "Accepting connects your dispatch organization to this carrier. You decide afterwards which of your people work their freight."
          : `You have been invited as ${invitation.roleName}. Here is exactly what that lets you do.`
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-3.5">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted shadow-e1"
          >
            {isOrgInvite ? (
              <Building2 className="size-[1.125rem]" />
            ) : (
              <UserRound className="size-[1.125rem]" />
            )}
          </span>
          <div className="min-w-0 text-[0.8125rem]">
            <p className="font-semibold text-fg">{invitation.roleName}</p>
            <p className="mt-0.5 text-fg-muted">
              Invitation for{" "}
              <span className="font-medium text-fg break-all">{invitation.recipientEmail}</span>
              {invitation.expiresAt
                ? ` · expires ${new Date(invitation.expiresAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}`
                : " · no expiry"}
            </p>
          </div>
        </div>

        {invitation.scopedToCarrierName ? (
          <FormAlert
            tone="info"
            role="none"
            title={`Limited to ${invitation.scopedToCarrierName}.`}
          >
            Everything below applies to this carrier relationship only. It gives them no access to
            your other carrier clients, and gives you none to theirs.
          </FormAlert>
        ) : null}

        <div>
          <h2 className="mb-2 text-[0.875rem] font-semibold text-fg">What you&apos;ll be able to do</h2>
          <PermissionSummary permissions={invitation.permissions} />
        </div>

        <SensitiveAccessWarning permissions={invitation.permissions} />

        {needsAccount ? (
          <div className="space-y-3">
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              You need an Antcolos account to accept. We&apos;ll bring you straight back here once
              it exists.
            </p>
            <Button variant="primary" size="lg" className="w-full" asChild>
              <Link href={`/sign-up?invitation=${encodeURIComponent(token)}`}>
                Create an account to accept
              </Link>
            </Button>
            <Button variant="secondary" size="lg" className="w-full" asChild>
              <Link href={`/sign-in?invitation=${encodeURIComponent(token)}`}>
                I already have an account
              </Link>
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={accept}
            disabled={accepting}
            aria-busy={accepting || undefined}
          >
            {accepting ? "Accepting…" : isOrgInvite ? "Accept and connect" : "Accept invitation"}
          </Button>
        )}
      </div>
    </AuthShell>
  );
}

function SignInLink() {
  return (
    <>
      Already have an account?{" "}
      <Link
        href="/sign-in"
        className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
      >
        Sign in
      </Link>
    </>
  );
}

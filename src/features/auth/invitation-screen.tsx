"use client";

import { Building2, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./shell";
import { SubmitButton } from "./controls";
import { FormAlert } from "./form-alert";
import { mockAcceptInvitation, mockLookUpInvitation } from "./mock-backend";

type State =
  | { status: "checking" }
  | { status: "valid"; organization: string; role: string }
  | { status: "expired"; organization: string }
  | { status: "invalid" }
  | { status: "joined"; organization: string };

/**
 * The screen an invitation link opens: /invite/<code>.
 *
 * This is the only door into an existing dispatch organization. The link is
 * resolved as soon as the page loads, so someone who was sent a dead link is
 * told immediately rather than after filling anything in.
 */
export function InvitationScreen({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "checking" });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await mockLookUpInvitation(code);
      if (cancelled) return;
      if (result.status === "valid") {
        setState({ status: "valid", organization: result.organization, role: result.role });
      } else if (result.status === "expired") {
        setState({ status: "expired", organization: result.organization });
      } else {
        setState({ status: "invalid" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleAccept() {
    if (state.status !== "valid" || joining) return;
    setJoining(true);
    await mockAcceptInvitation(code);
    setState({ status: "joined", organization: state.organization });
    setJoining(false);
  }

  const title =
    state.status === "joined"
      ? `You've joined ${state.organization}`
      : state.status === "valid"
        ? "You've been invited"
        : state.status === "checking"
          ? "Checking your invitation"
          : "This invitation can't be used";

  return (
    <AuthShell
      title={title}
      description={
        state.status === "valid"
          ? "Review the details below, then accept to join."
          : state.status === "checking"
            ? "One moment while we look up the link you opened."
            : undefined
      }
      footer={
        state.status === "invalid" || state.status === "expired" ? (
          <>
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
            >
              Sign in
            </Link>
          </>
        ) : null
      }
    >
      {state.status === "checking" ? (
        <div className="flex items-center gap-2.5 text-[0.875rem] text-fg-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Checking invitation…
        </div>
      ) : null}

      {state.status === "valid" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-4">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted shadow-e1"
            >
              <Building2 className="size-[1.125rem]" />
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold text-fg">{state.organization}</p>
              <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                Invited as <span className="font-medium text-fg">{state.role}</span>. Your access
                follows this role.
              </p>
            </div>
          </div>
          <SubmitButton
            type="button"
            pending={joining}
            pendingLabel="Joining…"
            onClick={handleAccept}
          >
            Accept invitation
          </SubmitButton>
        </div>
      ) : null}

      {state.status === "expired" ? (
        <FormAlert tone="warning" title="This invitation has expired.">
          Invitations are time limited. Ask an administrator at {state.organization} to send you a
          new one.
        </FormAlert>
      ) : null}

      {state.status === "invalid" ? (
        <FormAlert tone="danger" title="We don't recognise this invitation link.">
          It may have been withdrawn, already used, or copied incompletely. Ask whoever invited you
          to send a fresh link.
        </FormAlert>
      ) : null}

      {state.status === "joined" ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <CircleCheck className="size-5 shrink-0 text-st-success" aria-hidden />
            <p className="text-[0.8125rem] font-medium text-fg">
              You now have access to {state.organization}.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => router.push("/home")}
          >
            Go to Antcolos
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}

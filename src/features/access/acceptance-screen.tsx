"use client";

import { Ban, Building2, CircleCheck, Clock, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/shell";
import { FormAlert } from "@/features/auth/form-alert";
import { PermissionSummary, SensitiveAccessWarning } from "./permission-summary";
import { QuickOnboarding } from "@/features/driver/quick-onboarding";
import { ENGAGEMENT_DESCRIPTION, ENGAGEMENT_LABEL } from "@/features/driver/driver-rules";
import { services } from "@/lib/api";
import type { AcceptInput, InvitationLookup } from "@/lib/api/contracts/access";
import {
  ACCEPTANCE_LIMITATION, ACCEPTANCE_STEP_LABEL,
  type AcceptanceRun, type Invitation,
} from "@/types";
import { cn } from "@/lib/utils";

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
  /** What actually happened, step by step. Never a bare "done". */
  const [run, setRun] = useState<AcceptanceRun | null>(null);
  const [collecting, setCollecting] = useState(false);
  /** Set when the person turned it down. Nothing was created. */
  const [declined, setDeclined] = useState<Invitation | null>(null);

  useEffect(() => {
    let cancelled = false;
    services.access.lookUp(token, { returningFromAuth }).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [token, returningFromAuth]);

  async function accept(input: AcceptInput) {
    if (accepting) return;
    setAccepting(true);
    const result = await services.access.accept(token, { returningFromAuth }, input);
    setAccepting(false);
    if (result.status === "accepted" || result.status === "incomplete") {
      setRun(result.run);
      setCollecting(false);
      return;
    }
    if (result.status === "not-acceptable") setState(result.lookup);
  }

  async function decline() {
    const updated = await services.access.decline(token, { returningFromAuth });
    if (!updated) return;
    setCollecting(false);
    setDeclined(updated);
  }

  if (declined) {
    return (
      <AuthShell title="You declined this invitation" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="info" title={`Nothing was shared with ${declined.organizationName}.`}>
            No profile, no relationship, no documents and no access. Declining is the one answer
            that leaves everything exactly as it was.
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            {declined.organizationName} can see that you declined rather than that the link
            expired, so they know not to send it again. If you change your mind, ask them for a
            new invitation.
          </p>
        </div>
      </AuthShell>
    );
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

  if (collecting && invitation.kind === "driver") {
    return (
      <QuickOnboarding
        invitation={invitation}
        onConfirm={(decisions) => accept({
          licence: decisions.licence,
          sharedDocumentKeys: decisions.sharedDocumentKeys,
        })}
        onDecline={() => void decline()}
        failureNote={state.status === "resume"
          ? "You started this before and something did not finish. Carrying on will complete what is missing."
          : undefined}
      />
    );
  }

  if (run) return <AcceptanceOutcome run={run} invitation={invitation} onRetry={() => setCollecting(true)} router={router} />;

  if (state.status === "resume") {
    // The state that stops a half-finished acceptance locking somebody out of
    // their own retry. Only ever shown to the person whose run it is.
    return (
      <AuthShell
        title={`Finish joining ${invitation.organizationName}`}
        description="You started this before and something did not finish. Carrying on completes what is missing and repeats nothing."
      >
        <div className="space-y-4">
          <StepList run={state.run} />
          <Button
            variant="primary" size="lg" className="w-full"
            onClick={() => {
              if (invitation.kind === "driver") { setCollecting(true); return; }
              void accept({ sharedDocumentKeys: [] });
            }}
            disabled={accepting}
            aria-busy={accepting || undefined}
          >
            {accepting ? "Finishing…" : "Finish joining"}
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (state.status === "expired" || state.status === "revoked" || state.status === "used"
    || state.status === "declined") {
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
      declined: {
        title: "You declined this invitation",
        alert: `Nothing was shared with ${invitation.organizationName}.`,
        body: "No profile, no relationship, no documents and no access. If you have changed your mind, ask them for a new invitation.",
        tone: "info" as const,
        icon: Ban,
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

  if (state.status === "organization-invitation") {
    return (
      <AuthShell title="This invitation is for a whole organization" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="warning" title="This link connects two companies, not a person.">
            {invitation.organizationName} invited{" "}
            <strong className="font-medium text-fg">{invitation.recipientName}</strong> as an
            organization — a dispatch arrangement with its own scope, its own end date and its own
            per-truck permissions.
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Antcolos will not turn that into a seat for whoever opened the link, because a seat is
            not what was agreed. Contact {invitation.organizationName} and set the arrangement up
            from your own workspace.
          </p>
        </div>
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

        {invitation.engagementType ? (
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-[0.75rem] text-fg-muted">Engagement type</p>
            <p className="mt-0.5 text-[0.875rem] font-semibold text-fg">
              {ENGAGEMENT_LABEL[invitation.engagementType]}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {ENGAGEMENT_DESCRIPTION[invitation.engagementType]}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              {invitation.organizationName} set this. If it looks wrong, ask them to send a new
              invitation — it decides what paperwork you owe them.
            </p>
          </div>
        ) : null}

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
            onClick={() => {
              if (invitation.kind === "driver") { setCollecting(true); return; }
              void accept({ sharedDocumentKeys: [] });
            }}
            disabled={accepting}
            aria-busy={accepting || undefined}
          >
            {accepting ? "Accepting…" : isOrgInvite ? "Accept and connect" : "Accept invitation"}
          </Button>
        )}

        {/*
          * Turning it down is an answer, so it is offered here as well as on
          * the driver's consent screen. An agreement nobody can refuse is not
          * one, and a link whose only exits are "accept" or "close the tab"
          * leaves the sender re-sending it forever.
          */}
        {!isOrgInvite ? (
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => void decline()}
            disabled={accepting}
            data-testid="decline-invitation"
          >
            No thanks — decline this invitation
          </Button>
        ) : null}
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

/**
 * What acceptance actually did, one record at a time.
 *
 * Shown instead of "you've joined", because "you've joined" is a claim and this
 * is a report. Five different modules were asked for five different things and
 * they do not all have to have said yes — a person whose portal seat failed is
 * genuinely connected to the carrier and genuinely cannot sign in, and telling
 * them they have joined would be the most useful-looking lie the product could
 * tell them.
 */
function StepList({ run }: { run: AcceptanceRun }) {
  return (
    <ul className="space-y-2" data-testid="acceptance-steps">
      {run.steps.map((step) => {
        const ok = step.state === "done";
        const skipped = step.state === "not_applicable";
        return (
          <li
            key={step.key}
            data-step={step.key}
            data-state={step.state}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
              ok && "border-st-success/35 bg-st-success-bg/40",
              skipped && "border-border bg-surface-sunken",
              !ok && !skipped && "border-st-danger/35 bg-st-danger-bg/40",
            )}
          >
            {ok ? (
              <CircleCheck className="mt-px size-4 shrink-0 text-st-success" aria-hidden />
            ) : skipped ? (
              <Ban className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            ) : (
              <Clock className="mt-px size-4 shrink-0 text-st-danger" aria-hidden />
            )}
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">{ACCEPTANCE_STEP_LABEL[step.key]}</p>
              <p className="mt-0.5 leading-relaxed text-fg-muted">{step.detail}</p>
              {step.failureReason ? (
                <p className="mt-1 leading-relaxed text-st-danger">{step.failureReason}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AcceptanceOutcome({
  run,
  invitation,
  onRetry,
  router,
}: {
  run: AcceptanceRun;
  invitation: Invitation;
  onRetry: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const finished = Boolean(run.completedAt);
  const accepted = new Date(run.acceptedAt).toLocaleDateString(undefined, {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <AuthShell
      title={finished
        ? `You've joined ${invitation.organizationName}`
        : "Almost there"}
      description={finished
        // The sentence the whole date decision was about. Accepting is the
        // person saying yes; being started is the carrier's separate act, and
        // conflating them is how a migrated workforce looks freshly hired.
        ? `Invitation accepted on ${accepted}. ${invitation.organizationName} has not activated your relationship yet — until they do, you are connected but not yet working under their authority.`
        : "Some of what accepting creates did not finish. Nothing was lost, and carrying on completes what is missing."}
    >
      <div className="space-y-4" data-testid={finished ? "acceptance-confirmed" : undefined}>
        <StepList run={run} />

        {finished ? (
          <>
            {/*
              * ★ AN ABSENT START DATE, SAID OUT LOUD ★
              * `startedAt` is deliberately not set by accepting, so the screen
              * states it rather than showing an empty field somebody would
              * read as a bug — or worse, as today's date.
              */}
            <p
              data-testid="no-start-date"
              className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3 text-[0.8125rem] leading-relaxed text-fg-muted"
            >
              <span className="font-semibold text-fg">Your start date: </span>
              Not recorded yet. {invitation.organizationName} sets it when they activate you.
            </p>
            <WithheldDocuments run={run} />
          </>
        ) : null}

        {finished ? (
          /**
           * Two ways on, and the order is the point.
           *
           * The next thing a newly-connected driver has to do is their
           * paperwork — the carrier cannot activate them until it is done — so
           * that is the primary action, as it was before this flow changed.
           * The portal is offered beside it rather than instead of it.
           */
          <div className="space-y-2.5">
            <Button
              variant="primary" size="lg" className="w-full"
              onClick={() => router.push(
                invitation.kind === "driver" ? "/driver/documents" : "/home",
              )}
            >
              {invitation.kind === "driver" ? "Go to my documents" : "Go to Antcolos"}
            </Button>
            {invitation.kind === "driver" ? (
              <Button
                variant="secondary" size="lg" className="w-full"
                onClick={() => router.push("/driver/home")}
              >
                Go to my driver portal
              </Button>
            ) : null}
          </div>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={onRetry}>
            Finish joining
          </Button>
        )}

        <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
          {ACCEPTANCE_LIMITATION}
        </p>
      </div>
    </AuthShell>
  );
}

/**
 * What acceptance deliberately did NOT hand over.
 *
 * Restricted paperwork — a social security number, bank details, a state
 * driving record, a substance-testing record — is never shared as a side
 * effect of joining. Access to one of those is its own decision, per document,
 * for a stated reason, by somebody who holds the permission for it.
 *
 * Shown rather than silently omitted: a list shorter than the one somebody
 * just ticked, with no explanation, is how people conclude the product lost
 * their documents.
 */
function WithheldDocuments({ run }: { run: AcceptanceRun }) {
  const withheld = run.steps.find((s) => s.key === "document_access")?.withheld;
  if (!withheld || withheld.length === 0) return null;

  return (
    <section
      data-testid="withheld-documents"
      className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3"
    >
      <h2 className="text-[0.8125rem] font-semibold text-fg">
        Not shared with them
      </h2>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
        Joining does not hand these over. They are asked for separately, one at a
        time, for a reason somebody writes down.
      </p>
      <ul className="mt-2 space-y-1.5">
        {withheld.map((document) => (
          <li key={document.key} className="text-[0.75rem] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{document.label}</span>
            {document.reason ? ` — ${document.reason}` : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

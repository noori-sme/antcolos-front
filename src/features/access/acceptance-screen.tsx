"use client";

import {
  Ban, Building2, CircleCheck, Clock, LoaderCircle, ShieldAlert, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/shell";
import { FormAlert } from "@/features/auth/form-alert";
import { PermissionSummary, SensitiveAccessWarning } from "./permission-summary";
import { ENGAGEMENT_DESCRIPTION, ENGAGEMENT_LABEL } from "@/features/driver/driver-rules";
import {
  type DriverIdentityDraft,
  driverIdentityErrors,
  driverIdentityIsComplete,
  emptyDriverIdentity,
  normalizeDriverIdentity,
} from "@/features/driver/identity";
import { DriverIdentityFields } from "@/features/driver/identity-fields";
import { useSession } from "@/lib/session/hooks";
import { readSessionScenario } from "@/lib/session/scenarios";
import { profileForUser } from "@/lib/api/mock/driver-registry";
import { acceptInvitation, resolveInvitation } from "@/lib/api/mock/access-service";
import type { AcceptanceOutcome, AcceptingIdentity, InvitationResolution } from "@/lib/api/contracts/access";
import type { Invitation } from "@/types";

/**
 * The screen an invitation link opens.
 *
 * ★ WHAT CHANGED HERE, AND WHY IT IS THE WHOLE POINT ★
 *
 * This screen used to resolve and "accept" an invitation against a fixture that
 * flipped a status string. Nothing was created: no seat, no profile, no
 * engagement, no audit entry. A driver who accepted was shown a success page
 * and still belonged to nothing.
 *
 * Now every decision belongs to the Access service and this screen only shows
 * them. In particular it does NOT decide who the accepter is: the identity
 * comes from the session boundary and is handed over whole, so an invitation
 * cannot attach itself to whoever happens to have the link open.
 *
 * The one thing this screen still owns is the licence questions, because a
 * brand-new driver has to answer them before there is a profile to point a seat
 * at. They are collected BEFORE accepting, not after, so the acceptance is one
 * act rather than a seat followed by a form somebody can walk away from.
 */
export function InvitationAcceptanceScreen({ token }: { token: string }) {
  const router = useRouter();
  const { user } = useSession();

  const identity = useMemo<AcceptingIdentity>(() => ({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    scenario: readSessionScenario(),
  }), [user]);

  const [state, setState] = useState<InvitationResolution | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [outcome, setOutcome] = useState<AcceptanceOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [draft, setDraft] = useState<DriverIdentityDraft>(emptyDriverIdentity);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveInvitation(token, identity).then((result) => {
      if (cancelled) return;
      setState(result);
      // An acceptance that already happened is shown as what it produced,
      // not as a fresh offer. This is the idempotent read.
      if (result.status === "already_accepted") {
        void acceptInvitation(token, identity).then((replay) => {
          if (!cancelled && replay.status !== "refused") setOutcome(replay.outcome);
        });
      }
    });
    return () => { cancelled = true; };
  }, [token, identity]);

  const invitation = state && "invitation" in state ? state.invitation : undefined;
  const isDriver = invitation?.kind === "driver";
  /**
   * Does this person already have a permanent profile?
   *
   * If they do they are never asked for their licence again — not on a second
   * carrier, not on a tenth. That is the rule `createOrResumeProfile` enforces;
   * this only decides whether to show the questions at all.
   */
  const hasProfile = isDriver ? profileForUser(user.id) !== undefined : true;
  const needsLicence = isDriver && !hasProfile;

  const accept = useCallback(async () => {
    if (!invitation || accepting) return;
    if (needsLicence) {
      setSubmitted(true);
      if (!driverIdentityIsComplete(draft)) return;
    }
    setAccepting(true);
    setFailure(null);
    const result = await acceptInvitation(token, identity, {
      driverIdentity: needsLicence
        ? { ...normalizeDriverIdentity(draft) }
        : undefined,
    });
    setAccepting(false);
    if (result.status === "refused") {
      setFailure(result.message);
      // Re-resolve so the screen shows the state the refusal came from.
      setState(await resolveInvitation(token, identity));
      return;
    }
    setOutcome(result.outcome);
  }, [invitation, accepting, needsLicence, draft, token, identity]);

  /* ---- loading ---------------------------------------------------------- */

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

  /* ---- accepted --------------------------------------------------------- */

  if (outcome) return <AcceptedPanel outcome={outcome} onContinue={() => router.push("/home")} />;

  /* ---- refusals --------------------------------------------------------- */

  if (state.status === "refused") {
    return (
      <RefusalPanel
        refusal={state.refusal}
        message={state.message}
        invitation={state.invitation}
        signedInAs={state.signedInAs}
        token={token}
      />
    );
  }

  if (state.status === "already_accepted") {
    return (
      <AuthShell title="You have already accepted this" footer={<SignInLink />}>
        <div className="flex items-center gap-2.5 text-[0.875rem] text-fg-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Opening what it gave you…
        </div>
      </AuthShell>
    );
  }

  /* ---- ready ------------------------------------------------------------ */

  const offer = state.invitation;

  return (
    <AuthShell
      title={`You've been invited to ${offer.organizationName}`}
      description={`You have been invited as ${offer.roleName}. Here is exactly what that lets you do.`}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-3.5">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted shadow-e1"
          >
            <UserRound className="size-[1.125rem]" />
          </span>
          <div className="min-w-0 text-[0.8125rem]">
            <p className="font-semibold text-fg">{offer.roleName}</p>
            <p className="mt-0.5 text-fg-muted">
              Invitation for{" "}
              <span className="font-medium text-fg break-all">{offer.recipientEmail}</span>
              {offer.expiresAt
                ? ` · expires ${new Date(offer.expiresAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric",
                  })}`
                : " · no expiry"}
            </p>
            <p className="mt-0.5 text-fg-subtle">
              Sent by {offer.invitedByName}.
            </p>
          </div>
        </div>

        {offer.engagementType ? (
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-[0.75rem] text-fg-muted">Engagement type</p>
            <p className="mt-0.5 text-[0.875rem] font-semibold text-fg">
              {ENGAGEMENT_LABEL[offer.engagementType]}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {ENGAGEMENT_DESCRIPTION[offer.engagementType]}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              {offer.organizationName} set this. If it looks wrong, ask them to send a new
              invitation — it decides what paperwork you owe them.
            </p>
          </div>
        ) : null}

        <div>
          <h2 className="mb-2 text-[0.875rem] font-semibold text-fg">What you&apos;ll be able to do</h2>
          <PermissionSummary permissions={offer.permissions} />
        </div>

        <SensitiveAccessWarning permissions={offer.permissions} />

        {isDriver ? <AcceptingIsNotStartingNote organizationName={offer.organizationName} /> : null}

        {needsLicence ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3.5">
            <div>
              <h2 className="text-[0.875rem] font-semibold text-fg">Set up your driver profile</h2>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                Four things, once. This profile is yours — it stays with you if you move carriers,
                and you never fill it in twice.
              </p>
            </div>
            <DriverIdentityFields
              draft={draft}
              onChange={setDraft}
              errors={
                submitted
                  ? driverIdentityErrors(draft)
                  : { legalName: null, cdlNumber: null, cdlState: null, cdlExpiresAt: null }
              }
            />
          </div>
        ) : null}

        {failure ? (
          <FormAlert tone="danger" title="We could not accept this invitation.">
            {failure}
          </FormAlert>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={accept}
          disabled={accepting}
          aria-busy={accepting || undefined}
          data-testid="accept-invitation"
        >
          {accepting ? "Accepting…" : "Accept invitation"}
        </Button>
      </div>
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Accepting is not starting                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Said out loud, on the screen, before anybody clicks.
 *
 * The product records an acceptance date and deliberately records NO start
 * date, because nobody knows one yet. A driver who was told "you're in" and
 * then could not take a load would reasonably think something had broken; this
 * is the sentence that makes the two states different on purpose.
 */
function AcceptingIsNotStartingNote({ organizationName }: { organizationName: string }) {
  return (
    <div className="rounded-md border border-st-info/35 bg-st-info-bg/50 px-3.5 py-3 text-[0.8125rem] leading-relaxed">
      <p className="font-medium text-fg">Accepting is not the same as starting.</p>
      <p className="mt-0.5 text-fg-muted">
        Saying yes records that you have agreed to work with {organizationName}. Your start date is
        recorded when you actually start — not today — so nothing here guesses it for you.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Refusals                                                                    */
/* -------------------------------------------------------------------------- */

function RefusalPanel({
  refusal, message, invitation, signedInAs, token,
}: {
  refusal: string;
  message: string;
  invitation?: Invitation;
  signedInAs?: string;
  token: string;
}) {
  if (refusal === "wrong_recipient" && invitation) {
    // An address with no Antcolos account behind it is a different sentence
    // from an address that belongs to somebody else. Both are refusals; only
    // one of them has a way forward on this screen.
    const noAccountYet = !invitation.recipientHasAccount;
    return (
      <AuthShell
        title={noAccountYet ? "This invitation needs its own account" : "This invitation isn't for this account"}
        footer={<SignInLink />}
      >
        <div className="space-y-4">
          <FormAlert
            tone={noAccountYet ? "warning" : "danger"}
            title={noAccountYet ? "Nobody has signed up with this address yet." : "You are signed in as somebody else."}
          >
            This invitation was sent to{" "}
            <strong className="font-medium text-fg">{invitation.recipientEmail}</strong>
            {signedInAs ? (
              <>
                , but you are signed in as{" "}
                <strong className="font-medium text-fg">{signedInAs}</strong>
              </>
            ) : null}
            . We will not attach it to the wrong account.
          </FormAlert>
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link href={`/sign-up?invitation=${encodeURIComponent(token)}`}>
              Create the account it was sent to
            </Link>
          </Button>
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <Link href={`/sign-in?invitation=${encodeURIComponent(token)}`}>
              Sign in as someone else
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const TONE: Record<string, { title: string; tone: "danger" | "warning" | "info"; icon: typeof Ban }> = {
    not_found: { title: "This invitation link doesn't work", tone: "danger", icon: Ban },
    expired: { title: "This invitation has expired", tone: "warning", icon: Clock },
    revoked: { title: "This invitation was withdrawn", tone: "danger", icon: Ban },
    already_accepted_by_other: { title: "This invitation has already been used", tone: "warning", icon: CircleCheck },
    needs_account: { title: "Sign in to accept this invitation", tone: "info", icon: UserRound },
    unknown_organization: { title: "We can't reach that organization", tone: "danger", icon: Building2 },
    organization_invitation_unsupported: {
      title: "This one connects two companies", tone: "info", icon: ShieldAlert,
    },
    needs_driver_profile: { title: "One more step first", tone: "info", icon: UserRound },
  };
  const copy = TONE[refusal] ?? { title: "This invitation cannot be used", tone: "danger" as const, icon: Ban };

  return (
    <AuthShell title={copy.title} footer={<SignInLink />}>
      <div className="space-y-4">
        <FormAlert tone={copy.tone} title={message}>
          {refusal === "organization_invitation_unsupported" ? (
            <>
              Connecting a dispatch organization to a carrier is not a seat in a workspace. The
              carrier grants it per truck, from the truck it concerns, and can end it the same way.
              Ask {invitation?.organizationName ?? "the carrier"} to grant dispatch access there
              instead.
            </>
          ) : (
            <>
              Ask {invitation?.organizationName ?? "whoever invited you"} to send a new link.
            </>
          )}
        </FormAlert>
      </div>
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/* What accepting produced                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Shows what was actually created, including what was NOT.
 *
 * Two things here are deliberate. "No start date recorded yet" is stated rather
 * than left as a blank field, because an empty date reads as a bug and this one
 * is a decision. And the withheld paperwork is listed by name: a person who
 * just saw a checklist and then sees a shorter shared list needs to be told the
 * difference was on purpose, not lost.
 */
function AcceptedPanel({
  outcome, onContinue,
}: { outcome: AcceptanceOutcome; onContinue: () => void }) {
  const { invitation, relationship, sharedDocuments, withheldDocuments } = outcome;
  return (
    <AuthShell
      title={`You've joined ${invitation.organizationName}`}
      description="Your access is active. It is already in your workspace switcher — no reload needed."
    >
      <div className="space-y-4">
        <div
          className="flex items-center gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5"
          data-testid="acceptance-confirmed"
        >
          <CircleCheck className="size-5 shrink-0 text-st-success" aria-hidden />
          <p className="text-[0.8125rem] font-medium text-fg">
            Invitation accepted as {invitation.roleName}.
          </p>
        </div>

        <dl className="overflow-hidden rounded-lg border border-border divide-y divide-border">
          <Row label="Accepted" value={formatWhen(invitation.acceptedAt)} />
          {relationship ? (
            <>
              <Row
                label="Engagement"
                value={`${ENGAGEMENT_LABEL[relationship.engagementType]} · ${labelForStatus(relationship.status)}`}
              />
              <Row
                label="Start date"
                value="Not recorded yet — you have accepted, you have not started."
                testId="no-start-date"
              />
            </>
          ) : null}
          {outcome.driverProfileResumed !== undefined ? (
            <Row
              label="Driver profile"
              value={
                outcome.driverProfileResumed
                  ? "Your existing profile — reused, not duplicated."
                  : "Created. It is yours and follows you between carriers."
              }
            />
          ) : null}
        </dl>

        {relationship ? (
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <h2 className="text-[0.875rem] font-semibold text-fg">What you shared</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
              {sharedDocuments.length > 0
                ? sharedDocuments.map((doc) => doc.label).join(" · ")
                : "Nothing yet — you have no paperwork on file to share."}
            </p>
            {withheldDocuments.length > 0 ? (
              <div
                className="mt-3 rounded-md border border-border bg-surface-sunken px-3 py-2.5"
                data-testid="withheld-documents"
              >
                <p className="text-[0.8125rem] font-medium text-fg">
                  Not shared by accepting
                </p>
                <ul className="mt-1 space-y-1.5">
                  {withheldDocuments.map((doc) => (
                    <li key={doc.key} className="text-[0.75rem] leading-relaxed text-fg-muted">
                      <span className="font-medium text-fg">{doc.label}</span>
                      {doc.reason ? ` — ${doc.reason}` : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                  {invitation.organizationName} still needs these. Handing one over is its own
                  decision, asked for separately — never a consequence of joining.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <Button variant="primary" size="lg" className="w-full" onClick={onContinue}>
          Go to Antcolos
        </Button>
      </div>
    </AuthShell>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="px-3.5 py-2.5" data-testid={testId}>
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg">{value}</dd>
    </div>
  );
}

function formatWhen(iso?: string): string {
  if (!iso) return "Just now";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function labelForStatus(status: string): string {
  return status === "onboarding" ? "Onboarding — not yet active" : status;
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

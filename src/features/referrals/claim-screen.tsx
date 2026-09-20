"use client";

import { Check, Flag, ShieldAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSkeleton } from "@/components/data/states";
import { services } from "@/lib/api";
import { useSession } from "@/lib/session/hooks";
import type { CandidateReferralView } from "@/types";
import type { ReferralClaimLookup } from "@/lib/api/contracts/referrals";
import { useReferringIdentity } from "./identity";

/**
 * The page the referred person opens.
 *
 * ★ THE ONE THING THIS SCREEN MUST NEVER LOSE ★
 * `view.disclaimer` — creating an Antcolos account is theirs and permanent, and
 * it does not mean the company accepted them, hired them, or gave them
 * anything. It is rendered from the domain constant rather than typed here, so
 * it cannot be quietly softened on one screen.
 *
 * Every refusal is a sentence, never a blank page: an expired link, a used one,
 * a withdrawn introduction and a link addressed to somebody else all say
 * different things, because the person on the other end needs a different next
 * step for each.
 *
 * ★ REPORTING WORKS WITHOUT AN ACCOUNT ★
 * The report action does not require signing in. Making somebody join the thing
 * that is emailing them before they can ask it to stop is not an opt-out.
 */
export function ReferralClaimScreen({
  token, reportFirst,
}: { token: string; reportFirst?: boolean }) {
  const { user } = useSession();
  const identity = useReferringIdentity();
  const [lookup, setLookup] = useState<ReferralClaimLookup | null>(null);
  const [outcome, setOutcome] = useState<"claimed" | "declined" | "reported" | null>(null);
  const [reporting, setReporting] = useState(Boolean(reportFirst));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `identity` is passed when there is a signed-in account, which in this build
  // is always. A real product resolves anonymously first and only then asks.
  useEffect(() => {
    let cancelled = false;
    services.referrals.lookUpClaim(token, identity).then((result) => {
      if (!cancelled) setLookup(result);
    });
    return () => {
      cancelled = true;
    };
  }, [token, identity]);

  async function claim() {
    setBusy(true);
    setError(null);
    const result = await services.referrals.claim(token, identity);
    setBusy(false);
    if (result.status === "refused") {
      setError(result.message);
      return;
    }
    setOutcome("claimed");
  }

  async function decline() {
    setBusy(true);
    setError(null);
    const result = await services.referrals.decline(token, identity);
    setBusy(false);
    if (result.status === "refused") {
      setError(result.message);
      return;
    }
    setOutcome("declined");
  }

  async function report() {
    setBusy(true);
    setError(null);
    const result = await services.referrals.reportUnwanted(token, reason.trim() || undefined);
    setBusy(false);
    if (result.status === "refused") {
      setError(result.message);
      return;
    }
    setOutcome("reported");
  }

  if (outcome) return <Outcome outcome={outcome} />;
  if (lookup === null) {
    return <Card><LoadingSkeleton rows={3} /></Card>;
  }

  if (lookup.status === "refused") {
    return (
      <Card>
        <h1 className="text-[1.125rem] font-semibold text-fg">
          We can&apos;t open this introduction
        </h1>
        <p className="mt-2 text-[0.875rem] text-fg-muted">{lookup.message}</p>
        {/* Reporting stays available even on a refusal, because an expired link
            is exactly when somebody gets round to saying "stop emailing me". */}
        <ReportBlock
          open={reporting}
          onOpen={() => setReporting(true)}
          reason={reason}
          setReason={setReason}
          onSubmit={report}
          busy={busy}
        />
        {error ? <Alert>{error}</Alert> : null}
      </Card>
    );
  }

  const view: CandidateReferralView = lookup.view;

  return (
    <Card>
      <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">
        Introduction · {view.reference}
      </p>
      <h1 className="mt-2 text-[1.125rem] font-semibold text-fg">
        {view.referrerName} referred you to {view.targetOrganizationName}
      </h1>
      <p className="mt-2 text-[0.875rem] text-fg-muted">
        They suggested you for <strong className="text-fg">{view.proposedTitle}</strong>.
      </p>
      {view.note ? (
        <blockquote className="mt-3 border-l-2 border-border-strong pl-3 text-[0.8125rem] text-fg-muted">
          {view.note}
        </blockquote>
      ) : null}

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-surface-sunken px-3 py-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
        <p className="text-[0.8125rem] text-fg-muted">{view.disclaimer}</p>
      </div>

      {lookup.status === "needs-account" ? (
        <div className="mt-5 space-y-3">
          <p className="text-[0.875rem] text-fg">
            Create your Antcolos account, or sign in to the one you already have,
            and we will bring you straight back here.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" asChild>
              <Link href={`/sign-up?referral=${encodeURIComponent(token)}`}>
                <UserPlus aria-hidden />
                Create an account
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/sign-in?referral=${encodeURIComponent(token)}`}>Sign in</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <p className="text-[0.875rem] text-fg">
            Signed in as <strong>{user.email}</strong>. Connecting this
            introduction to your account does not share your profile or your
            documents with anybody.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={claim} disabled={busy}>
              <Check aria-hidden />
              Connect my account
            </Button>
            <Button variant="ghost" onClick={decline} disabled={busy}>
              No thanks
            </Button>
          </div>
        </div>
      )}

      <p className="mt-4 text-[0.75rem] text-fg-subtle">
        This link works until {new Date(view.expiresAt).toLocaleDateString()} and
        can only be used once.
      </p>

      <ReportBlock
        open={reporting}
        onOpen={() => setReporting(true)}
        reason={reason}
        setReason={setReason}
        onSubmit={report}
        busy={busy}
      />
      {error ? <Alert>{error}</Alert> : null}
    </Card>
  );
}

function ReportBlock({
  open, onOpen, reason, setReason, onSubmit, busy,
}: {
  open: boolean;
  onOpen: () => void;
  reason: string;
  setReason: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mt-5 inline-flex items-center gap-1.5 text-[0.75rem] text-fg-subtle underline underline-offset-2 hover:text-fg-muted"
      >
        <Flag className="size-3.5" aria-hidden />
        I did not expect this
      </button>
    );
  }
  return (
    <div className="mt-5 space-y-2 rounded-md border border-border bg-surface-sunken p-3">
      <p className="text-[0.8125rem] font-semibold text-fg">Report this introduction</p>
      <p className="text-[0.75rem] text-fg-muted">
        We will stop sending you referral email. You do not need an Antcolos
        account to do this.
      </p>
      <Textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What happened? (optional)"
      />
      <Button variant="secondary" size="sm" onClick={onSubmit} disabled={busy}>
        Report and stop these emails
      </Button>
    </div>
  );
}

function Outcome({ outcome }: { outcome: "claimed" | "declined" | "reported" }) {
  const copy = {
    claimed: {
      title: "Your account is connected",
      body: "Your Antcolos account is yours and stays yours. The company decides "
        + "separately whether to go further, and nothing about your account "
        + "changes either way.",
    },
    declined: {
      title: "We have told them no",
      body: "Nothing was created, and nothing about you was shared. If you have "
        + "an Antcolos account, it is unaffected.",
    },
    reported: {
      title: "Reported — and we will stop",
      body: "Your address will not receive referral email from Antcolos again. "
        + "We have kept a record of the report.",
    },
  }[outcome];

  return (
    <Card>
      <h1 className="text-[1.125rem] font-semibold text-fg">{copy.title}</h1>
      <p className="mt-2 text-[0.875rem] text-fg-muted">{copy.body}</p>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-e1">
      {children}
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 text-[0.8125rem] text-st-danger">{children}</p>
  );
}

"use client";

import {
  Check, Inbox, Mail, Phone, ShieldAlert, UserPlus, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  CANDIDATE_CLAIM_VISIBILITY_LABEL, COMPANY_ACCEPT_MEANS, COMPANY_STATE_LABEL,
  type CompanyReferralView,
} from "@/types";

/**
 * The company's referral inbox.
 *
 * ★ THE SENTENCE THIS SCREEN EXISTS TO KEEP SAYING ★
 * Accepting means "we are interested". It creates no membership, no
 * permissions, no engagement and no employment, and it gives nobody access to
 * anything. The screen says so beside the button, not in a help article, and
 * the string comes from the domain types so it cannot be softened here without
 * being softened everywhere.
 *
 * What the company can see about the candidate's side is three values wide —
 * `CANDIDATE_CLAIM_VISIBILITY_LABEL` — and that is the whole of it. Whether the
 * person's address already had an Antcolos account, whether the email bounced,
 * and whether they reported the introduction are not on this screen and are not
 * in the data it receives.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function CompanyReferralInbox() {
  const ctx = useServiceContext();
  const [rows, setRows] = useState<CompanyReferralView[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!ctx) return undefined;
    let cancelled = false;
    services.referrals.companyInbox(ctx).then((list) => {
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(load, [load]);

  async function decide(id: string, decision: "accept" | "reject") {
    if (!ctx) return;
    setBusy(true);
    setMessage(null);
    const result = decision === "accept"
      ? await services.referrals.accept(ctx, id, note.trim() || undefined)
      : await services.referrals.reject(ctx, id, note.trim() || undefined);
    setBusy(false);
    if (result.status === "refused") {
      setMessage(result.message);
      return;
    }
    setNote("");
    setRows((prev) => prev?.map((r) => (r.id === id ? result.view : r)) ?? null);
  }

  const pending = (rows ?? []).filter((r) => r.company.state === "pending_review");
  const decided = (rows ?? []).filter((r) => r.company.state !== "pending_review");

  return (
    <div className="space-y-section">
      <PageHeader
        title="Referrals"
        description="People somebody outside this company introduced to it. An introduction is not an application, and deciding on one gives nobody access to anything."
      />

      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-st-danger/35 bg-st-danger-bg/40 px-4 py-3 text-[0.8125rem] text-fg"
        >
          {message}
        </p>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
        <p className="text-[0.8125rem] text-fg-muted">{COMPANY_ACCEPT_MEANS}</p>
      </div>

      {rows === null ? <LoadingSkeleton /> : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No referrals yet"
          description="When somebody introduces a person to this company, it arrives here for a decision."
        />
      ) : (
        <>
          <Section title="Waiting on you" empty="Nothing waiting.">
            {pending.map((row) => (
              <ReferralCard
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                note={note}
                setNote={setNote}
                busy={busy}
                onDecide={decide}
              />
            ))}
          </Section>

          {decided.length > 0 ? (
            <Section title="Decided" empty="">
              {decided.map((row) => (
                <ReferralCard
                  key={row.id}
                  row={row}
                  open={openId === row.id}
                  onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                  note={note}
                  setNote={setNote}
                  busy={busy}
                  onDecide={decide}
                />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({
  title, empty, children,
}: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[0.8125rem] font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </h2>
      {children.length === 0
        ? (empty ? <p className="text-[0.8125rem] text-fg-subtle">{empty}</p> : null)
        : <ul className="space-y-2">{children}</ul>}
    </section>
  );
}

function ReferralCard({
  row, open, onToggle, note, setNote, busy, onDecide,
}: {
  row: CompanyReferralView;
  open: boolean;
  onToggle: () => void;
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  onDecide: (id: string, decision: "accept" | "reject") => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <p className="text-[0.9375rem] font-semibold text-fg">{row.candidateName}</p>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Proposed as {row.proposedTitle} · referred by {row.referrerName}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
            {formatDate(row.submittedAt)} · {row.reference}
          </p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge
            tone={row.company.state === "accepted" ? "success"
              : row.company.state === "rejected" ? "outline" : "info"}
          >
            {COMPANY_STATE_LABEL[row.company.state]}
          </Badge>
          {/* Three values wide, and never more. */}
          <span className="text-[0.75rem] text-fg-subtle">
            {CANDIDATE_CLAIM_VISIBILITY_LABEL[row.candidateClaim]}
          </span>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <dl className="grid gap-2 sm:grid-cols-2">
            <ContactRow icon={Mail} label="Email" value={row.candidateEmail} />
            <ContactRow icon={Phone} label="Phone" value={row.candidatePhone} />
          </dl>
          <p className="text-[0.75rem] text-fg-subtle">
            Submitted by the person who made the introduction. It has not been
            verified and is not this person&apos;s Antcolos profile.
          </p>

          {row.note ? (
            <blockquote className="border-l-2 border-border-strong pl-3 text-[0.8125rem] text-fg-muted">
              {row.note}
            </blockquote>
          ) : null}

          {row.canDecide ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="A note for your team (optional). Never shown to the referrer or the person."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDecide(row.id, "accept")}
                >
                  <Check aria-hidden />
                  We are interested
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDecide(row.id, "reject")}
                >
                  <X aria-hidden />
                  Not proceeding
                </Button>
              </div>
            </div>
          ) : null}

          {row.canStartInvitation ? (
            <div className="rounded-md border border-st-info/35 bg-st-info-bg/40 p-3">
              <p className="text-[0.8125rem] font-semibold text-fg">
                Interested is not invited
              </p>
              <p className="mt-1 text-[0.8125rem] text-fg-muted">
                Nobody has been given a seat, a role or an engagement. To bring
                this person in, start the normal invitation — you will still
                choose the engagement type, the permissions, the agreements and
                the documents there.
              </p>
              <Button variant="secondary" size="sm" className="mt-3" asChild>
                <Link href={`/settings/invitations/new?referral=${row.id}`}>
                  <UserPlus aria-hidden />
                  Start the invitation
                </Link>
              </Button>
            </div>
          ) : null}

          {row.resultingInvitationId ? (
            <p className="text-[0.8125rem] text-fg-muted">
              An invitation was sent from this referral. What happens next belongs
              to that invitation.
            </p>
          ) : null}

          {row.events.length > 0 ? (
            <ol className="space-y-1.5">
              {row.events.map((e) => (
                <li key={e.id} className="text-[0.75rem] text-fg-subtle">
                  {formatDate(e.at)} — {e.summary}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ContactRow({
  icon: Icon, label, value,
}: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.8125rem]">
      <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <span className="text-fg-subtle">{label}</span>
      <span className="min-w-0 truncate text-fg">{value}</span>
    </div>
  );
}

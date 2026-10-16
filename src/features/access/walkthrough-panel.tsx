"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * A walkthrough you can actually press, on the screen the flow starts from.
 *
 * ★ WHY THIS EXISTS AND WHY IT IS NOT A BACKDOOR ★
 *
 * PR-1 could not show a granted seat reaching the product without a
 * development-only `window.__antcolosFixtures` bridge, because nothing in the
 * product granted one. PR-2 removes that need: every step below is an ordinary
 * link to an ordinary screen, pressed by an ordinary person, and the only
 * unusual thing about any of them is `?fixture=newcomer` — the fixture switch
 * that already existed, which chooses WHICH mock person the tab runs as and
 * grants nothing.
 *
 * So this panel adds no capability. It is signposting: without it, walking the
 * arc means knowing that one seeded invitation is addressed to the newcomer
 * fixture, and that is knowledge a reviewer should not have to have.
 */
export function WalkthroughPanel() {
  const [open, setOpen] = useState(false);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface-sunken">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="min-w-0">
          <span className="block text-[0.875rem] font-semibold text-fg">
            Walk the whole thing end to end
          </span>
          <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">
            Issue, accept as the person it was addressed to, then try to break it.
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <ol className="space-y-3 border-t border-border px-3.5 py-3.5 text-[0.8125rem] leading-relaxed">
          <Step n={1} title="Issue one yourself">
            <Link href="/settings/invitations/new" className="text-primary underline-offset-4 hover:underline">
              Invite someone
            </Link>{" "}
            — the form now refuses anything you do not hold yourself, and records both the
            invitation and the refusal.
          </Step>

          <Step n={2} title="Accept it as the person it names">
            A seeded invitation is already addressed to Alex Rivera, a real account that belongs to
            nothing.{" "}
            <Walk href="/invitations/accept/INV-NEWDRIVER?fixture=newcomer">Open it as Alex</Walk> — set up
            the driver profile, accept, and watch the seat appear.
          </Step>

          <Step n={3} title="See what it produced">
            As Alex, <Walk href="/home?fixture=newcomer">Home</Walk> now resolves to Northline and
            the workspace switcher carries it. No reload happened at any point.
          </Step>

          <Step n={4} title="Try it as the wrong person">
            <Walk href="/invitations/accept/INV-NEWDRIVER">Open Alex&apos;s link as yourself</Walk>. It is
            refused, by name, rather than quietly attaching to your account.
          </Step>

          <Step n={5} title="Accept it twice">
            Open <Walk href="/invitations/accept/INV-NEWDRIVER?fixture=newcomer">the same link again as
            Alex</Walk>. One seat, one profile, one engagement — it shows you what already exists
            instead of making a second one.
          </Step>

          <Step n={6} title="Take the access away">
            Back as yourself, <Link href="/settings/users" className="text-primary underline-offset-4 hover:underline">
              People
            </Link>{" "}
            lists who is in this organization. Remove Alex, then open{" "}
            <Walk href="/home?fixture=newcomer">their Home</Walk> again: the workspace is gone, and
            their driver profile and documents are not.
          </Step>

          <Step n={7} title="The two edges">
            A person already in another organization keeps both — accept{" "}
            <Walk href="/invitations/accept/INV-DRIVER-ACCT">the invitation addressed to you</Walk> and the
            switcher grows rather than swaps. And a solo owner cannot be removed from their own
            workspace: try it on{" "}
            <Link href="/settings/users" className="text-primary underline-offset-4 hover:underline">
              People
            </Link>{" "}
            after switching to Sam Murtaza — Dispatch.
          </Step>

          <li className="rounded-md border border-border bg-surface px-3 py-2.5 text-[0.75rem] text-fg-muted">
            <span className="font-medium text-fg">About <code>?fixture=newcomer</code>:</span> it
            chooses which mock person the tab runs as, exactly as it did before this change. It is
            not a sign-in and it grants nothing — every seat below is created by pressing Accept.
          </li>
        </ol>
      ) : null}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[0.6875rem] font-semibold text-fg-muted shadow-e1 tabular-nums"
      >
        {n}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-fg-muted">{children}</span>
      </span>
    </li>
  );
}

/**
 * A plain anchor rather than `next/link`.
 *
 * The scenario is read once per tab from the URL, so a client-side navigation
 * that changed only the query string would leave the tab running as whoever it
 * was already. A full load is what actually switches person, and pretending
 * otherwise would make the walkthrough silently show the wrong answer.
 */
function Walk({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

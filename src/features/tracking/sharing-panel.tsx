"use client";

import { Copy, Link2, Plus, RotateCcw, ShieldOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  TRACKING_AUDIENCE_LABEL, TRACKING_UPDATE_POLICY_LABEL,
  type TrackingAudience, type TrackingSession, type TrackingUpdatePolicy,
  type TrackingVisibility,
} from "@/types";
import { NEVER_DISCLOSED, VISIBILITY_LABEL, defaultVisibility } from "@/lib/tracking";
import { LinkStateChip } from "./chips";

/**
 * The Load-scoped tracking session, and the links it has minted.
 *
 * Three things this panel is careful about:
 *
 *  - It shows the link rather than sending it. Nothing in this build emails,
 *    texts or posts anything to a broker, so the dispatcher copies the link and
 *    passes it on themselves, and the screen says that plainly.
 *  - Each recipient's switches are listed individually, per audience, because
 *    "shared with the broker" is not one decision.
 *  - What can never be shared is printed next to what can. A dispatcher should
 *    not have to infer the absence of a rate from the absence of a checkbox.
 */
export function SharingPanel({
  loadReference,
  session,
  origin,
  busy,
  onOpen,
  onAddRecipient,
  onRevoke,
  onReissue,
  onSetVisibility,
  onSetPolicy,
}: {
  loadReference: string;
  session?: TrackingSession;
  /** The page's own origin, so the copyable link is the real one. */
  origin: string;
  busy?: boolean;
  onOpen: () => void;
  onAddRecipient: (input: {
    audience: TrackingAudience;
    partyName: string;
    contactName?: string;
    contactEmail?: string;
    timeoutHours?: number;
  }) => void;
  onRevoke: (recipientId: string, reason: string) => void;
  onReissue: (recipientId: string) => void;
  onSetVisibility: (recipientId: string, visibility: TrackingVisibility) => void;
  onSetPolicy: (policy: TrackingUpdatePolicy) => void;
}) {
  const [audience, setAudience] = useState<TrackingAudience>("broker");
  const [partyName, setPartyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [timeoutHours, setTimeoutHours] = useState("120");
  const [copied, setCopied] = useState<string | null>(null);

  if (!session) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
          <Link2 className="size-4 text-fg-subtle" aria-hidden />
          Customer tracking
        </h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          Open a tracking session on {loadReference} to give the broker, the shipper or the
          receiver a limited, expiring view of it. One session per load, and you decide separately
          what each of them sees.
        </p>
        <Button variant="primary" size="sm" className="mt-3" disabled={busy} onClick={onOpen}>
          <Plus aria-hidden />
          Open tracking on this load
        </Button>
      </section>
    );
  }

  const linkFor = (token: string) => `${origin}/track/${token}`;

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section
      aria-labelledby="sharing-heading"
      className="rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2
            id="sharing-heading"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
          >
            <Link2 className="size-4 text-fg-subtle" aria-hidden />
            Customer tracking on {session.loadReference}
          </h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            Links expire after {session.linkTimeoutHours} hours and close{" "}
            {session.postDeliveryGraceHours} hours after delivery, on cancellation, or if the
            carrier relationship behind them ends. Nothing is emailed or texted — copy the link and
            send it yourself.
          </p>
        </div>
      </div>

      {/* Update policy ---------------------------------------------------- */}
      <div className="mt-3 rounded-md border border-border px-3.5 py-3">
        <p className="text-[0.8125rem] font-medium text-fg">How updates reach the customer</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["draft_for_approval", "automatic_mock_handoff"] as TrackingUpdatePolicy[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={session.updatePolicy === p ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => onSetPolicy(p)}
            >
              {TRACKING_UPDATE_POLICY_LABEL[p]}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">
          Either way nothing is transmitted. &ldquo;Queued for handoff&rdquo; means exactly that:
          there is no email, SMS or broker portal connected to this build.
        </p>
      </div>

      {/* Recipients ------------------------------------------------------- */}
      <ul className="mt-3 space-y-2.5">
        {session.recipients.map((recipient) => (
          <li key={recipient.id} className="rounded-md border border-border px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {recipient.partyName}
                  <span className="text-fg-subtle">
                    {TRACKING_AUDIENCE_LABEL[recipient.audience]}
                  </span>
                  <LinkStateChip state={recipient.state} />
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Expires {new Date(recipient.link.expiresAt).toLocaleString()} ·{" "}
                  opened {recipient.link.accessCount} time
                  {recipient.link.accessCount === 1 ? "" : "s"}
                  {recipient.link.revokedReason ? ` · ${recipient.link.revokedReason}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {recipient.state === "active" ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => copy(recipient.link.token)}>
                      <Copy aria-hidden />
                      {copied === recipient.link.token ? "Copied" : "Copy link"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => onRevoke(recipient.id, "Withdrawn by the carrier.")}
                    >
                      <ShieldOff aria-hidden />
                      Revoke
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onReissue(recipient.id)}
                  >
                    <RotateCcw aria-hidden />
                    Issue a new link
                  </Button>
                )}
              </div>
            </div>

            {recipient.state === "active" ? (
              <p className="mt-2 truncate rounded bg-surface-sunken px-2 py-1 font-mono text-[0.6875rem] text-fg-muted">
                {linkFor(recipient.link.token)}
              </p>
            ) : null}

            <fieldset className="mt-2.5">
              <legend className="text-[0.75rem] font-medium text-fg">
                What {recipient.partyName} may see
              </legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {(Object.keys(VISIBILITY_LABEL) as Array<keyof TrackingVisibility>).map((key) => (
                  <label
                    key={key}
                    className="inline-flex items-center gap-1.5 text-[0.75rem] text-fg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={recipient.visibility[key]}
                      disabled={busy}
                      onChange={(e) =>
                        onSetVisibility(recipient.id, {
                          ...recipient.visibility,
                          [key]: e.target.checked,
                        })}
                      className="size-3.5 accent-[var(--color-primary,currentColor)]"
                    />
                    {VISIBILITY_LABEL[key]}
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ul>

      {/* Add a recipient -------------------------------------------------- */}
      <form
        className="mt-3 rounded-md border border-dashed border-border px-3.5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!partyName.trim()) return;
          onAddRecipient({
            audience,
            partyName,
            contactName: contactName || undefined,
            contactEmail: contactEmail || undefined,
            timeoutHours: Number(timeoutHours) || undefined,
          });
          setPartyName("");
          setContactName("");
          setContactEmail("");
        }}
      >
        <p className="text-[0.8125rem] font-medium text-fg">Give somebody a link</p>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          <Field label="Who are they" htmlFor="audience">
            <select
              id="audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as TrackingAudience)}
              className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:outline-none"
            >
              {(["broker", "shipper", "receiver"] as TrackingAudience[]).map((a) => (
                <option key={a} value={a}>{TRACKING_AUDIENCE_LABEL[a]}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Company"
            htmlFor="partyName"
            hint={`Starts with the ${TRACKING_AUDIENCE_LABEL[audience].toLowerCase()} defaults: ${
              Object.entries(defaultVisibility(audience))
                .filter(([, on]) => on)
                .map(([k]) => VISIBILITY_LABEL[k as keyof TrackingVisibility])
                .join(", ")
            }.`}
          >
            <Input
              id="partyName"
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="Apex Logistics"
              required
            />
          </Field>
          <Field label="Contact name (optional)" htmlFor="contactName">
            <Input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Contact email (optional)" htmlFor="contactEmail" hint="Held for the audit trail. Nothing is sent to it.">
            <Input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </Field>
          <Field label="Link lifetime (hours)" htmlFor="timeoutHours">
            <Input
              id="timeoutHours"
              type="number"
              min={1}
              max={720}
              value={timeoutHours}
              onChange={(e) => setTimeoutHours(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" size="sm" className="mt-2.5" disabled={busy}>
          <Plus aria-hidden />
          Issue a link
        </Button>
      </form>

      {/* What is never shared --------------------------------------------- */}
      <div className="mt-3 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
        <p className="text-[0.8125rem] font-medium text-fg">Never shared, whatever the switches say</p>
        <ul className="mt-1.5 space-y-1">
          {NEVER_DISCLOSED.map((item) => (
            <li key={item.key} className="text-[0.75rem] leading-relaxed text-fg-muted">
              <span className="font-medium text-fg">{item.label}.</span> {item.why}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

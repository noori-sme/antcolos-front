"use client";

import { Copy, ExternalLink, Landmark, Mail, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FACTORING_MODE_LABEL, FACTORING_MOCK_NOTICE, FACTORING_SOURCE_LABEL,
  type FactoringDecision, type FactoringDecisionSource, type FactoringFallbackPrefill,
} from "@/types";
import { services } from "@/lib/api";
import type { ServiceContext } from "@/lib/api/contracts/context";
import { FactoringDetail } from "./factoring-chip";

/**
 * The fallback panel: what a dispatcher does when there is no authorized API.
 *
 * ★ IT DOES NOT PRETEND A LIVE CHECK EXISTS ★
 * Nothing here calls a factoring company. It opens the carrier's OWN configured
 * workflow — the credit-check email, the factor's portal, the credit desk's
 * phone number — and then records what came back, labelled with how it came
 * back. A person does the check, as themselves, with their own access.
 *
 * ★ AND IT RETYPES NOTHING ★
 * Antcolos already knows the carrier and its MC, the factoring account, the
 * broker and its MC, the load and the proposed amount, who is asking and what
 * the last answer was. Every one of those is on the panel before it opens.
 * Making a dispatcher go and find the broker's MC is how a credit check gets
 * run against the wrong company.
 */
export function CheckWithFactoringDialog({
  ctx, subject, onClose, onRecorded,
}: {
  ctx: ServiceContext;
  subject: {
    carrierOrganizationId: string;
    brokerNameObserved: string;
    brokerMcNumber?: string;
    brokerPartyId?: string;
    proposedAmountCents?: number;
    dispatchCycleId?: string;
    listingId?: string;
    laneLabel?: string;
  };
  onClose: () => void;
  /** Called after a result is written, so the caller can refresh both surfaces. */
  onRecorded: () => void;
}) {
  const [prefill, setPrefill] = useState<FactoringFallbackPrefill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [decision, setDecision] = useState<FactoringDecision>("approved_manual");
  const [source, setSource] = useState<FactoringDecisionSource>("manual_portal_check");
  const [reason, setReason] = useState("");
  const [conditions, setConditions] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [available, setAvailable] = useState("");
  const [reference, setReference] = useState("");

  useEffect(() => {
    let live = true;
    services.factoring
      .fallbackPrefill(ctx, subject)
      .then((p) => { if (live) setPrefill(p); })
      .catch(() => { if (live) setLoadError("This carrier has no factoring connection to check with."); });
    return () => { live = false; };
    // The subject is stable for the life of one dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!prefill) return;
    setBusy(true);
    setError(null);
    try {
      await services.factoring.recordResult(ctx, {
        carrierOrganizationId: subject.carrierOrganizationId,
        brokerNameObserved: subject.brokerNameObserved,
        brokerMcNumber: subject.brokerMcNumber,
        brokerPartyId: subject.brokerPartyId,
        proposedAmountCents: subject.proposedAmountCents,
        dispatchCycleId: subject.dispatchCycleId,
        listingId: subject.listingId,
        decision,
        source,
        // Everything below is the FACTOR's, as the person heard it. An empty
        // box stays empty rather than becoming a sentence Antcolos wrote.
        reason: reason.trim() || undefined,
        conditions: conditions.split("\n").map((c) => c.trim()).filter(Boolean),
        creditLimitCents: parseMoney(creditLimit),
        availableAmountCents: parseMoney(available),
        providerReference: reference.trim() || undefined,
        evidence: reference.trim()
          ? {
            kind: source === "recorded_email" ? "email_message"
              : source === "phone_confirmation" ? "call_note" : "portal_reference",
            reference: reference.trim(),
          }
          : undefined,
        // One key per dialog, so a double-tapped Save records one answer.
        idempotencyKey: `fallback:${subject.carrierOrganizationId}:${subject.brokerMcNumber ?? subject.brokerNameObserved}:${subject.listingId ?? subject.dispatchCycleId ?? "adhoc"}:${decision}:${source}`,
      });
      onRecorded();
      onClose();
    } catch {
      setError("That could not be recorded. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Check with factoring"
        description={prefill
          ? `${prefill.providerName} · ${FACTORING_MODE_LABEL[prefill.mode]}`
          : "Loading what we already know…"}
        /*
         * Tall on purpose — it carries the prefill, the ways to go and ask, and
         * the form for what came back. On a 900px laptop that overflows, and a
         * dialog whose Save button is below the fold is a dialog nobody can
         * finish. So the panel scrolls inside itself and the viewport never has
         * to.
         */
        className="max-h-[85vh] max-w-lg overflow-y-auto"
      >
        {loadError ? (
          <p role="alert" className="mt-4 rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
            {loadError}
          </p>
        ) : null}

        {prefill ? (
          <div className="mt-4 space-y-4">
            {/* ---- What Antcolos already knows. Nobody retypes any of it. --- */}
            <dl
              data-testid="factoring-prefill"
              className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.75rem]"
            >
              <Row label="Carrier">
                {prefill.carrierName}
                {prefill.carrierMcNumber ? ` · MC ${prefill.carrierMcNumber}` : ""}
              </Row>
              <Row label="Factoring account">
                {prefill.providerName}
                {prefill.accountReference ? ` · ${prefill.accountReference}` : ""}
              </Row>
              <Row label="Broker">{prefill.brokerName}</Row>
              <Row label="Broker MC">
                {prefill.brokerMcNumber ?? "None on this load"}
                {prefill.brokerMcNumber && !prefill.brokerMcVerified ? (
                  <Badge tone="warning" className="ml-1.5">Not in your directory</Badge>
                ) : null}
              </Row>
              {prefill.proposedAmountCents !== undefined ? (
                <Row label="Load amount">
                  ${(prefill.proposedAmountCents / 100).toLocaleString("en-US")}
                </Row>
              ) : null}
              {prefill.dispatchCycleId ? (
                <Row label="Opportunity">{prefill.dispatchCycleId}</Row>
              ) : null}
              <Row label="Asked by">{prefill.dispatcherName}</Row>
            </dl>

            {prefill.previous ? (
              <div className="rounded-md border border-dashed border-border px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
                <span className="font-medium text-fg">Last answer on file </span>
                <FactoringDetail status={prefill.previous} />
              </div>
            ) : null}

            {/* ---- How to go and get the answer ---------------------------- */}
            <div className="flex flex-wrap gap-2">
              {prefill.emailDraft ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(prefill.emailDraft!.body)
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false));
                  }}
                >
                  <Copy aria-hidden />
                  {copied ? "Copied" : "Copy credit-check email"}
                </Button>
              ) : null}
              {prefill.fallback.creditCheckEmail ? (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`mailto:${prefill.fallback.creditCheckEmail}?subject=${encodeURIComponent(prefill.emailDraft?.subject ?? "")}&body=${encodeURIComponent(prefill.emailDraft?.body ?? "")}`}>
                    <Mail aria-hidden />
                    {prefill.fallback.creditCheckEmail}
                  </a>
                </Button>
              ) : null}
              {prefill.fallback.portalUrl ? (
                <Button variant="ghost" size="sm" asChild>
                  <a href={prefill.fallback.portalUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink aria-hidden />
                    Open {prefill.providerName}
                  </a>
                </Button>
              ) : null}
              {prefill.fallback.phone ? (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`tel:${prefill.fallback.phone}`}>
                    <Phone aria-hidden />
                    {prefill.fallback.phone}
                  </a>
                </Button>
              ) : null}
            </div>

            {prefill.fallback.instructions ? (
              <p className="text-[0.75rem] leading-relaxed text-fg-muted">
                {prefill.fallback.instructions}
              </p>
            ) : null}

            {prefill.emailDraft ? (
              <Field label="The message, ready to send" htmlFor="factoring-draft">
                <Textarea id="factoring-draft" readOnly rows={7} value={prefill.emailDraft.body} className="font-mono text-[0.6875rem]" />
              </Field>
            ) : null}

            {/* ---- Writing down what came back ----------------------------- */}
            <div className="rounded-md border border-border px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
                <Landmark className="size-3.5 text-fg-subtle" aria-hidden />
                Record what {prefill.providerName} said
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Their answer" htmlFor="factoring-decision">
                  <select
                    id="factoring-decision"
                    value={decision}
                    onChange={(e) => setDecision(e.target.value as FactoringDecision)}
                    className="h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
                  >
                    <option value="approved_manual">Approved</option>
                    <option value="conditional">Approved with conditions</option>
                    <option value="rejected">Rejected</option>
                    <option value="pending">Still waiting for an answer</option>
                  </select>
                </Field>

                <Field
                  label="How you got it"
                  htmlFor="factoring-source"
                  hint="Recorded evidence, not a live API response."
                >
                  <select
                    id="factoring-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value as FactoringDecisionSource)}
                    className="h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg"
                  >
                    <option value="manual_portal_check">{FACTORING_SOURCE_LABEL.manual_portal_check}</option>
                    <option value="recorded_email">{FACTORING_SOURCE_LABEL.recorded_email}</option>
                    <option value="phone_confirmation">{FACTORING_SOURCE_LABEL.phone_confirmation}</option>
                  </select>
                </Field>

                <Field
                  label="Credit limit they gave"
                  htmlFor="factoring-limit"
                  hint="Leave empty if they did not give one. Antcolos never guesses a figure."
                  className="sm:col-span-1"
                >
                  <Input id="factoring-limit" inputMode="decimal" placeholder="e.g. 25000" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
                </Field>

                <Field label="Available right now" htmlFor="factoring-available" hint="Optional.">
                  <Input id="factoring-available" inputMode="decimal" placeholder="e.g. 18400" value={available} onChange={(e) => setAvailable(e.target.value)} />
                </Field>

                <Field
                  label="Their reference"
                  htmlFor="factoring-reference"
                  hint="A ticket number, a message id, or who you spoke to."
                  className="sm:col-span-2"
                >
                  <Input id="factoring-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>

                <Field
                  label="Their words, if they gave a reason"
                  htmlFor="factoring-reason"
                  hint="Only what they actually said."
                  className="sm:col-span-2"
                >
                  <Textarea id="factoring-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>

                {decision === "conditional" ? (
                  <Field
                    label="Conditions, one per line"
                    htmlFor="factoring-conditions"
                    className="sm:col-span-2"
                  >
                    <Textarea id="factoring-conditions" rows={3} value={conditions} onChange={(e) => setConditions(e.target.value)} />
                  </Field>
                ) : null}
              </div>
            </div>

            <p className="text-[0.6875rem] leading-relaxed text-fg-subtle">
              {FACTORING_MOCK_NOTICE}
            </p>

            {error ? (
              <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>
                Record the answer
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </>
  );
}

/**
 * "$25,000" or "25000" into cents, and an empty box into NOTHING.
 *
 * Never zero. A blank field means the factor did not give a figure, and
 * recording that as $0 would put a limit on the file that nobody set.
 */
function parseMoney(text: string): number | undefined {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return undefined;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

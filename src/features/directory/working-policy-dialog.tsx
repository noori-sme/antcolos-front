"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  policyAuthorityFor, proposeBrokerPolicy,
} from "@/lib/api/mock/broker-policy-registry";
import {
  BROKER_POLICY_ACTION_LABEL, BROKER_POLICY_REASON_LABEL,
  type BrokerPolicyAction, type BrokerPolicyReason, type BrokerPolicyScope,
} from "@/types";
import { ACTION_DESCRIPTION, REASON_DESCRIPTION } from "./broker-policy-labels";

/**
 * ★ ONE DIALOG, WHATEVER THE BUTTON SAID ★
 *
 * "Block / Deprioritize / Warn" and "Propose broker policy" are the SAME
 * command. What comes out — a policy in force, or a proposal waiting on an
 * owner — is decided by the registry from the actor's authority over the
 * organization the policy would belong to, not by which label a screen showed.
 *
 * That matters more than it looks. If the two were separate commands, a screen
 * that guessed the viewer's authority wrongly would hand somebody a block they
 * were not entitled to take. Here a screen that guesses wrongly shows a
 * slightly wrong verb and produces exactly the right record.
 *
 * The same dialog opens from the Broker profile, from a Load Search result,
 * from an Opportunity and from the Broker policies list, and every one of them
 * writes to the one canonical record.
 */

const ACTIONS: BrokerPolicyAction[] = [
  "hard_block", "deprioritize", "warning", "temporary_safety_hold",
];

const REASONS: BrokerPolicyReason[] = [
  "carrier_preference", "payment_experience", "factoring_rejected",
  "suspected_fraud", "identity_conflict", "service_dispute",
  "contract_restriction", "other",
];

export function WorkingPolicyDialog({
  brokerPartyId,
  brokerName,
  /** The carrier the freight would run under. Required for a carrier policy. */
  carrierOrganizationId,
  /** Which scopes this workspace may write. Decided by the caller's screen. */
  scopes,
  trigger,
  onWritten,
}: {
  brokerPartyId: string;
  brokerName: string;
  carrierOrganizationId?: string;
  scopes: BrokerPolicyScope[];
  trigger?: React.ReactNode;
  onWritten?: () => void;
}) {
  const ctx = useServiceContext();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<BrokerPolicyScope>(scopes[0] ?? "carrier");
  const [action, setAction] = useState<BrokerPolicyAction>("hard_block");
  const [reason, setReason] = useState<BrokerPolicyReason>("payment_experience");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();

  if (!ctx) return null;

  // What this actor would actually produce, asked of the registry rather than
  // guessed from a role name. `undefined` when the scope is not open to them.
  let authority;
  try {
    authority = policyAuthorityFor(ctx, { scope, carrierOrganizationId });
  } catch {
    authority = undefined;
  }
  const wouldPropose = authority ? !authority.mayApprove : true;
  const isHold = action === "temporary_safety_hold";

  async function submit() {
    if (!ctx) return;
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await proposeBrokerPolicy(ctx, {
        scope,
        carrierOrganizationId,
        brokerPartyId,
        action,
        reason,
        explanation,
      });
      setResult(
        outcome.createdDirectly
          ? `${BROKER_POLICY_ACTION_LABEL[action]} is in force for ${outcome.policy.organizationNameSnapshot}.`
          : outcome.escalated
            ? `Raised for ${outcome.policy.organizationNameSnapshot}. Nobody there can approve it right now, so it is waiting unassigned in Needs You rather than being approved by default.`
            : `Sent to ${outcome.policy.approverNameSnapshot ?? "the owner"} at ${outcome.policy.organizationNameSnapshot} in Needs You. Nothing is blocked until they decide.`,
      );
      setExplanation("");
      onWritten?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(undefined);
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <ShieldAlert aria-hidden />
            Working policy
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={wouldPropose ? "Propose a broker policy" : "Set a working policy"}
        description={
          wouldPropose
            ? `This goes to the owner of ${authority?.owningOrganizationName ?? "the organization"} in Needs You. It blocks nothing until they approve it.`
            : `This takes effect for ${authority?.owningOrganizationName ?? "your organization"} immediately.`
        }
        className="max-w-lg"
      >
        {result ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-md border border-border bg-canvas px-3 py-2.5 text-[0.8125rem] text-fg">
              {result}
            </p>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button variant="primary" size="sm">Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-[0.8125rem] text-fg-muted">
              About <span className="font-medium text-fg">{brokerName}</span>.
            </p>

            {scopes.length > 1 ? (
              <Field label="Whose decision is this?" htmlFor="policy-scope">
                <select
                  id="policy-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as BrokerPolicyScope)}
                  className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg"
                >
                  {scopes.includes("carrier") ? (
                    <option value="carrier">The carrier — who it hauls for</option>
                  ) : null}
                  {scopes.includes("dispatch_organization") ? (
                    <option value="dispatch_organization">
                      This dispatch organization — who we work with
                    </option>
                  ) : null}
                </select>
              </Field>
            ) : null}

            <Field
              label="What should happen"
              htmlFor="policy-action"
              hint={ACTION_DESCRIPTION[action]}
            >
              <select
                id="policy-action"
                value={action}
                onChange={(e) => setAction(e.target.value as BrokerPolicyAction)}
                className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg"
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>{BROKER_POLICY_ACTION_LABEL[a]}</option>
                ))}
              </select>
            </Field>

            <Field label="Why" htmlFor="policy-reason" hint={REASON_DESCRIPTION[reason]}>
              <select
                id="policy-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as BrokerPolicyReason)}
                className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>{BROKER_POLICY_REASON_LABEL[r]}</option>
                ))}
              </select>
            </Field>

            <Field
              label="What happened"
              htmlFor="policy-explanation"
              hint="Private to your organization. It is never published on the broker's profile and the broker never sees it. Write what a colleague would need in order to agree or disagree with you."
              error={error}
            >
              <Textarea
                id="policy-explanation"
                rows={3}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="Invoice 4471 went 52 days and two emails went unanswered."
              />
            </Field>

            {isHold ? (
              <p className="rounded-md border border-st-warning/35 bg-st-warning-bg/40 px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted">
                A temporary hold stops their freight straight away and lifts by
                itself if nobody decides. It cannot become permanent without an
                owner approving it.
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || explanation.trim().length === 0}
                onClick={submit}
              >
                {wouldPropose ? "Send for approval" : "Set the policy"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

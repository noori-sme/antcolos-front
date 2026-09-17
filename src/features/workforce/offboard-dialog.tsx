"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/form-alert";
import {
  OFFBOARDING_EFFECT_LABEL, ONBOARDING_DOMAIN_LABEL,
  type OffboardingStepKey,
} from "@/types";
import { useOffboardingPlan } from "./hooks";

/**
 * The impact preview, shown BEFORE anything happens.
 *
 * Three things this dialog is careful about, and each of them is a product
 * decision rather than a layout choice:
 *
 *  1. Nothing outside the confirmed list runs. Every destructive row is a
 *     checkbox, and unticking one genuinely means it is not performed.
 *  2. The "kept" rows are shown even though nobody can act on them. An
 *     offboarding screen that listed only destruction would teach people that
 *     ending a relationship deletes things, and this one deliberately does not.
 *  3. The qualification-retention row cannot be turned off, and says why. A
 *     carrier's obligation to keep what it relied on is not a checkbox.
 */
export function OffboardDialog({
  engagementId,
  personName,
  open,
  onOpenChange,
  onConfirm,
  pending,
  error,
}: {
  engagementId: string;
  personName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { reason: string; confirmedSteps: OffboardingStepKey[] }) => void;
  pending: boolean;
  error?: string;
}) {
  const plan = useOffboardingPlan(engagementId, open);
  const [reason, setReason] = useState("");
  /**
   * What the person has actually touched. `null` means "they have not", and the
   * defaults below stand.
   *
   * Derived rather than copied into state by an effect, so the service's
   * defaults are the single source of the starting selection and there is no
   * window in which the dialog shows a selection the plan never proposed.
   */
  const [touched, setTouched] = useState<Set<OffboardingStepKey> | null>(null);

  const selected = useMemo(() => {
    if (touched) return touched;
    return new Set(
      (plan.data?.impacts ?? []).filter((i) => i.defaultSelected).map((i) => i.key),
    );
  }, [touched, plan.data]);

  const toggle = (key: OffboardingStepKey) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setTouched(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`End ${personName}'s engagement`}
        description="Look at what this will and will not do before you confirm."
        className="max-w-2xl"
      >
        <div className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {plan.isPending ? (
            <p className="text-[0.8125rem] text-fg-muted">Working out what this would do…</p>
          ) : null}

          {plan.data ? (
            <>
              <FormAlert tone="warning" role="none" title="What ending this engagement means">
                {plan.data.warning}
              </FormAlert>

              <ul className="space-y-2" data-testid="offboarding-impacts">
                {plan.data.impacts.map((impact) => (
                  <li
                    key={impact.key}
                    data-impact={impact.key}
                    data-effect={impact.effect}
                    className="rounded-md border border-border bg-surface px-3.5 py-3"
                  >
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(impact.key)}
                        disabled={!impact.selectable}
                        onChange={() => toggle(impact.key)}
                        aria-label={impact.label}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.875rem] font-medium text-fg">
                            {impact.label}
                          </span>
                          <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
                            {OFFBOARDING_EFFECT_LABEL[impact.effect]}
                          </span>
                          <span className="text-[0.6875rem] text-fg-subtle">
                            {ONBOARDING_DOMAIN_LABEL[impact.domain]} · {impact.ownerService}
                          </span>
                        </span>
                        <span className="mt-1 block text-[0.8125rem] leading-relaxed text-fg-muted">
                          {impact.description}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <label className="block">
                <span className="mb-1 block text-[0.8125rem] font-medium text-fg">
                  Why is this ending?
                </span>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Recorded on the engagement and in the audit ledger."
                  aria-label="Reason for ending the engagement"
                />
              </label>
            </>
          ) : null}

          {error ? <FormAlert tone="danger" title="That did not work">{error}</FormAlert> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            size="sm"
            type="button"
            disabled={pending || !reason.trim() || !plan.data}
            onClick={() => onConfirm({ reason: reason.trim(), confirmedSteps: [...selected] })}
          >
            {pending ? "Ending…" : "End the engagement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

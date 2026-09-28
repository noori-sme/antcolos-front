"use client";

import { LoaderCircle, ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A full-width primary submit that owns its own busy state.
 *
 * While pending it stays in the tab order but is disabled, keeps its label (so
 * the button does not resize under the pointer) and sets `aria-busy`.
 */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
  type = "submit",
  onClick,
}: {
  pending?: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <Button
      type={type}
      variant="primary"
      size="lg"
      className="w-full"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/**
 * A large, self-describing option — used for the onboarding role choice and the
 * create/join fork. It is a real button, so Enter and Space work and the whole
 * block is one tab stop rather than a card with a link buried in it.
 */
export function ChoiceCard({
  icon: Icon,
  title,
  description,
  onSelect,
  selected,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "group flex w-full items-start gap-3.5 rounded-lg border p-4 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-primary bg-primary/[0.06] shadow-e1"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover shadow-e1",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
          selected ? "bg-primary text-primary-fg" : "bg-surface-sunken text-fg-muted group-hover:text-fg",
        )}
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-fg-muted">
          {description}
        </span>
      </span>
    </button>
  );
}

/** "Step 2 of 4" plus a purely decorative progress bar. */
export function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-5">
      <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">
        Step {current} of {total}
      </p>
      <div aria-hidden className="mt-2 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < current ? "bg-primary" : "bg-surface-sunken",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The three stages of getting an Antcolos account: the ACCOUNT, the PROFILE,
 * then the ROLE.
 *
 * Named rather than numbered, and deliberately a different component from
 * `StepProgress` above. That one counts the four fields inside signup; this one
 * counts the three things somebody is being asked for, at a coarser scale.
 * Showing "step 4 of 4" and then "step 2 of 3" with no names would read as the
 * flow going backwards.
 */
export const ACCOUNT_STAGES = ["Account", "Profile", "Role"] as const;

export function AccountFlowProgress({ stage }: { stage: 1 | 2 | 3 }) {
  return (
    <div className="mb-5">
      <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">
        {ACCOUNT_STAGES[stage - 1]} · step {stage} of {ACCOUNT_STAGES.length}
      </p>
      <div aria-hidden className="mt-2 flex gap-1.5">
        {ACCOUNT_STAGES.map((name, i) => (
          <span
            key={name}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < stage ? "bg-primary" : "bg-surface-sunken",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** A quiet "go back one step" control for multi-step flows. */
export function BackLink({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 transition-colors",
        "hover:text-fg hover:underline focus-visible:text-fg focus-visible:underline",
      )}
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </button>
  );
}

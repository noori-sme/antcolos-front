"use client";

import { useId } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { US_STATES, todayIsoDate } from "./driver-rules";
import type { DriverIdentityDraft, DriverIdentityErrors } from "./identity";
import { cn } from "@/lib/utils";

/**
 * The four fields a driver profile is made of, asked the same way everywhere.
 *
 * Accepting a carrier's invitation and signing up as a driver without one both
 * render this, so the two doors into the same permanent profile cannot drift
 * apart — one licence field, one set of rules, one profile.
 */
export function DriverIdentityFields({
  draft,
  onChange,
  errors,
  disabled,
}: {
  draft: DriverIdentityDraft;
  onChange: (next: DriverIdentityDraft) => void;
  /** Null entries render nothing; the caller decides when to start showing them. */
  errors: DriverIdentityErrors;
  disabled?: boolean;
}) {
  const uid = useId();
  const set = (patch: Partial<DriverIdentityDraft>) => onChange({ ...draft, ...patch });

  return (
    <>
      <Field
        label="Full legal name"
        htmlFor={`${uid}-name`}
        hint={errors.legalName ? undefined : "Exactly as it appears on your licence."}
        error={errors.legalName ?? undefined}
      >
        <Input
          id={`${uid}-name`}
          value={draft.legalName}
          onChange={(e) => set({ legalName: e.target.value })}
          autoComplete="name"
          placeholder="Yusuf Demir"
          maxLength={80}
          disabled={disabled}
          aria-invalid={errors.legalName ? true : undefined}
          className={cn(errors.legalName && "border-st-danger")}
        />
      </Field>

      <Field
        label="Driver license / CDL number"
        htmlFor={`${uid}-cdl`}
        error={errors.cdlNumber ?? undefined}
      >
        <Input
          id={`${uid}-cdl`}
          value={draft.cdlNumber}
          onChange={(e) => set({ cdlNumber: e.target.value.toUpperCase() })}
          spellCheck={false}
          autoCapitalize="characters"
          placeholder="K4471182993"
          maxLength={24}
          disabled={disabled}
          aria-invalid={errors.cdlNumber ? true : undefined}
          className={cn("font-mono", errors.cdlNumber && "border-st-danger")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issuing state" htmlFor={`${uid}-state`} error={errors.cdlState ?? undefined}>
          <select
            id={`${uid}-state`}
            value={draft.cdlState}
            onChange={(e) => set({ cdlState: e.target.value })}
            disabled={disabled}
            aria-invalid={errors.cdlState ? true : undefined}
            className={cn(
              "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 transition-colors",
              "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
              errors.cdlState && "border-st-danger",
            )}
          >
            <option value="">Choose…</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>

        <Field
          label="License expiration date"
          htmlFor={`${uid}-expiry`}
          error={errors.cdlExpiresAt ?? undefined}
        >
          <Input
            id={`${uid}-expiry`}
            type="date"
            min={todayIsoDate()}
            value={draft.cdlExpiresAt}
            onChange={(e) => set({ cdlExpiresAt: e.target.value })}
            disabled={disabled}
            aria-invalid={errors.cdlExpiresAt ? true : undefined}
            className={cn(errors.cdlExpiresAt && "border-st-danger")}
          />
        </Field>
      </div>
    </>
  );
}

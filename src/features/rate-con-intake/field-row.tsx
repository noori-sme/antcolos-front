"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Pencil } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FieldReviewStatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkCorrection, fieldLabel, inputKindFor } from "@/lib/rate-con/fields";
import { cn } from "@/lib/utils";
import type { ReviewDecision, ReviewField } from "@/types/rate-con-intake";

const INPUT_TYPE = { date: "date", time: "time" } as const;
const INPUT_MODE = { money: "decimal", mc: "numeric" } as const;
const PLACEHOLDER = {
  money: "2500.00",
  date: "YYYY-MM-DD",
  time: "08:00",
  currency: "USD",
  mc: "123456",
  text: "",
} as const;

/** The correction form: one value, checked with the backend's format for this path. */
export function correctionSchema(path: string) {
  return z.object({ value: z.string() }).superRefine(({ value }, issue) => {
    const check = checkCorrection(path, value);
    if (!check.ok) issue.addIssue({ code: "custom", path: ["value"], message: check.message });
  });
}

export function fieldDomId(fieldId: string): string {
  return `rc-field-${fieldId}`;
}

function Value({ value }: { value: string | null }) {
  return value === null || value === "" ? (
    <span className="italic text-fg-subtle">Not on the document</span>
  ) : (
    <span className="break-words text-fg">{value}</span>
  );
}

/**
 * One extracted field: its value, its review state, and Confirm / Correct.
 * Pointing at it (hover or focus) makes it the active field, which the
 * document pane finds on the page.
 */
export function FieldRow({
  field,
  active,
  readOnly,
  pending,
  onActivate,
  onDecide,
}: {
  field: ReviewField;
  active: boolean;
  readOnly: boolean;
  pending: boolean;
  /** `jump` moves the PDF to the field's page: on focus or click, not on hover. */
  onActivate: (fieldId: string, jump: boolean) => void;
  onDecide: (decision: ReviewDecision) => Promise<unknown>;
}) {
  const inputId = useId();
  const rowRef = useRef<HTMLLIElement>(null);
  const correctRef = useRef<HTMLButtonElement>(null);
  // The editor belongs to the value it was opened on. If the field changes
  // underneath it (someone else decided it, the list reloaded), it closes
  // instead of letting a stale edit overwrite that decision.
  const signature = `${field.reviewStatus}|${field.currentValue ?? ""}`;
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const editing = editingFor === signature;
  const setEditing = (open: boolean) => setEditingFor(open ? signature : null);
  const schema = useMemo(() => correctionSchema(field.path), [field.path]);
  const form = useForm<{ value: string }>({
    resolver: zodResolver(schema),
    defaultValues: { value: "" },
  });
  const problem = form.formState.errors.value?.message ?? null;
  const kind = inputKindFor(field.path);
  const label = fieldLabel(field.path);
  const needsDecision = field.requiresConfirmation && field.reviewStatus === "unreviewed";

  function startEditing() {
    form.reset({ value: field.currentValue ?? "" });
    setEditing(true);
  }

  async function correct({ value }: { value: string }) {
    const check = checkCorrection(field.path, value);
    if (!check.ok) return;
    try {
      await onDecide({ fieldId: field.id, action: "correct", value: check.value });
      setEditing(false);
      rowRef.current?.focus();
    } catch {
      // The list shows the API's message; keep the editor open to fix it.
    }
  }

  function save(event: React.FormEvent) {
    void form.handleSubmit(correct)(event);
  }

  return (
    <li
      ref={rowRef}
      id={fieldDomId(field.id)}
      tabIndex={-1}
      onMouseEnter={() => onActivate(field.id, false)}
      onFocusCapture={() => onActivate(field.id, true)}
      onClick={() => onActivate(field.id, true)}
      className={cn(
        "rounded-lg border bg-surface px-4 py-3 shadow-e1 outline-none motion-safe:transition-colors",
        active ? "border-primary" : "border-border",
        needsDecision && !active && "border-st-warning/50",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[0.75rem] font-medium text-fg-muted">{label}</p>
          <p className="mt-0.5 text-[0.9375rem]">
            <Value value={field.currentValue} />
          </p>
          {field.reviewStatus === "corrected" ? (
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              Read as{" "}
              <span className="line-through">{field.predictedValue ?? "nothing"}</span>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {needsDecision ? <Badge tone="warning">Needs a check</Badge> : null}
          <FieldReviewStatusBadge status={field.reviewStatus} />
          {field.confidence !== null ? (
            <span className="text-[0.75rem] tabular-nums text-fg-subtle" title="How sure the reader was">
              {Math.round(field.confidence * 100)}%
            </span>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-3 space-y-2">
          <label htmlFor={inputId} className="sr-only">
            Correct {label}
          </label>
          <Input
            id={inputId}
            autoFocus
            {...form.register("value")}
            type={kind === "date" || kind === "time" ? INPUT_TYPE[kind] : "text"}
            inputMode={kind === "money" || kind === "mc" ? INPUT_MODE[kind] : undefined}
            placeholder={PLACEHOLDER[kind]}
            aria-invalid={Boolean(problem)}
            aria-describedby={problem ? `${inputId}-problem` : undefined}
          />
          {problem ? (
            <p id={`${inputId}-problem`} role="alert" className="text-[0.75rem] text-st-danger">
              {problem}
            </p>
          ) : (
            <p className="text-[0.75rem] text-fg-subtle">Leave it empty if the Rate Con does not say.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              Save correction
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                requestAnimationFrame(() => correctRef.current?.focus());
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : readOnly ? null : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {field.reviewStatus === "unreviewed" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void onDecide({ fieldId: field.id, action: "confirm" })
                  .then(() => rowRef.current?.focus())
                  .catch(() => {})
              }
            >
              <Check aria-hidden />
              Confirm
              <span className="sr-only"> {label}</span>
            </Button>
          ) : null}
          <Button ref={correctRef} size="sm" variant="ghost" disabled={pending} onClick={startEditing}>
            <Pencil aria-hidden />
            Correct
            <span className="sr-only"> {label}</span>
          </Button>
        </div>
      )}
    </li>
  );
}

"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { BackLink, SubmitButton } from "./controls";
import { mockCheckUsername } from "./mock-backend";
import { USERNAME_MAX_LENGTH, USERNAME_RULES_TEXT, validateUsername } from "./rules";
import { cn } from "@/lib/utils";

type Availability = "idle" | "checking" | "available" | "taken";

/** Pause after the last keystroke before asking whether the name is free. */
const DEBOUNCE_MS = 450;

/** An answer is stored with the name it belongs to, never on its own. */
interface Answer {
  name: string;
  result: "available" | "taken";
  suggestions: string[];
}

/**
 * Sign up, step 3 — choose the permanent username.
 *
 * Shape is judged instantly and locally. Availability needs a round trip, so it
 * is debounced, and each answer remembers which name it was about. Rendering
 * only trusts an answer whose name still matches what is in the box, so a slow
 * reply about an old name can never mislabel the current one.
 */
export function StepUsername({
  username,
  onUsernameChange,
  onChosen,
  onBack,
}: {
  username: string;
  onUsernameChange: (username: string) => void;
  onChosen: () => void;
  onBack: () => void;
}) {
  const uid = useId();
  const inputId = `${uid}-username`;
  const statusId = `${uid}-status`;
  const rulesId = `${uid}-rules`;

  const [answer, setAnswer] = useState<Answer | null>(null);

  const value = username.trim();
  const shapeError = value.length > 0 ? validateUsername(value) : null;
  const eligible = value.length > 0 && !shapeError;

  const currentAnswer = answer && answer.name === value ? answer : null;
  const availability: Availability = !eligible
    ? "idle"
    : currentAnswer
      ? currentAnswer.result
      : "checking";

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(async () => {
      const result = await mockCheckUsername(value);
      setAnswer({
        name: value,
        result: result.status,
        suggestions: result.status === "taken" ? result.suggestions : [],
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [eligible, value]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (availability !== "available") return;
    onChosen();
  }

  const invalid = Boolean(shapeError) || availability === "taken";
  const suggestions = currentAnswer?.suggestions ?? [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-[0.8125rem] font-medium text-fg">
          Username
        </label>

        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[0.875rem] text-fg-subtle"
          >
            @
          </span>
          <Input
            id={inputId}
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value.replace(/\s/g, ""))}
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={USERNAME_MAX_LENGTH}
            placeholder="northline_ops"
            aria-invalid={invalid || undefined}
            aria-describedby={`${statusId} ${rulesId}`}
            className={cn(
              "pl-7",
              availability === "checking" && "pr-10",
              invalid && "border-st-danger focus-visible:border-st-danger",
              availability === "available" && "border-st-success focus-visible:border-st-success",
            )}
          />
          {availability === "checking" ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <LoaderCircle className="size-4 animate-spin text-fg-subtle" aria-hidden />
            </span>
          ) : null}
        </div>

        {/* One live region for every outcome, so only one thing is ever announced. */}
        <p id={statusId} aria-live="polite" className="min-h-4 text-[0.75rem]">
          {shapeError ? (
            <span className="text-st-danger">{shapeError}</span>
          ) : availability === "checking" ? (
            <span className="text-fg-subtle">Checking availability…</span>
          ) : availability === "available" ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-st-success">
              <Check className="size-3.5" strokeWidth={3} aria-hidden />
              @{value} is available
            </span>
          ) : availability === "taken" ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-st-danger">
              <X className="size-3.5" strokeWidth={3} aria-hidden />
              @{value} is already taken
            </span>
          ) : null}
        </p>

        {availability === "taken" && suggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[0.75rem] text-fg-muted">Try:</span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onUsernameChange(suggestion)}
                className={cn(
                  "rounded-full border border-border bg-surface px-2.5 py-1 text-[0.75rem] font-medium text-fg",
                  "transition-colors hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                @{suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <p id={rulesId} className="pt-0.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          {USERNAME_RULES_TEXT}
        </p>
      </div>

      <SubmitButton pendingLabel="Saving…" disabled={availability !== "available"}>
        Continue
      </SubmitButton>

      <div className="pt-1">
        <BackLink onClick={onBack} />
      </div>
    </form>
  );
}

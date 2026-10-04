"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { BackLink, SubmitButton } from "./controls";
import { USERNAME_MAX_LENGTH, USERNAME_RULES_TEXT, validateUsername } from "./rules";
import { cn } from "@/lib/utils";

type Availability = "idle" | "checking" | "available" | "taken";

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
  onBack?: () => void;
}) {
  const uid = useId();
  const inputId = `${uid}-username`;
  const statusId = `${uid}-status`;
  const rulesId = `${uid}-rules`;

  const [answer, setAnswer] = useState<Answer | null>(null);

  const value = username.trim();
  const shapeError = value.length > 0 ? validateUsername(value) : null;
  const eligible = value.length > 0 && !shapeError;

  const checkUsernameMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data } = await apiClient.get<{ available: boolean }>(`/auth/username-available?username=${name}`);
      return data.available;
    },
    onSuccess: (isAvailable, name) => {
      setAnswer({
        name,
        result: isAvailable ? "available" : "taken",
        suggestions: [],
      });
    },
    onError: (error) => {
      const errorMsg = (
        <span>
          We're experiencing some technical issues. Please try again later.{" "}
          <span className="text-[10px] opacity-70">(CORS)</span>
        </span>
      );

      if (error.message === "Network Error" || error.message.includes("Network Error")) {
        toast.error(errorMsg);
      } else {
        toast.error(errorMsg);
      }
    }
  });

  const setUsernameMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data } = await apiClient.post("/auth/username", { username: name });
      return data;
    },
    onSuccess: () => {
      toast.success("Username set successfully!");
      onChosen();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to set username. Please try again.");
    }
  });

  const currentAnswer = answer && answer.name === value ? answer : null;
  const availability: Availability = !eligible
    ? "idle"
    : checkUsernameMutation.isPending
      ? "checking"
      : currentAnswer
        ? currentAnswer.result
        : "idle";

  function handleCheckAvailability() {
    if (!eligible) return;
    checkUsernameMutation.mutate(value);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (availability !== "available" || setUsernameMutation.isPending) return;
    setUsernameMutation.mutate(value);
  }

  const invalid = Boolean(shapeError) || availability === "taken";
  const suggestions = currentAnswer?.suggestions ?? [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-[0.8125rem] font-medium text-fg">
          Username
          <span className="ml-1 text-st-danger">*</span>
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
              "pr-[4.5rem]",
              invalid && "border-st-danger focus-visible:border-st-danger",
              availability === "available" && "border-st-success focus-visible:border-st-success",
            )}
          />
          <div className="absolute inset-y-0 right-1.5 flex items-center">

            <Button
              type="button"
              className={cn("!h-6.5 !text-[11px]", eligible && !currentAnswer && "animate-pulse")}
              variant={availability === "available" ? "secondary" : "primary"}
              disabled={!eligible || !!currentAnswer}
              onClick={handleCheckAvailability}
            >
              {availability === "checking" ? <><LoaderCircle className="!text-black size-4 animate-spin text-fg-subtle" aria-hidden />Checking</> : availability === "available" ? "Verified" : availability === "taken" ? "Taken" : "Verify"}
            </Button>
          </div>
        </div>

        {/* One live region for every outcome, so only one thing is ever announced. */}
        <p id={statusId} aria-live="polite" className="min-h-4 text-[0.75rem]">
          {shapeError ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-st-danger">
              <X className="size-3.5" strokeWidth={3} aria-hidden />
              {shapeError}
            </span>
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

      <SubmitButton 
        pending={setUsernameMutation.isPending} 
        pendingLabel="Setting username…" 
        disabled={availability !== "available" || setUsernameMutation.isPending}
      >
        Set Username
      </SubmitButton>

      {onBack && (
        <div className="pt-1">
          <BackLink onClick={onBack} />
        </div>
      )}
    </form>
  );
}

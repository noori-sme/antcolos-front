"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { USERNAME_MAX_LENGTH, USERNAME_RULES_TEXT, validateUsername } from "./rules";
import { cn } from "@/lib/utils";

export type UsernameAvailability = "idle" | "checking" | "available" | "taken";

interface Answer {
  name: string;
  result: "available" | "taken";
  suggestions: string[];
}

export function UsernameField({
  id: propId,
  value,
  onChange,
  disabled = false,
  autoComplete = "username",
  placeholder = "e.g. jor_dan",
  showRules = true,
  required = false,
  onAvailabilityChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete?: string;
  placeholder?: string;
  showRules?: boolean;
  required?: boolean;
  onAvailabilityChange?: (availability: UsernameAvailability) => void;
}) {
  const uid = useId();
  const inputId = propId || `${uid}-username`;
  const statusId = `${uid}-status`;
  const rulesId = `${uid}-rules`;

  const [answer, setAnswer] = useState<Answer | null>(null);

  const cleanValue = value.trim();
  const shapeError = cleanValue.length > 0 ? validateUsername(cleanValue) : null;
  const eligible = cleanValue.length > 0 && !shapeError;

  const checkUsernameMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data } = await apiClient.get<{ available: boolean }>(
        `/auth/username-available?username=${encodeURIComponent(name)}`
      );
      return data.available;
    },
    onSuccess: (isAvailable, name) => {
      setAnswer({
        name,
        result: isAvailable ? "available" : "taken",
        suggestions: [],
      });
    },
    onError: (error: any) => {
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to check username availability.";
      toast.error(msg);
    },
  });

  const currentAnswer = answer && answer.name === cleanValue ? answer : null;
  const availability: UsernameAvailability = !eligible
    ? "idle"
    : checkUsernameMutation.isPending
      ? "checking"
      : currentAnswer
        ? currentAnswer.result
        : "idle";

  useEffect(() => {
    onAvailabilityChange?.(availability);
  }, [availability, onAvailabilityChange]);

  function handleCheckAvailability() {
    if (!eligible || checkUsernameMutation.isPending) return;
    checkUsernameMutation.mutate(cleanValue);
  }

  const invalid = Boolean(shapeError) || availability === "taken";

  return (
    <div className="space-y-1.5">
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
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s/g, ""))}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          maxLength={USERNAME_MAX_LENGTH}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={`${statusId} ${rulesId}`}
          className={cn(
            "pl-7 pr-[5.5rem]",
            invalid && "border-st-danger focus-visible:border-st-danger",
            availability === "available" && "border-st-success focus-visible:border-st-success"
          )}
        />
        <div className="absolute inset-y-0 right-1.5 flex items-center">
          <Button
            type="button"
            className={cn("!h-6.5 !text-[11px]", eligible && !currentAnswer && "animate-pulse")}
            variant={availability === "available" ? "secondary" : "primary"}
            disabled={!eligible || !!currentAnswer || disabled || checkUsernameMutation.isPending}
            onClick={handleCheckAvailability}
          >
            {availability === "checking" ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin mr-1" aria-hidden />
                Checking
              </>
            ) : availability === "available" ? (
              "Verified"
            ) : availability === "taken" ? (
              "Taken"
            ) : (
              "Verify"
            )}
          </Button>
        </div>
      </div>

      {/* One live region for every outcome */}
      <p id={statusId} aria-live="polite" className="min-h-4 text-[0.75rem]">
        {shapeError ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-st-danger">
            <X className="size-3.5" strokeWidth={3} aria-hidden />
            {shapeError}
          </span>
        ) : availability === "available" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-st-success">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
            @{cleanValue} is available
          </span>
        ) : availability === "taken" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-st-danger">
            <X className="size-3.5" strokeWidth={3} aria-hidden />
            @{cleanValue} is already taken
          </span>
        ) : null}
      </p>

      {showRules && (
        <p id={rulesId} className="pt-0.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          {USERNAME_RULES_TEXT}
        </p>
      )}
    </div>
  );
}

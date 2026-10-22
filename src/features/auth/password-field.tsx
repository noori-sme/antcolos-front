"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password box with a show/hide toggle.
 *
 * The toggle is a real button inside the field: reachable by keyboard, labelled
 * for screen readers, and `aria-pressed` so its on/off state is announced. It is
 * `tabIndex={-1}`-free on purpose — hiding it from the keyboard would make the
 * feature useless to the people who most need it.
 */
export function PasswordField({
  id,
  value,
  onChange,
  onBlur,
  autoComplete,
  placeholder,
  invalid,
  describedBy,
  disabled,
  required,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("pr-11", invalid && "border-st-danger focus-visible:border-st-danger")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={id}
        disabled={disabled}
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md",
          "text-fg-subtle transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-50",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        )}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

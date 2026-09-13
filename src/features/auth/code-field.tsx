"use client";

import { useRef } from "react";
import { CODE_LENGTH } from "./rules";
import { cn } from "@/lib/utils";

const BOXES = Array.from({ length: CODE_LENGTH }, (_, i) => i);

/**
 * Six single-character boxes for the verification code.
 *
 * Split boxes are a readability device, not a data model — the value is one
 * string of digits. Keyboard behaviour people expect from this control is all
 * here: typing advances, Backspace on an empty box steps back and clears, arrow
 * keys and Home/End move, and pasting a whole code fills the row in one go.
 */
export function CodeField({
  idPrefix,
  digits,
  onChange,
  onSubmitRequested,
  disabled,
  invalid,
  describedBy,
}: {
  idPrefix: string;
  digits: string[];
  onChange: (digits: string[]) => void;
  onSubmitRequested?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const focusBox = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), CODE_LENGTH - 1);
    const el = refs.current[clamped];
    el?.focus();
    el?.select();
  };

  const setDigit = (index: number, digit: string) => {
    const next = [...digits];
    next[index] = digit;
    onChange(next);
  };

  const handleChange = (index: number, raw: string) => {
    // A phone keyboard or autofill can deliver more than one character at once.
    const typed = raw.replace(/\D/g, "");
    if (!typed) {
      if (raw === "") setDigit(index, "");
      return;
    }
    if (typed.length === 1) {
      setDigit(index, typed);
      if (index < CODE_LENGTH - 1) focusBox(index + 1);
      return;
    }
    fill(typed, index);
  };

  const fill = (source: string, from: number) => {
    const next = [...digits];
    let cursor = from;
    for (const char of source.slice(0, CODE_LENGTH - from)) {
      next[cursor] = char;
      cursor += 1;
    }
    onChange(next);
    focusBox(cursor);
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Backspace":
        if (digits[index]) {
          setDigit(index, "");
        } else if (index > 0) {
          event.preventDefault();
          setDigit(index - 1, "");
          focusBox(index - 1);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusBox(index - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        focusBox(index + 1);
        break;
      case "Home":
        event.preventDefault();
        focusBox(0);
        break;
      case "End":
        event.preventDefault();
        focusBox(CODE_LENGTH - 1);
        break;
      case "Enter":
        onSubmitRequested?.();
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="group"
      aria-label={`Verification code, ${CODE_LENGTH} digits`}
      aria-describedby={describedBy}
      className="grid grid-cols-6 gap-1.5 sm:gap-2"
    >
      {BOXES.map((index) => (
        <input
          key={index}
          id={`${idPrefix}-${index}`}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={CODE_LENGTH}
          value={digits[index] ?? ""}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={(e) => e.currentTarget.select()}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
            if (!pasted) return;
            e.preventDefault();
            fill(pasted, 0);
          }}
          className={cn(
            "h-12 w-full rounded-md border bg-surface text-center text-[1.125rem] font-medium text-fg shadow-e1 transition-colors",
            "tabular-nums caret-primary",
            "hover:border-border-strong",
            "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-st-danger" : "border-border",
          )}
        />
      ))}
    </div>
  );
}

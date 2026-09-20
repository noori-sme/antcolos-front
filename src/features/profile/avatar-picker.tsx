"use client";

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AVATAR_ACCEPT_ATTRIBUTE, AVATAR_MAX_BYTES, avatarInitials, formatBytes,
  validateAvatar,
} from "@/lib/profile/avatar";
import { cn } from "@/lib/utils";

/** What the picker hands up: enough for the service, and nothing about files. */
export interface PickedAvatar {
  contentType: string;
  byteLength: number;
  /** A data URL. See `putAvatar` for why it is not a blob URL. */
  data: string;
}

/**
 * Choosing an avatar.
 *
 * The preview is read locally and shown immediately, because an upload that
 * only appears after a round trip is an upload people repeat. Nothing is sent
 * from here — the parent decides when, so that skipping the step is genuinely
 * free rather than an upload that has to be undone.
 *
 * The file is judged by `validateAvatar`, the same pure rule the service
 * applies again on submit and a backend has to apply a third time. Judging it
 * here is a courtesy to the person, not a check anybody relies on.
 */
export function AvatarPicker({
  value,
  fullName,
  onPick,
  onClear,
  disabled,
}: {
  value?: string;
  fullName: string;
  onPick: (avatar: PickedAvatar) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const uid = useId();
  const inputId = `${uid}-avatar`;
  const statusId = `${uid}-avatar-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = validateAvatar({ type: file.type, size: file.size, name: file.name });
    if (problem) {
      setError(problem);
      // Cleared so choosing the SAME corrected file again still fires a change.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setError(null);
    setReading(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setReading(false);
      setError("That image could not be read. Try another one.");
    };
    reader.onload = () => {
      setReading(false);
      const data = typeof reader.result === "string" ? reader.result : "";
      if (!data) {
        setError("That image could not be read. Try another one.");
        return;
      }
      onPick({ contentType: file.type, byteLength: file.size, data });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-start gap-4">
      <span
        aria-hidden
        className={cn(
          "flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full",
          "border border-border bg-surface-sunken text-[1.25rem] font-semibold text-fg-muted",
        )}
      >
        {value ? (
          // A data URL of the person's own choosing, rendered at a fixed size.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : reading ? (
          <LoaderCircle className="size-5 animate-spin text-fg-subtle" />
        ) : (
          avatarInitials(fullName)
        )}
      </span>

      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={AVATAR_ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || reading}
            aria-describedby={statusId}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden />
            {value ? "Change photo" : "Upload a photo"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setError(null);
                if (inputRef.current) inputRef.current.value = "";
                onClear();
              }}
            >
              <Trash2 aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>

        <p id={statusId} aria-live="polite" className="mt-1.5 text-[0.75rem] leading-relaxed">
          {error ? (
            <span className="text-st-danger">{error}</span>
          ) : (
            <span className="text-fg-subtle">
              PNG, JPEG or WebP, up to {formatBytes(AVATAR_MAX_BYTES)}. You can add one later.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

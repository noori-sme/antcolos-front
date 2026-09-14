"use client";

import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Chooses a file and hands back its name, type and size.
 *
 * That is genuinely all it does, and it is all the rest of the Document Center
 * ever receives — the File object is not read, kept or passed on.
 */
export function FilePicker({
  label,
  onPick,
  disabled,
  variant = "secondary",
  size = "sm",
  className,
}: {
  label: string;
  onPick: (file: { name: string; type: string; size: number }) => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  className?: string;
}) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onPick({ name: file.name, type: file.type || "application/octet-stream", size: file.size });
  }

  return (
    <span
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={cn("inline-flex", dragging && "rounded-md ring-2 ring-primary", className)}
    >
      <input
        ref={input}
        id={uid}
        type="file"
        accept="image/*,application/pdf"
        tabIndex={-1}
        aria-label={label}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden />
        {label}
      </Button>
    </span>
  );
}

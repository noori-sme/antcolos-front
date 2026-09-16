"use client";

import {
  Camera, Check, CircleAlert, FileText, LoaderCircle, Send, Trash2, TriangleAlert, Upload,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentRequirement, DriverDocument } from "@/types";
import { DocumentStatusChip } from "./status-chips";
import {
  expiryState, formatDate, formatFileSize, todayIsoDate, validateExpiryDate,
} from "./driver-rules";
import { cn } from "@/lib/utils";

/** Statuses where the driver has nothing left to do right now. */
const SETTLED = new Set(["pending_review", "approved"]);

/**
 * One line of the checklist.
 *
 * The whole row is a drop target on desktop, and offers the camera on a phone,
 * because a driver photographing a licence in a truck stop is the normal case
 * and a file browser is not.
 *
 * Nothing is uploaded anywhere — see mock-driver.ts. The row only ever learns a
 * file's name, type and size.
 */
export function DocumentItem({
  requirement,
  document,
  onUpload,
  onRemove,
  onSubmit,
  onExpiryChange,
}: {
  requirement: DocumentRequirement;
  document?: DriverDocument;
  onUpload: (file: File) => void;
  onRemove: () => void;
  /** Absent when there is nobody to submit to — a driver with no carrier yet. */
  onSubmit?: () => void;
  onExpiryChange: (value: string) => void;
}) {
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);

  const status = document?.status ?? "missing";
  const uploading = Boolean(document?.uploading);
  const hasFile = Boolean(document?.fileName) && !uploading;
  const settled = SETTLED.has(status);
  const needsExpiry = requirement.expires && hasFile && !settled;
  const expiryError =
    needsExpiry && expiryTouched ? validateExpiryDate(document?.expiresAt?.slice(0, 10) ?? "") : null;
  const readyToSubmit = hasFile && status !== "pending_review" && status !== "approved"
    && (!requirement.expires || Boolean(document?.expiresAt));

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) onUpload(file);
  }

  return (
    <li
      onDragOver={(e) => {
        if (settled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (settled) return;
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
      className={cn(
        "rounded-lg border bg-surface p-4 shadow-e1 transition-colors",
        dragging ? "border-primary bg-primary/[0.04]" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-[0.875rem] font-semibold text-fg">{requirement.label}</span>
            <DocumentStatusChip
              status={status}
              // "Ready to submit" is a lie when there is nobody to submit to.
              label={!onSubmit && status === "selected_local" ? "On your profile" : undefined}
            />
            {requirement.applicability !== "required" ? (
              <span className="text-[0.6875rem] text-fg-subtle">Optional</span>
            ) : null}
            {requirement.addedByOrganizationId ? (
              <span className="rounded-full bg-st-info-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-info">
                Asked for by this carrier
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {requirement.description}
          </p>
        </div>
      </div>

      {status === "rejected" && document?.rejectionReason ? (
        <div role="alert" className="mt-3 flex gap-2.5 rounded-md border border-st-danger/35 bg-st-danger-bg/50 px-3 py-2.5">
          <CircleAlert className="mt-px size-4 shrink-0 text-st-danger" aria-hidden />
          <div className="min-w-0 text-[0.8125rem] leading-relaxed">
            <p className="font-medium text-fg">This was sent back.</p>
            <p className="mt-0.5 text-fg-muted">{document.rejectionReason}</p>
          </div>
        </div>
      ) : null}

      {(status === "expired" || status === "expiring_soon") && document?.expiresAt ? (
        <div className="mt-3 flex gap-2.5 rounded-md border border-st-warning/40 bg-st-warning-bg/60 px-3 py-2.5">
          <TriangleAlert className="mt-px size-4 shrink-0 text-st-warning" aria-hidden />
          <p className="text-[0.8125rem] leading-relaxed text-fg">
            {status === "expired"
              ? `This expired on ${formatDate(document.expiresAt)}. Upload a current one.`
              : `This expires on ${formatDate(document.expiresAt)}. Upload a new one before then.`}
          </p>
        </div>
      ) : null}

      {uploading ? (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            <span className="truncate">Uploading {document?.fileName}…</span>
            <span className="ml-auto tabular-nums">{document?.progress ?? 0}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={document?.progress ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uploading ${requirement.label}`}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${document?.progress ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {hasFile ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken px-3 py-2">
          <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-fg">
            {document?.fileName}
          </span>
          <span className="shrink-0 text-[0.75rem] text-fg-subtle tabular-nums">
            {document?.fileType?.split("/")[1]?.toUpperCase()}
            {document?.sizeBytes ? ` · ${formatFileSize(document.sizeBytes)}` : ""}
          </span>
        </div>
      ) : null}

      {needsExpiry ? (
        <div className="mt-3 max-w-[16rem]">
          <label htmlFor={`${uid}-expiry`} className="block text-[0.75rem] font-medium text-fg">
            Expiration date
          </label>
          <Input
            id={`${uid}-expiry`}
            type="date"
            min={todayIsoDate()}
            value={document?.expiresAt?.slice(0, 10) ?? ""}
            onChange={(e) => onExpiryChange(e.target.value)}
            onBlur={() => setExpiryTouched(true)}
            aria-invalid={expiryError ? true : undefined}
            className={cn("mt-1", expiryError && "border-st-danger")}
          />
          {expiryError ? (
            <p role="alert" className="mt-1 text-[0.75rem] text-st-danger">{expiryError}</p>
          ) : (
            <p className="mt-1 text-[0.75rem] text-fg-subtle">
              As printed on the document. We&apos;ll remind you before it runs out.
            </p>
          )}
        </div>
      ) : null}

      {status === "approved" && document?.expiresAt ? (
        <p className="mt-2 text-[0.75rem] text-fg-muted">
          Valid until {formatDate(document.expiresAt)}
          {expiryState(document.expiresAt) === "expiring_soon" ? " — renew soon" : ""}.
        </p>
      ) : null}

      {status === "pending_review" ? (
        <p className="mt-2 text-[0.75rem] text-fg-muted">
          Sent to the carrier{document?.submittedAt ? ` on ${formatDate(document.submittedAt)}` : ""}.
          Nothing more to do until they look at it.
        </p>
      ) : null}

      {!settled ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInput}
            id={`${uid}-file`}
            type="file"
            accept="image/*,application/pdf"
            tabIndex={-1}
            aria-label={`Choose a file for ${requirement.label}`}
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInput}
            id={`${uid}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex={-1}
            aria-label={`Take a photo for ${requirement.label}`}
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />

          <Button
            variant="secondary"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden />
            {hasFile ? "Replace file" : "Select file"}
          </Button>

          {/* Phones get the camera; a desktop file browser already covers this. */}
          <Button
            variant="secondary"
            size="sm"
            disabled={uploading}
            className="sm:hidden"
            onClick={() => cameraInput.current?.click()}
          >
            <Camera aria-hidden />
            Take a photo
          </Button>

          {hasFile ? (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={uploading}>
              <Trash2 aria-hidden />
              Remove
            </Button>
          ) : null}

          {hasFile && onSubmit ? (
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              disabled={!readyToSubmit || uploading}
              onClick={onSubmit}
            >
              <Send aria-hidden />
              Submit for review
            </Button>
          ) : null}

          <p className="w-full text-[0.75rem] text-fg-subtle max-sm:hidden">
            {hasFile
              ? !onSubmit
                ? "Kept on your profile. No carrier has reviewed it."
                : requirement.expires && !document?.expiresAt
                  ? "Add the expiration date above, then submit."
                  : "Check it is readable, then submit it to the carrier."
              : "Drag a photo or PDF here, or use the button."}
          </p>
        </div>
      ) : null}

      {status === "approved" ? (
        <p className="mt-3 flex items-center gap-1.5 text-[0.75rem] font-medium text-st-success">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
          Accepted by the carrier.
        </p>
      ) : null}
    </li>
  );
}

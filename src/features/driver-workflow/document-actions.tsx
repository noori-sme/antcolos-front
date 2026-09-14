"use client";

import { Camera, FileUp, Pencil } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DOCUMENT_KIND_LABEL } from "@/config/documents";
import { dateTimeIn } from "@/lib/utils";
import type { UploadDescriptor, WorkflowDocument } from "@/types";

/**
 * Document actions for the trip. Every one of them goes through the Unified
 * Document Center port — this feature has no uploader of its own, and does not
 * store, transfer or read a file. Picking a file reads the name, type and size
 * the browser gives away for free, and that is all that happens to it.
 */

/** What the picker hands back: the browser's own facts about the file. */
export type PickedUpload = UploadDescriptor;

export function UploadButtons({
  label, disabled, onPick, variant = "secondary",
}: {
  label: string;
  disabled?: boolean;
  onPick: (upload: PickedUpload) => void;
  variant?: "primary" | "secondary" | "subtle";
}) {
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  function pick(files: FileList | null, capture: "camera" | "file") {
    const file = files?.[0];
    if (!file) return;
    // The file itself is never read and never leaves the device.
    onPick({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      capture,
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={fileInput}
        id={`${uid}-file`}
        type="file"
        accept="image/*,application/pdf"
        tabIndex={-1}
        aria-label={`Choose a file for ${label}`}
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files, "file");
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
        aria-label={`Take a photo for ${label}`}
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files, "camera");
          e.target.value = "";
        }}
      />

      {/* The camera first: a driver at a dock has the paperwork in their hand. */}
      <Button
        size="lg"
        variant={variant}
        disabled={disabled}
        onClick={() => cameraInput.current?.click()}
        className="flex-1 sm:flex-none"
      >
        <Camera aria-hidden />
        Take a photo
      </Button>
      <Button
        size="lg"
        variant="secondary"
        disabled={disabled}
        onClick={() => fileInput.current?.click()}
        className="flex-1 sm:flex-none"
      >
        <FileUp aria-hidden />
        Choose a file
      </Button>
    </div>
  );
}

/**
 * What the extractor made of a document, and the driver's corrections.
 *
 * A correction never replaces what was extracted: both values stay, with who
 * changed it and when, so the audit trail can always answer "what did the
 * machine read, and who disagreed".
 */
export function DocumentPanel({
  documents, closed, onCorrect, pending,
}: {
  documents: WorkflowDocument[];
  closed: boolean;
  onCorrect: (input: {
    documentId: string;
    fieldKey: string;
    correctedValue: string;
    note?: string;
  }) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState<{
    documentId: string;
    fieldKey: string;
    label: string;
    extractedValue: string;
  } | null>(null);

  if (documents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Paperwork on this trip</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Extraction is a placeholder — no document has been read. Corrections are real and
            are kept beside the extracted value.
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ul className="divide-y divide-border border-t border-border">
          {documents.map((doc) => (
            <li key={doc.documentId} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-medium text-fg">
                  {DOCUMENT_KIND_LABEL[doc.kind as keyof typeof DOCUMENT_KIND_LABEL] ?? doc.kind}
                </span>
                <Badge tone="neutral">{doc.fileName}</Badge>
                {doc.provenance.mock ? <Badge tone="outline">Mock extraction</Badge> : null}
              </div>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                Attached {dateTimeIn(doc.attachedAt, "UTC")} by {doc.byName}
              </p>

              {doc.fields.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {doc.fields.map((field) => (
                    <li
                      key={field.key}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-surface-sunken px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-[0.75rem] text-fg-muted">{field.label}</p>
                        <p className="mt-0.5 text-[0.9375rem] text-fg">
                          {field.correctedValue ?? field.extractedValue}
                        </p>
                        {field.correctedValue ? (
                          // Both values, always. The extracted one is never lost.
                          <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                            Extracted “{field.extractedValue}”, corrected by{" "}
                            {field.correctedBy?.displayNameSnapshot ?? "the driver"}
                            {field.correctionNote ? ` — ${field.correctionNote}` : ""}
                          </p>
                        ) : field.extractionConfidence != null ? (
                          <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                            {Math.round(field.extractionConfidence * 100)}% confidence
                          </p>
                        ) : null}
                      </div>
                      {!closed ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            setEditing({
                              documentId: doc.documentId,
                              fieldKey: field.key,
                              label: field.label,
                              extractedValue: field.extractedValue,
                            })
                          }
                        >
                          <Pencil aria-hidden />
                          Correct
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[0.8125rem] text-fg-muted">
                  Nothing extracted from this one.
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>

      {editing ? (
        <CorrectionDialog
          field={editing}
          open
          onOpenChange={(v) => !v && setEditing(null)}
          pending={pending}
          onConfirm={(correctedValue, note) => {
            onCorrect({
              documentId: editing.documentId,
              fieldKey: editing.fieldKey,
              correctedValue,
              note,
            });
            setEditing(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function CorrectionDialog({
  field, open, onOpenChange, onConfirm, pending,
}: {
  field: { label: string; extractedValue: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (correctedValue: string, note?: string) => void;
  pending?: boolean;
}) {
  const [value, setValue] = useState(field.extractedValue);
  const [note, setNote] = useState("");
  const invalid = value.trim().length === 0 || value.trim() === field.extractedValue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Correct “${field.label}”`}
        description="Both values are kept — what was extracted and what you put right — with your name and the time."
      >
        <div className="mt-4 space-y-4">
          <div className="rounded-md bg-surface-sunken px-3 py-2">
            <p className="text-[0.75rem] text-fg-muted">Extracted</p>
            <p className="mt-0.5 text-[0.9375rem] text-fg">{field.extractedValue}</p>
          </div>

          <Field label="What it should be" htmlFor="correction-value">
            <Input
              id="correction-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>

          <Field
            label="Why"
            htmlFor="correction-note"
            hint="Optional, but it saves the office a phone call."
          >
            <Textarea
              id="correction-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The scale ticket says 8,410."
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={invalid || pending}
            onClick={() => onConfirm(value.trim(), note.trim() || undefined)}
          >
            {pending ? "Saving…" : "Save correction"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

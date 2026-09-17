"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormAlert } from "@/features/auth/form-alert";
import {
  QUALIFICATION_CATEGORY_LABEL, isRestrictedQualificationCategory,
  type QualificationRecordCategory,
} from "@/types";
import { useAdoptDocument, useAdoptionPreview } from "./hooks";

/**
 * "Adopt into the qualification file", with the consequences said out loud.
 *
 * The confirmation is the product here, not the button. Three things have to
 * reach the person before they press it, and all three come from the service's
 * own preview rather than from copy written beside it:
 *
 *   • This pins THIS VERSION. It is not a live link to whatever is current.
 *   • Revocation later does not erase it. A carrier's record of what it relied
 *     on is not the driver's to withdraw.
 *   • Adopting is not verifying. It records that this carrier reviewed this
 *     version, and nothing about any authority having confirmed it.
 *   • And it keeps a RECORD of the version, not the file. "Adopt into the
 *     qualification file" sounds exactly like taking a copy, and this build
 *     takes none — so the confirmation says so rather than letting the name do
 *     the talking.
 */
/**
 * What this build will hold.
 *
 * Filtered through the same restriction the service enforces rather than
 * hand-listed, so a category can never be offered here that `adopt` would
 * refuse — and so lifting one out of the restricted set needs no change to
 * this screen.
 */
const CATEGORIES: QualificationRecordCategory[] = ([
  "commercial_licence",
  "medical_certificate",
  "motor_vehicle_record",
  "employment_application",
  "road_test_certificate",
  "handbook_acknowledgement",
  "other",
] as QualificationRecordCategory[]).filter((c) => !isRestrictedQualificationCategory(c));

export function AdoptDialog({
  documentId,
  driverProfileId,
  driverName,
  open,
  onOpenChange,
  onAdopted,
}: {
  documentId: string;
  driverProfileId: string;
  driverName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdopted: () => void;
}) {
  const preview = useAdoptionPreview(open ? documentId : null);
  const adopt = useAdoptDocument();
  const [category, setCategory] = useState<QualificationRecordCategory>("commercial_licence");
  const [error, setError] = useState<string | undefined>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Adopt into the qualification file"
        description={`This creates a record belonging to this carrier about ${driverName}.`}
        className="max-w-lg"
      >
        <div className="mt-4 space-y-4">
          {preview.isPending ? (
            <p className="text-[0.8125rem] text-fg-muted">Working out what this would do…</p>
          ) : null}

          {preview.data ? (
            <>
              <p className="text-[0.8125rem] text-fg">
                <span className="font-medium">{preview.data.label}</span>, version{" "}
                <span className="font-medium">{preview.data.documentVersion}</span>
                {preview.data.supersedesVersion !== undefined
                  ? ` — this would supersede the record for version ${preview.data.supersedesVersion}, which is kept.`
                  : "."}
              </p>

              {preview.data.alreadyAdopted ? (
                <FormAlert tone="info" title="Already adopted">
                  This carrier has already adopted this exact version. Adopting again changes
                  nothing and creates no second record.
                </FormAlert>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-[0.8125rem] font-medium text-fg">
                  What kind of record is this?
                </span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as QualificationRecordCategory)}
                  aria-label="Record category"
                  className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{QUALIFICATION_CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                  The category decides the retention basis, which is why it is asked rather than
                  guessed from the file.
                </span>
              </label>

              <FormAlert tone="warning" role="none" title="What adopting means">
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {preview.data.consequences.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </FormAlert>

              <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
                {preview.data.retentionSummary}
              </p>

              {/* The claim this dialog must not let a reader make for itself. */}
              <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
                Antcolos stores no file in this build. What is kept is a record of{" "}
                <span className="font-medium">which version</span> you relied on — its
                identity, its version number, its file name and your review. Holding the
                document itself, so that it survives the driver replacing or deleting
                their copy, needs the backend&rsquo;s durable storage.
              </p>
            </>
          ) : null}

          {error ? <FormAlert tone="danger" title="That did not work">{error}</FormAlert> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            size="sm"
            type="button"
            data-testid="confirm-adopt"
            disabled={adopt.isPending || !preview.data}
            onClick={() => {
              setError(undefined);
              adopt.mutate({
                documentId,
                driverProfileId,
                category,
                purpose: "driver_qualification_file",
              }, {
                onSuccess: () => { onAdopted(); onOpenChange(false); },
                onError: (e) => setError(e instanceof Error ? e.message : "That did not work."),
              });
            }}
          >
            {adopt.isPending ? "Adopting…" : "Adopt this version"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

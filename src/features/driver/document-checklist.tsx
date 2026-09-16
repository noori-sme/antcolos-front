"use client";

import { CircleCheck, FileText, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import type { CarrierRelationship, DocumentRequirement, DriverDocument } from "@/types";
import { driverRequirements } from "@/lib/documents/requirements";
import { DocumentItem } from "./document-item";
import { ENGAGEMENT_LABEL } from "./driver-rules";
import {
  completion,
  documentRequirements,
  mockRemoveDocument,
  mockSetDocumentExpiry,
  mockSubmitDocument,
  mockUploadDocument,
} from "./mock-driver";
import { currentRelationship, useDriverData } from "./use-driver-data";
import { cn } from "@/lib/utils";

/**
 * The driver's paperwork for one carrier.
 *
 * What is asked for depends on the carrier and on whether this is a company
 * driver or an owner-operator, so the list is built from the relationship
 * rather than hard-coded. A driver working for two carriers switches between
 * their checklists here.
 */
export function DocumentChecklistScreen() {
  const data = useDriverData();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const workable = data.relationships.filter((r) => r.status !== "ended");
  const active = workable.find((r) => r.id === selectedId) ?? currentRelationship(workable);

  if (data.loading) return <LoadingSkeleton rows={5} />;

  if (!data.profile) {
    return (
      <div className="space-y-section">
        <PageHeader title="My documents" description="The paperwork that belongs to you." />
        <EmptyState
          icon={FileText}
          title="You don't have a driver profile yet"
          description="Sign up as a driver, or accept a carrier's invitation, and your documents live here."
        />
      </div>
    );
  }

  // No carrier yet — but the driver's own paperwork is still theirs to supply,
  // and supplying it now is the whole point of being able to start alone. The
  // carrier-independent driver set is what anybody will ask for.
  if (!active) return <OwnDocuments data={data} />;

  return (
    <div className="space-y-section">
      <PageHeader
        title="My documents"
        description={`What ${active.carrierName} needs from you as a ${ENGAGEMENT_LABEL[active.engagementType].toLowerCase()}.`}
      />

      {workable.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a carrier">
          {workable.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === active.id}
              onClick={() => setSelectedId(r.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                r.id === active.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {r.carrierName}
            </button>
          ))}
        </div>
      ) : null}

      <ChecklistBody relationship={active} data={data} />
    </div>
  );
}

/**
 * The driver's own paperwork, before any carrier is in the picture.
 *
 * Same screen, same checklist rows, same upload path — the only difference is
 * that nobody is asking and nobody has reviewed it. These documents belong to
 * the driver: they are kept when a carrier arrives, shown to that carrier
 * because the driver shared them, and still here when the carrier is gone.
 */
function OwnDocuments({ data }: { data: ReturnType<typeof useDriverData> }) {
  // The carrier-independent driver set — what every carrier asks a company
  // driver for. Owner-operator paperwork depends on an engagement, which is a
  // carrier's decision, so it is not pre-empted here.
  const requirements = driverRequirements("company_driver");

  return (
    <div className="space-y-section">
      <PageHeader
        title="My documents"
        description="Your licence, medical card and tax details — yours, and kept between carriers."
      />

      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
        <ShieldCheck className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          No carrier has reviewed any of these. You are not working with one yet, so nothing here
          has been approved or rejected by anybody — it is simply what you have supplied. When a
          carrier invites you and you share these, they review the same documents; you do not
          upload them again.
        </p>
      </div>

      <ChecklistBody requirements={requirements} data={data} />
    </div>
  );
}

export function ChecklistBody({
  relationship,
  requirements: given,
  data,
  compact,
}: {
  /** Absent when the driver is supplying their own paperwork with no carrier. */
  relationship?: CarrierRelationship;
  /** Overrides the carrier's checklist. Used for the driver's own document set. */
  requirements?: readonly DocumentRequirement[];
  data: ReturnType<typeof useDriverData>;
  compact?: boolean;
}) {
  const requirements = useMemo(
    () =>
      given
        ?? (relationship
          ? documentRequirements(relationship.engagementType, relationship.carrierId)
          : []),
    [given, relationship],
  );
  const byKey = new Map(data.documents.map((d) => [d.requirementKey, d]));
  const progress = completion(requirements, data.documents);

  const driverDocs = requirements.filter((r) => r.setId === "driver");
  const ownerDocs = requirements.filter((r) => r.setId === "owner_operator");

  function patch(next: DriverDocument) {
    const others = data.documents.filter((d) => d.requirementKey !== next.requirementKey);
    data.setDocuments([...others, next]);
  }

  async function upload(key: string, file: File) {
    patch({
      requirementKey: key,
      status: "selected_local",
      uploading: true,
      fileName: file.name,
      fileType: file.type,
      sizeBytes: file.size,
      progress: 0,
    });
    const saved = await mockUploadDocument(
      key,
      { name: file.name, type: file.type, size: file.size },
      (percent) =>
        patch({
          requirementKey: key,
          status: "selected_local",
          uploading: true,
          fileName: file.name,
          fileType: file.type,
          sizeBytes: file.size,
          progress: percent,
        }),
    );
    patch(saved);
  }

  const handlers = (key: string) => ({
    onUpload: (file: File) => void upload(key, file),
    // Submitting means "a carrier should look at this". With no carrier there
    // is nobody to send it to, and the row says so instead of offering it.
    onSubmit: relationship ? () => void mockSubmitDocument(key).then(patch) : undefined,
    onRemove: () => {
      void mockRemoveDocument(key);
      data.setDocuments(data.documents.filter((d) => d.requirementKey !== key));
    },
    onExpiryChange: (value: string) => {
      const existing = data.documents.find((d) => d.requirementKey === key);
      if (!existing) return;
      const iso = value ? new Date(`${value}T00:00:00`).toISOString() : undefined;
      patch({ ...existing, expiresAt: iso });
      if (iso) void mockSetDocumentExpiry(key, iso);
    },
  });

  return (
    <div className="space-y-5">
      <ProgressPanel progress={progress} compact={compact} />

      <section aria-labelledby="driver-docs">
        <h2 id="driver-docs" className="mb-2.5 text-[0.9375rem] font-semibold text-fg">
          Your driver documents
        </h2>
        <ul className="space-y-2.5">
          {driverDocs.map((requirement) => (
            <DocumentItem
              key={requirement.key}
              requirement={requirement}
              document={byKey.get(requirement.key)}
              {...handlers(requirement.key)}
            />
          ))}
        </ul>
      </section>

      {ownerDocs.length > 0 ? (
        <section aria-labelledby="owner-docs">
          <h2 id="owner-docs" className="mb-1 text-[0.9375rem] font-semibold text-fg">
            Owner-Operator documents
          </h2>
          <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            You run your own truck and business, so the carrier needs your business paperwork as
            well as your driver paperwork.
          </p>
          <ul className="space-y-2.5">
            {ownerDocs.map((requirement) => (
              <DocumentItem
                key={requirement.key}
                requirement={requirement}
                document={byKey.get(requirement.key)}
                {...handlers(requirement.key)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
        Preview build: files are not uploaded, stored or checked by anyone. Nothing here is
        verified, and nothing leaves your browser.
      </p>
    </div>
  );
}

function ProgressPanel({
  progress,
  compact,
}: {
  progress: ReturnType<typeof completion>;
  compact?: boolean;
}) {
  const done = progress.outstanding.length === 0;
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        done ? "border-st-success/35 bg-st-success-bg/40" : "border-border bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-fg">
          {done ? <CircleCheck className="size-4 text-st-success" aria-hidden /> : null}
          {done ? "Everything asked for is in" : "Complete your driver profile"}
        </p>
        <p className="text-[0.8125rem] text-fg-muted tabular-nums">
          {progress.done} of {progress.required} required
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Driver profile completion"
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", done ? "bg-st-success" : "bg-primary")}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {!done && !compact ? (
        <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          Still needed: {progress.outstanding.map((r) => r.label).join(", ")}. You can keep driving
          while you sort these out.
        </p>
      ) : null}
    </div>
  );
}

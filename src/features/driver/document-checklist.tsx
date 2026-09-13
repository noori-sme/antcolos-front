"use client";

import { CircleCheck, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import type { CarrierRelationship, DriverDocument } from "@/types";
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

  if (!data.profile || !active) {
    return (
      <div className="space-y-section">
        <PageHeader title="My documents" description="Paperwork your carrier needs from you." />
        <EmptyState
          icon={FileText}
          title="No carrier is asking for anything yet"
          description="Once you accept a carrier's invitation, the documents they need appear here."
        />
      </div>
    );
  }

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

export function ChecklistBody({
  relationship,
  data,
  compact,
}: {
  relationship: CarrierRelationship;
  data: ReturnType<typeof useDriverData>;
  compact?: boolean;
}) {
  const requirements = useMemo(
    () => documentRequirements(relationship.engagementType, relationship.carrierId),
    [relationship.engagementType, relationship.carrierId],
  );
  const byKey = new Map(data.documents.map((d) => [d.requirementKey, d]));
  const progress = completion(requirements, data.documents);

  const driverDocs = requirements.filter((r) => r.category === "driver");
  const ownerDocs = requirements.filter((r) => r.category === "owner_operator");

  function patch(next: DriverDocument) {
    const others = data.documents.filter((d) => d.requirementKey !== next.requirementKey);
    data.setDocuments([...others, next]);
  }

  async function upload(key: string, file: File) {
    patch({
      requirementKey: key,
      status: "uploading",
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
          status: "uploading",
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
    onRemove: () => {
      void mockRemoveDocument(key);
      data.setDocuments(data.documents.filter((d) => d.requirementKey !== key));
    },
    onSubmit: () => void mockSubmitDocument(key).then(patch),
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
          {done ? "Everything the carrier asked for is in" : "Complete your driver profile"}
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

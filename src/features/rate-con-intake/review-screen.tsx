"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Can } from "@/components/auth/can";
import { RateConStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { fieldLabel } from "@/lib/rate-con/fields";
import type { RateConDocument } from "@/types/rate-con-intake";
import { DocumentPane, type ActiveSource } from "./document-pane";
import { FieldList } from "./field-list";
import { fieldDomId } from "./field-row";
import {
  isReading, useDocumentReview, useIntentKey, useRateConDocument, useRetryExtraction,
} from "./hooks";
import { ApprovedBanner, LoadPreview } from "./load-preview";

function hasFields(document: RateConDocument): boolean {
  return document.status !== "received" && document.status !== "expected";
}

function Reading() {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-5 shadow-e1"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 shrink-0 text-fg-subtle motion-safe:animate-spin" aria-hidden />
      <div>
        <p className="text-[0.875rem] font-medium text-fg">Reading the Rate Con…</p>
        <p className="text-[0.8125rem] text-fg-muted">This usually takes under a minute. The fields appear here.</p>
      </div>
    </div>
  );
}

function ReadFailed({ document }: { document: RateConDocument }) {
  const retry = useRetryExtraction(document.id);
  const retryKey = useIntentKey();
  return (
    <div className="space-y-3">
      <ErrorState
        title="This Rate Con could not be read"
        description={
          document.latestRun?.errorCode
            ? `The reader stopped (${document.latestRun.errorCode}). Try again, or create the load by hand.`
            : "Try again, or create the load by hand."
        }
      />
      <Can permission="documents:review">
        <Button
          variant="secondary"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(
              { idempotencyKey: retryKey.keyFor("retry") },
              { onSuccess: () => retryKey.clear() },
            )
          }
        >
          <RefreshCw aria-hidden />
          {retry.isPending ? "Starting…" : "Read it again"}
        </Button>
      </Can>
      {retry.error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {retry.error.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A Rate Con beside its fields (plan 13, F1.1): review riskiest-first,
 * complete the review, preview the load, approve it.
 */
export function RateConReviewScreen({ documentId }: { documentId: string }) {
  const document = useRateConDocument(documentId);
  const doc = document.data;
  const ready = Boolean(doc && hasFields(doc));
  const review = useDocumentReview(documentId, ready);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  const activeField = review.data?.fields.find((f) => f.id === activeFieldId) ?? null;
  const active: ActiveSource | null = activeField
    ? { label: fieldLabel(activeField.path), page: activeField.page, box: activeField.box }
    : null;

  const focusPath = useCallback(
    (path: string) => {
      const field = review.data?.fields.find((f) => f.path === path);
      if (!field) return;
      setActiveFieldId(field.id);
      const row = window.document.getElementById(fieldDomId(field.id));
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.focus({ preventScroll: true });
    },
    [review.data],
  );

  if (document.isPending) {
    return (
      <div className="space-y-section">
        <PageHeader title="Rate confirmation" />
        <LoadingSkeleton rows={4} />
      </div>
    );
  }
  if (document.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="Rate confirmation" />
        <ErrorState
          title="Could not open this Rate Con"
          description={document.error.message}
          onRetry={() => void document.refetch()}
        />
      </div>
    );
  }

  const data = document.data;
  const failed = !isReading(data) && data.latestRun?.status === "failed" && !hasFields(data);

  return (
    <div className="space-y-section">
      <PageHeader
        title={data.file.filename || "Rate confirmation"}
        description="Check the values against the document. High-risk values each need a decision before the load can be approved."
        actions={<RateConStatusBadge status={data.status} />}
      />

      {data.status === "accepted" ? <ApprovedBanner loadId={data.loadId} /> : null}

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <DocumentPane
            documentId={documentId}
            filename={data.file.filename}
            mimeType={data.file.mimeType}
            active={active}
          />
        </div>

        <div className="min-w-0 space-y-section">
          {isReading(data) ? <Reading /> : null}
          {failed ? <ReadFailed document={data} /> : null}
          {ready ? (
            review.isPending ? (
              <LoadingSkeleton rows={6} />
            ) : review.isError ? (
              <ErrorState
                title="Could not load the fields"
                description={review.error.message}
                onRetry={() => void review.refetch()}
              />
            ) : (
              <FieldList
                documentId={documentId}
                review={review.data}
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
              />
            )
          ) : null}
          {data.status === "reviewed" ? (
            <LoadPreview documentId={documentId} onFix={focusPath} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Can } from "@/components/auth/can";
import { RateConStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { fieldLabel } from "@/lib/rate-con/fields";
import { rateConDisplayStatus } from "@/lib/rate-con/status";
import type { RateConDocument } from "@/types/rate-con-intake";
import { DocumentPane, type ActiveSource } from "./document-pane";
import { FieldList } from "./field-list";
import { fieldDomId } from "./field-row";
import {
  isReading, readingFor, RETRY_STUCK_MS, SLOW_READ_MS, useDocumentReview, useIntentKey,
  useRateConDocument, useRetryExtraction,
} from "./hooks";
import { ApprovedBanner, LoadPreview } from "./load-preview";

function hasFields(document: RateConDocument): boolean {
  return document.status !== "received" && document.status !== "expected";
}

function Reading({ document }: { document: RateConDocument }) {
  const elapsed = readingFor(document);
  const slow = elapsed > SLOW_READ_MS;
  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-5 shadow-e1"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-5 shrink-0 text-fg-subtle motion-safe:animate-spin" aria-hidden />
        <div>
          <p className="text-[0.875rem] font-medium text-fg">
            {slow ? "This is taking longer than usual…" : "Reading the Rate Con…"}
          </p>
          <p className="text-[0.8125rem] text-fg-muted">
            {slow
              ? "It is still queued or being read. You can start it again after 10 minutes."
              : "This usually takes under a minute. The fields appear here."}
          </p>
        </div>
      </div>
      {elapsed > RETRY_STUCK_MS ? <RetryButton document={document} /> : null}
    </div>
  );
}

function RetryButton({ document }: { document: RateConDocument }) {
  const retry = useRetryExtraction(document.id);
  const retryKey = useIntentKey();
  return (
    <Can permission="documents:review">
      <Button
        variant="secondary"
        disabled={retry.isPending}
        onClick={() =>
          retry.mutate(
            { idempotencyKey: retryKey.keyFor("retry") },
            // Retry, complete and approve are guarded by state on the server, so a
            // fresh key after a failure cannot double anything.
            { onSettled: () => retryKey.clear() },
          )
        }
      >
        <RefreshCw aria-hidden />
        {retry.isPending ? "Starting…" : "Read it again"}
      </Button>
      {retry.error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-st-danger">
          {retry.error.message}
        </p>
      ) : null}
    </Can>
  );
}

function ReadFailed({ document }: { document: RateConDocument }) {
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
      <RetryButton document={document} />
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
  const [pdfPage, setPdfPage] = useState(1);

  const activeField = review.data?.fields.find((f) => f.id === activeFieldId) ?? null;
  const active: ActiveSource | null = activeField
    ? { label: fieldLabel(activeField.path), page: activeField.page, box: activeField.box }
    : null;

  const activate = useCallback(
    (fieldId: string, jump: boolean) => {
      setActiveFieldId(fieldId);
      const page = jump ? review.data?.fields.find((f) => f.id === fieldId)?.page : null;
      if (page) setPdfPage(page);
    },
    [review.data],
  );

  /** "Fix in the review": the first listed path that is a field of this review. */
  const focusPath = useCallback(
    (paths: string[]) => {
      const field = paths
        .map((path) => review.data?.fields.find((f) => f.path === path))
        .find(Boolean);
      if (!field) return;
      setActiveFieldId(field.id);
      if (field.page) setPdfPage(field.page);
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
  // A failed background refresh keeps what is on screen; only a first load
  // without data shows the full error.
  if (document.isError && !document.data) {
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

  const data = document.data!;
  const failed = !isReading(data) && data.latestRun?.status === "failed" && !hasFields(data);

  return (
    <div className="space-y-section">
      <PageHeader
        title={data.file.filename || "Rate confirmation"}
        description="Check the values against the document. High-risk values each need a decision before the load can be approved."
        actions={<RateConStatusBadge status={rateConDisplayStatus(data)} />}
      />

      {document.isError ? (
        <p role="status" className="text-[0.8125rem] text-fg-muted">
          Couldn&apos;t refresh the status ({document.error.message}).{" "}
          <Button size="sm" variant="link" onClick={() => void document.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}

      {data.status === "accepted" ? <ApprovedBanner loadId={data.loadId} /> : null}

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <DocumentPane
            documentId={documentId}
            filename={data.file.filename}
            mimeType={data.file.mimeType}
            active={active}
            pdfPage={pdfPage}
          />
        </div>

        <div className="min-w-0 space-y-section">
          {isReading(data) ? <Reading document={data} /> : null}
          {failed ? <ReadFailed document={data} /> : null}
          {ready ? (
            review.isPending ? (
              <LoadingSkeleton rows={6} />
            ) : review.isError && !review.data ? (
              <ErrorState
                title="Could not load the fields"
                description={review.error.message}
                onRetry={() => void review.refetch()}
              />
            ) : (
              <FieldList
                documentId={documentId}
                review={review.data!}
                activeFieldId={activeFieldId}
                onActivate={activate}
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

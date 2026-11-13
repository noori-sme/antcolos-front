"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createIntentKeys } from "@/lib/rate-con/intent-key";
import { services, type ServiceContext } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import type { RateConDocument, ReviewDecision } from "@/types/rate-con-intake";

/**
 * Rate Con intake keys (plan 13), namespaced by organization. Every write
 * invalidates `rateConKeys.document(org, id)`: status, review, draft and file.
 */
export const rateConKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "rate-con"] as const,
  document: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId] as const,
  detail: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "detail"] as const,
  review: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "review"] as const,
  draft: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "load-draft"] as const,
  file: (organizationId: string, documentId: string) =>
    [...orgKey(organizationId), "rate-con", documentId, "file"] as const,
};

/** Poll every 2.5 s while the extraction is queued or running (requirements §2), 10 s after 2 min. */
export const POLL_MS = 2_500;
export const SLOW_POLL_MS = 10_000;
/** Past this, say the read is taking longer than usual (review, plan 13). */
export const SLOW_READ_MS = 5 * 60_000;
/** The backend lets a RUNNING run be retried after 10 minutes (contract §5). */
export const RETRY_STUCK_MS = 10 * 60_000;

export function isReading(document: RateConDocument | undefined): boolean {
  const status = document?.latestRun?.status;
  return status === "pending" || status === "running";
}

/** How long the current read has been going, from its start or the upload. */
export function readingFor(document: RateConDocument, now = Date.now()): number {
  const since = Date.parse(document.latestRun?.startedAt ?? document.receivedAt);
  return Number.isFinite(since) ? Math.max(0, now - since) : 0;
}

export function useRateConDocument(documentId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.detail(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.get(ctx!, documentId),
    enabled: Boolean(ctx),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || !isReading(data)) return false;
      return readingFor(data) > 2 * 60_000 ? SLOW_POLL_MS : POLL_MS;
    },
  });
}

export function useDocumentReview(documentId: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.review(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.review(ctx!, documentId),
    enabled: Boolean(ctx) && enabled,
  });
}

export function useLoadDraft(documentId: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.draft(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.loadDraft(ctx!, documentId),
    enabled: Boolean(ctx) && enabled,
  });
}

/**
 * The signed URL expires (15 min by default). It is fetched once and kept: a
 * new URL would reload the viewer. The document pane asks for a fresh one
 * only when it needs to navigate after the old one expired.
 */
export function useDocumentFileUrl(documentId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: rateConKeys.file(ctx?.organizationId ?? "", documentId),
    queryFn: () => services.rateConIntake.fileUrl(ctx!, documentId),
    enabled: Boolean(ctx),
    staleTime: Infinity,
    retry: false,
  });
}

function useRateConMutation<TVars, TResult>(
  documentId: string | null,
  run: (ctx: ServiceContext, vars: TVars) => Promise<TResult>,
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    // A conflict (someone else decided a field) also leaves the cache stale.
    // The file URL is left alone: refetching it would reload the viewer.
    onSettled: async () => {
      if (!ctx || !documentId) return;
      const org = ctx.organizationId;
      await Promise.all(
        [rateConKeys.detail(org, documentId), rateConKeys.review(org, documentId), rateConKeys.draft(org, documentId)].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

export function useUploadRateCon() {
  return useRateConMutation(null, (ctx, vars: { file: File; idempotencyKey: string }) =>
    services.rateConIntake.upload(ctx, vars.file, vars.idempotencyKey),
  );
}

export function useRetryExtraction(documentId: string) {
  return useRateConMutation(documentId, (ctx, vars: { idempotencyKey: string }) =>
    services.rateConIntake.retryExtraction(ctx, documentId, vars.idempotencyKey),
  );
}

export function useDecideFields(documentId: string) {
  return useRateConMutation(
    documentId,
    (ctx, vars: { decisions: ReviewDecision[]; idempotencyKey: string }) =>
      services.rateConIntake.decide(ctx, documentId, vars.decisions, vars.idempotencyKey),
  );
}

export function useCompleteReview(documentId: string) {
  return useRateConMutation(documentId, (ctx, vars: { idempotencyKey: string }) =>
    services.rateConIntake.completeReview(ctx, documentId, vars.idempotencyKey),
  );
}

export function useApproveRateCon(documentId: string) {
  return useRateConMutation(documentId, (ctx, vars: { idempotencyKey: string }) =>
    services.rateConIntake.approve(ctx, documentId, vars.idempotencyKey),
  );
}

/** One Idempotency-Key per user intent; see `createIntentKeys`. */
export function useIntentKey() {
  const [keys] = useState(() => createIntentKeys());
  return keys;
}
